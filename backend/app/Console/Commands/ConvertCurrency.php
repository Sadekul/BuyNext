<?php

namespace App\Console\Commands;

use App\Services\Audit;
use App\Services\CatalogRules;
use App\Services\Pricing;
use App\Services\Settings;
use App\Support\Currency;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/**
 * Phase 12: switches an existing store's prices to a new currency
 * (docs/CURRENCY.md). Every stored price-like amount is multiplied by the
 * rate and rounded; orders, invoices, credit memos, and history keep their
 * own currency and are never touched.
 *
 *   php artisan buynest:currency:convert BDT --rate=110 [--dry-run] [--round=1|5|10|0.01] [--from=USD]
 *
 * Refused unless BUYNEST_CURRENCY already is the target (code and data
 * change together), and refused a second time for the same target
 * (currency_conversions). One transaction; audited currency.converted.
 */
class ConvertCurrency extends Command
{
    protected $signature = 'buynest:currency:convert
        {currency : The new store currency (ISO 4217, e.g. BDT); BUYNEST_CURRENCY must already be set to it}
        {--rate= : How many units of the new currency one unit of the old one is worth (e.g. 110)}
        {--round=1 : Round converted prices to a multiple of this: 1, 5, 10, or 0.01}
        {--from= : The currency the prices are in now (default: the last conversion\'s target, else USD)}
        {--dry-run : Show what would change, change nothing}';

    protected $description = 'Convert every stored price to a new store currency (orders and documents are left alone)';

    /** Settings that are money, converted with --round. */
    private const MONEY_SETTINGS = ['standard_price', 'express_price', 'next_day_price', 'free_shipping_threshold'];

    private string $rate;

    private int $stepCents;

    /** Up to three before/after examples per kind, for the report. */
    private array $examples = [];

    public function handle(Settings $settings, Audit $audit, CatalogRules $rules): int
    {
        $to = strtoupper(trim((string) $this->argument('currency')));
        $from = strtoupper(trim((string) ($this->option('from') ?: (DB::table('currency_conversions')->latest('id')->value('to_currency') ?? 'USD'))));
        $dryRun = (bool) $this->option('dry-run');

        try {
            [$this->rate, $this->stepCents] = $this->parseOptions();
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage());

            return self::INVALID;
        }
        $problem = match (true) {
            ! preg_match('/^[A-Z]{3}$/', $to) => "\"{$to}\" isn't a currency code (use ISO 4217, e.g. BDT).",
            ! preg_match('/^[A-Z]{3}$/', $from) => "--from \"{$from}\" isn't a currency code.",
            DB::table('currency_conversions')->where('to_currency', $to)->exists() => "The prices were already converted to {$to} once "
                .'(see the currency_conversions table). Running it again would multiply them twice.',
            $from === $to => "The prices are already in {$to}.",
            Currency::store() !== $to => "Set BUYNEST_CURRENCY={$to} first (it is ".Currency::store().' now), clear the config cache, then run this again: '
                .'the code and the prices must change together.',
            default => null,
        };
        if ($problem) {
            $this->error($problem);

            return self::FAILURE;
        }

        $this->info(($dryRun ? 'Dry run: nothing is saved. ' : '')."Converting prices {$from} → {$to} at {$this->rate}, rounded to "
            .Pricing::format($this->stepCents).' '.$to.'.');

        // One transaction; a dry run does all the work and rolls it back, so its counts are the real ones.
        DB::beginTransaction();
        try {
            $counts = $this->convert($from, $to, $settings);
            if ($dryRun) {
                DB::rollBack();
            } else {
                $this->record($from, $to, $counts, $audit);
                DB::commit();
            }
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }

        if (! $dryRun) {
            $settings->flush();
            $rules->flush();
        }

        $this->table(['What', 'Rows changed'], collect($counts)->map(fn ($n, $what) => [$what, $n])->values()->all());
        foreach ($this->examples as $what => $rows) {
            $this->line("<comment>{$what}</comment>");
            foreach ($rows as $row) {
                $this->line("  {$row}");
            }
        }
        $this->info($dryRun ? 'Dry run finished: nothing was changed.' : "Done. Prices are now in {$to}. Clear the caches (php artisan optimize:clear) and check the shop.");

        return self::SUCCESS;
    }

    private function record(string $from, string $to, array $counts, Audit $audit): void
    {
        $id = DB::table('currency_conversions')->insertGetId([
            'from_currency' => $from,
            'to_currency' => $to,
            'rate' => $this->rate,
            'rounding' => Pricing::format($this->stepCents),
            'actor' => 'cli',
            'admin_id' => null,
            'counts' => json_encode($counts),
            'created_at' => now(),
        ]);
        $audit->record('currency.converted', "Store prices converted {$from} → {$to} at {$this->rate} (rounded to ".Pricing::format($this->stepCents).').',
            'currency_conversion', $id, ['before' => ['currency' => $from], 'after' => ['currency' => $to, 'rate' => $this->rate,
                'rounding' => Pricing::format($this->stepCents), 'counts' => $counts]]);
    }

    /** [rate as a decimal string, rounding step in cents]. */
    private function parseOptions(): array
    {
        $rate = trim((string) $this->option('rate'));
        if (! preg_match('/^\d{1,10}(\.\d{1,8})?$/', $rate) || (float) $rate <= 0) {
            throw new InvalidArgumentException('Give the rate as a positive number, e.g. --rate=110 (one unit of the old currency in the new one).');
        }
        $round = trim((string) $this->option('round'));
        if (! in_array($round, ['1', '5', '10', '0.01', '1.00', '5.00', '10.00'], true)) {
            throw new InvalidArgumentException('--round must be 1, 5, 10, or 0.01.');
        }

        return [$rate, Pricing::toCents($round)];
    }

    /** Multiplies $cents by the rate and rounds to the step (halves up). */
    private function price(int $cents, ?int $stepCents = null): int
    {
        $step = $stepCents ?? $this->stepCents;
        $converted = $cents * (float) $this->rate;

        return (int) (round($converted / $step, 0, PHP_ROUND_HALF_UP) * $step);
    }

    private function money(mixed $value, ?int $stepCents = null): ?string
    {
        return $value === null || $value === '' ? null : Pricing::format($this->price(Pricing::toCents((string) $value), $stepCents));
    }

    private function example(string $what, string $label, mixed $before, mixed $after): void
    {
        if (count($this->examples[$what] ?? []) < 3) {
            $this->examples[$what][] = "{$label}: {$before} → {$after}";
        }
    }

    /** Converts everything; returns table => rows changed. */
    private function convert(string $from, string $to, Settings $settings): array
    {
        $counts = [];
        $now = now();

        // Products: price, and gift card products' amounts and limits (deleted products too: they can be restored).
        $counts['products'] = 0;
        foreach (DB::table('products')->orderBy('id')->get(['id', 'name', 'price', 'gift_card_amounts', 'gift_card_min_amount', 'gift_card_max_amount']) as $row) {
            $amounts = $row->gift_card_amounts !== null ? json_decode($row->gift_card_amounts, true) : null;
            $update = [
                'price' => $this->money($row->price),
                'gift_card_amounts' => is_array($amounts) ? json_encode(array_values(array_map(fn ($a) => $this->money($a), $amounts))) : $row->gift_card_amounts,
                'gift_card_min_amount' => $this->money($row->gift_card_min_amount),
                'gift_card_max_amount' => $this->money($row->gift_card_max_amount),
                'updated_at' => $now,
            ];
            DB::table('products')->where('id', $row->id)->update($update);
            $this->example('Products', $row->name, $row->price, $update['price']);
            $counts['products']++;
        }

        // Variant prices (null = the product's price).
        $counts['product_variants'] = 0;
        foreach (DB::table('product_variants')->whereNotNull('price')->orderBy('id')->get(['id', 'sku', 'price']) as $row) {
            $price = $this->money($row->price);
            DB::table('product_variants')->where('id', $row->id)->update(['price' => $price, 'updated_at' => $now]);
            $this->example('Variants', $row->sku, $row->price, $price);
            $counts['product_variants']++;
        }

        // Catalog price rules: fixed amounts (percentages don't change).
        $counts['catalog_rules'] = 0;
        foreach (DB::table('catalog_rules')->where('action', 'fixed')->orderBy('id')->get(['id', 'name', 'amount']) as $row) {
            $amount = $this->money($row->amount);
            DB::table('catalog_rules')->where('id', $row->id)->update(['amount' => $amount, 'updated_at' => $now]);
            $this->example('Catalog price rules', $row->name, $row->amount, $amount);
            $counts['catalog_rules']++;
        }

        // Coupons and cart price rules: fixed amounts and minimum subtotals.
        $counts['coupons'] = 0;
        foreach (DB::table('coupons')->where(fn ($q) => $q->where('type', 'fixed')->orWhereNotNull('min_subtotal'))->orderBy('id')
            ->get(['id', 'code', 'description', 'type', 'value', 'min_subtotal']) as $row) {
            $update = [
                'value' => $row->type === 'fixed' ? $this->money($row->value) : $row->value,
                'min_subtotal' => $this->money($row->min_subtotal),
                'updated_at' => $now,
            ];
            DB::table('coupons')->where('id', $row->id)->update($update);
            $this->example('Coupons and cart rules', $row->code ?? $row->description, $row->type === 'fixed' ? $row->value : "min {$row->min_subtotal}",
                $row->type === 'fixed' ? $update['value'] : "min {$update['min_subtotal']}");
            $counts['coupons']++;
        }

        // Shipping table rates: prices and subtotal bands.
        $counts['shipping_rates'] = 0;
        foreach (DB::table('shipping_rates')->orderBy('id')->get(['id', 'method', 'country', 'price', 'min_subtotal', 'max_subtotal']) as $row) {
            $update = [
                'price' => $this->money($row->price),
                'min_subtotal' => $this->money($row->min_subtotal) ?? '0.00',
                'max_subtotal' => $this->money($row->max_subtotal),
                'updated_at' => $now,
            ];
            DB::table('shipping_rates')->where('id', $row->id)->update($update);
            $this->example('Shipping rates', "{$row->method} {$row->country}", $row->price, $update['price']);
            $counts['shipping_rates']++;
        }

        // Settings: flat shipping prices, the free-shipping threshold, and the reward point value (4 decimals, not rounded to the step).
        $values = [];
        foreach (self::MONEY_SETTINGS as $key) {
            $values[$key] = $this->money($settings->get($key, '0'));
            $this->example('Settings', $key, $settings->get($key), $values[$key]);
        }
        $pointValue = (float) $settings->get('rewards_point_value', '0.0100');
        $values['rewards_point_value'] = number_format(max(0.0001, round($pointValue * (float) $this->rate, 4)), 4, '.', '');
        $this->example('Settings', 'rewards_point_value', $settings->get('rewards_point_value'), $values['rewards_point_value']);
        foreach ($values as $key => $value) {
            DB::table('settings')->updateOrInsert(['key' => $key], ['value' => json_encode($value), 'updated_at' => $now]);
            DB::table('settings')->where('key', $key)->whereNull('created_at')->update(['created_at' => $now]);
        }
        $counts['settings'] = count($values);

        // Unused gift card balances: converted to the cent (never rounded away), with a transaction note.
        $counts['gift_cards'] = 0;
        foreach (DB::table('gift_cards')->where('currency', $from)->where('balance', '>', 0)->orderBy('id')
            ->get(['id', 'last4', 'balance', 'initial_balance']) as $row) {
            $balance = $this->money($row->balance, 1);
            DB::table('gift_cards')->where('id', $row->id)->update([
                'balance' => $balance,
                'initial_balance' => $this->money($row->initial_balance, 1),
                'currency' => $to,
                'updated_at' => $now,
            ]);
            DB::table('gift_card_transactions')->insert([
                'gift_card_id' => $row->id,
                'amount' => '0.00',
                'balance_after' => $balance,
                'note' => "Currency changed: {$row->balance} {$from} → {$balance} {$to} (rate {$this->rate}).",
                'created_at' => $now,
            ]);
            $this->example('Gift cards', "••••{$row->last4}", "{$row->balance} {$from}", "{$balance} {$to}");
            $counts['gift_cards']++;
        }

        // Saved carts' subtotals (cart reminders), and display currency rates (they are relative to the store currency).
        $counts['customer_carts'] = DB::table('customer_carts')->count();
        foreach (DB::table('customer_carts')->get(['id', 'subtotal']) as $row) {
            DB::table('customer_carts')->where('id', $row->id)->update(['subtotal' => $this->money($row->subtotal, 1)]);
        }
        $counts['currency_rates'] = 0;
        foreach (DB::table('currency_rates')->orderBy('id')->get(['id', 'code', 'rate']) as $row) {
            if ($row->code === $to) {
                // The new store currency can't also be a display currency.
                DB::table('currency_rates')->where('id', $row->id)->update(['enabled' => false, 'updated_at' => $now]);
            } elseif ((float) $row->rate > 0) {
                $rate = number_format((float) $row->rate / (float) $this->rate, 8, '.', '');
                DB::table('currency_rates')->where('id', $row->id)->update(['rate' => $rate, 'updated_at' => $now]);
                $this->example('Display currencies', $row->code, $row->rate, $rate);
            } else {
                continue;
            }
            $counts['currency_rates']++;
        }

        return $counts;
    }
}
