<?php

namespace Tests\Feature;

use App\Mail\OneTimeCodeMail;
use App\Mail\OrderPlacedMail;
use App\Models\Admin;
use App\Models\OneTimeCode;
use App\Services\OneTimeCodes;
use App\Support\EmailTemplateCatalog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 7: email templates: variables, required variables, escaping, preview, test send, reset. */
class EmailTemplateTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private array $headers;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->headers = $this->adminHeaders();
    }

    private function save(string $key, string $subject, string $body)
    {
        return $this->asAdmin($this->headers, 'PUT', "/api/admin/v1/email-templates/{$key}", ['subject' => $subject, 'body' => $body]);
    }

    public function test_every_email_has_a_template_and_the_list_shows_them(): void
    {
        $this->asAdmin($this->headers, 'GET', '/api/admin/v1/email-templates')->assertOk()
            ->assertJsonCount(11, 'data')->assertJsonPath('data.0.key', 'email_verification')->assertJsonPath('data.0.is_customized', false);
        $this->asAdmin($this->headers, 'GET', '/api/admin/v1/email-templates/email_verification')->assertOk()
            ->assertJsonPath('data.required', [['code']])
            ->assertJsonFragment(['name' => 'code', 'label' => 'The 6-digit code', 'kind' => 'text', 'required' => true]);
        $this->asAdmin($this->headers, 'GET', '/api/admin/v1/email-templates/nope')->assertNotFound();
    }

    public function test_saving_a_default_unchanged_keeps_it(): void
    {
        foreach (EmailTemplateCatalog::keys() as $key) {
            $default = EmailTemplateCatalog::get($key);
            $this->save($key, $default['subject'], $default['body'])->assertOk()->assertJsonPath('data.body', $default['body']);
        }
    }

    public function test_unknown_and_required_variables(): void
    {
        $this->save('email_verification', 'Your code', '<p>Hi {{ customer_first_name }}</p>')
            ->assertUnprocessable()->assertJsonValidationErrors(['body' => 'This template must include {{ code }}.']);
        $this->save('email_verification', 'Your code', '<p>{{ code }} {{ order_number }}</p>')
            ->assertUnprocessable()->assertJsonValidationErrors(['body' => 'Unknown variable {{ order_number }}.']);
        $this->save('email_verification', 'Code {{ secret }}', '<p>{{ code }}</p>')->assertUnprocessable()->assertJsonValidationErrors('subject');
        $this->save('order_confirmation', 'Order {{ items_table }}', '<p>{{ order_number }}</p>')
            ->assertUnprocessable()->assertJsonValidationErrors(['subject' => 'can only be used in the body']);
        $this->save('newsletter_confirmation', 'Confirm', '<p>Hi</p>')
            ->assertUnprocessable()->assertJsonValidationErrors(['body' => '{{ button }} or {{ confirm_url }}']);
        $this->save('newsletter_confirmation', 'Confirm', '<p><a href="{{ confirm_url }}">Yes</a></p>')->assertOk();
        $this->save('abandoned_cart', 'Cart', '<p><a href="{{ customer_first_name }}">x</a> {{ button }}</p>')
            ->assertUnprocessable()->assertJsonValidationErrors(['body' => 'can\'t be used as a link address']);
    }

    public function test_the_body_is_sanitized_and_values_are_escaped_except_blocks(): void
    {
        $this->save('order_confirmation', 'Order {{ order_number }} for {{ customer_first_name }}',
            '<p onclick="x()">Hi {{ customer_first_name }}<script>alert(1)</script></p>{{ items_table }}<p>{{ order_number }}</p>')
            ->assertOk()->assertJsonPath('data.body', '<p>Hi {{ customer_first_name }}</p>{{ items_table }}<p>{{ order_number }}</p>');

        $product = $this->product(['name' => 'Lamp & <Shade>', 'price' => '20.00']);
        $this->placeOrder([['product_id' => $product->id, 'quantity' => 1]], [
            'shipping_address' => ['first_name' => '<b>Ann</b>', 'last_name' => 'X', 'line1' => '1 St', 'line2' => null,
                'city' => 'Town', 'state' => null, 'postal_code' => '29112', 'country' => 'United States'],
        ])->assertCreated();

        Mail::assertSent(OrderPlacedMail::class, function ($mail) {
            $html = $mail->render();

            return str_contains($html, 'Hi &lt;b&gt;Ann&lt;/b&gt;') && ! str_contains($html, '<b>Ann</b>')
                && str_contains($html, 'Lamp &amp; &lt;Shade&gt; × 1') // the items table: a block, built escaped
                && str_contains($html, '<table role="presentation"')
                && $mail->envelope()->subject === 'Order '.$mail->order->number.' for <b>Ann</b>'; // subject: plain text
        });
    }

    public function test_a_customized_template_is_used_and_reset_restores_the_default(): void
    {
        $this->save('password_reset', 'Reset it, {{ customer_first_name }}', '<p>Your code: <strong>{{ code }}</strong></p>')->assertOk()
            ->assertJsonPath('data.is_customized', true);
        app(OneTimeCodes::class)->send('ava@example.com', OneTimeCode::RESET_PASSWORD, 'Ava');
        Mail::assertSent(OneTimeCodeMail::class, fn ($m) => $m->envelope()->subject === 'Reset it, Ava'
            && str_contains($m->render(), 'Your code: <strong>'.$m->code.'</strong>'));

        $this->asAdmin($this->headers, 'POST', '/api/admin/v1/email-templates/password_reset/reset')->assertOk()
            ->assertJsonPath('data.is_customized', false)->assertJsonPath('data.subject', 'Reset your {{ store_name }} password');
        $this->assertDatabaseMissing('email_templates', ['key' => 'password_reset']);
        $this->assertDatabaseHas('audit_log', ['action' => 'email_template.reset']);
    }

    public function test_preview_and_test_send_use_sample_data(): void
    {
        $this->asAdmin($this->headers, 'POST', '/api/admin/v1/email-templates/shipment/preview', ['subject' => 'Shipped {{ order_number }}'])
            ->assertOk()->assertJsonPath('data.subject', 'Shipped BN-100001')
            ->assertJsonPath('data.text', fn ($text) => str_contains($text, 'Tracking number: 1Z999AA10123456784'));
        $this->asAdmin($this->headers, 'POST', '/api/admin/v1/email-templates/shipment/preview', ['body' => '<p>{{ nope }}</p>'])
            ->assertUnprocessable();

        $admin = Admin::factory()->create(['email' => 'me@example.com']);
        $this->asAdmin($this->signInAdmin($admin), 'POST', '/api/admin/v1/email-templates/invoice/test')->assertOk()
            ->assertJsonPath('data.email', 'me@example.com');
        Mail::assertSentCount(1);
        $this->assertDatabaseMissing('email_templates', ['key' => 'shipment']); // previews save nothing
    }
}
