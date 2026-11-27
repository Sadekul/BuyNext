<?php

namespace App\Services\Sms;

use App\Models\Admin;
use App\Models\Order;
use App\Models\OrderStatusHistory;
use App\Models\Shipment;
use App\Models\SmsMessage;
use App\Services\Audit;
use App\Services\BdAddresses;
use App\Services\Payments\OnlinePayments;
use App\Services\Pricing;
use App\Services\Settings;
use App\Support\Currency;
use App\Support\Locale;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Phase 20: SMS order notifications (docs/backend/PHASE20_CONTRACT.md §1),
 * the rules that are the same for every provider. The providers' wire
 * formats live in their drivers (LogDriver, SslWirelessDriver, BulkSmsBdDriver).
 *
 * - Off by default (sms_enabled): then nothing here writes or sends anything.
 * - Only order texts (transactional), at the moments the matching customer
 *   email goes, respecting the same "notify the customer" choice:
 *   order_placed / cod_confirm_request (checkout, or when the online payment
 *   completes), order_confirmed (phone confirmation or the one-tap link),
 *   order_shipped (a shipment with notify), order_delivered and
 *   order_cancelled (a notified history step; see historyCreated()).
 * - Each order text goes once (dedupe_key; order_shipped once per shipment).
 * - The row is written (queued) with the order change and the provider is
 *   called after the commit (DB::afterCommit), so a rolled-back change sends
 *   nothing and a failed text never undoes the change: it is kept as failed
 *   and can be retried (buynest:sms:retry, or the admin's Retry).
 * - Logs carry the message id, status and the provider's reason: never the
 *   text or the credentials.
 */
class Sms
{
    public const EVENTS = ['order_placed', 'cod_confirm_request', 'order_confirmed', 'order_shipped', 'order_delivered', 'order_cancelled'];

    /** Provider key => driver class. */
    public const PROVIDERS = ['log' => LogDriver::class, 'ssl_wireless' => SslWirelessDriver::class, 'bulksmsbd' => BulkSmsBdDriver::class];

    public const VARIABLES = ['store', 'order', 'total', 'name', 'courier', 'tracking', 'tracking_url', 'confirm_url', 'order_url'];

    public const TEMPLATE_MAX = 480;

    /**
     * The default texts (the store owner reviews the Bangla ones). English stays within one
     * GSM-7 SMS where it can ("Tk" rather than "৳", which would make the text Unicode).
     */
    public const DEFAULT_TEMPLATES = [
        'order_placed' => [
            'en' => '{store}: order {order} received, total {total}. We\'ll text you when it ships.',
            'bn' => '{store}: আপনার অর্ডার {order} পেয়েছি, মোট {total}। পাঠানোর সময় আমরা SMS করে জানাব।',
        ],
        'cod_confirm_request' => [
            'en' => '{store}: please confirm your order {order} ({total}, cash on delivery): {confirm_url}',
            'bn' => '{store}: আপনার অর্ডার {order} ({total}, ক্যাশ অন ডেলিভারি) নিশ্চিত করুন: {confirm_url}',
        ],
        'order_confirmed' => [
            'en' => '{store}: order {order} is confirmed. We\'ll text you when it ships.',
            'bn' => '{store}: আপনার অর্ডার {order} নিশ্চিত হয়েছে। পাঠানোর সময় আমরা SMS করে জানাব।',
        ],
        'order_shipped' => [
            'en' => '{store}: order {order} is on its way with {courier}. Track: {tracking_url}',
            'bn' => '{store}: আপনার অর্ডার {order} {courier}-এর মাধ্যমে পাঠানো হয়েছে। ট্র্যাক করুন: {tracking_url}',
        ],
        'order_delivered' => [
            'en' => '{store}: order {order} was delivered. Thank you for shopping with us!',
            'bn' => '{store}: আপনার অর্ডার {order} পৌঁছে গেছে। আমাদের সাথে কেনাকাটার জন্য ধন্যবাদ!',
        ],
        'order_cancelled' => [
            'en' => '{store}: order {order} was cancelled. Questions? Reply or call us.',
            'bn' => '{store}: আপনার অর্ডার {order} বাতিল করা হয়েছে। কোনো প্রশ্ন থাকলে আমাদের কল করুন।',
        ],
    ];

    /** Variables whose sentence is left out when they are empty (no tracking link, no confirmation link). */
    private const SENTENCE_VARIABLES = ['tracking', 'tracking_url', 'confirm_url'];

    public function __construct(private Settings $settings, private Audit $audit) {}

    /*
     * Providers and settings.
     */

    public function driver(string $key): ?SmsDriver
    {
        return isset(self::PROVIDERS[$key]) ? app(self::PROVIDERS[$key]) : null;
    }

    /** @return list<array{key: string, label: string, configured: bool}> never a credential */
    public function providers(): array
    {
        return array_map(function (string $key) {
            $driver = $this->driver($key);

            return ['key' => $key, 'label' => $driver->label(), 'configured' => $driver->configured()];
        }, array_keys(self::PROVIDERS));
    }

    public function enabled(): bool
    {
        return (bool) $this->settings->get('sms_enabled', false);
    }

    /** The chosen provider's key (an unknown stored value falls back to the log driver). */
    public function provider(): string
    {
        $key = (string) $this->settings->get('sms_provider', config('buynest.sms.driver', 'log'));

        return isset(self::PROVIDERS[$key]) ? $key : 'log';
    }

    /** @return list<string> the events that send a text (in EVENTS order) */
    public function events(): array
    {
        return array_values(array_intersect(self::EVENTS, (array) $this->settings->get('sms_events', self::EVENTS)));
    }

    public function eventOn(string $event): bool
    {
        return $this->enabled() && in_array($event, $this->events(), true);
    }

    /** Settings → SMS as the admin API answers it: templates as stored ({ en, bn }, null = the default). */
    public function settings(): array
    {
        $stored = (array) $this->settings->get('sms_templates', []);

        return [
            'sms_enabled' => $this->enabled(),
            'sms_provider' => $this->provider(),
            'sms_events' => $this->events(),
            'sms_templates' => collect(self::EVENTS)->mapWithKeys(fn (string $event) => [$event => [
                'en' => filled($stored[$event]['en'] ?? null) ? $stored[$event]['en'] : null,
                'bn' => filled($stored[$event]['bn'] ?? null) ? $stored[$event]['bn'] : null,
            ]])->all(),
            'sms_confirm_link' => (bool) $this->settings->get('sms_confirm_link', true),
        ];
    }

    /** GET /api/admin/v1/sms: { settings, providers, stats, defaults: { templates, variables } }. */
    public function adminPayload(): array
    {
        return [
            'settings' => $this->settings(),
            'providers' => $this->providers(),
            'stats' => $this->stats(),
            'defaults' => ['templates' => self::DEFAULT_TEMPLATES, 'variables' => self::VARIABLES],
        ];
    }

    /** sent_today, failed_today (by the time the text was written), sent_30d. */
    public function stats(): array
    {
        $today = now()->startOfDay();

        return [
            'sent_today' => SmsMessage::where('status', 'sent')->where('created_at', '>=', $today)->count(),
            'failed_today' => SmsMessage::where('status', 'failed')->where('created_at', '>=', $today)->count(),
            'sent_30d' => SmsMessage::where('status', 'sent')->where('created_at', '>=', now()->subDays(30))->count(),
        ];
    }

    /**
     * PUT /api/admin/v1/sms/settings (partial): the stored values to save. 422 for an unknown
     * provider or one that isn't set up, no event while on, unknown events, a text over 480 characters.
     */
    public function validated(array $input): array
    {
        $data = Validator::make($input, [
            'sms_enabled' => ['sometimes', 'boolean'],
            'sms_provider' => ['sometimes', 'string', Rule::in(array_keys(self::PROVIDERS))],
            'sms_events' => ['sometimes', 'array'],
            'sms_events.*' => ['string', Rule::in(self::EVENTS)],
            'sms_templates' => ['sometimes', 'array'],
            'sms_templates.*' => ['array'],
            'sms_templates.*.en' => ['nullable', 'string', 'max:'.self::TEMPLATE_MAX],
            'sms_templates.*.bn' => ['nullable', 'string', 'max:'.self::TEMPLATE_MAX],
            'sms_confirm_link' => ['sometimes', 'boolean'],
        ], [
            'sms_provider.in' => 'Choose test mode, SSL Wireless, or BulkSMSBD.',
            'sms_events.*.in' => 'Choose events from the list.',
            'sms_templates.*.*.max' => 'Keep each text to '.self::TEMPLATE_MAX.' characters (about 3 SMS in English).',
        ])->validate();

        $errors = [];
        foreach (array_keys($data['sms_templates'] ?? []) as $event) {
            if (! in_array($event, self::EVENTS, true)) {
                $errors["sms_templates.{$event}"] = 'There is no such SMS event.';
            }
        }
        if (isset($data['sms_provider']) && ! $this->driver($data['sms_provider'])->configured()) {
            $errors['sms_provider'] = 'Set up '.$this->driver($data['sms_provider'])->label().' first: its credentials go in backend/.env (docs/BANGLADESH.md → SMS).';
        }
        $enabled = array_key_exists('sms_enabled', $data) ? filter_var($data['sms_enabled'], FILTER_VALIDATE_BOOLEAN) : $this->enabled();
        $events = array_key_exists('sms_events', $data) ? array_values(array_intersect(self::EVENTS, $data['sms_events'])) : $this->events();
        if ($enabled && $events === []) {
            $errors['sms_events'] = 'Choose at least one event to text customers about, or turn SMS off.';
        }
        if ($errors) {
            throw ValidationException::withMessages($errors);
        }

        $values = [];
        if (array_key_exists('sms_enabled', $data)) {
            $values['sms_enabled'] = $enabled;
        }
        if (isset($data['sms_provider'])) {
            $values['sms_provider'] = $data['sms_provider'];
        }
        if (array_key_exists('sms_events', $data)) {
            $values['sms_events'] = $events;
        }
        if (array_key_exists('sms_confirm_link', $data)) {
            $values['sms_confirm_link'] = filter_var($data['sms_confirm_link'], FILTER_VALIDATE_BOOLEAN);
        }
        if (array_key_exists('sms_templates', $data)) {
            // Merged per event and language; an empty text goes back to the default.
            $templates = (array) $this->settings->get('sms_templates', []);
            foreach ($data['sms_templates'] as $event => $texts) {
                foreach (['en', 'bn'] as $locale) {
                    if (array_key_exists($locale, $texts)) {
                        $text = trim((string) $texts[$locale]);
                        if ($text === '') {
                            unset($templates[$event][$locale]);
                        } else {
                            $templates[$event][$locale] = $text;
                        }
                    }
                }
                if (($templates[$event] ?? null) === []) {
                    unset($templates[$event]);
                }
            }
            $values['sms_templates'] = $templates;
        }

        return $values;
    }

    /** Saves validated() values, with an audit entry naming what changed. */
    public function update(array $values): void
    {
        DB::transaction(function () use ($values) {
            $before = $this->settings();
            $this->settings->put($values);
            $after = $this->settings();
            if ($diff = Audit::diff(array_intersect_key($before, $values), array_intersect_key($after, $values))) {
                $this->audit->record('settings.updated', 'SMS settings changed: '.implode(', ', array_keys($diff['after'])).'.', 'settings', null, $diff);
            }
        });
    }

    /*
     * Texts.
     */

    /** "+8801712345678" for a Bangladeshi mobile number in any usual form (01…, 8801…, +880 1…, Bangla digits); else null. */
    public static function mobile(?string $phone): ?string
    {
        $normalized = BdAddresses::normalizePhone((string) $phone);

        return preg_match('/^\+8801[3-9]\d{8}$/', $normalized) ? $normalized : null;
    }

    /** "+8801•••••5678": the number with only the last 4 digits (audit entries). */
    public static function masked(string $to): string
    {
        return substr($to, 0, 5).str_repeat('•', max(0, strlen($to) - 9)).substr($to, -4);
    }

    /** The template for $event in $locale: staff's text, else the default. */
    public function template(string $event, string $locale): string
    {
        $locale = $locale === 'bn' ? 'bn' : 'en';
        $stored = $this->settings->get('sms_templates', [])[$event][$locale] ?? null;

        return filled($stored) ? (string) $stored : self::DEFAULT_TEMPLATES[$event][$locale];
    }

    /**
     * Fills {variables}. Unknown variables are left out; the sentence holding an empty
     * tracking or confirmation link is left out ("…with Steadfast." without "Track: "),
     * and a dangling ":" at the end goes too.
     */
    public static function render(string $template, array $values): string
    {
        foreach (self::SENTENCE_VARIABLES as $name) {
            if (blank($values[$name] ?? null)) {
                $template = (string) preg_replace('/(?<=[.!?।])[^.!?।]*\{'.$name.'\}[^.!?।]*[.!?।]?/u', '', $template);
            }
        }
        $text = (string) preg_replace_callback('/\{([a-z_]+)\}/', fn (array $m) => in_array($m[1], self::VARIABLES, true)
            ? (string) ($values[$m[1]] ?? '') : '', $template);
        $text = (string) preg_replace('/[ \t]{2,}/u', ' ', $text);
        $text = (string) preg_replace('/ +([.,!?।])/u', '$1', $text);

        return rtrim(trim($text), " :\t");
    }

    /** "Tk 1,060" / "৳১,০৬০" (".00" dropped to save characters; "Tk" keeps an English text GSM-7). */
    public static function money(Order $order, string $locale): string
    {
        $code = $order->currencyCode();
        $text = (string) preg_replace('/\.0+$/', '', Currency::formatCents(Pricing::toCents($order->grand_total), $code));
        if ($locale !== 'bn' && $code === 'BDT') {
            $text = str_replace('৳', 'Tk ', $text);
        }

        return Locale::digits($text, $locale);
    }

    /**
     * A new order (checkout, after the commit): cod_confirm_request for a COD order waiting for its
     * confirmation (when that event is on), else order_placed. Nothing while the order waits for an
     * online payment (card, PayPal, SSLCommerz, a COD advance): paid() texts it then.
     */
    public function placed(Order $order): ?SmsMessage
    {
        if (! $this->enabled()) {
            return null;
        }

        try {
            if (app(OnlinePayments::class)->uses($order)) {
                return null;
            }
        } catch (Throwable $e) {
            report($e);

            return null;
        }

        return $this->sendForOrder($order, $this->placedEvent($order));
    }

    /** An online payment completed (Stripe, PayPal, SSLCommerz, a COD advance): the "order received" text now. */
    public function paid(Order $order): ?SmsMessage
    {
        return $this->enabled() ? $this->sendForOrder($order, $this->placedEvent($order)) : null;
    }

    private function placedEvent(Order $order): string
    {
        return $order->awaitsConfirmation() && $this->eventOn('cod_confirm_request') ? 'cod_confirm_request' : 'order_placed';
    }

    /**
     * Every order status history row (AppServiceProvider): a notified step INTO delivered or
     * cancelled texts the customer (staff, the courier's report, the confirmation outcome, the
     * customer's own cancel). Not a note on an already delivered / cancelled order, and not the
     * cancel of an order that was still waiting for its online payment (it was never texted as
     * placed; the "payment not completed" email covers it).
     */
    public function historyCreated(OrderStatusHistory $row): void
    {
        if (! $row->customer_notified || ! in_array($row->status, ['delivered', 'cancelled'], true) || ! $this->enabled()) {
            return;
        }

        try {
            $previous = OrderStatusHistory::where('order_id', $row->order_id)->where('id', '<', $row->id)->orderByDesc('id')->value('status');
            $order = Order::find($row->order_id);
            if ($previous === $row->status || ! $order) {
                return;
            }
            if ($row->status === 'cancelled' && $previous === 'pending_payment' && app(OnlinePayments::class)->uses($order)) {
                return;
            }
            $this->sendForOrder($order, $row->status === 'delivered' ? 'order_delivered' : 'order_cancelled');
        } catch (Throwable $e) {
            report($e);
        }
    }

    /** Every new shipment (AppServiceProvider): with "notify the customer", order_shipped (manual, courier, bulk). */
    public function shipmentCreated(Shipment $shipment): void
    {
        if (! $shipment->customer_notified || ! $this->enabled()) {
            return;
        }
        $order = Order::find($shipment->order_id);
        if ($order) {
            $this->sendForOrder($order, 'order_shipped', ['shipment' => $shipment]);
        }
    }

    /**
     * Texts the order's customer about $event: skipped (null) unless SMS is on, the event is on,
     * the order's phone is a Bangladeshi mobile (anything else: a log line, no row), and the text
     * wasn't written before. The row is written now (queued), sent after the commit.
     * $extra: shipment (order_shipped). Never throws.
     */
    public function sendForOrder(Order $order, string $event, array $extra = []): ?SmsMessage
    {
        if (! in_array($event, self::EVENTS, true) || ! $this->eventOn($event)) {
            return null;
        }

        try {
            $to = self::mobile($order->phone);
            if ($to === null) {
                Log::info('SMS skipped: the order has no Bangladeshi mobile number.', ['order' => $order->number, 'event' => $event]);

                return null;
            }
            $shipment = $extra['shipment'] ?? null;
            $key = "{$order->id}:{$event}".($shipment instanceof Shipment ? ":{$shipment->id}" : '');
            if (SmsMessage::where('dedupe_key', $key)->exists()) {
                return null;
            }

            $locale = Locale::forOrder($order);
            $body = self::render($this->template($event, $locale), $this->values($order, $event, $locale, $shipment));
            $measure = SmsText::measure($body);
            $message = SmsMessage::create([
                'order_id' => $order->id,
                'event' => $event,
                'dedupe_key' => $key,
                'to' => $to,
                'body' => $body,
                'locale' => $locale,
                'segments' => min(255, $measure['segments']),
                'encoding' => $measure['encoding'],
                'provider' => $this->provider(),
                'status' => 'queued',
                'attempts' => 0,
            ]);
        } catch (Throwable $e) {
            // A text never stops the order change it belongs to.
            report($e);

            return null;
        }
        DB::afterCommit(fn () => $this->deliver($message));

        return $message;
    }

    /** The template variables for one order text. A cod_confirm_request with the link on makes the one-tap token now. */
    private function values(Order $order, string $event, string $locale, ?Shipment $shipment): array
    {
        $store = config('buynest.storefront_url');
        $confirmUrl = null;
        if ($event === 'cod_confirm_request' && $this->settings->get('sms_confirm_link', true)) {
            $token = Str::random(43); // ~256 bits, URL-safe ([A-Za-z0-9])
            $order->forceFill([
                'sms_confirm_token_hash' => hash('sha256', $token),
                'sms_confirm_expires_at' => now()->addHours((int) config('buynest.sms.confirm_link_hours', 72)),
            ])->save();
            $confirmUrl = "{$store}/c/{$token}";
        }

        return [
            'store' => (string) $this->settings->get('store_name'),
            'order' => $order->number,
            'total' => self::money($order, $locale),
            'name' => trim((string) ($order->shipping_address['first_name'] ?? '')),
            'courier' => $shipment?->carrierLabel(),
            'tracking' => $shipment?->tracking_number,
            'tracking_url' => $shipment?->trackingUrl(),
            'confirm_url' => $confirmUrl,
            'order_url' => "{$store}/track-order?order=".rawurlencode((string) $order->number),
        ];
    }

    /** POST /api/admin/v1/sms/test: one text through the chosen provider now (also while SMS is off). 422 for a bad number. */
    public function sendTest(Admin $admin, string $to, ?string $body): SmsMessage
    {
        $number = self::mobile($to);
        if ($number === null) {
            throw ValidationException::withMessages(['to' => 'Enter a Bangladeshi mobile number (01XXXXXXXXX).']);
        }
        $body = filled($body) ? trim((string) $body)
            : $this->settings->get('store_name').': this is a test SMS from the SMS settings. Order texts will look like this.';
        $measure = SmsText::measure($body);
        $message = SmsMessage::create([
            'order_id' => null,
            'event' => null,
            'to' => $number,
            'body' => $body,
            'locale' => $measure['encoding'] === 'unicode' ? 'bn' : 'en',
            'segments' => min(255, $measure['segments']),
            'encoding' => $measure['encoding'],
            'provider' => $this->provider(),
            'status' => 'queued',
            'attempts' => 0,
            'admin_id' => $admin->id,
        ]);
        $this->deliver($message);
        $this->audit->record('sms.test_sent', 'Test SMS to '.self::masked($number).' through '.$this->driver($message->provider)->label().": {$message->status}.",
            'sms_message', $message->id, ['before' => [], 'after' => ['provider' => $message->provider, 'status' => $message->status]], $admin);

        return $message;
    }

    /** Sends a failed text again (through the provider chosen now). 422 when it isn't failed or has had its attempts. */
    public function retry(SmsMessage $message): SmsMessage
    {
        $max = (int) config('buynest.sms.max_attempts', 5);
        if ($message->status !== 'failed') {
            throw ValidationException::withMessages(['message' => 'Only a failed text can be sent again.']);
        }
        if ($message->attempts >= $max) {
            throw ValidationException::withMessages(['message' => "This text has been tried {$max} times; it won't be sent again."]);
        }
        $message->forceFill(['provider' => $this->provider()])->save();
        $this->deliver($message);

        return $message;
    }

    /** Calls the provider and records the outcome on the row. Never throws (it runs after the commit). */
    public function deliver(SmsMessage $message): void
    {
        try {
            $attempt = $message->attempts + 1;
            $reference = $attempt > 1 ? "{$message->id}-{$attempt}" : (string) $message->id;
            $driver = $this->driver($message->provider);

            try {
                $result = $driver ? $driver->send($message->to, $message->body, $reference) : SmsResult::failed('Unknown SMS provider.');
            } catch (SmsException $e) {
                $result = SmsResult::failed($e->getMessage());
            } catch (Throwable $e) {
                report($e);
                $result = SmsResult::failed('The text could not be sent (unexpected error).');
            }

            $message->forceFill([
                'status' => $result->ok ? 'sent' : 'failed',
                'provider_message_id' => $result->ok ? $result->messageId : $message->provider_message_id,
                'error' => $result->ok ? null : $result->error,
                'attempts' => min(255, $attempt),
                'sent_at' => $result->ok ? now() : null,
            ])->save();
            $result->ok
                ? Log::info('SMS sent.', ['sms' => $message->id, 'provider' => $message->provider, 'provider_message_id' => $result->messageId])
                : Log::warning('SMS failed.', ['sms' => $message->id, 'provider' => $message->provider, 'attempt' => $attempt, 'reason' => $result->error]);
        } catch (Throwable $e) {
            report($e);
        }
    }
}
