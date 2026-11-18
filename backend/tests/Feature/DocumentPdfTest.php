<?php

namespace Tests\Feature;

use App\Mail\InvoiceMail;
use App\Models\Admin;
use App\Models\AdminRole;
use App\Models\CreditMemo;
use App\Models\Customer;
use App\Models\Invoice;
use App\Models\Order;
use App\Models\Product;
use App\Services\DocumentPdfs;
use App\Services\Settings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\Feature\Concerns\ReadsCodes;
use Tests\TestCase;

/**
 * Phase 10 (part A): invoices and credit memos as PDF files (storefront and
 * admin), the invoice email's attachment, and the documents and analytics
 * settings. Contents are checked on the HTML the PDF is drawn from.
 */
class DocumentPdfTest extends TestCase
{
    use PlacesOrders, ReadsCodes, RefreshDatabase;

    private array $admin;

    private Product $lamp;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->admin = $this->adminHeaders();
        $this->lamp = $this->product(['name' => 'Desk Lamp', 'sku' => 'LMP-1', 'price' => '25.00', 'stock_quantity' => 10]);
        app(Settings::class)->put(['address' => "12 Nest Road\nPortland, OR 97201"]);
    }

    private function admin(string $method, string $uri, array $body = []): TestResponse
    {
        $this->app['auth']->forgetGuards();

        return $this->json($method, $uri, $body, $this->admin);
    }

    private function customerHeaders(Customer $customer): array
    {
        $this->app['auth']->forgetGuards();

        return $this->bearer($this->postJson('/api/v1/auth/login', ['email' => $customer->email, 'password' => 'Password123'])->json('data.tokens.access_token'));
    }

    /** A paid order (NEST10 coupon, invoiced by staff with a note the customer wasn't told). [order number, invoice number] */
    private function invoicedOrder(array $headers = [], array $overrides = []): array
    {
        $this->app['auth']->forgetGuards();
        $number = $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 2]], [
            'coupon_code' => 'NEST10',
            'billing_address' => ['first_name' => 'Zoë', 'last_name' => 'Łukasiewicz', 'line1' => '9 Ångström Way', 'line2' => 'Flat 2',
                'city' => 'Kraków', 'state' => null, 'postal_code' => '30-001', 'country' => 'United States'],
            ...$overrides,
        ], $headers)->assertCreated()->json('data.number');
        $invoice = $this->admin('POST', "/api/admin/v1/orders/{$number}/invoices", ['note' => 'Staff only.', 'notify_customer' => false])
            ->assertCreated()->json('data.number');

        return [$number, $invoice];
    }

    private function assertPdf(TestResponse $response, string $filename): void
    {
        $response->assertOk()
            ->assertHeader('Content-Type', 'application/pdf')
            ->assertHeader('Content-Disposition', 'attachment; filename="'.$filename.'"');
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
        $this->assertStringStartsWith('%PDF-', $response->getContent());
        $this->assertStringContainsString('%%EOF', substr($response->getContent(), -32));
    }

    public function test_the_invoice_document_shows_everything_the_customer_needs(): void
    {
        [$number, $invoiceNumber] = $this->invoicedOrder();
        $html = app(DocumentPdfs::class)->html(Invoice::sole());
        $order = Order::where('number', $number)->sole();

        foreach ([
            'BuyNest', '12 Nest Road<br />', 'Portland, OR 97201', 'support@buynest.example.com', '+1 (555) 010-2030', // the store
            $invoiceNumber, $number,                                                                                   // numbers
            'Zoë Łukasiewicz', '9 Ångström Way', 'Kraków', 'Ava Customer', '12 Market Street',                        // bill-to, ship-to
            'Cash on delivery', 'Paid', 'Standard',                                                                  // payment, shipping
            'Desk Lamp', 'SKU LMP-1', '$25.00', '$50.00',                                                            // the line
            'NEST10', '−$'.$order->discount_total, '$'.$order->grand_total, 'Amount paid',                           // totals
            'DejaVu Sans',
        ] as $text) {
            $this->assertStringContainsString($text, $html);
        }
        $this->assertStringNotContainsString('Staff only.', $html); // the note wasn't sent to the customer
        $this->assertStringNotContainsString('Store Admin', $html);  // nor who on staff made it
        $this->assertStringNotContainsString('http', preg_replace('/(support@|https?:\/\/www\.w3\.org)/', '', $html)); // nothing to fetch
    }

    public function test_admins_download_invoices_and_credit_memos(): void
    {
        [$number, $invoice] = $this->invoicedOrder();
        $itemId = Order::where('number', $number)->sole()->items[0]->id;
        $memo = $this->admin('POST', "/api/admin/v1/orders/{$number}/credit-memos", [
            'items' => [['order_item_id' => $itemId, 'quantity' => 1]], 'shipping_refund' => '0.00', 'adjustment' => '-2.00',
            'restock' => true, 'note' => 'Sorry about the scratch.',
        ])->assertCreated()->json('data.number');

        $this->assertPdf($this->admin('GET', "/api/admin/v1/invoices/{$invoice}.pdf"), "{$invoice}.pdf");
        $this->assertPdf($this->admin('GET', '/api/admin/v1/credit-memos/'.strtolower($memo).'.pdf'), "{$memo}.pdf");
        $this->admin('GET', '/api/admin/v1/invoices/INV-1.pdf')->assertNotFound()->assertExactJson(['message' => 'Invoice not found.']);
        $this->admin('GET', '/api/admin/v1/credit-memos/CM-1.pdf')->assertNotFound()->assertExactJson(['message' => 'Credit memo not found.']);
        // The JSON routes still answer JSON.
        $this->admin('GET', "/api/admin/v1/invoices/{$invoice}")->assertOk()->assertJsonPath('data.number', $invoice);
        $this->admin('GET', "/api/admin/v1/credit-memos/{$memo}")->assertOk()->assertJsonPath('data.number', $memo);

        $html = app(DocumentPdfs::class)->html(CreditMemo::sole());
        foreach (['Credit memo', $memo, $number, 'Desk Lamp', 'SKU LMP-1', 'Adjustment', '−$2.00', 'Total refunded',
            'Refunded to: Cash on delivery', 'The items were put back in stock.', 'Sorry about the scratch.', 'Zoë Łukasiewicz'] as $text) {
            $this->assertStringContainsString($text, $html);
        }
        // The invoice now lists the refund.
        $this->assertStringContainsString($memo, app(DocumentPdfs::class)->html(Invoice::sole()));

        // orders.view is needed; customer tokens are refused.
        $role = AdminRole::create(['name' => 'Catalog only', 'permissions' => ['products.view']]);
        $noOrders = $this->signInAdmin(Admin::factory()->create(['role_id' => $role->id]));
        $this->asAdmin($noOrders, 'GET', "/api/admin/v1/invoices/{$invoice}.pdf")->assertForbidden()->assertJsonPath('permission', 'orders.view');
        $this->asAdmin($noOrders, 'GET', "/api/admin/v1/credit-memos/{$memo}.pdf")->assertForbidden();
        $customer = $this->customerHeaders(Customer::factory()->create());
        $this->getJson("/api/admin/v1/invoices/{$invoice}.pdf", $customer)->assertForbidden();
    }

    public function test_customers_and_guests_with_the_orders_email_download_their_invoice(): void
    {
        $ava = Customer::factory()->create(['email' => 'ava@example.com']);
        $avaHeaders = $this->customerHeaders($ava);
        [$number, $invoice] = $this->invoicedOrder($avaHeaders, ['email' => 'ava@example.com']);
        [$guestNumber, $guestInvoice] = $this->invoicedOrder([], ['email' => 'Guest@Example.com']);
        $notFound = ['message' => 'We couldn\'t find an order with that number and email.'];
        $url = fn (string $order, string $invoice, string $query = '') => "/api/v1/orders/{$order}/invoices/{$invoice}.pdf{$query}";

        // The owner (token), and a guest with the order's email (any case).
        $this->app['auth']->forgetGuards();
        $this->assertPdf($this->get($url($number, $invoice), $avaHeaders), "{$invoice}.pdf");
        $this->app['auth']->forgetGuards();
        $this->assertPdf($this->get($url(strtolower($guestNumber), strtolower($guestInvoice), '?email=guest@EXAMPLE.com')), "{$guestInvoice}.pdf");

        // Wrong email, no proof, someone else's token, another order's invoice: the lookup's 404.
        $this->app['auth']->forgetGuards();
        $this->getJson($url($guestNumber, $guestInvoice, '?email=other@example.com'))->assertNotFound()->assertExactJson($notFound);
        // The store's sign-in service sends the email in a header instead, so it stays out of logs.
        $this->assertPdf($this->get($url($guestNumber, $guestInvoice, ''), ['X-Order-Email' => 'Guest@example.com']), "{$guestInvoice}.pdf");
        $this->getJson($url($guestNumber, $guestInvoice, ''), ['X-Order-Email' => 'other@example.com'])->assertNotFound();
        $this->getJson($url($guestNumber, $guestInvoice))->assertNotFound()->assertExactJson($notFound);
        $this->getJson($url($guestNumber, $guestInvoice), $avaHeaders)->assertNotFound()->assertExactJson($notFound);
        $this->app['auth']->forgetGuards();
        $this->getJson($url($number, $guestInvoice), $avaHeaders)->assertNotFound()->assertExactJson(['message' => 'Invoice not found.']);
        $this->getJson($url('BN-999999', $invoice, '?email=ava@example.com'))->assertNotFound()->assertExactJson($notFound);
        $this->getJson($url($number, $invoice, '?email=not-an-email'))->assertUnprocessable()->assertJsonValidationErrors('email');

        // An admin token isn't a customer's.
        $this->app['auth']->forgetGuards();
        $this->getJson($url($number, $invoice), $this->admin)->assertForbidden();

        // The printable invoice page's JSON route is unchanged.
        $this->app['auth']->forgetGuards();
        $this->getJson("/api/v1/orders/{$number}/invoices/{$invoice}", $avaHeaders)->assertOk()->assertJsonPath('data.number', $invoice);
    }

    public function test_the_paper_size_follows_the_setting(): void
    {
        $this->invoicedOrder();
        $pdfs = app(DocumentPdfs::class);
        $this->assertMatchesRegularExpression('#/MediaBox \[0\.000 0\.000 595\.28\d* 841\.89\d*\]#', $pdfs->pdf(Invoice::sole())); // A4

        $this->admin('PATCH', '/api/admin/v1/settings', ['documents' => ['paper_size' => 'letter']])->assertOk()
            ->assertJsonPath('data.documents', ['paper_size' => 'letter', 'attach_pdf_to_emails' => true]);
        $this->assertMatchesRegularExpression('#/MediaBox \[0\.000 0\.000 612\.000 792\.000\]#', app(DocumentPdfs::class)->pdf(Invoice::sole()));

        $this->admin('PATCH', '/api/admin/v1/settings', ['documents' => ['paper_size' => 'a3', 'attach_pdf_to_emails' => 'maybe']])
            ->assertUnprocessable()->assertJsonValidationErrors(['documents.paper_size' => 'Choose A4 or Letter.', 'documents.attach_pdf_to_emails']);
    }

    public function test_the_invoice_email_carries_the_pdf_unless_turned_off(): void
    {
        $this->invoicedOrder();
        $invoice = Invoice::sole();

        $attachments = (new InvoiceMail($invoice->fresh()))->attachments();
        $this->assertCount(1, $attachments);
        $this->assertSame($invoice->number.'.pdf', $attachments[0]->as);
        $this->assertSame('application/pdf', $attachments[0]->mime);
        $this->assertStringStartsWith('%PDF-', $attachments[0]->attachWith(fn () => '', fn ($data) => $data()));

        // Staff invoicing with "notify customer" sends it (Mail::fake keeps the mailable).
        $this->app['auth']->forgetGuards();
        $number = $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]])->assertCreated()->json('data.number');
        $this->admin('POST', "/api/admin/v1/orders/{$number}/invoices")->assertCreated();
        Mail::assertSent(InvoiceMail::class, fn (InvoiceMail $mail) => count($mail->attachments()) === 1);

        $this->admin('PATCH', '/api/admin/v1/settings', ['documents' => ['attach_pdf_to_emails' => false]])->assertOk();
        app(Settings::class)->flush();
        $this->assertSame([], (new InvoiceMail($invoice->fresh()))->attachments());
    }

    public function test_extra_totals_from_part_b_reach_the_document(): void
    {
        $this->invoicedOrder();
        $pdfs = app(DocumentPdfs::class);
        $data = $pdfs->invoiceData(Invoice::sole());
        $data['totals'] = [...$data['totals'], 'gift_card' => '10.00', 'amount_due' => '0.00', 'store_credit' => '1.50'];
        $data['items'][0]['gift_card'] = ['recipient_name' => 'Mia', 'recipient_email' => 'mia@example.com'];

        $html = view('documents.invoice', $data)->render();
        $this->assertStringContainsString('Paid by gift card', $html);
        $this->assertStringContainsString('−$10.00', $html);
        $this->assertStringContainsString('Paid by Cash on delivery', $html); // what was left for the other method
        $this->assertStringContainsString('Store Credit', $html); // any other amount, labelled from its key
        $this->assertStringContainsString('Gift card for Mia (mia@example.com)', $html);

        // A credit memo that returned part of the money to the gift card.
        $number = Order::sole()->number;
        $itemId = Order::sole()->items[0]->id;
        $this->admin('POST', "/api/admin/v1/orders/{$number}/credit-memos", [
            'items' => [['order_item_id' => $itemId, 'quantity' => 1]], 'shipping_refund' => '0.00', 'adjustment' => '0.00', 'restock' => false,
        ])->assertCreated();
        $memo = $pdfs->creditMemoData(CreditMemo::sole());
        $memo['memo']['gift_card_refund'] = '5.00';
        $memo['memo']['other_refund'] = '17.50';
        $html = view('documents.credit-memo', $memo)->render();
        $this->assertStringContainsString('Returned to gift card', $html);
        $this->assertStringContainsString('Refunded to Cash on delivery', $html);
        $this->assertStringContainsString('$17.50', $html);
    }

    public function test_analytics_setting_is_validated_and_public(): void
    {
        $this->admin('GET', '/api/admin/v1/settings')->assertOk()
            ->assertJsonPath('data.analytics', ['ga4_measurement_id' => null])
            ->assertJsonPath('data.documents', ['paper_size' => 'a4', 'attach_pdf_to_emails' => true]);
        $this->getJson('/api/v1/store')->assertOk()->assertJsonPath('data.ga4_measurement_id', null);

        foreach (['UA-12345-1', 'g-abc123', 'G-ABC', 'G-ABCDEFGHIJKLM', 'G-ABC 123', 'G-ABC123<'] as $bad) {
            $this->admin('PATCH', '/api/admin/v1/settings', ['analytics' => ['ga4_measurement_id' => $bad]])->assertUnprocessable()
                ->assertJsonValidationErrors(['analytics.ga4_measurement_id' => 'Enter a GA4 measurement ID like G-ABC123XYZ, or leave it empty.']);
        }
        $this->admin('PATCH', '/api/admin/v1/settings', ['analytics' => ['ga4_measurement_id' => 'G-ABC123XYZ']])->assertOk()
            ->assertJsonPath('data.analytics.ga4_measurement_id', 'G-ABC123XYZ');
        $this->getJson('/api/v1/store')->assertOk()->assertJsonPath('data.ga4_measurement_id', 'G-ABC123XYZ');

        // Empty turns it off.
        $this->admin('PATCH', '/api/admin/v1/settings', ['analytics' => ['ga4_measurement_id' => '']])->assertOk()
            ->assertJsonPath('data.analytics.ga4_measurement_id', null);
        $this->getJson('/api/v1/store')->assertOk()->assertJsonPath('data.ga4_measurement_id', null);
    }
}
