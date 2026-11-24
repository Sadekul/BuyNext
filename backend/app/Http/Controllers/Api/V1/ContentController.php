<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Api\Admin\CurrencyController;
use App\Http\Controllers\Controller;
use App\Http\Resources\PageResource;
use App\Http\Resources\ProductResource;
use App\Models\CurrencyRate;
use App\Models\Page;
use App\Services\CashOnDelivery;
use App\Services\HomeContent;
use App\Services\Payments\PayPalPayments;
use App\Services\Payments\SslCommerzPayments;
use App\Services\Payments\StripePayments;
use App\Services\Pricing;
use App\Services\RewardPoints;
use App\Services\Settings;
use App\Support\Currency;
use App\Support\Locale;
use Illuminate\Http\JsonResponse;

/** Public content: the home page, content pages, and the store's rules (no sign-in). */
class ContentController extends Controller
{
    /** GET /api/v1/home → { hero, banners (active, by position), featured_products [ProductResource] } */
    public function home(HomeContent $home): JsonResponse
    {
        $content = $home->forStorefront();
        $content['featured_products'] = ProductResource::collection($content['featured_products']);

        return response()->json(['data' => $content]);
    }

    /** GET /api/v1/pages/{slug} - published pages only; drafts are "not found". */
    public function page(string $slug): PageResource|JsonResponse
    {
        $page = Page::where('slug', $slug)->where('is_published', true)->with('translations')->first();

        return $page ? (new PageResource($page))->forStorefront() : response()->json(['message' => __('Page not found.')], 404);
    }

    /**
     * GET /api/v1/store - the rules the server applies at checkout, so the
     * storefront shows the same ones (shipping prices, countries, payment
     * methods, guest checkout, whether tax is charged).
     */
    public function store(Settings $settings, StripePayments $payments, PayPalPayments $paypal, SslCommerzPayments $sslcommerz, RewardPoints $rewards): JsonResponse
    {
        return response()->json(['data' => [
            'store_name' => $settings->get('store_name'),
            // Phase 13: the store's languages, the one a first visit gets, and Bangla digits (০–৯) in Bangla.
            'locales' => Locale::SUPPORTED,
            'default_locale' => Locale::storeDefault(),
            'bangla_digits' => Locale::banglaDigitsEnabled(),
            'support_email' => $settings->get('support_email'),
            'support_phone' => $settings->get('support_phone'),
            'shipping_methods' => array_values(array_map(fn (array $method) => [
                'id' => $method['id'],
                'label' => __($method['label']), // phase 13: in the request language (ids stay)
                'eta' => __($method['eta']),
                'price' => Pricing::format($method['price_cents']),
            ], $settings->shippingMethods())),
            'free_shipping_threshold' => Pricing::format($settings->cents('free_shipping_threshold')),
            'allowed_countries' => $settings->get('allowed_countries'),
            'default_country' => $settings->get('default_country'), // phase 14: the country address forms start with (null: none)
            'payment_methods' => $settings->paymentMethods(),
            'guest_checkout' => (bool) $settings->get('guest_checkout'),
            'tax_enabled' => (bool) $settings->get('tax_enabled'),
            // Phase 6: Settings → Returns, so the storefront can show the policy and the reasons.
            'returns_enabled' => (bool) $settings->get('returns_enabled'),
            'return_window_days' => (int) $settings->get('return_window_days'),
            'return_reasons' => array_values($settings->get('return_reasons', [])),
            // Phase 8: "stripe" = card orders are paid online on Stripe's page; "manual" = staff invoice them.
            'card_payments' => $payments->cardPayments(),
            // Phase 10 (part B): "paypal" = PayPal orders are approved on PayPal's site and captured online; "manual" = staff invoice them.
            // Phase 12: "unavailable" when PayPal doesn't take the store currency (taka).
            'paypal_payments' => $paypal->paypalPayments(),
            // Phase 12: "sslcommerz" (bKash, Nagad, cards on SSLCommerz's page), "manual" (staff invoice them), "unavailable" (store currency isn't BDT).
            'sslcommerz_payments' => $sslcommerz->sslcommerzPayments(),
            // Phase 12: the store currency (a deployment setting); every price above and in the catalog is in it.
            'currency' => Currency::api(),
            // Phase 10 (part A): Google Analytics 4 (null = off; the storefront asks for cookie consent first).
            'ga4_measurement_id' => $settings->get('ga4_measurement_id'),
            // Phase 11: reward points ("Earn about N points" = floor(price × earn_rate)) and display currencies (enabled, with a rate).
            'rewards' => [
                'enabled' => $rewards->enabled(),
                'earn_rate' => $rewards->earnRateString(),
                'point_value' => $rewards->pointValueString(),
                'min_redeem' => $rewards->minRedeem(),
            ],
            // Phase 14: cash on delivery rules (fee, limit, advance delivery charge, zones, phone confirmation).
            'cod' => app(CashOnDelivery::class)->publicSettings(),
            'currencies' => [
                'base' => CurrencyController::base(),
                'display' => CurrencyRate::where('enabled', true)->where('rate', '>', 0)->orderBy('position')->orderBy('id')->get()
                    ->map(fn (CurrencyRate $rate) => ['code' => $rate->code, 'symbol' => $rate->symbol, 'rate' => $rate->rate, 'decimals' => $rate->decimals])
                    ->values()->all(),
            ],
        ]]);
    }
}
