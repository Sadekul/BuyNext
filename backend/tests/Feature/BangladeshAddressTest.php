<?php

namespace Tests\Feature;

use App\Models\BdArea;
use App\Models\Customer;
use App\Models\Order;
use App\Services\BdAddresses;
use App\Services\Settings;
use App\Services\ShippingRates;
use Database\Seeders\BangladeshPlacesSeeder;
use Database\Seeders\DeliveryZonesSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\BangladeshAddresses;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 14 (§1–§3): Bangladesh places, addresses, mobile numbers, delivery zones and zone rates. */
class BangladeshAddressTest extends TestCase
{
    use BangladeshAddresses, PlacesOrders, RefreshDatabase;

    private const BN = ['Accept-Language' => 'bn'];

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
    }

    public function test_the_seeder_loads_every_place_once(): void
    {
        $counts = fn () => [DB::table('bd_divisions')->count(), DB::table('bd_districts')->count(),
            DB::table('bd_areas')->where('kind', 'upazila')->count(), DB::table('bd_areas')->where('kind', 'thana')->count(), DB::table('delivery_zone_places')->count()];
        $this->assertSame([8, 64, 495, 50, 52], $counts());
        (new BangladeshPlacesSeeder)->run();
        (new DeliveryZonesSeeder)->run();
        $this->assertSame([8, 64, 495, 50, 52], $counts(), 'idempotent');

        $this->assertSame([1001, 'Palton', 'পল্টন', 'Dhaka South City Corporation', ['1000']],
            [BdArea::find(1001)->id, BdArea::find(1001)->name, BdArea::find(1001)->bn_name, BdArea::find(1001)->city_corporation, BdArea::find(1001)->postcodes]);
        // BuyNest's supplement: the Dhaka Metropolitan Police thanas the dataset lacks, Inside Dhaka.
        $banani = BdArea::where('name', 'Banani')->firstOrFail();
        $this->assertSame([1114, 47, 'thana', 'বনানী'], [$banani->id, $banani->district_id, $banani->kind, $banani->bn_name]);
        $this->assertSame('inside_dhaka', DB::table('delivery_zone_places')->join('delivery_zones', 'delivery_zones.id', '=', 'delivery_zone_places.zone_id')
            ->where('delivery_zone_places.area_id', $banani->id)->value('delivery_zones.code'));
        $this->assertSame('দেবিদ্বার', $this->debidwar()->bn_name);
        $this->assertContains('3530', $this->debidwar()->postcodes);
        $this->assertTrue(BdArea::where('kind', 'thana')->get()->every(fn ($area) => preg_match('/[\x{0980}-\x{09FF}]/u', $area->bn_name) === 1));
    }

    public function test_places_api_in_both_languages(): void
    {
        $this->getJson('/api/v1/places/bd/divisions')->assertOk()->assertJsonCount(8, 'data')
            ->assertJsonPath('data.0.name', 'Barishal')->assertHeader('Cache-Control', 'max-age=86400, public')
            ->assertJsonStructure(['data' => [['id', 'name', 'name_en', 'name_bn']]]);
        $bn = $this->getJson('/api/v1/places/bd/divisions', self::BN)->assertOk();
        $this->assertSame($bn->json('data.*.name'), $bn->json('data.*.name_bn'));

        $this->getJson('/api/v1/places/bd/districts?division=6')->assertOk()->assertJsonCount(13, 'data')->assertJsonPath('data.0.division_id', 6);
        $this->getJson('/api/v1/places/bd/districts')->assertOk()->assertJsonCount(64, 'data');

        $areas = $this->getJson('/api/v1/places/bd/areas?district=47')->assertOk();
        $this->assertCount(54, $areas->json('data')); // 5 upazilas + 17 metro thanas + 32 more DMP thanas
        $dhanmondi = collect($areas->json('data'))->firstWhere('name', 'Dhanmondi');
        $this->assertEquals(['kind' => 'thana', 'name_bn' => 'ধানমন্ডি', 'postcodes' => ['1209'], 'city_corporation' => 'Dhaka South City Corporation'],
            array_intersect_key($dhanmondi, array_flip(['kind', 'name_bn', 'postcodes', 'city_corporation'])));
        $this->assertSame('ধানমন্ডি', collect($this->getJson('/api/v1/places/bd/areas?district=47', self::BN)->json('data'))->firstWhere('id', $dhanmondi['id'])['name']);
        $this->getJson('/api/v1/places/bd/areas')->assertUnprocessable()->assertJsonValidationErrors('district');
        $this->getJson('/api/v1/places/bd/areas?district=999')->assertOk()->assertExactJson(['data' => []]);
    }

    public function test_a_bangladesh_order_address_is_checked_and_filled(): void
    {
        $product = $this->product(['price' => '20.00']);
        $items = [['product_id' => $product->id, 'quantity' => 1]];

        $order = $this->placeOrder($items, ['phone' => '01712-345678', 'shipping_address' => $this->bdAddress()])->assertCreated();
        $order->assertJsonPath('data.phone', '+8801712345678')
            ->assertJsonPath('data.shipping_address.city', 'Dhaka')->assertJsonPath('data.shipping_address.state', 'Dhaka')
            ->assertJsonPath('data.shipping_address.country', 'Bangladesh')->assertJsonPath('data.shipping_address.area', 'Dhanmondi')
            ->assertJsonPath('data.shipping_address.area_id', $this->dhanmondi()->id)
            ->assertJsonPath('data.delivery.zone_code', 'inside_dhaka');

        // The ids must belong together; line1 is required; a postcode has 4 digits.
        $this->placeOrder($items, ['phone' => '01712345678', 'shipping_address' => $this->bdAddress(null, ['district_id' => 1, 'line1' => '', 'postal_code' => '12'])])
            ->assertUnprocessable()->assertJsonValidationErrors(['shipping_address.line1', 'shipping_address.postal_code'])
            ->assertJsonFragment(['shipping_address.postal_code' => ['Enter a 4-digit postcode.']]);
        $this->placeOrder($items, ['phone' => '01712345678', 'shipping_address' => $this->bdAddress(null, ['district_id' => 1])])
            ->assertUnprocessable()->assertJsonFragment(['shipping_address.district_id' => ['The district isn\'t in the chosen division.']]);
        $this->placeOrder($items, ['phone' => '01712345678', 'shipping_address' => $this->bdAddress(null, ['area_id' => $this->debidwar()->id])])
            ->assertUnprocessable()->assertJsonFragment(['shipping_address.area_id' => ['The area isn\'t in the chosen district.']]);
        $this->placeOrder($items, ['phone' => '01712345678', 'shipping_address' => $this->bdAddress(null, ['area_id' => $this->debidwar()->id])], self::BN)
            ->assertUnprocessable()->assertJsonFragment(['shipping_address.area_id' => ['এলাকাটি বেছে নেওয়া জেলার মধ্যে নেই।']]);

        // A Bangladeshi store requires the places even without ids; other stores keep free-text Bangladesh addresses.
        $free = ['first_name' => 'Rahim', 'last_name' => 'Uddin', 'line1' => 'House 12', 'city' => 'Dhaka', 'postal_code' => '1207', 'country' => 'Bangladesh'];
        $placed = $this->placeOrder($items, ['phone' => '+8801711000000', 'shipping_address' => $free])->assertCreated()
            ->assertJsonPath('data.delivery.zone_code', null);
        $this->assertEqualsCanonicalizing([...$free, 'line2' => null, 'state' => null], $placed->json('data.shipping_address'));
        app(Settings::class)->put(['default_country' => 'Bangladesh']);
        $this->placeOrder($items, ['phone' => '+8801711000000', 'shipping_address' => $free])->assertUnprocessable()
            ->assertJsonValidationErrors(['shipping_address.division_id', 'shipping_address.district_id', 'shipping_address.area_id']);
    }

    public function test_bangladeshi_mobile_numbers(): void
    {
        foreach (['01712345678', '+880 1712-345678', '8801712345678', '00880 1712 345678', '০১৭১২৩৪৫৬৭৮'] as $input) {
            $this->assertSame('+8801712345678', BdAddresses::normalizePhone($input), $input);
        }
        $product = $this->product();
        $items = [['product_id' => $product->id, 'quantity' => 1]];
        foreach (['01212345678', '+15550100100', '0171234567'] as $bad) {
            $this->placeOrder($items, ['phone' => $bad, 'shipping_address' => $this->bdAddress()])->assertUnprocessable()
                ->assertJsonPath('errors.phone.0', 'Enter a Bangladeshi mobile number, for example 01712 345678.');
        }
        $this->placeOrder($items, ['phone' => '01212345678', 'shipping_address' => $this->bdAddress()], self::BN)->assertUnprocessable()
            ->assertJsonPath('errors.phone.0', 'সঠিক একটি বাংলাদেশি মোবাইল নম্বর দিন, যেমন ০১৭১২ ৩৪৫৬৭৮।');
        // Other countries: the phase 1 rule, unchanged.
        $this->placeOrder($items, ['phone' => '01712345678'])->assertUnprocessable()
            ->assertJsonPath('errors.phone.0', 'Enter the phone number with its country code, for example +1 555 010 0100.');
        $this->placeOrder($items)->assertCreated()->assertJsonPath('data.shipping_address.city', 'Springfield')
            ->assertJsonPath('data.delivery', ['zone_code' => null, 'zone_name' => null, 'eta_days_min' => null, 'eta_days_max' => null, 'eta' => null])
            ->assertJsonPath('data.cod.fee', '0.00')->assertJsonPath('data.confirmation_status', null);
        $this->assertEqualsCanonicalizing(['first_name', 'last_name', 'line1', 'line2', 'city', 'state', 'postal_code', 'country'],
            array_keys(Order::latest('id')->first()->shipping_address));
    }

    public function test_the_address_book_takes_bangladesh_addresses(): void
    {
        $customer = Customer::factory()->create();
        $headers = ['Authorization' => 'Bearer '.$customer->createToken('t', ['customer'])->plainTextToken];
        $created = $this->postJson('/api/v1/me/addresses', [...$this->bdAddress($this->savar()), 'phone' => '01812 345678'], $headers)->assertCreated()
            ->assertJsonPath('data.phone', '+8801812345678')->assertJsonPath('data.city', 'Dhaka')->assertJsonPath('data.state', 'Dhaka')
            ->assertJsonPath('data.postal_code', null)->assertJsonPath('data.area_id', $this->savar()->id)->assertJsonPath('data.country', 'Bangladesh');
        $id = $created->json('data.id');

        // A PATCH of the area alone is checked against the saved district.
        $this->patchJson("/api/v1/me/addresses/{$id}", ['area_id' => $this->debidwar()->id], $headers)->assertUnprocessable()
            ->assertJsonValidationErrors('area_id');
        $this->patchJson("/api/v1/me/addresses/{$id}", ['division_id' => 1, 'district_id' => 1, 'area_id' => $this->debidwar()->id], $headers)->assertOk()
            ->assertJsonPath('data.city', 'Cumilla')->assertJsonPath('data.state', 'Chattogram');
        // Back to another country: the ids go.
        $this->patchJson("/api/v1/me/addresses/{$id}", ['country' => 'Germany', 'city' => 'Berlin', 'postal_code' => '10115', 'phone' => '+4930123456'], $headers)
            ->assertOk()->assertJsonPath('data.area_id', null)->assertJsonPath('data.city', 'Berlin');
    }

    public function test_zone_matching_and_zone_rates_with_eta(): void
    {
        $this->zoneRates();
        $product = $this->product(['price' => '20.00']);
        $cart = fn (?BdArea $area, array $headers = []) => $this->postJson('/api/v1/cart/validate', [
            'items' => [['product_id' => $product->id, 'quantity' => 1]], 'country' => $area ? 'BD' : 'Germany',
            'area_id' => $area?->id, 'district_id' => $area?->district_id,
        ], $headers)->assertOk();

        $inside = $cart($this->dhanmondi());
        $inside->assertJsonPath('data.delivery_zone', ['code' => 'inside_dhaka', 'name' => 'Inside Dhaka', 'name_en' => 'Inside Dhaka', 'name_bn' => 'ঢাকার ভেতরে'])
            ->assertJsonPath('data.shipping_options.0.price', '60.00')->assertJsonPath('data.shipping_options.0.eta', 'Delivery in 1–2 days')
            ->assertJsonPath('data.shipping_options.0.zone_code', 'inside_dhaka')->assertJsonPath('data.shipping_options.0.eta_days_max', 2);
        $cart($this->dhanmondi(), self::BN)->assertJsonPath('data.shipping_options.0.eta', '১–২ দিনে ডেলিভারি')->assertJsonPath('data.delivery_zone.name', 'ঢাকার ভেতরে');
        $cart($this->savar())->assertJsonPath('data.delivery_zone.code', 'dhaka_suburbs')->assertJsonPath('data.shipping_options.0.price', '100.00');
        $cart($this->debidwar())->assertJsonPath('data.delivery_zone.code', 'outside_dhaka')->assertJsonPath('data.shipping_options.0.price', '120.00')
            ->assertJsonPath('data.shipping_options.0.eta', 'Delivery in 3–5 days');
        // Not Bangladesh: the old rows ("*"), no zone.
        $cart(null)->assertJsonPath('data.delivery_zone', null)->assertJsonPath('data.shipping_options.0.price', '9.00')
            ->assertJsonPath('data.shipping_options.0.eta', '3–5 business days');

        // Only zone rows for a method: abroad it keeps its flat price (a Bangladesh zone price never
        // takes the method away from other countries).
        DB::table('shipping_rates')->where('method', 'standard')->whereNull('zone_code')->delete();
        app(ShippingRates::class)->flush();
        $standard = fn ($response) => collect($response->json('data.shipping_options'))->firstWhere('id', 'standard');
        $abroad = $standard($cart(null));
        $this->assertNotNull($abroad, 'Standard is still offered abroad');
        $this->assertSame(['flat', null], [$abroad['source'], $abroad['zone_code']]);
        $this->assertSame('120.00', $standard($cart($this->debidwar()))['price'], 'Bangladesh still uses its zone row');

        // An area listed in a zone beats its district's zone.
        DB::table('delivery_zone_places')->insert(['zone_id' => DB::table('delivery_zones')->where('code', 'inside_dhaka')->value('id'), 'area_id' => $this->savar()->id]);
        $cart($this->savar())->assertJsonPath('data.delivery_zone.code', 'inside_dhaka');

        // The order keeps the zone and its delivery time.
        $this->placeOrder([['product_id' => $product->id, 'quantity' => 1]], ['phone' => '01712345678', 'shipping_address' => $this->bdAddress($this->debidwar())])
            ->assertCreated()->assertJsonPath('data.totals.shipping', '120.00')
            ->assertJsonPath('data.delivery', ['zone_code' => 'outside_dhaka', 'zone_name' => 'Outside Dhaka', 'eta_days_min' => 3, 'eta_days_max' => 5, 'eta' => 'Delivery in 3–5 days']);
        $this->assertSame('outside_dhaka', Order::latest('id')->first()->delivery_zone_code);
    }

    public function test_staff_manage_zones_and_zone_rates(): void
    {
        $headers = $this->adminHeaders();
        $zones = $this->asAdmin($headers, 'GET', '/api/admin/v1/delivery-zones')->assertOk()->assertJsonCount(3, 'data')
            ->assertJsonPath('data.0.code', 'inside_dhaka')->assertJsonPath('data.2.is_fallback', true);
        $this->assertCount(49, $zones->json('data.0.areas')); // every Dhaka city thana
        $this->assertSame([41, 43, 47], collect($zones->json('data.1.districts'))->pluck('id')->sort()->values()->all());

        // A place belongs to one zone.
        $this->asAdmin($headers, 'POST', '/api/admin/v1/delivery-zones', ['code' => 'chattogram', 'name' => 'Chattogram city', 'bn_name' => 'চট্টগ্রাম শহর',
            'district_ids' => [47]])->assertUnprocessable()->assertJsonValidationErrors('district_ids.0');
        $created = $this->asAdmin($headers, 'POST', '/api/admin/v1/delivery-zones', ['code' => 'chattogram', 'name' => 'Chattogram city',
            'bn_name' => 'চট্টগ্রাম শহর', 'district_ids' => [8]])->assertCreated()->assertJsonPath('data.districts.0.name', 'Chattogram');
        $id = $created->json('data.id');
        $this->asAdmin($headers, 'GET', '/api/admin/v1/delivery-zones/match?district_id=8')->assertOk()->assertJsonPath('data.code', 'chattogram');

        // Zone rates name an existing zone; a zone with rates can't be deleted; the fallback can't either.
        $this->asAdmin($headers, 'POST', '/api/admin/v1/shipping-rates', ['method' => 'standard', 'country' => '*', 'zone_code' => 'nope', 'price' => '80'])
            ->assertUnprocessable()->assertJsonValidationErrors('zone_code');
        $this->asAdmin($headers, 'POST', '/api/admin/v1/shipping-rates', ['method' => 'standard', 'country' => '*', 'zone_code' => 'chattogram', 'price' => '80',
            'eta_days_min' => 2, 'eta_days_max' => 1])->assertUnprocessable()->assertJsonValidationErrors('eta_days_max');
        $this->asAdmin($headers, 'POST', '/api/admin/v1/shipping-rates', ['method' => 'standard', 'country' => '*', 'zone_code' => 'chattogram', 'price' => '80',
            'eta_days_min' => 2, 'eta_days_max' => 3])->assertCreated()->assertJsonPath('data.zone_code', 'chattogram')->assertJsonPath('data.eta_days_max', 3);
        $this->asAdmin($headers, 'DELETE', "/api/admin/v1/delivery-zones/{$id}")->assertUnprocessable()->assertJsonValidationErrors('zone');
        $fallback = collect($zones->json('data'))->firstWhere('code', 'outside_dhaka')['id'];
        $this->asAdmin($headers, 'DELETE', "/api/admin/v1/delivery-zones/{$fallback}")->assertUnprocessable()->assertJsonValidationErrors('zone');

        // Renaming the code carries its rates along.
        $this->asAdmin($headers, 'PATCH', "/api/admin/v1/delivery-zones/{$id}", ['code' => 'ctg'])->assertOk()->assertJsonPath('data.rates_count', 1);
        $this->asAdmin($headers, 'GET', '/api/admin/v1/shipping-rates/export.csv')->assertOk();
        $this->assertDatabaseHas('audit_log', ['action' => 'delivery_zone.updated']);
    }

    public function test_staff_create_orders_with_bangladesh_addresses(): void
    {
        $this->zoneRates();
        $headers = $this->adminHeaders();
        $product = $this->product(['price' => '20.00']);
        $body = ['items' => [['product_id' => $product->id, 'quantity' => 1]], 'guest' => ['email' => 'rahim@example.com', 'phone' => '01912-345678',
            'first_name' => 'Rahim', 'last_name' => 'Uddin'], 'shipping_address' => $this->bdAddress($this->savar()), 'same_as_shipping' => true,
            'shipping_method' => 'standard', 'payment_method' => 'cod'];
        $this->asAdmin($headers, 'POST', '/api/admin/v1/orders/quote', $body)->assertOk()
            ->assertJsonPath('data.delivery_zone.code', 'dhaka_suburbs')->assertJsonPath('data.totals.shipping', '100.00');
        $this->asAdmin($headers, 'POST', '/api/admin/v1/orders', [...$body, 'shipping_address' => $this->bdAddress($this->savar(), ['area_id' => $this->debidwar()->id])])
            ->assertUnprocessable()->assertJsonValidationErrors('shipping_address.area_id');
        $this->asAdmin($headers, 'POST', '/api/admin/v1/orders', [...$body, 'guest' => [...$body['guest'], 'phone' => '+15550100100']])
            ->assertUnprocessable()->assertJsonValidationErrors('guest.phone');
        $this->asAdmin($headers, 'POST', '/api/admin/v1/orders', $body)->assertCreated()->assertJsonPath('data.phone', '+8801912345678')
            ->assertJsonPath('data.shipping_address.city', 'Dhaka')->assertJsonPath('data.billing_address.area', 'Savar')
            ->assertJsonPath('data.delivery.zone_code', 'dhaka_suburbs')->assertJsonPath('data.totals.total', '120.00');
    }
}
