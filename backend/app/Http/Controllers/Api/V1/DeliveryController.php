<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\BdArea;
use App\Services\BdAddresses;
use App\Services\CashOnDelivery;
use App\Services\DeliveryZones;
use App\Services\Pricing;
use App\Services\Settings;
use App\Services\ShippingRates;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * Phase 17: "Deliver to" — what delivery to a Bangladesh area costs and how
 * long it takes, before anything is in the cart. Computed with the services
 * checkout uses (DeliveryZones, ShippingRates::options with an empty cart:
 * 0 g, subtotal 0; CashOnDelivery::problem), so the answer matches the cart.
 */
class DeliveryController extends Controller
{
    /** Browsers and proxies may keep an answer this long (prices are admin-editable, so shorter than the places' day). */
    private const MAX_AGE = 600;

    /**
     * GET /api/v1/delivery/estimate?area_id= →
     * { data: { area { id, name, district, district_id, division, division_id }, zone { code, name } | null,
     *   methods [{ id, label, price, eta, eta_days_min, eta_days_max, free_over_threshold }],
     *   free_shipping_threshold, cod { available, reason, message, fee } } }
     */
    public function estimate(Request $request, Settings $settings, BdAddresses $addresses, DeliveryZones $zones, ShippingRates $rates,
        CashOnDelivery $cod): JsonResponse
    {
        // Resolved per request (not in the constructor: the route keeps its controller, and the rate and zone services memoize their rows).
        $data = $request->validate(['area_id' => ['required', 'integer', 'min:1']], [
            'area_id.required' => __('Choose your area (upazila or thana).'),
            'area_id.integer' => __('Choose your area (upazila or thana).'),
            'area_id.min' => __('Choose your area (upazila or thana).'),
        ]);
        if (! $addresses->storeIsBangladeshi()) {
            throw ValidationException::withMessages(['area_id' => __('Delivery areas are for Bangladesh addresses.')]);
        }
        $area = BdArea::with('district.division')->find((int) $data['area_id']);
        if (! $area) {
            throw ValidationException::withMessages(['area_id' => __('Choose your area (upazila or thana).')]);
        }

        $zone = $zones->zoneFor($area->id, $area->district_id);
        $options = $rates->options($settings->shippingMethods(), $addresses->countryName(), 0, 0, $zone?->code);
        $methods = array_values(array_map(fn (array $option) => [
            'id' => $option['id'],
            // Translated on the way out, as the cart does (CartQuote).
            'label' => filled($option['label']) ? __($option['label']) : $option['label'],
            'price' => Pricing::format($option['price_cents']),
            'eta' => $option['eta_days_min'] !== null ? ShippingRates::etaText($option['eta_days_min'], $option['eta_days_max'])
                : (filled($option['eta']) ? __($option['eta']) : $option['eta']),
            'eta_days_min' => $option['eta_days_min'],
            'eta_days_max' => $option['eta_days_max'],
            'free_over_threshold' => (bool) $option['free_over_threshold'],
        ], $options));

        // Cash on delivery: an enabled payment method, then the zone rules (an empty cart never meets the order limit).
        $problem = in_array('cod', $settings->paymentMethods(), true)
            ? $cod->problem($zone?->code, 0)
            : ['disabled', __('Cash on delivery isn\'t offered right now.')];

        return response()->json(['data' => [
            'area' => [
                'id' => $area->id,
                'name' => $area->localName(),
                'district' => $area->district?->localName(),
                'district_id' => $area->district_id,
                'division' => $area->district?->division?->localName(),
                'division_id' => $area->district?->division_id,
            ],
            'zone' => $zone ? ['code' => $zone->code, 'name' => $zone->localName()] : null,
            'methods' => $methods,
            'free_shipping_threshold' => Pricing::format($settings->cents('free_shipping_threshold')),
            'cod' => [
                'available' => $problem === null,
                'reason' => $problem[0] ?? null,
                'message' => $problem[1] ?? null,
                'fee' => Pricing::format($cod->feeCents()),
            ],
        ]])->withHeaders([
            'Cache-Control' => 'public, max-age='.self::MAX_AGE,
            'Vary' => 'Accept-Language',
        ]);
    }
}
