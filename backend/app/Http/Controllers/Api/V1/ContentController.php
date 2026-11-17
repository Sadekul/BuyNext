<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\PageResource;
use App\Http\Resources\ProductResource;
use App\Models\Page;
use App\Services\HomeContent;
use App\Services\Payments\StripePayments;
use App\Services\Pricing;
use App\Services\Settings;
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
        $page = Page::where('slug', $slug)->where('is_published', true)->first();

        return $page ? (new PageResource($page))->forStorefront() : response()->json(['message' => 'Page not found.'], 404);
    }

    /**
     * GET /api/v1/store - the rules the server applies at checkout, so the
     * storefront shows the same ones (shipping prices, countries, payment
     * methods, guest checkout, whether tax is charged).
     */
    public function store(Settings $settings, StripePayments $payments): JsonResponse
    {
        return response()->json(['data' => [
            'store_name' => $settings->get('store_name'),
            'support_email' => $settings->get('support_email'),
            'support_phone' => $settings->get('support_phone'),
            'shipping_methods' => array_values(array_map(fn (array $method) => [
                'id' => $method['id'],
                'label' => $method['label'],
                'eta' => $method['eta'],
                'price' => Pricing::format($method['price_cents']),
            ], $settings->shippingMethods())),
            'free_shipping_threshold' => Pricing::format($settings->cents('free_shipping_threshold')),
            'allowed_countries' => $settings->get('allowed_countries'),
            'payment_methods' => $settings->paymentMethods(),
            'guest_checkout' => (bool) $settings->get('guest_checkout'),
            'tax_enabled' => (bool) $settings->get('tax_enabled'),
            // Phase 6: Settings → Returns, so the storefront can show the policy and the reasons.
            'returns_enabled' => (bool) $settings->get('returns_enabled'),
            'return_window_days' => (int) $settings->get('return_window_days'),
            'return_reasons' => array_values($settings->get('return_reasons', [])),
            // Phase 8: "stripe" = card orders are paid online on Stripe's page; "manual" = staff invoice them.
            'card_payments' => $payments->cardPayments(),
        ]]);
    }
}
