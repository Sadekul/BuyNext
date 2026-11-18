<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Services\Audit;
use App\Services\Settings;
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
                'currency' => config('buynest.store.currency'),
            ],
        ]);
    }
}
