<?php

namespace Tests\Feature;

use App\Mail\InvoiceMail;
use App\Mail\OrderStatusMail;
use App\Mail\ShipmentMail;
use App\Models\Coupon;
use App\Models\Customer;
use App\Models\Invoice;
use App\Models\Order;
use App\Models\Product;
use App\Models\Shipment;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\Feature\Concerns\ReadsCodes;
use Tests\TestCase;

/** Phase 3: invoices (payment) and shipments (tracking), and how they move an order along. */
class OrderDocumentsTest extends TestCase
{
    use PlacesOrders, ReadsCodes, RefreshDatabase;

    /** Every admin route added in phase 3 (customer tokens must get 403 on all of them). */
    private const NEW_ADMIN_ROUTES = [
        ['POST', '/api/admin/v1/orders/BN-100001/invoices'],
        ['POST', '/api/admin/v1/orders/BN-100001/shipments'],
        ['GET', '/api/admin/v1/orders/BN-100001/refundable'],
        ['POST', '/api/admin/v1/orders/BN-100001/credit-memos'],
        ['GET', '/api/admin/v1/invoices'],
        ['GET', '/api/admin/v1/invoices/INV-100001'],
        ['GET', '/api/admin/v1/credit-memos'],
        ['GET', '/api/admin/v1/credit-memos/CM-100001'],
        ['GET', '/api/admin/v1/coupons'],
        ['POST', '/api/admin/v1/coupons'],
        ['GET', '/api/admin/v1/coupons/1'],
        ['PATCH', '/api/admin/v1/coupons/1'],
        ['DELETE', '/api/admin/v1/coupons/1'],
    ];

    private array $admin;

    private Product $lamp;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->admin = $this->adminHeaders();
        $this->lamp = $this->product(['price' => '25.00', 'stock_quantity' => 10]);
    }

    private function order(string $payment = 'cod', array $headers = [], array $overrides = []): string
    {
        $this->app['auth']->forgetGuards();

        return $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]], ['payment_method' => $payment, ...$overrides], $headers)
            ->assertCreated()->json('data.number');
    }

    private function admin(string $method, string $uri, array $body = [])
    {
        $this->app['auth']->forgetGuards();

        return $this->json($method, $uri, $body, $this->admin);
    }

    private function customerHeaders(Customer $customer): array
    {
        $this->app['auth']->forgetGuards();

        return $this->bearer($this->postJson('/api/v1/auth/login', ['email' => $customer->email, 'password' => 'Password123'])->json('data.tokens.access_token'));
    }

    public function test_every_new_admin_route_refuses_customer_tokens(): void
    {
        $number = $this->order();
        $headers = $this->customerHeaders(Customer::factory()->create());

        foreach (self::NEW_ADMIN_ROUTES as [$method, $uri]) {
            $uri = str_replace('BN-100001', $number, $uri);
            $this->app['auth']->forgetGuards();
            $this->json($method, $uri, ['carrier' => 'ups', 'code' => 'HACKED', 'type' => 'percent', 'value' => '50'], $headers)->assertForbidden();
            $this->app['auth']->forgetGuards();
            $this->json($method, $uri)->assertUnauthorized();
        }
        $this->assertSame(0, Invoice::count() + Shipment::count());
        $this->assertSame(['NEST10', 'SAVE20'], Coupon::orderBy('code')->pluck('code')->all());
    }

    public function test_invoicing_records_the_payment(): void
    {
        $number = $this->order('card'); // 25.00 + 4.99

        $response = $this->admin('POST', "/api/admin/v1/orders/{$number}/invoices", ['note' => 'Paid by bank transfer.'])->assertCreated();
        $invoice = Invoice::sole();
        $this->assertSame('INV-'.(100000 + $invoice->id), $invoice->number);
        $response->assertJsonPath('data.number', $invoice->number)
            ->assertJsonPath('data.order_number', $number)
            ->assertJsonPath('data.amount', '29.99')
            ->assertJsonPath('data.admin_name', 'Store Admin')
            ->assertJsonPath('data.note', 'Paid by bank transfer.')
            ->assertJsonPath('data.billing_address.first_name', 'Ava')
            ->assertJsonPath('data.items.0.line_total', '25.00')
            ->assertJsonPath('data.totals.total', '29.99')
            ->assertJsonPath('data.totals.paid', '29.99')
            ->assertJsonPath('data.totals.refunded', '0.00');

        $order = $this->admin('GET', "/api/admin/v1/orders/{$number}")->assertOk()
            ->assertJsonPath('data.status', 'processing')
            ->assertJsonPath('data.payment_status', 'paid')
            ->assertJsonPath('data.invoices.0.number', $invoice->number)
            ->assertJsonPath('data.history.1.note', "Invoice {$invoice->number} created; payment of \$29.99 recorded.");
        $this->assertSame('29.99', $order->json('data.totals.paid'));
        Mail::assertSent(InvoiceMail::class, fn ($mail) => $mail->hasTo('guest@example.com') && $mail->invoice->is($invoice));

        // One invoice per order.
        $this->admin('POST', "/api/admin/v1/orders/{$number}/invoices")
            ->assertJsonValidationErrors(['order' => 'This order has already been invoiced.']);
        $this->admin('POST', '/api/admin/v1/orders/BN-1/invoices')->assertNotFound();
    }

    public function test_invoicing_is_refused_for_cancelled_orders_and_can_be_silent(): void
    {
        $cancelled = $this->order('card');
        $this->admin('PATCH', "/api/admin/v1/orders/{$cancelled}", ['status' => 'cancelled'])->assertOk();
        $this->admin('POST', "/api/admin/v1/orders/{$cancelled}/invoices")
            ->assertJsonValidationErrors(['order' => 'A cancelled order can\'t be invoiced.']);

        $cod = $this->order('cod');
        $this->admin('POST', "/api/admin/v1/orders/{$cod}/invoices", ['notify_customer' => false])->assertCreated();
        $this->assertSame(['processing', 'paid'], [Order::where('number', $cod)->value('status'), Order::where('number', $cod)->value('payment_status')]);
        Mail::assertNotSent(InvoiceMail::class);
    }

    public function test_an_order_already_marked_paid_without_an_invoice_is_never_invoiced_twice(): void
    {
        // Phase 2 recorded payments without invoices; such an order must not get a second charge on paper.
        $number = $this->order('card');
        Order::where('number', $number)->update(['payment_status' => 'paid', 'status' => 'processing']);

        $this->admin('POST', "/api/admin/v1/orders/{$number}/invoices")
            ->assertJsonValidationErrors(['order' => 'This order has already been invoiced.']);
        $this->assertSame(0, Invoice::count());
    }

    public function test_the_backfill_gives_paid_orders_their_missing_invoice(): void
    {
        $paid = $this->order('cod');
        $unpaid = $this->order('card');
        Order::where('number', $paid)->update(['payment_status' => 'paid']);
        $migration = require database_path('migrations/2026_11_11_000300_backfill_invoices_for_paid_orders.php');

        $migration->up();
        $migration->up(); // running it again adds nothing

        $invoice = Invoice::sole();
        $this->assertSame(Order::where('number', $paid)->value('id'), $invoice->order_id);
        $this->assertSame(Order::where('number', $paid)->value('grand_total'), $invoice->amount);
        $this->assertSame('INV-'.(100000 + $invoice->id), $invoice->number);
        $this->assertSame(0, Invoice::where('order_id', Order::where('number', $unpaid)->value('id'))->count());
    }

    public function test_cancelling_is_refused_once_invoiced(): void
    {
        $number = $this->order('cod');
        $this->admin('POST', "/api/admin/v1/orders/{$number}/invoices")->assertCreated();

        $this->admin('PATCH', "/api/admin/v1/orders/{$number}", ['status' => 'cancelled'])
            ->assertJsonValidationErrors(['status' => 'This order has been invoiced (paid), so it can\'t be cancelled. Create a refund (credit memo) instead.']);
        $this->assertSame('processing', Order::sole()->status);
        $this->assertSame(9, $this->lamp->fresh()->stock_quantity);
    }

    public function test_card_orders_must_be_invoiced_before_shipping(): void
    {
        $number = $this->order('card');
        $this->admin('POST', "/api/admin/v1/orders/{$number}/shipments", ['carrier' => 'ups'])
            ->assertJsonValidationErrors(['order' => 'Invoice this order before shipping it: it hasn\'t been paid yet.']);

        // Moved to processing without a payment (allowed by PATCH since phase 2): still not shippable.
        $this->admin('PATCH', "/api/admin/v1/orders/{$number}", ['status' => 'processing'])->assertOk();
        $this->admin('POST', "/api/admin/v1/orders/{$number}/shipments", ['carrier' => 'ups'])
            ->assertJsonValidationErrors(['order' => 'Invoice this order before shipping it: it hasn\'t been paid yet.']);

        $this->admin('POST', "/api/admin/v1/orders/{$number}/invoices")->assertCreated();
        $response = $this->admin('POST', "/api/admin/v1/orders/{$number}/shipments", ['carrier' => 'ups', 'tracking_number' => '1z999aa10123456784', 'note' => 'Two boxes.'])
            ->assertCreated();
        $shipment = Shipment::sole();
        $response->assertJsonPath('data', [
            'number' => 'SHP-'.(100000 + $shipment->id), 'order_number' => $number, 'carrier' => 'ups', 'carrier_label' => 'UPS',
            'tracking_number' => '1Z999AA10123456784', 'tracking_url' => 'https://www.ups.com/track?tracknum=1Z999AA10123456784',
            'created_at' => $shipment->created_at->toIso8601ZuluString(), 'admin_name' => 'Store Admin', 'note' => 'Two boxes.',
        ]);
        $this->assertSame('shipped', Order::sole()->status);
        Mail::assertSent(ShipmentMail::class, function ($mail) {
            $html = $mail->render();

            return $mail->hasTo('guest@example.com') && str_contains($html, '1Z999AA10123456784') && str_contains($html, 'https://www.ups.com/track?tracknum=1Z999AA10123456784');
        });

        // One shipment per order.
        $this->admin('POST', "/api/admin/v1/orders/{$number}/shipments", ['carrier' => 'dhl'])
            ->assertJsonValidationErrors(['order' => 'This order has already been shipped.']);
    }

    public function test_cash_on_delivery_ships_unpaid_and_shipments_are_validated(): void
    {
        $number = $this->order('cod');

        $this->admin('POST', "/api/admin/v1/orders/{$number}/shipments", [])->assertJsonValidationErrors(['carrier' => 'Choose a carrier.']);
        $this->admin('POST', "/api/admin/v1/orders/{$number}/shipments", ['carrier' => 'pigeon'])->assertJsonValidationErrors('carrier');
        $this->admin('POST', "/api/admin/v1/orders/{$number}/shipments", ['carrier' => 'dhl', 'tracking_number' => '<script>'])->assertJsonValidationErrors('tracking_number');

        $this->admin('POST', "/api/admin/v1/orders/{$number}/shipments", ['carrier' => 'other', 'notify_customer' => false])->assertCreated()
            ->assertJsonPath('data.carrier_label', 'Other')
            ->assertJsonPath('data.tracking_url', null);
        $this->assertSame(['shipped', 'unpaid'], [Order::sole()->status, Order::sole()->payment_status]);
        Mail::assertNotSent(ShipmentMail::class);

        $cancelled = $this->order('cod');
        $this->admin('PATCH', "/api/admin/v1/orders/{$cancelled}", ['status' => 'cancelled'])->assertOk();
        $this->admin('POST', "/api/admin/v1/orders/{$cancelled}/shipments", ['carrier' => 'dhl'])
            ->assertJsonValidationErrors(['order' => 'A cancelled order can\'t be shipped.']);
    }

    public function test_tracking_urls_for_every_carrier(): void
    {
        $expected = [
            'dhl' => 'https://www.dhl.com/en/express/tracking.html?AWB=AB 12',
            'fedex' => 'https://www.fedex.com/fedextrack/?trknbr=AB 12',
            'ups' => 'https://www.ups.com/track?tracknum=AB 12',
            'usps' => 'https://tools.usps.com/go/TrackConfirmAction?tLabels=AB 12',
            'other' => null,
        ];
        foreach ($expected as $carrier => $url) {
            $shipment = new Shipment(['carrier' => $carrier, 'tracking_number' => 'AB 12']);
            $this->assertSame($url === null ? null : str_replace(' ', '%20', $url), $shipment->trackingUrl(), $carrier);
            $this->assertNull((new Shipment(['carrier' => $carrier]))->trackingUrl());
        }
        $this->assertSame(['DHL', 'FedEx', 'UPS', 'USPS', 'Other'], array_map(fn ($c) => (new Shipment(['carrier' => $c]))->carrierLabel(), array_keys($expected)));
    }

    public function test_phase_2_shortcuts_create_the_documents(): void
    {
        $card = $this->order('card');
        $this->admin('PATCH', "/api/admin/v1/orders/{$card}", ['payment_status' => 'paid'])->assertOk()
            ->assertJsonPath('data.status', 'processing')
            ->assertJsonPath('data.invoices.0.amount', '29.99')
            ->assertJsonPath('data.totals.paid', '29.99');
        Mail::assertNotSent(InvoiceMail::class); // as in phase 2: marking paid emails nobody
        // Paid again: nothing to do.
        $this->admin('PATCH', "/api/admin/v1/orders/{$card}", ['payment_status' => 'paid'])->assertJsonValidationErrors('status');

        $this->admin('PATCH', "/api/admin/v1/orders/{$card}", ['status' => 'shipped'])->assertOk()
            ->assertJsonPath('data.status', 'shipped')
            ->assertJsonPath('data.shipments.0.carrier', 'other')
            ->assertJsonPath('data.shipments.0.tracking_number', null);
        Mail::assertSent(OrderStatusMail::class, fn ($mail) => $mail->order->status === 'shipped');
        $this->assertSame(1, Invoice::count());
        $this->assertSame(1, Shipment::count());

        // The shipped shortcut follows the shipment rules: an unpaid card order can't ship.
        $unpaid = $this->order('card');
        $this->admin('PATCH', "/api/admin/v1/orders/{$unpaid}", ['status' => 'processing'])->assertOk();
        $this->admin('PATCH', "/api/admin/v1/orders/{$unpaid}", ['status' => 'shipped'])
            ->assertJsonValidationErrors(['status' => 'Invoice this order before shipping it: it hasn\'t been paid yet.']);
    }

    public function test_customers_see_their_documents_and_only_their_own_invoices(): void
    {
        $ava = Customer::factory()->create(['email' => 'ava@example.com']);
        $avaHeaders = $this->customerHeaders($ava);
        $number = $this->order('cod', $avaHeaders, ['email' => null, 'phone' => null]);
        $this->admin('POST', "/api/admin/v1/orders/{$number}/invoices", ['note' => 'internal', 'notify_customer' => false])->assertCreated();
        $this->admin('POST', "/api/admin/v1/orders/{$number}/shipments", ['carrier' => 'fedex', 'tracking_number' => '7777', 'note' => 'Signed for.'])->assertCreated();
        $invoice = Invoice::sole()->number;

        $this->app['auth']->forgetGuards();
        $order = $this->getJson("/api/v1/orders/{$number}", $avaHeaders)->assertOk()
            ->assertJsonPath('data.invoices', [['number' => $invoice, 'amount' => '29.99', 'created_at' => Invoice::sole()->created_at->toIso8601ZuluString()]])
            ->assertJsonPath('data.shipments.0.tracking_url', 'https://www.fedex.com/fedextrack/?trknbr=7777')
            ->assertJsonPath('data.shipments.0.admin_name', null)   // staff names stay internal
            ->assertJsonPath('data.shipments.0.note', 'Signed for.')
            ->assertJsonPath('data.credit_memos', [])
            ->assertJsonPath('data.totals.paid', '29.99');
        $this->assertSame('shipped', $order->json('data.status'));

        $this->app['auth']->forgetGuards();
        $this->getJson("/api/v1/orders/{$number}/invoices/".strtolower($invoice), $avaHeaders)->assertOk()
            ->assertJsonPath('data.number', $invoice)
            ->assertJsonPath('data.admin_name', null)
            ->assertJsonPath('data.note', null) // not told about it: internal
            ->assertJsonPath('data.items.0.name', $this->lamp->name);

        // Someone else, a wrong order number, a guest, an admin token: all refused.
        $other = $this->customerHeaders(Customer::factory()->create());
        $this->app['auth']->forgetGuards();
        $this->getJson("/api/v1/orders/{$number}/invoices/{$invoice}", $other)->assertNotFound();
        $guestOrder = $this->order('cod');
        $this->app['auth']->forgetGuards();
        $this->getJson("/api/v1/orders/{$guestOrder}/invoices/{$invoice}", $avaHeaders)->assertNotFound();
        $this->app['auth']->forgetGuards();
        $this->getJson("/api/v1/orders/{$number}/invoices/{$invoice}")->assertUnauthorized();
        $this->getJson("/api/v1/orders/{$number}/invoices/{$invoice}", $this->admin)->assertForbidden();

        // Guest lookup shows the shipments too.
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/orders/lookup', ['number' => $number, 'email' => 'ava@example.com'])->assertOk()
            ->assertJsonPath('data.shipments.0.carrier_label', 'FedEx');
    }

    public function test_staff_list_and_read_invoices(): void
    {
        $first = $this->order('cod');
        $second = $this->order('cod', [], ['email' => 'other@example.com']);
        $this->admin('POST', "/api/admin/v1/orders/{$first}/invoices")->assertCreated();
        $this->admin('POST', "/api/admin/v1/orders/{$second}/invoices")->assertCreated();
        [$a, $b] = Invoice::orderBy('id')->pluck('number')->all();

        $this->admin('GET', '/api/admin/v1/invoices')->assertOk()->assertJsonPath('meta.total', 2)->assertJsonPath('data.0.number', $b);
        $this->admin('GET', '/api/admin/v1/invoices?search=other@')->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.order_number', $second);
        $this->admin('GET', "/api/admin/v1/invoices?search={$a}")->assertJsonPath('meta.total', 1);
        $this->admin('GET', "/api/admin/v1/invoices/{$a}")->assertOk()->assertJsonPath('data.order_number', $first)->assertJsonPath('data.admin_name', 'Store Admin');
        $this->admin('GET', '/api/admin/v1/invoices/INV-1')->assertNotFound();
    }
}
