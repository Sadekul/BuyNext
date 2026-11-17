<?php

namespace App\Services;

use App\Jobs\SendStockAlertBatch;
use App\Models\Customer;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\StockAlert;
use App\Support\CategoryTree;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Phase 9 (part B): "Email me when it's back in stock".
 *
 * - Asking (subscribe) never tells anyone whether the address was already
 *   listed: the controller always answers the same 202.
 * - Sending: whenever a product or one of its variants changes (stock,
 *   status, active, minimum quantity), App\Providers\LaunchServiceProvider
 *   calls queueCheck(), which looks after the transaction commits for
 *   waiting alerts whose product/variant can be bought again and queues
 *   SendStockAlertBatch jobs of 100. One central hook, so every way stock
 *   comes back (the product form, variant edits, bulk "set stock", CSV
 *   import, refunds with restock, cancellations, received returns) is covered
 *   without each of them knowing about alerts.
 * - Each alert is claimed with an atomic UPDATE before its email is sent, so
 *   it is sent once even if two checks queue the same alert.
 */
class StockAlerts
{
    public const MESSAGE = 'Thanks! We\'ll email you once when it\'s back in stock.';

    /** Saves a waiting alert unless the same one is already waiting (silently). */
    public function subscribe(Product $product, ?ProductVariant $variant, string $email, ?Customer $customer): void
    {
        $email = mb_strtolower(trim($email));
        $key = StockAlert::waitingKey($product->id, $variant?->id, $email);

        $inserted = StockAlert::query()->insertOrIgnore([
            'product_id' => $product->id,
            'variant_id' => $variant?->id,
            'email' => $email,
            'customer_id' => $customer?->id,
            // Replaced when the email is sent (the link needs the plain token, which isn't kept).
            'token_hash' => hash('sha256', Str::random(40)),
            'waiting_key' => $key,
            'created_at' => now(),
        ]);
        if (! $inserted && $customer) {
            // Already waiting (maybe asked as a guest): link it to the account.
            StockAlert::where('waiting_key', $key)->whereNull('customer_id')->update(['customer_id' => $customer->id]);
        }
    }

    /**
     * Can it be bought right now? The product is for sale and has at least its
     * minimum order quantity in stock: the variant's stock for a variant, any
     * active variant's for a product with variants, else the product's own.
     */
    public function isAvailable(Product $product, ?ProductVariant $variant = null, ?CategoryTree $tree = null): bool
    {
        if (! $product->isForSale($tree)) {
            return false;
        }
        $minimum = max(1, (int) $product->min_order_quantity);
        if ($variant) {
            return $product->has_variants && $variant->product_id === $product->id && $variant->is_active && $variant->stock_quantity >= $minimum;
        }
        if ($product->has_variants) {
            return $product->variants()->where('is_active', true)->where('stock_quantity', '>=', $minimum)->exists();
        }

        return $product->stock_quantity >= $minimum;
    }

    /** Called by the model events: check $productId once the current transaction (if any) commits. */
    public function queueCheck(int $productId): void
    {
        DB::afterCommit(function () use ($productId) {
            try {
                $this->check($productId);
            } catch (\Throwable $e) {
                report($e); // an alert must never break the change that caused it
            }
        });
    }

    /** Queues the emails for $productId's waiting alerts that can be bought now. Returns how many. */
    public function check(int $productId): int
    {
        $waiting = StockAlert::where('product_id', $productId)->whereNull('notified_at')->get(['id', 'variant_id']);
        if ($waiting->isEmpty()) {
            return 0;
        }
        $product = Product::with('variants')->find($productId);
        if (! $product) {
            return 0;
        }
        $tree = CategoryTree::load();
        if (! $product->isForSale($tree)) {
            return 0;
        }

        $available = [];
        $ids = $waiting->filter(function (StockAlert $alert) use ($product, $tree, &$available) {
            $target = $alert->variant_id ?? 0;

            return $available[$target] ??= $this->isAvailable($product,
                $alert->variant_id ? $product->variants->firstWhere('id', $alert->variant_id) ?? new ProductVariant : null, $tree);
        })->pluck('id');

        foreach ($ids->chunk(SendStockAlertBatch::SIZE) as $batch) {
            SendStockAlertBatch::dispatch($batch->values()->all());
        }

        return $ids->count();
    }

    /**
     * Marks the alert sent, unless another job already did. Returns the plain
     * "stop these alerts" token for its email, or null when it was taken.
     */
    public function claim(int $alertId): ?string
    {
        $token = Str::random(40);
        $claimed = StockAlert::whereKey($alertId)->whereNull('notified_at')
            ->update(['notified_at' => now(), 'waiting_key' => null, 'token_hash' => hash('sha256', $token)]);

        return $claimed === 1 ? $token : null;
    }

    public static function unsubscribeUrl(StockAlert $alert, string $token): string
    {
        return config('buynest.storefront_url').'/stock-alerts/unsubscribe?token='.urlencode($alert->id.'.'.$token);
    }

    /** "Stop these alerts": removes every waiting alert of the link's email. Null when the token isn't valid. */
    public function unsubscribe(string $token): ?int
    {
        if (! preg_match('/^(\d{1,18})\.([A-Za-z0-9]{40})$/', $token, $match)) {
            return null;
        }
        $alert = StockAlert::find((int) $match[1]);
        if (! $alert || ! hash_equals($alert->token_hash, hash('sha256', $match[2]))) {
            return null;
        }

        return StockAlert::where('email', $alert->email)->whereNull('notified_at')->delete();
    }

    /** The waiting alerts of an account (its id, or its email from before it signed in). */
    public function waitingFor(Customer $customer): Collection
    {
        return StockAlert::with(['product', 'variant'])->whereNull('notified_at')
            ->where(fn ($q) => $q->where('customer_id', $customer->id)->orWhere('email', mb_strtolower($customer->email)))
            ->orderByDesc('id')->get();
    }

    /** Account → Stock alerts item: { id, product: { id, name, thumbnail_url }, variant_id, variant_label, created_at }. */
    public static function item(StockAlert $alert): array
    {
        return [
            'id' => $alert->id,
            'product' => ['id' => $alert->product_id, 'name' => $alert->product?->name, 'thumbnail_url' => $alert->product?->thumbnail_url],
            'variant_id' => $alert->variant_id,
            'variant_label' => self::variantLabel($alert),
            'created_at' => $alert->created_at?->toIso8601ZuluString(),
        ];
    }

    /** For part A's account deletion: removes every alert of the customer (id or email). Returns how many. */
    public function forgetCustomer(Customer $customer): int
    {
        return StockAlert::where('customer_id', $customer->id)->orWhere('email', mb_strtolower($customer->email))->delete();
    }

    /** For part A's "download my data": [{ product_name, variant_label, created_at, notified_at }]. */
    public function forCustomer(Customer $customer): array
    {
        return StockAlert::with(['product', 'variant'])
            ->where(fn ($q) => $q->where('customer_id', $customer->id)->orWhere('email', mb_strtolower($customer->email)))
            ->orderBy('id')->get()
            ->map(fn (StockAlert $alert) => [
                'product_name' => $alert->product?->name,
                'variant_label' => self::variantLabel($alert),
                'created_at' => $alert->created_at?->toIso8601ZuluString(),
                'notified_at' => $alert->notified_at?->toIso8601ZuluString(),
            ])->all();
    }

    public function waitingCount(int $productId): int
    {
        return StockAlert::where('product_id', $productId)->whereNull('notified_at')->count();
    }

    /**
     * Reports → Stock alerts: products with waiting alerts, most waiting first.
     * Returns [items, meta] (see the phase 9 contract).
     */
    public function report(?string $search, int $limit, int $skip): array
    {
        $counts = StockAlert::whereNull('notified_at')
            ->join('products', 'products.id', '=', 'stock_alerts.product_id')
            ->when(filled($search), function ($q) use ($search) {
                $like = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], trim($search)).'%';
                $q->where(fn ($q) => $q->where('products.name', 'like', $like)->orWhere('products.sku', 'like', $like));
            })
            ->groupBy('stock_alerts.product_id')
            ->selectRaw('stock_alerts.product_id, COUNT(*) AS waiting, MIN(stock_alerts.created_at) AS oldest_at, MAX(stock_alerts.created_at) AS newest_at');

        $total = DB::query()->fromSub($counts, 'c')->count();
        $rows = DB::query()->fromSub($counts, 'c')->orderByDesc('waiting')->orderBy('product_id')->offset($skip)->limit($limit)->get();

        $products = Product::withTrashed()->with('variants')->whereIn('id', $rows->pluck('product_id'))->get()->keyBy('id');
        $byVariant = StockAlert::whereNull('notified_at')->whereIn('product_id', $rows->pluck('product_id'))->whereNotNull('variant_id')
            ->groupBy('variant_id')->selectRaw('variant_id, COUNT(*) AS waiting')->pluck('waiting', 'variant_id');

        $items = $rows->map(function ($row) use ($products, $byVariant) {
            $product = $products->get($row->product_id);
            $map = $product?->has_variants ? $product->optionValueMap() : [];

            return [
                'product' => [
                    'id' => (int) $row->product_id,
                    'name' => $product?->name,
                    'sku' => $product?->sku,
                    'status' => $product?->trashed() ? 'deleted' : $product?->status,
                    'stock_quantity' => $product?->stock_quantity,
                    'thumbnail_url' => $product?->thumbnail_url,
                    'has_variants' => (bool) $product?->has_variants,
                ],
                'waiting' => (int) $row->waiting,
                'variants' => ($product?->variants ?? collect())->filter(fn ($variant) => $byVariant->has($variant->id))
                    ->map(fn (ProductVariant $variant) => [
                        'id' => $variant->id,
                        'sku' => $variant->sku,
                        'label' => $variant->label($map),
                        'stock_quantity' => $variant->stock_quantity,
                        'waiting' => (int) $byVariant->get($variant->id),
                    ])->values()->all(),
                'oldest_at' => Carbon::parse($row->oldest_at)->toIso8601ZuluString(),
                'newest_at' => Carbon::parse($row->newest_at)->toIso8601ZuluString(),
            ];
        })->values()->all();

        return [$items, [
            'total' => $total,
            'waiting_total' => StockAlert::whereNull('notified_at')->count(),
            'notified_last_30_days' => StockAlert::where('notified_at', '>=', now()->subDays(30))->count(),
            'limit' => $limit,
            'skip' => $skip,
        ]];
    }

    private static function variantLabel(StockAlert $alert): ?string
    {
        if (! $alert->variant || ! $alert->product) {
            return null;
        }

        return $alert->variant->label($alert->product->optionValueMap());
    }
}
