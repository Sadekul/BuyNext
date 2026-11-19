<?php

namespace Tests\Feature;

use App\Mail\InvoiceMail;
use App\Mail\OrderPlacedMail;
use App\Models\AuditLog;
use App\Models\CatalogRule;
use App\Models\Coupon;
use App\Models\CurrencyRate;
use App\Models\GiftCard;
use App\Models\Invoice;
use App\Models\Order;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\ShippingRate;
use App\Services\DocumentPdfs;
use App\Services\EmailTemplates;
use App\Services\GiftCards;
use App\Services\Settings;
use App\Support\Currency;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/**
 * Phase 12: the store currency (BUYNEST_CURRENCY), each order's own
 * currency, and php artisan buynest:currency:convert.
 */
class StoreCurrencyTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        config(['buynest.storefront_url' => 'https://shop.example.com']);
    }

    private function bdtAddress(): array
    {
        return ['first_name' => 'Rahim', 'last_name' => 'Uddin', 'line1' => 'House 12', 'line2' => null, 'city' => 'Dhaka', 'state' => null,
            'postal_code' => '1207', 'country' => 'Bangladesh'];
    }

    public function test_money_is_written_in_the_currency(): void
    {
        $this->assertSame('$59.97', Currency::format('59.97', 'USD'));
        $this->assertSame('৳1,250.00', Currency::format('1250', 'BDT'));
        $this->assertSame('-৳5.00', Currency::format('-5', 'BDT'));
        $this->assertSame('XYZ 1.50', Currency::format('1.5', 'XYZ'));
        $this->assertSame('', Currency::format(null));
        $this->assertSame(['code' => 'USD', 'symbol' => '$', 'decimals' => 2], Currency::api());
        config(['buynest.store.currency' => 'BDT']);
        $this->assertSame(['code' => 'BDT', 'symbol' => '৳', 'decimals' => 2], Currency::api());
        $this->assertSame('৳9.99', Currency::format('9.99'));
    }

    public function test_the_store_currency_comes_from_the_configuration(): void
    {
        $this->getJson('/api/v1/store')->assertOk()->assertJsonPath('data.currency', ['code' => 'USD', 'symbol' => '$', 'decimals' => 2])
            ->assertJsonPath('data.currencies.base', 'USD');
        config(['buynest.store.currency' => 'BDT']);
        $this->getJson('/api/v1/store')->assertOk()->assertJsonPath('data.currency', ['code' => 'BDT', 'symbol' => '৳', 'decimals' => 2])
            ->assertJsonPath('data.currencies.base', 'BDT')
            ->assertJsonPath('data.paypal_payments', 'unavailable')
            ->assertJsonPath('data.payment_methods', ['card', 'cod']);
    }

    public function test_stripe_charges_in_the_store_currency(): void
    {
        config(['buynest.store.currency' => 'BDT', 'buynest.stripe.secret_key' => 'sk_test_currency']);
        Http::fake(['api.stripe.com/v1/checkout/sessions' => fn (Request $request) => Http::response([
            'id' => 'cs_test_1', 'url' => 'https://checkout.stripe.com/c/pay/cs_test_1', 'expires_at' => (int) $request['expires_at'],
        ])]);
        $lamp = $this->product(['price' => '1250.00', 'stock_quantity' => 5]);

        $this->placeOrder([['product_id' => $lamp->id, 'quantity' => 1]], ['payment_method' => 'card', 'shipping_address' => $this->bdtAddress()])
            ->assertCreated()->assertJsonPath('data.currency', 'BDT')->assertJsonPath('data.payment.provider', 'stripe');
        Http::assertSent(fn (Request $request) => $request['line_items[0][price_data][currency]'] === 'bdt'
            && (int) $request['line_items[0][price_data][unit_amount]'] === 125000);
    }

    public function test_orders_keep_the_currency_they_were_placed_in(): void
    {
        // Orders from before phase 12 were dollars: the column's default back-fills them.
        $this->assertTrue(Schema::hasColumn('orders', 'currency'));
        $old = Order::factory()->create();
        $this->assertSame('USD', $old->fresh()->currency);
        DB::table('orders')->insert([...collect(Order::factory()->raw())->map(fn ($v) => is_array($v) ? json_encode($v) : $v)->all(),
            'number' => 'BN-LEGACY', 'created_at' => now(), 'updated_at' => now()]);
        $this->assertSame('USD', Order::where('number', 'BN-LEGACY')->value('currency'));

        config(['buynest.store.currency' => 'BDT']);
        $lamp = $this->product(['price' => '1250.00', 'stock_quantity' => 5]);
        $number = $this->placeOrder([['product_id' => $lamp->id, 'quantity' => 1]], ['shipping_address' => $this->bdtAddress()])
            ->assertCreated()->assertJsonPath('data.currency', 'BDT')->json('data.number');
        $this->assertSame('BDT', Order::where('number', $number)->value('currency'));

        // Switching back to dollars changes nothing for it.
        config(['buynest.store.currency' => 'USD']);
        $this->postJson('/api/v1/orders/lookup', ['number' => $number, 'email' => 'guest@example.com'])->assertOk()->assertJsonPath('data.currency', 'BDT');
    }

    public function test_documents_emails_and_pdfs_use_the_order_currency(): void
    {
        config(['buynest.store.currency' => 'BDT']);
        $lamp = $this->product(['price' => '1250.00', 'stock_quantity' => 5]);
        $number = $this->placeOrder([['product_id' => $lamp->id, 'quantity' => 1]], ['shipping_address' => $this->bdtAddress()])->json('data.number');
        Mail::assertSent(OrderPlacedMail::class, function (OrderPlacedMail $mail) {
            $html = $mail->render();

            return str_contains($html, '৳1,250.00') && ! str_contains($html, '$1250') && ! str_contains($html, '$1,250');
        });

        // The store goes back to dollars; the taka order's documents stay in taka.
        config(['buynest.store.currency' => 'USD']);
        $this->asAdmin($this->adminHeaders(), 'POST', "/api/admin/v1/orders/{$number}/invoices", ['notify_customer' => true])->assertCreated();
        $invoice = Invoice::sole();
        $this->assertStringContainsString('payment of ৳1,250.00 recorded', Order::sole()->history->last()->note);
        Mail::assertSent(InvoiceMail::class, fn (InvoiceMail $mail) => str_contains($mail->render(), '৳1,250.00')
            && str_contains($mail->envelope()->subject ?? '', $number));

        $html = app(DocumentPdfs::class)->html($invoice);
        $this->assertStringContainsString('৳1,250.00', $html);
        $this->assertStringNotContainsString('$1,250.00', $html);
        $pdf = app(DocumentPdfs::class)->pdf($invoice);
        $this->assertStringStartsWith('%PDF-', $pdf);
        // DejaVu Sans has no ৳: the taka sign comes from the bundled Noto Sans Bengali (embedded as a subset).
        $this->assertMatchesRegularExpression('#/BaseFont\s*/[A-Z]{6}\+NotoSansBengali#', $pdf);

        $this->asAdmin($this->adminHeaders(), 'GET', "/api/admin/v1/orders/{$number}")->assertOk()->assertJsonPath('data.currency', 'BDT');
    }

    public function test_saved_email_templates_get_the_order_currency_symbol(): void
    {
        config(['buynest.store.currency' => 'BDT']);
        $templates = app(EmailTemplates::class);
        $rendered = $templates->render('order_status', ['order_number' => 'BN-1', 'order_total' => '1250.00', 'customer_first_name' => 'Rahim',
            'status_heading' => 'Shipped', 'status_message' => 'On its way.'], 'Total ${{ order_total }} / {{ order_total }}',
            '<p>Total ${{ order_total }}</p>', currency: 'BDT');
        $this->assertSame('Total ৳1,250.00 / 1250.00', $rendered['subject']);
        $this->assertStringContainsString('Total ৳1,250.00', $rendered['html']);
        $this->assertStringContainsString('Total $1,250.00', $templates->render('order_status', ['order_total' => '1250.00'],
            'x {{ order_number }}', '<p>Total ${{ order_total }}</p>', currency: 'USD')['html']);
    }

    public function test_a_gift_card_pays_only_in_its_own_currency(): void
    {
        [, $dollarCode] = app(GiftCards::class)->create(5000, []); // a USD card
        config(['buynest.store.currency' => 'BDT']);
        $lamp = $this->product(['price' => '1250.00', 'stock_quantity' => 5]);

        $this->placeOrder([['product_id' => $lamp->id, 'quantity' => 1]], ['gift_card_code' => $dollarCode, 'shipping_address' => $this->bdtAddress()])
            ->assertStatus(422)->assertJsonPath('errors.gift_card_code.0', 'This gift card is in USD, so it can\'t pay for an order in BDT.');
        $this->assertSame(0, Order::count());

        [, $takaCode] = app(GiftCards::class)->create(10000, []);
        $this->placeOrder([['product_id' => $lamp->id, 'quantity' => 1]], ['gift_card_code' => $takaCode, 'shipping_address' => $this->bdtAddress()])
            ->assertCreated()->assertJsonPath('data.totals.gift_card', '100.00');
    }

    // ---- buynest:currency:convert -------------------------------------------------------

    /** A small catalog with every kind of stored price. */
    private function catalog(): array
    {
        $lamp = $this->product(['name' => 'Lamp', 'price' => '19.99', 'stock_quantity' => 5]);
        $card = $this->product(['name' => 'Gift Card', 'type' => 'gift_card', 'price' => '0.00', 'gift_card_amounts' => ['25.00', '50.00'],
            'gift_card_min_amount' => '10.00', 'gift_card_max_amount' => '500.00']);
        $variant = ProductVariant::create(['product_id' => $lamp->id, 'sku' => 'LAMP-RED', 'option_value_ids' => [], 'option_key' => 'red',
            'price' => '21.49', 'stock_quantity' => 1, 'is_active' => true]);
        $fixedRule = CatalogRule::create(['name' => 'Two off', 'is_active' => true, 'customer_group_ids' => [], 'category_ids' => [], 'product_ids' => [],
            'action' => 'fixed', 'amount' => '2.00', 'priority' => 0]);
        $percentRule = CatalogRule::create(['name' => 'Ten percent', 'is_active' => true, 'customer_group_ids' => [], 'category_ids' => [], 'product_ids' => [],
            'action' => 'percent', 'amount' => '10.00', 'priority' => 1]);
        $fixed = Coupon::create(['code' => 'FIVE', 'description' => '5 off', 'type' => 'fixed', 'value' => '5.00', 'min_subtotal' => '30.00', 'is_active' => true]);
        $percent = Coupon::create(['code' => 'TEN', 'description' => '10%', 'type' => 'percent', 'value' => '10.00', 'min_subtotal' => null, 'is_active' => true]);
        $rate = ShippingRate::create(['method' => 'standard', 'country' => '*', 'min_subtotal' => '0.00', 'max_subtotal' => '49.99', 'price' => '4.99']);
        app(Settings::class)->put(['express_price' => '12.99']);
        [$giftCard] = app(GiftCards::class)->create(2550, []);
        [$spent] = app(GiftCards::class)->create(1000, []);
        $spent->forceFill(['balance' => '0.00'])->save();
        CurrencyRate::where('code', 'EUR')->update(['rate' => '0.92000000', 'enabled' => true]);
        $order = Order::factory()->create(['grand_total' => '19.99', 'subtotal' => '19.99']);

        return compact('lamp', 'card', 'variant', 'fixedRule', 'percentRule', 'fixed', 'percent', 'rate', 'giftCard', 'spent', 'order');
    }

    public function test_the_convert_command_refuses_the_wrong_environment(): void
    {
        $this->catalog();
        $this->artisan('buynest:currency:convert', ['currency' => 'BDT', '--rate' => '110'])
            ->expectsOutputToContain('Set BUYNEST_CURRENCY=BDT first')->assertFailed();
        config(['buynest.store.currency' => 'BDT']);
        $this->artisan('buynest:currency:convert', ['currency' => 'BDT', '--rate' => '0'])->assertExitCode(2);
        $this->artisan('buynest:currency:convert', ['currency' => 'BDT', '--rate' => '110', '--round' => '3'])->assertExitCode(2);
        $this->assertSame('19.99', Product::where('name', 'Lamp')->value('price'));
        $this->assertSame(0, DB::table('currency_conversions')->count());
    }

    public function test_a_dry_run_changes_nothing(): void
    {
        $this->catalog();
        config(['buynest.store.currency' => 'BDT']);
        $this->artisan('buynest:currency:convert', ['currency' => 'BDT', '--rate' => '110', '--dry-run' => true])
            ->expectsOutputToContain('Dry run')->expectsOutputToContain('Lamp: 19.99 → 2199.00')->assertSuccessful();
        $this->assertSame('19.99', Product::where('name', 'Lamp')->value('price'));
        $this->assertSame('12.99', app(Settings::class)->get('express_price'));
        $this->assertSame('USD', GiftCard::first()->currency);
        $this->assertSame(0, DB::table('currency_conversions')->count());
        $this->assertSame(0, AuditLog::where('action', 'currency.converted')->count());
    }

    public function test_the_convert_command_converts_every_price_once_and_leaves_orders_alone(): void
    {
        $c = $this->catalog();
        config(['buynest.store.currency' => 'BDT']);

        $this->artisan('buynest:currency:convert', ['currency' => 'BDT', '--rate' => '110'])->expectsOutputToContain('Done.')->assertSuccessful();

        $this->assertSame('2199.00', $c['lamp']->fresh()->price); // 19.99 × 110 = 2198.90 → whole taka
        $this->assertSame(['2750.00', '5500.00'], $c['card']->fresh()->gift_card_amounts);
        $this->assertSame(['1100.00', '55000.00'], [$c['card']->fresh()->gift_card_min_amount, $c['card']->fresh()->gift_card_max_amount]);
        $this->assertSame('2364.00', $c['variant']->fresh()->price); // 2363.90
        $this->assertSame('220.00', $c['fixedRule']->fresh()->amount);
        $this->assertSame('10.00', $c['percentRule']->fresh()->amount); // percentages don't change
        $this->assertSame(['550.00', '3300.00'], [$c['fixed']->fresh()->value, $c['fixed']->fresh()->min_subtotal]);
        $this->assertSame(['10.00', null], [$c['percent']->fresh()->value, $c['percent']->fresh()->min_subtotal]);
        $this->assertSame(['549.00', '0.00', '5499.00'], [$c['rate']->fresh()->price, $c['rate']->fresh()->min_subtotal, $c['rate']->fresh()->max_subtotal]);
        $settings = app(Settings::class);
        $settings->flush();
        $this->assertSame(['549.00', '1429.00', '2749.00', '5500.00', '1.1000'], [$settings->get('standard_price'), $settings->get('express_price'),
            $settings->get('next_day_price'), $settings->get('free_shipping_threshold'), $settings->get('rewards_point_value')]);
        // Gift card balances to the cent, with a note; spent cards stay as they were.
        $card = $c['giftCard']->fresh();
        $this->assertSame(['2805.00', '2805.00', 'BDT'], [$card->balance, $card->initial_balance, $card->currency]);
        $this->assertSame('Currency changed: 25.50 USD → 2805.00 BDT (rate 110).', $card->transactions()->latest('id')->value('note'));
        $this->assertSame('USD', $c['spent']->fresh()->currency);
        // Display currencies are relative to the new store currency.
        $this->assertSame('0.00836364', CurrencyRate::where('code', 'EUR')->value('rate'));
        // Orders and their documents are history: untouched.
        $this->assertSame(['19.99', 'USD'], [$c['order']->fresh()->grand_total, $c['order']->fresh()->currency]);

        $conversion = DB::table('currency_conversions')->sole();
        $this->assertSame(['USD', 'BDT', '110.00000000', '1.00', 'cli'], [$conversion->from_currency, $conversion->to_currency, $conversion->rate,
            $conversion->rounding, $conversion->actor]);
        $this->assertSame(2, json_decode($conversion->counts, true)['products']);
        $this->assertSame('Store prices converted USD → BDT at 110 (rounded to 1.00).', AuditLog::where('action', 'currency.converted')->sole()->summary);

        // A second run would multiply everything again: refused.
        $this->artisan('buynest:currency:convert', ['currency' => 'BDT', '--rate' => '110'])
            ->expectsOutputToContain('already converted to BDT')->assertFailed();
        $this->assertSame('2199.00', $c['lamp']->fresh()->price);
    }

    public function test_rounding_to_five_or_ten_taka_or_to_the_paisa(): void
    {
        $lamp = $this->product(['name' => 'Lamp', 'price' => '19.99', 'stock_quantity' => 5]);
        config(['buynest.store.currency' => 'BDT']);
        $this->artisan('buynest:currency:convert', ['currency' => 'BDT', '--rate' => '110', '--round' => '10'])->assertSuccessful();
        $this->assertSame('2200.00', $lamp->fresh()->price);

        $tea = $this->product(['name' => 'Tea', 'price' => '2.99', 'stock_quantity' => 5]);
        DB::table('currency_conversions')->delete();
        config(['buynest.store.currency' => 'EUR']);
        $this->artisan('buynest:currency:convert', ['currency' => 'EUR', '--rate' => '0.0077', '--round' => '0.01', '--from' => 'BDT'])->assertSuccessful();
        $this->assertSame('0.02', $tea->fresh()->price); // 2.99 × 0.0077 = 0.023
        $this->assertSame('16.94', $lamp->fresh()->price); // 2200 × 0.0077
    }
}
