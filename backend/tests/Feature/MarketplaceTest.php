<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\AuditLog;
use App\Models\Category;
use App\Models\Coupon;
use App\Models\DeliveryZone;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\ShippingRate;
use App\Services\HomeContent;
use App\Services\Settings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Concerns\BangladeshAddresses;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 17 (docs/backend/PHASE17_CONTRACT.md §1): best selling sort, the delivery estimate, and the promo strip. */
class MarketplaceTest extends TestCase
{
    use BangladeshAddresses, PlacesOrders, RefreshDatabase;

    private const BN = ['Accept-Language' => 'bn'];

    /* ---------------------------------------------------------------- best selling */

    /** An order (no money checks: only its status, date and lines matter here). */
    private function sold(array $lines, string $status = 'processing', ?string $createdAt = null): Order
    {
        $order = Order::factory()->create(['status' => $status]);
        if ($createdAt) {
            $order->forceFill(['created_at' => $createdAt])->save();
        }
        foreach ($lines as [$product, $quantity]) {
            OrderItem::create(['order_id' => $order->id, 'product_id' => $product->id, 'sku' => $product->sku, 'name' => $product->name,
                'unit_price' => '10.00', 'discount_percent' => '0.00', 'sale_price' => '10.00', 'quantity' => $quantity,
                'line_total' => number_format(10 * $quantity, 2, '.', '')]);
        }

        return $order;
    }

    private function ids(string $query): array
    {
        return array_column($this->getJson('/api/v1/products?'.$query)->assertOk()->json('data'), 'id');
    }

    public function test_best_selling_orders_by_units_sold_then_rating_then_id(): void
    {
        $category = Category::factory()->create(['slug' => 'lamps']);
        $make = fn (string $rating) => $this->product(['category_id' => $category->id, 'rating_average' => $rating]);
        $few = $make('5.00');
        $many = $make('3.00');
        $neverA = $make('4.00');
        $neverB = $make('4.50');
        $neverC = $make('4.50');
        $tieLow = $make('2.00');
        $tieHigh = $make('4.90');

        $this->sold([[$many, 3], [$few, 1]]);
        $this->sold([[$many, 4], [$tieLow, 2], [$tieHigh, 2]]);
        $this->sold([[$few, 50]], 'cancelled'); // cancelled orders don't count
        $this->sold([[$neverA, 99]], 'delivered', now()->subDays(91)->toDateTimeString()); // older than 90 days
        $this->sold([[$few, 1]], 'delivered', now()->subDays(89)->toDateTimeString()); // inside the window: few = 2

        $this->assertSame(
            [$many->id, $few->id, $tieHigh->id, $tieLow->id, $neverB->id, $neverC->id, $neverA->id],
            $this->ids('category=lamps&sort=best_selling&per_page=20'),
            'units desc (7, then 2, 2, 2 by rating 5.0, 4.9, 2.0, then 0 by rating 4.5, 4.5 (id), 4.0)',
        );
        // Ascending puts the unsold first (still rating, then id among ties).
        $this->assertSame($many->id, last($this->ids('category=lamps&sort=best_selling&direction=asc&per_page=20')));
    }

    public function test_best_selling_pages_never_overlap_and_filters_still_apply(): void
    {
        $category = Category::factory()->create(['slug' => 'desks']);
        $other = Category::factory()->create(['slug' => 'chairs']);
        $products = collect(range(1, 5))->map(fn () => $this->product(['category_id' => $category->id]));
        $elsewhere = $this->product(['category_id' => $other->id]);
        $this->sold([[$products[3], 5], [$products[1], 2], [$elsewhere, 100]]);
        $outOfStock = $this->product(['category_id' => $category->id, 'stock_quantity' => 0]);
        $this->sold([[$outOfStock, 50]]);

        $page1 = $this->getJson('/api/v1/products?category=desks&sort=best_selling&per_page=2&available=1')->assertOk();
        $page2 = $this->getJson('/api/v1/products?category=desks&sort=best_selling&per_page=2&available=1&page=2')->assertOk();
        $page3 = $this->getJson('/api/v1/products?category=desks&sort=best_selling&per_page=2&available=1&page=3')->assertOk();
        $this->assertSame(5, $page1->json('meta.total'), 'the join adds no rows and the stock filter still works');
        $all = [...array_column($page1->json('data'), 'id'), ...array_column($page2->json('data'), 'id'), ...array_column($page3->json('data'), 'id')];
        $this->assertSame([$products[3]->id, $products[1]->id, $products[0]->id, $products[2]->id, $products[4]->id], $all);
        $this->assertNotContains($elsewhere->id, $all);
        // units_sold: the number the sort uses (out-of-stock sales excluded with the product); has_sales over the whole result.
        $this->assertSame([5, 2], array_column($page1->json('data'), 'units_sold'));
        $this->assertSame([0, 0], array_column($page2->json('data'), 'units_sold'));
        $this->assertTrue($page3->json('meta.has_sales'), 'any item of the whole filtered result, not just this page');
        $this->assertSame(3, $page3->json('meta.last_page'), 'pagination meta is kept');
    }

    public function test_units_sold_and_has_sales_only_on_best_selling_lists(): void
    {
        $category = Category::factory()->create(['slug' => 'rugs']);
        $rug = $this->product(['category_id' => $category->id]);
        $this->sold([[$rug, 4]], 'cancelled');
        $this->sold([[$rug, 9]], 'delivered', now()->subDays(120)->toDateTimeString());

        // Only cancelled and old sales: the order is the rating order, and the storefront can tell.
        $response = $this->getJson('/api/v1/products?category=rugs&sort=best_selling')->assertOk();
        $this->assertFalse($response->json('meta.has_sales'));
        $this->assertSame(0, $response->json('data.0.units_sold'));

        $this->sold([[$rug, 2]]);
        $response = $this->getJson('/api/v1/products?category=rugs&sort=best_selling&direction=asc')->assertOk();
        $this->assertTrue($response->json('meta.has_sales'));
        $this->assertSame(2, $response->json('data.0.units_sold'));
        // With a search too, has_sales sits next to the search meta.
        $response = $this->getJson('/api/v1/products?category=rugs&sort=best_selling&search='.urlencode($rug->name))->assertOk();
        $this->assertTrue($response->json('meta.has_sales'));
        $this->assertArrayHasKey('corrected_query', $response->json('meta'));

        // Other listings don't compute it.
        foreach (['sort=rating', 'sort=newest', ''] as $sort) {
            $response = $this->getJson('/api/v1/products?category=rugs&'.$sort)->assertOk();
            $this->assertArrayNotHasKey('units_sold', $response->json('data.0'));
            $this->assertArrayNotHasKey('has_sales', $response->json('meta'));
        }
        $this->assertArrayNotHasKey('units_sold', $this->getJson('/api/v1/products/'.$rug->id)->assertOk()->json('data'));
    }

    public function test_best_selling_works_with_brand_and_search_and_runs_one_listing_query(): void
    {
        $category = Category::factory()->create(['slug' => 'kettles']);
        $a = $this->product(['category_id' => $category->id, 'name' => 'Steel Kettle Alpha']);
        $b = $this->product(['category_id' => $category->id, 'name' => 'Steel Kettle Beta']);
        $this->sold([[$b, 3], [$a, 1]]);

        $this->assertSame([$b->id, $a->id], $this->ids('search=kettle&sort=best_selling&category=kettles'));

        DB::enableQueryLog();
        $this->ids('category=kettles&sort=best_selling&per_page=12');
        $sums = collect(DB::getQueryLog())->filter(fn ($q) => str_contains($q['query'], 'SUM(order_items.quantity)'));
        DB::disableQueryLog();
        $this->assertCount(3, $sums, 'one grouped subquery each for the page, the count and has_sales (no per-product queries)');
    }

    public function test_an_unknown_sort_is_still_rejected(): void
    {
        $this->getJson('/api/v1/products?sort=popular')->assertStatus(422)->assertJsonValidationErrors('sort');
    }

    /* ---------------------------------------------------------------- delivery estimate */

    private function bangladeshStore(array $settings = []): void
    {
        app(Settings::class)->put(['default_country' => 'Bangladesh', ...$settings]);
    }

    public function test_the_estimate_shows_the_zone_methods_and_cod_for_an_area(): void
    {
        $this->bangladeshStore(['cod_fee' => '20.00']);
        $this->zoneRates();
        $area = $this->dhanmondi()->load('district.division');

        $response = $this->getJson('/api/v1/delivery/estimate?area_id='.$area->id)->assertOk()
            ->assertHeader('Vary', 'Accept-Language');
        $this->assertStringContainsString('public', $response->headers->get('Cache-Control'));
        $this->assertStringContainsString('max-age=600', $response->headers->get('Cache-Control'));
        $data = $response->json('data');

        $this->assertSame(['id' => $area->id, 'name' => 'Dhanmondi', 'district' => $area->district->name, 'district_id' => $area->district_id,
            'division' => $area->district->division->name, 'division_id' => $area->district->division_id], $data['area']);
        $this->assertSame(['code' => 'inside_dhaka', 'name' => 'Inside Dhaka'], $data['zone']);
        $standard = collect($data['methods'])->firstWhere('id', 'standard');
        $this->assertSame(['id' => 'standard', 'label' => 'Standard', 'price' => '60.00', 'eta' => 'Delivery in 1–2 days',
            'eta_days_min' => 1, 'eta_days_max' => 2, 'free_over_threshold' => true], $standard);
        // Methods without table rows keep their flat price and ETA text (as at checkout).
        $express = collect($data['methods'])->firstWhere('id', 'express');
        $this->assertSame('12.99', $express['price']);
        $this->assertNull($express['eta_days_min']);
        $this->assertSame('50.00', $data['free_shipping_threshold']);
        $this->assertSame(['available' => true, 'reason' => null, 'message' => null, 'fee' => '20.00'], $data['cod']);

        // Same price as the cart for the same area.
        $lamp = $this->product(['price' => '10.00']);
        $cart = $this->postJson('/api/v1/cart/validate', ['items' => [['product_id' => $lamp->id, 'quantity' => 1]], 'country' => 'BD',
            'area_id' => $area->id, 'district_id' => $area->district_id])->assertOk()->json('data.shipping_options');
        $this->assertSame('60.00', collect($cart)->firstWhere('id', 'standard')['price']);
    }

    public function test_other_zones_and_bangla_names(): void
    {
        $this->bangladeshStore();
        $this->zoneRates();
        $savar = $this->savar()->load('district.division');

        $data = $this->getJson('/api/v1/delivery/estimate?area_id='.$savar->id, self::BN)->assertOk()->json('data');
        $this->assertSame($savar->bn_name, $data['area']['name']);
        $this->assertSame($savar->district->bn_name, $data['area']['district']);
        $this->assertSame($savar->district->division->bn_name, $data['area']['division']);
        $this->assertSame(['code' => 'dhaka_suburbs', 'name' => 'ঢাকার আশপাশ'], $data['zone']);
        $standard = collect($data['methods'])->firstWhere('id', 'standard');
        $this->assertSame('100.00', $standard['price']);
        $this->assertSame('স্ট্যান্ডার্ড', $standard['label']);
        $this->assertSame('২–৩ দিনে ডেলিভারি', $standard['eta']);

        $outside = $this->getJson('/api/v1/delivery/estimate?area_id='.$this->debidwar()->id)->assertOk()->json('data');
        $this->assertSame('outside_dhaka', $outside['zone']['code']);
        $this->assertSame('120.00', collect($outside['methods'])->firstWhere('id', 'standard')['price']);
    }

    public function test_cod_follows_the_zones_and_the_payment_methods(): void
    {
        $this->bangladeshStore(['cod_zones' => ['inside_dhaka']]);
        $this->zoneRates();

        $cod = $this->getJson('/api/v1/delivery/estimate?area_id='.$this->debidwar()->id)->assertOk()->json('data.cod');
        $this->assertSame(['available' => false, 'reason' => 'zone', 'message' => 'Cash on delivery isn\'t available in your area.', 'fee' => '0.00'], $cod);
        $this->assertTrue($this->getJson('/api/v1/delivery/estimate?area_id='.$this->dhanmondi()->id)->json('data.cod.available'));

        app(Settings::class)->put(['enabled_payment_methods' => ['card']]);
        $cod = $this->getJson('/api/v1/delivery/estimate?area_id='.$this->dhanmondi()->id)->assertOk()->json('data.cod');
        $this->assertSame(['available' => false, 'reason' => 'disabled', 'message' => 'Cash on delivery isn\'t offered right now.', 'fee' => '0.00'], $cod);
    }

    public function test_an_area_without_an_active_zone_has_no_zone_and_flat_prices(): void
    {
        $this->bangladeshStore();
        $this->zoneRates();
        DeliveryZone::query()->update(['is_active' => false]);

        $data = $this->getJson('/api/v1/delivery/estimate?area_id='.$this->debidwar()->id)->assertOk()->json('data');
        $this->assertNull($data['zone']);
        // The "*" row of the zoneRates() table applies, as at checkout.
        $this->assertSame('9.00', collect($data['methods'])->firstWhere('id', 'standard')['price']);
        // A method whose rows match nothing is left out, as at checkout.
        ShippingRate::query()->whereNull('zone_code')->delete();
        $methods = $this->getJson('/api/v1/delivery/estimate?area_id='.$this->debidwar()->id)->assertOk()->json('data.methods');
        $this->assertNotContains('standard', array_column($methods, 'id'));
    }

    public function test_estimate_validation(): void
    {
        $this->bangladeshStore();
        $this->getJson('/api/v1/delivery/estimate')->assertStatus(422)
            ->assertJsonValidationErrors(['area_id' => 'Choose your area (upazila or thana).']);
        $this->getJson('/api/v1/delivery/estimate?area_id=abc')->assertStatus(422)->assertJsonValidationErrors('area_id');
        $this->getJson('/api/v1/delivery/estimate?area_id=999999')->assertStatus(422)
            ->assertJsonValidationErrors(['area_id' => 'Choose your area (upazila or thana).']);
        $this->getJson('/api/v1/delivery/estimate?area_id=999999', self::BN)->assertStatus(422)
            ->assertJsonValidationErrors(['area_id' => 'আপনার এলাকা (উপজেলা বা থানা) বেছে নিন।']);
    }

    public function test_the_estimate_is_only_for_a_bangladeshi_store(): void
    {
        app(Settings::class)->put(['default_country' => 'Germany']);
        $this->getJson('/api/v1/delivery/estimate?area_id='.$this->dhanmondi()->id)->assertStatus(422)
            ->assertJsonValidationErrors(['area_id' => 'Delivery areas are for Bangladesh addresses.']);
        app(Settings::class)->put(['default_country' => null]);
        $this->getJson('/api/v1/delivery/estimate?area_id='.$this->dhanmondi()->id, self::BN)->assertStatus(422)
            ->assertJsonValidationErrors(['area_id' => 'ডেলিভারি এলাকা শুধু বাংলাদেশের ঠিকানার জন্য।']);
        app(Settings::class)->put(['default_country' => 'BD']);
        $this->getJson('/api/v1/delivery/estimate?area_id='.$this->dhanmondi()->id)->assertOk();
    }

    /* ---------------------------------------------------------------- promo strip (top_bar) */

    private function coupon(array $attributes = []): Coupon
    {
        return Coupon::create(['code' => 'EID10', 'description' => '10% off', 'type' => 'percent', 'value' => '10.00', 'is_active' => true, ...$attributes]);
    }

    /** A valid PUT body: the stored content (as the admin sends it back) with $changes on top. */
    private function body(array $changes = []): array
    {
        $content = app(HomeContent::class)->get();
        $content['featured_product_ids'] = [];

        return array_replace($content, $changes);
    }

    private function saveTopBar(array $topBar, ?array $headers = null)
    {
        return $this->asAdmin($headers ?? $this->adminHeaders(), 'PUT', '/api/admin/v1/home', $this->body(['top_bar' => $topBar]));
    }

    public function test_the_strip_is_hidden_by_default(): void
    {
        $admin = $this->asAdmin($this->adminHeaders(), 'GET', '/api/admin/v1/home')->assertOk()->json('data.top_bar');
        $this->assertSame(['enabled' => false, 'message' => null, 'message_bn' => null, 'coupon_code' => null], $admin);
        $this->assertNull($this->getJson('/api/v1/home')->assertOk()->json('data.top_bar'));
        $this->assertArrayHasKey('top_bar', $this->getJson('/api/v1/home')->json('data'));
    }

    public function test_the_admin_saves_the_strip_and_shoppers_see_it_in_their_language(): void
    {
        $this->coupon();
        $headers = $this->adminHeaders();
        $saved = $this->saveTopBar(['enabled' => true, 'message' => '  Eid sale: 10% off everything  ', 'message_bn' => 'ঈদ সেল: সবকিছুতে ১০% ছাড়',
            'coupon_code' => ' eid10 '], $headers)->assertOk()->json('data.top_bar');
        $this->assertSame(['enabled' => true, 'message' => 'Eid sale: 10% off everything', 'message_bn' => 'ঈদ সেল: সবকিছুতে ১০% ছাড়', 'coupon_code' => 'EID10'], $saved);
        $this->assertSame($saved, $this->asAdmin($headers, 'GET', '/api/admin/v1/home')->json('data.top_bar'));

        $this->assertSame(['message' => 'Eid sale: 10% off everything', 'coupon_code' => 'EID10'], $this->getJson('/api/v1/home')->json('data.top_bar'));
        $this->assertSame(['message' => 'ঈদ সেল: সবকিছুতে ১০% ছাড়', 'coupon_code' => 'EID10'], $this->getJson('/api/v1/home', self::BN)->json('data.top_bar'));

        // The save is audited like any home page save.
        $log = AuditLog::where('action', 'home.updated')->latest('id')->first();
        $this->assertNotNull($log);
        $this->assertStringContainsString('top_bar', $log->summary);

        // Without a Bangla message, Bangla shows the English one; turned off, nothing.
        $this->saveTopBar(['enabled' => true, 'message' => 'Free delivery this week', 'message_bn' => '', 'coupon_code' => null], $headers)->assertOk();
        $this->assertSame(['message' => 'Free delivery this week', 'coupon_code' => null], $this->getJson('/api/v1/home', self::BN)->json('data.top_bar'));
        $this->saveTopBar(['enabled' => false, 'message' => 'Free delivery this week'], $headers)->assertOk();
        $this->assertNull($this->getJson('/api/v1/home')->json('data.top_bar'));
    }

    public function test_the_coupon_must_be_active_when_saved(): void
    {
        $headers = $this->adminHeaders();
        $message = 'This coupon doesn\'t exist or isn\'t active.';
        $this->saveTopBar(['enabled' => true, 'message' => 'Sale', 'coupon_code' => 'NOPE'], $headers)->assertStatus(422)
            ->assertJsonValidationErrors(['top_bar.coupon_code' => $message]);
        $this->coupon(['code' => 'OFF', 'is_active' => false]);
        $this->coupon(['code' => 'LATER', 'starts_at' => now()->addDay()]);
        $this->coupon(['code' => 'OLD', 'ends_at' => now()->subDay()]);
        $this->coupon(['code' => 'GONE', 'usage_limit' => 1])->forceFill(['times_used' => 1])->save();
        $this->coupon(['code' => null, 'description' => 'Automatic', 'auto_apply' => true]);
        foreach (['OFF', 'LATER', 'OLD', 'GONE'] as $code) {
            $this->saveTopBar(['enabled' => true, 'message' => 'Sale', 'coupon_code' => $code], $headers)->assertStatus(422)
                ->assertJsonValidationErrors(['top_bar.coupon_code' => $message]);
        }
        $this->saveTopBar(['enabled' => true, 'message' => 'Sale', 'coupon_code' => str_repeat('A', 41)], $headers)->assertStatus(422)
            ->assertJsonValidationErrors(['top_bar.coupon_code' => $message]);
    }

    public function test_strip_validation(): void
    {
        $headers = $this->adminHeaders();
        $this->saveTopBar(['enabled' => true, 'message' => ''], $headers)->assertStatus(422)
            ->assertJsonValidationErrors(['top_bar.message' => 'Write the promo message, or turn the promo strip off.']);
        $this->saveTopBar(['enabled' => true, 'message' => str_repeat('a', 121)], $headers)->assertStatus(422)
            ->assertJsonValidationErrors(['top_bar.message' => 'The promo message has at most 120 characters.']);
        $this->saveTopBar(['enabled' => true, 'message' => 'Hi', 'message_bn' => str_repeat('ক', 121)], $headers)->assertStatus(422)
            ->assertJsonValidationErrors(['top_bar.message_bn' => 'The Bangla promo message has at most 120 characters.']);
        $this->saveTopBar(['enabled' => true, 'message' => 'Hi', 'colour' => 'red'], $headers)->assertStatus(422)->assertJsonValidationErrors('top_bar');
        // 120 characters (Bangla counts characters, not bytes) and a hidden strip without a message are fine.
        $this->saveTopBar(['enabled' => true, 'message' => str_repeat('a', 120), 'message_bn' => str_repeat('ক', 120)], $headers)->assertOk();
        $this->saveTopBar(['enabled' => false, 'message' => null], $headers)->assertOk();
    }

    public function test_an_expired_stored_coupon_never_blocks_a_save_but_a_changed_code_is_checked(): void
    {
        $coupon = $this->coupon();
        $headers = $this->adminHeaders();
        $this->saveTopBar(['enabled' => true, 'message' => 'Eid sale', 'coupon_code' => 'EID10'], $headers)->assertOk();
        $coupon->update(['ends_at' => now()->subMinute()]);

        // Shoppers never see a code that stopped working.
        $this->assertSame(['message' => 'Eid sale', 'coupon_code' => null], $this->getJson('/api/v1/home')->json('data.top_bar'));

        $body = $this->body();
        unset($body['top_bar']);
        $data = $this->asAdmin($headers, 'PUT', '/api/admin/v1/home', $body)->assertOk()->json('data.top_bar');
        $this->assertSame(['enabled' => true, 'message' => 'Eid sale', 'message_bn' => null, 'coupon_code' => 'EID10'], $data, 'leaving out top_bar never resets it');

        // Sent back unchanged (the admin always sends top_bar), the expired code doesn't block other edits; any case and spacing.
        $this->asAdmin($headers, 'PUT', '/api/admin/v1/home', $this->body())->assertOk()->assertJsonPath('data.top_bar.coupon_code', 'EID10');
        $this->saveTopBar(['enabled' => true, 'message' => 'Eid sale', 'coupon_code' => '  eid10 '], $headers)->assertOk()
            ->assertJsonPath('data.top_bar.coupon_code', 'EID10');
        $this->assertNull($this->getJson('/api/v1/home')->json('data.top_bar.coupon_code'), 'still hidden from shoppers');

        // A changed code is checked: an inactive one is refused, an active one saves.
        $this->coupon(['code' => 'OLD', 'ends_at' => now()->subDay()]);
        $this->saveTopBar(['enabled' => true, 'message' => 'Eid sale', 'coupon_code' => 'OLD'], $headers)->assertStatus(422)
            ->assertJsonValidationErrors(['top_bar.coupon_code' => 'This coupon doesn\'t exist or isn\'t active.']);
        $this->coupon(['code' => 'NEW5']);
        $this->saveTopBar(['enabled' => true, 'message' => 'Eid sale', 'coupon_code' => 'new5'], $headers)->assertOk()
            ->assertJsonPath('data.top_bar.coupon_code', 'NEW5');
        // Cleared and then set again to the expired code, it counts as new.
        $this->saveTopBar(['enabled' => true, 'message' => 'Eid sale', 'coupon_code' => null], $headers)->assertOk();
        $this->saveTopBar(['enabled' => true, 'message' => 'Eid sale', 'coupon_code' => 'EID10'], $headers)->assertStatus(422)
            ->assertJsonValidationErrors('top_bar.coupon_code');
    }

    public function test_content_stored_before_the_strip_existed_gets_the_default(): void
    {
        $content = app(HomeContent::class)->get();
        unset($content['top_bar']);
        app(Settings::class)->put([HomeContent::KEY => $content]);

        $this->assertSame(HomeContent::TOP_BAR_DEFAULTS, app(HomeContent::class)->get()['top_bar']);
        $this->assertNull($this->getJson('/api/v1/home')->assertOk()->json('data.top_bar'));
    }

    public function test_a_content_viewer_reads_but_cannot_save_the_strip(): void
    {
        $headers = $this->signInAdmin(Admin::factory()->role(['content.view'])->create());
        $this->asAdmin($headers, 'GET', '/api/admin/v1/home')->assertOk()->assertJsonPath('data.top_bar.enabled', false);
        $this->saveTopBar(['enabled' => true, 'message' => 'Sale'], $headers)->assertForbidden();
    }
}
