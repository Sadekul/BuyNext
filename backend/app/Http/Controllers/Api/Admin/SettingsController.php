<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Services\Audit;
use App\Services\CashOnDelivery;
use App\Services\DeliveryZones;
use App\Services\Payments\PayPalPayments;
use App\Services\Payments\SslCommerzGateway;
use App\Services\Payments\SslCommerzPayments;
use App\Services\Payments\StripePayments;
use App\Services\Settings;
use App\Services\ShippingRates;
use App\Support\Currency;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/** Store settings (Magento's Stores → Configuration), grouped: general, shipping, tax, checkout, inventory. */
class SettingsController extends Controller
{
    public function __construct(private Settings $settings, private Audit $audit) {}

    /** GET /api/admin/v1/settings → { data: { general: {...}, shipping: {...}, ... }, meta: { the choices for the form } } */
    public function show(): JsonResponse
    {
        return $this->answer();
    }

    /**
     * PATCH /api/admin/v1/settings { group: { key: value } } - only the keys
     * sent change. Errors are reported as "group.key" (e.g. "shipping.standard_price").
     */
    public function update(Request $request): JsonResponse
    {
        $input = $request->all();
        $unknown = [];
        foreach ($input as $group => $values) {
            if (! isset(Settings::GROUPS[$group]) || ! is_array($values)) {
                $unknown[$group] = 'Unknown settings group.';

                continue;
            }
            foreach (array_keys($values) as $key) {
                if (! in_array($key, Settings::GROUPS[$group], true)) {
                    $unknown["{$group}.{$key}"] = 'Unknown setting.';
                }
            }
        }
        if ($unknown) {
            throw ValidationException::withMessages($unknown);
        }
        if ($input === []) {
            throw ValidationException::withMessages(['settings' => 'Send at least one setting to change.']);
        }
        // Phase 9 (part A): Settings → Security is the Owner's alone.
        if (array_key_exists('security', $input) && ! $request->user()->isOwner()) {
            return response()->json(['message' => 'Only an Owner can change security settings.', 'code' => 'owner_only'], 403);
        }

        // Only the rules of the keys that were sent (a PATCH): a key that is
        // sent must be valid; one that isn't sent keeps its value.
        $rules = $this->rulesFor($input);
        $validated = Validator::make($input, $rules, [
            'shipping.enabled_methods.min' => 'Keep at least one shipping method on.',
            'checkout.enabled_payment_methods.min' => 'Keep at least one payment method on.',
            'checkout.allowed_countries.min' => 'Keep at least one country.',
            'returns.return_reasons.min' => 'Keep at least one return reason.',
            'returns.return_window_days.min' => 'The return window must be at least 1 day.',
            '*.*.*.distinct' => 'This is listed twice.',
            'tax.tax_rates.*.country.distinct' => 'This country already has a rate.',
            // Phase 10 (part A).
            'documents.paper_size.in' => 'Choose A4 or Letter.',
            'analytics.ga4_measurement_id.regex' => 'Enter a GA4 measurement ID like G-ABC123XYZ, or leave it empty.',
        ])->validate();

        $changes = [];
        foreach ($validated as $group => $values) {
            foreach ($values as $key => $value) {
                $key = Settings::storageKey($group, $key); // phase 11: rewards.enabled → rewards_enabled
                $changes[$key] = $this->settings->normalize($key, $value);
            }
        }
        $this->checkPhase14($changes);
        // Phase 9 (part A): the Owner turning the rule on must not lock themselves out of the admin.
        if (($changes['require_admin_two_factor'] ?? false) && ! $request->user()->hasTwoFactor()) {
            throw ValidationException::withMessages(['security.require_admin_two_factor' => 'Turn on two-step sign-in for your own account first.']);
        }

        DB::transaction(function () use ($changes) {
            $before = array_intersect_key($this->settings->all(), $changes);
            $this->settings->put($changes);
            $diff = Audit::diff($before, $changes);
            if ($diff) {
                $this->audit->record('settings.updated', 'Settings changed: '.implode(', ', array_keys($diff['after'])).'.', 'settings', null, $diff);
            }
        });

        return $this->answer();
    }

    /**
     * Phase 14: the default country must be one the store ships to (an ISO
     * code becomes its name), COD zones must exist, and the advance delivery
     * charge needs SSLCommerz.
     */
    private function checkPhase14(array &$changes): void
    {
        if (array_key_exists('default_country', $changes) && $changes['default_country'] !== null) {
            $allowed = $changes['allowed_countries'] ?? $this->settings->get('allowed_countries', []);
            $name = ShippingRates::normalizeCountry($changes['default_country'], $allowed);
            if ($name === null || $name === '*' || ! in_array($name, $allowed, true)) {
                throw ValidationException::withMessages(['checkout.default_country' => 'Choose one of the countries the store ships to.']);
            }
            $changes['default_country'] = $name;
        }
        if (array_key_exists('cod_zones', $changes)) {
            $codes = app(DeliveryZones::class)->codes();
            foreach ($changes['cod_zones'] as $index => $code) {
                if (! in_array($code, $codes, true)) {
                    throw ValidationException::withMessages(["cod.zones.{$index}" => "There is no delivery zone {$code}."]);
                }
            }
        }
        if (($changes['cod_advance'] ?? null) === 'delivery_charge' && ! app(SslCommerzGateway::class)->enabled()) {
            throw ValidationException::withMessages(['cod.advance' => 'Advance delivery charge needs SSLCommerz: set SSLCOMMERZ_STORE_ID and '
                .'SSLCOMMERZ_STORE_PASSWORD and use the store currency BDT.']);
        }
    }

    /** The rules of the keys present in the request. */
    private function rulesFor(array $input): array
    {
        $rules = [];
        foreach ($this->settings->rules() as $field => $rule) {
            [$group, $key] = explode('.', $field);
            if (is_array($input[$group] ?? null) && array_key_exists($key, $input[$group])) {
                $rules[$field] = $rule;
            }
        }

        return $rules;
    }

    private function answer(): JsonResponse
    {
        return response()->json([
            'data' => $this->settings->grouped(),
            'meta' => [
                'shipping_methods' => collect(config('buynest.store.shipping_methods'))
                    ->map(fn ($method, $id) => ['id' => $id, 'label' => $method['label'], 'eta' => $method['eta']])->values(),
                'payment_methods' => collect(config('buynest.store.payment_methods'))
                    ->map(fn ($label, $id) => ['id' => $id, 'label' => $label])->values(),
                // Phase 6: always available to staff creating an order, never to shoppers.
                'admin_payment_methods' => collect(config('buynest.store.admin_payment_methods'))
                    ->map(fn ($label, $id) => ['id' => $id, 'label' => $label])->values(),
                'currency' => Currency::store(),
                // Phase 12: the store currency (read-only: BUYNEST_CURRENCY, see docs/CURRENCY.md) and each online provider's state.
                'store_currency' => Currency::api(),
                'currency_docs' => 'docs/CURRENCY.md',
                // Phase 14: the delivery zones (for the COD zones choice).
                'delivery_zones' => app(DeliveryZones::class)->all()->map(fn ($zone) => ['code' => $zone->code, 'name' => $zone->name,
                    'bn_name' => $zone->bn_name, 'is_active' => $zone->is_active])->values(),
                'cod_advance_modes' => CashOnDelivery::ADVANCE_MODES,
                'payment_providers' => [
                    'stripe' => app(StripePayments::class)->status(),
                    'paypal' => app(PayPalPayments::class)->status(),
                    'sslcommerz' => app(SslCommerzPayments::class)->status(),
                ],
            ],
        ]);
    }
}
