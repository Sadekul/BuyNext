<?php

namespace Tests\Feature;

use App\Mail\InvoiceMail;
use App\Mail\OneTimeCodeMail;
use App\Mail\OrderPlacedMail;
use App\Mail\OrderStatusMail;
use App\Mail\ShipmentMail;
use App\Models\Customer;
use App\Models\EmailTemplate;
use App\Models\Invoice;
use App\Models\Order;
use App\Models\Product;
use App\Services\DocumentPdfs;
use App\Services\EmailTemplates;
use App\Services\Settings;
use App\Support\EmailTemplateCatalog;
use App\Support\EmailTemplateCatalogBn;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\Feature\Concerns\ReadsCodes;
use Tests\TestCase;

/**
 * Phase 13: emails and PDF documents in Bangla (the customer's saved language,
 * else the language the order was placed in), Bangla digits per the store
 * setting, and the admin email templates per language.
 */
class BanglaEmailsTest extends TestCase
{
    use PlacesOrders, ReadsCodes, RefreshDatabase;

    private Product $lamp;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->lamp = $this->product(['name' => 'Desk Lamp', 'sku' => 'LMP-1', 'price' => '1250.00', 'stock_quantity' => 20]);
    }

    private function bnOrder(array $overrides = [], array $headers = []): string
    {
        $this->app['auth']->forgetGuards();

        return $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]], $overrides, ['Accept-Language' => 'bn', ...$headers])
            ->assertCreated()->json('data.number');
    }

    private function sent(string $class): object
    {
        $mails = Mail::sent($class);
        $this->assertNotEmpty($mails, "{$class} was not sent");

        return $mails->last();
    }

    public function test_every_template_has_a_bangla_default_that_passes_the_checks(): void
    {
        $templates = app(EmailTemplates::class);
        $this->assertEqualsCanonicalizing(EmailTemplateCatalog::keys(), array_keys(EmailTemplateCatalogBn::templates()));
        foreach (EmailTemplateCatalog::keys() as $key) {
            $bn = EmailTemplateCatalog::get($key, 'bn');
            $en = EmailTemplateCatalog::get($key, 'en');
            $this->assertNotSame($en['body'], $bn['body'], $key);
            $this->assertMatchesRegularExpression('/[\x{0980}-\x{09FF}]/u', $bn['body'], $key);
            $this->assertSame([], $templates->errors($key, $bn['subject'], $bn['body']), $key);
            // Saving the default unchanged keeps it exactly (only allowed tags and typographic quotes).
            $this->assertSame($bn['body'], $templates->sanitize($bn['body']), $key);
            // Same variables as the English version.
            preg_match_all('/\{\{\s*(\w+)\s*\}\}/', $en['subject'].$en['body'], $enVars);
            preg_match_all('/\{\{\s*(\w+)\s*\}\}/', $bn['subject'].$bn['body'], $bnVars);
            $this->assertEqualsCanonicalizing(array_values(array_unique($enVars[1])), array_values(array_unique($bnVars[1])), $key);
            // Previews render in both languages without leftovers.
            foreach (['en', 'bn'] as $locale) {
                App::setLocale($locale);
                $preview = $templates->render($key, $templates->sampleValues($key));
                $this->assertStringNotContainsString('{{', $preview['html'], "{$key} {$locale}");
            }
            App::setLocale('en');
        }
    }

    public function test_a_guest_order_placed_in_bangla_gets_a_bangla_confirmation_with_bangla_digits(): void
    {
        $number = $this->bnOrder();
        $this->assertSame('bn', Order::sole()->locale);

        $mail = $this->sent(OrderPlacedMail::class);
        $this->assertSame('bn', $mail->locale);
        $html = $mail->render();
        $this->assertStringContainsString('অর্ডারের জন্য ধন্যবাদ', $html);
        $this->assertStringContainsString('lang="bn"', $html);
        $this->assertStringContainsString('সাবটোটাল', $html);
        $this->assertStringContainsString('ক্যাশ অন ডেলিভারি', $html);
        $this->assertStringContainsString('প্রিয় Ava', $html);
        $this->assertStringContainsString('$১,২৫০.০০', $html); // the order is in the store currency (USD in tests), Bangla digits
        $this->assertStringContainsString($number, $html); // order numbers stay in Latin letters and digits
        $this->assertStringNotContainsString('Thanks for your order', $html);
        $this->assertSame("আপনার BuyNest অর্ডার {$number}", $mail->envelope()->subject);
    }

    public function test_bangla_emails_use_latin_digits_when_the_setting_is_off(): void
    {
        app(Settings::class)->put(['bangla_digits' => false]);
        $this->bnOrder();

        $html = $this->sent(OrderPlacedMail::class)->render();
        $this->assertStringContainsString('অর্ডারের জন্য ধন্যবাদ', $html);
        $this->assertStringContainsString('$1,250.00', $html);
        $this->assertStringNotContainsString('১,২৫০', $html);
    }

    public function test_english_orders_keep_english_emails(): void
    {
        $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]])->assertCreated();
        $this->assertSame('en', Order::sole()->locale);

        $html = $this->sent(OrderPlacedMail::class)->render();
        $this->assertStringContainsString('Thanks for your order', $html);
        $this->assertStringContainsString('$1,250.00', $html);
        $this->assertStringContainsString('lang="en"', $html);
        $this->assertDoesNotMatchRegularExpression('/[\x{0980}-\x{09FF}]/u', $html);
    }

    public function test_a_customer_who_chose_bangla_gets_bangla_status_invoice_and_shipment_emails(): void
    {
        $customer = Customer::factory()->create(['locale' => 'bn']);
        $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]])->assertCreated(); // placed in English
        $order = Order::sole();
        $order->update(['customer_id' => $customer->id]);
        $admin = $this->adminHeaders();

        $this->asAdmin($admin, 'POST', "/api/admin/v1/orders/{$order->number}/invoices", ['notify_customer' => true])->assertCreated();
        $invoice = $this->sent(InvoiceMail::class);
        $this->assertSame('bn', $invoice->locale);
        $html = $invoice->render();
        $this->assertStringContainsString('পেমেন্ট পাওয়া গেছে', $html);
        $this->assertStringContainsString('$১,২৫০.০০', $html);

        $this->asAdmin($admin, 'POST', "/api/admin/v1/orders/{$order->number}/shipments",
            ['carrier' => 'ups', 'tracking_number' => '1Z999', 'notify_customer' => true])->assertCreated();
        $shipment = $this->sent(ShipmentMail::class)->render();
        $this->assertStringContainsString('আপনার অর্ডার পথে আছে', $shipment);
        $this->assertStringContainsString('ট্র্যাকিং নম্বর', $shipment);
        $this->assertStringContainsString('পার্সেল ট্র্যাক করুন', $shipment);

        $this->asAdmin($admin, 'PATCH', "/api/admin/v1/orders/{$order->number}", ['status' => 'delivered', 'notify_customer' => true])->assertOk();
        $status = $this->sent(OrderStatusMail::class);
        $this->assertStringContainsString('আপনার অর্ডার ডেলিভারি হয়েছে', $status->render());
        $this->assertStringContainsString('আপনার অর্ডার ডেলিভারি হয়েছে', $status->envelope()->subject);
    }

    public function test_a_customer_who_chose_english_gets_english_even_for_a_bangla_order(): void
    {
        $customer = Customer::factory()->create(['locale' => 'en']);
        $this->bnOrder();
        $order = Order::sole();
        $order->update(['customer_id' => $customer->id]);

        $this->asAdmin($this->adminHeaders(), 'PATCH', "/api/admin/v1/orders/{$order->number}", ['status' => 'cancelled', 'notify_customer' => true])->assertOk();
        $mail = $this->sent(OrderStatusMail::class);
        $this->assertSame('en', $mail->locale);
        $this->assertStringContainsString('Your order was cancelled', $mail->render());
    }

    public function test_codes_come_in_the_language_of_the_request(): void
    {
        $this->signUp()->assertCreated();
        // Sign-up sent its code in English (no Accept-Language); ask again in Bangla after the resend wait.
        $this->travel(config('buynest.codes.resend_cooldown_seconds') + 1)->seconds();
        $this->postJson('/api/v1/auth/resend-code', ['email' => 'nadia@example.com', 'purpose' => 'verify_email'], ['Accept-Language' => 'bn'])->assertSuccessful();

        $mails = Mail::sent(OneTimeCodeMail::class);
        $this->assertCount(2, $mails);
        $en = $mails->first()->render();
        $this->assertStringContainsString('Confirm your email', $en);
        $bn = $mails->last()->render();
        $this->assertStringContainsString('আপনার ইমেইল নিশ্চিত করুন', $bn);
        $this->assertStringContainsString($mails->last()->code, $bn);
    }

    public function test_admin_edits_resets_and_previews_each_language_separately(): void
    {
        $admin = $this->adminHeaders();
        $default = EmailTemplateCatalog::get('password_reset', 'bn');

        $this->asAdmin($admin, 'GET', '/api/admin/v1/email-templates/password_reset?locale=bn')->assertOk()
            ->assertJsonPath('data.locale', 'bn')
            ->assertJsonPath('data.subject', $default['subject'])
            ->assertJsonPath('data.default_body', $default['body'])
            ->assertJsonPath('data.is_customized', false)
            ->assertJsonPath('data.locales.bn.is_customized', false);

        $this->asAdmin($admin, 'PUT', '/api/admin/v1/email-templates/password_reset',
            ['locale' => 'bn', 'subject' => 'পাসওয়ার্ড বদলান, {{ customer_first_name }}', 'body' => '<p>কোড: <strong>{{ code }}</strong></p>'])
            ->assertOk()->assertJsonPath('data.is_customized', true)->assertJsonPath('data.locales.bn.is_customized', true)
            ->assertJsonPath('data.locales.en.is_customized', false);
        $this->assertSame('bn', EmailTemplate::sole()->locale);

        // English is untouched.
        $this->asAdmin($admin, 'GET', '/api/admin/v1/email-templates/password_reset')->assertOk()
            ->assertJsonPath('data.locale', 'en')->assertJsonPath('data.is_customized', false)
            ->assertJsonPath('data.subject', 'Reset your {{ store_name }} password');
        $this->asAdmin($admin, 'GET', '/api/admin/v1/email-templates?locale=bn')->assertOk()
            ->assertJsonPath('data.1.key', 'password_reset')->assertJsonPath('data.1.is_customized', true)
            ->assertJsonPath('data.1.subject', 'পাসওয়ার্ড বদলান, {{ customer_first_name }}');

        // Preview in Bangla: sample values in Bangla, digits per the setting.
        $preview = $this->asAdmin($admin, 'POST', '/api/admin/v1/email-templates/order_confirmation/preview', ['locale' => 'bn'])->assertOk();
        $this->assertStringContainsString('অর্ডারের জন্য ধন্যবাদ', $preview->json('data.html'));
        $this->assertStringContainsString('১২৪.৯৬', $preview->json('data.html'));
        $this->assertStringContainsString('lang="bn"', $preview->json('data.html'));

        // A Bangla customer resetting their password gets the customization.
        Customer::factory()->create(['email' => 'rina@example.com', 'first_name' => 'Rina', 'locale' => 'bn']);
        $this->postJson('/api/v1/auth/forgot-password', ['email' => 'rina@example.com'], ['Accept-Language' => 'bn'])->assertSuccessful();
        $mail = Mail::sent(OneTimeCodeMail::class)->last();
        $this->assertStringContainsString('কোড: <strong>'.$mail->code.'</strong>', $mail->render());
        $this->assertSame('পাসওয়ার্ড বদলান, Rina', $mail->envelope()->subject);

        $this->asAdmin($admin, 'POST', '/api/admin/v1/email-templates/password_reset/reset', ['locale' => 'bn'])->assertOk()
            ->assertJsonPath('data.is_customized', false)->assertJsonPath('data.subject', $default['subject']);
        $this->assertSame(0, EmailTemplate::count());
        $this->assertDatabaseHas('audit_log', ['action' => 'email_template.reset', 'summary' => 'Email template "Password reset code" (Bangla) reset to the default.']);

        $this->asAdmin($admin, 'GET', '/api/admin/v1/email-templates/password_reset?locale=fr')->assertUnprocessable()->assertJsonValidationErrors('locale');
    }

    public function test_bangla_order_documents_are_in_bangla_with_the_bengali_font_first(): void
    {
        $number = $this->bnOrder();
        $this->asAdmin($this->adminHeaders(), 'POST', "/api/admin/v1/orders/{$number}/invoices", ['notify_customer' => false])->assertCreated();
        $invoice = Invoice::sole();
        $this->assertSame('en', App::getLocale()); // rendering a document doesn't change the request's language

        $html = app(DocumentPdfs::class)->html($invoice);
        $this->assertStringContainsString('<html lang="bn">', $html);
        $this->assertStringContainsString('font-family: "Noto Sans Bengali", "DejaVu Sans"', $html);
        foreach (['ইনভয়েস', 'বিলের ঠিকানা', 'ডেলিভারির ঠিকানা', 'সাবটোটাল', 'মোট', 'ক্যাশ অন ডেলিভারি', '$১,২৫০.০০'] as $text) {
            $this->assertStringContainsString($text, $html);
        }
        $this->assertStringNotContainsString('Bill to', $html);
        $this->assertSame('en', App::getLocale());

        $pdf = app(DocumentPdfs::class)->pdf($invoice);
        $this->assertStringStartsWith('%PDF-', $pdf);
        $this->assertMatchesRegularExpression('#/BaseFont\s*/[A-Z]{6}\+NotoSansBengali#', $pdf);
    }

    public function test_english_documents_are_unchanged(): void
    {
        $number = $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]])->json('data.number');
        $this->asAdmin($this->adminHeaders(), 'POST', "/api/admin/v1/orders/{$number}/invoices", ['notify_customer' => false])->assertCreated();

        $html = app(DocumentPdfs::class)->html(Invoice::sole());
        $this->assertStringContainsString('<html lang="en">', $html);
        $this->assertStringContainsString('font-family: "DejaVu Sans", "Noto Sans Bengali"', $html);
        $this->assertStringContainsString('Bill to', $html);
        $this->assertStringContainsString('$1,250.00', $html);
        $this->assertStringContainsString(now()->format('M j, Y'), $html);
        $this->assertDoesNotMatchRegularExpression('/[\x{0980}-\x{09FF}]/u', $html);
    }

    public function test_pdfs_draw_bangla_vowel_signs_before_their_consonants(): void
    {
        // dompdf can't shape Bangla: pre-base signs are moved for drawing, two-part signs split; tags and Latin text stay.
        $this->assertSame('<p class="তারিখ">তািরখ েমাট েকৗতুক Total</p>',
            DocumentPdfs::visualBangla('<p class="তারিখ">তারিখ মোট কৌতুক Total</p>'));
        $this->assertSame('<p>English only</p>', DocumentPdfs::visualBangla('<p>English only</p>'));
        $this->assertSame('<p>েপেমন্ট</p>', DocumentPdfs::visualBangla('<p>পেমেন্ট</p>'));
    }
}
