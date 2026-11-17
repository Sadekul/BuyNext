<?php

namespace Tests\Feature;

use App\Mail\AccountDeletedMail;
use App\Mail\EmailChangedMail;
use App\Mail\OneTimeCodeMail;
use App\Mail\OrderCancelledByCustomerMail;
use App\Models\AuditLog;
use App\Models\Customer;
use App\Models\CustomerCart;
use App\Models\NewsletterSubscriber;
use App\Models\OneTimeCode;
use App\Models\Order;
use App\Models\Product;
use App\Models\Review;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\Feature\Concerns\ReadsCodes;
use Tests\TestCase;

/** Phase 9 (part A): customers change their email, cancel their order, download their data, and delete their account. */
class CustomerSelfServiceTest extends TestCase
{
    use PlacesOrders, ReadsCodes, RefreshDatabase;

    private Customer $customer;

    private array $headers;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->customer = Customer::factory()->create(['first_name' => 'Ava', 'email' => 'ava@example.com']);
        $this->headers = $this->signIn($this->customer);
    }

    private function signIn(Customer $customer, string $password = 'Password123'): array
    {
        $this->app['auth']->forgetGuards();

        return $this->bearer($this->postJson('/api/v1/auth/login', ['email' => $customer->email, 'password' => $password])
            ->assertOk()->json('data.tokens.access_token'));
    }

    private function as(?array $headers, string $method, string $uri, array $body = []): TestResponse
    {
        $this->app['auth']->forgetGuards();

        return $this->json($method, $uri, $body, $headers ?? []);
    }

    private function orderFor(?Customer $customer, string $payment = 'cod', ?Product $product = null): string
    {
        $product ??= $this->product(['stock_quantity' => 10]);

        return $this->placeOrder([['product_id' => $product->id, 'quantity' => 2]], ['payment_method' => $payment, 'email' => $customer?->email ?? 'guest@example.com'],
            $customer ? $this->signIn($customer) : [])->assertCreated()->json('data.number');
    }

    /*
     * §4 Change email.
     */

    public function test_changing_the_email_sends_a_code_to_the_new_address_and_switches_after_it(): void
    {
        $other = $this->signIn($this->customer); // another device
        NewsletterSubscriber::create(['email' => 'ava@example.com', 'customer_id' => $this->customer->id, 'status' => 'subscribed', 'source' => 'account']);

        $this->as($this->headers, 'POST', '/api/v1/me/email', ['email' => 'Ava.New@Example.com', 'password' => 'Password123'])->assertOk()
            ->assertJsonPath('data.email', 'ava.new@example.com')->assertJsonPath('data.expires_in', 600)->assertJsonPath('data.resend_in', 60)
            ->assertJsonPath('message', 'We emailed a 6-digit code to ava.new@example.com. Your email stays the same until you enter it.');
        $code = $this->lastCodeFor('ava.new@example.com', OneTimeCode::EMAIL_CHANGE);
        Mail::assertNotSent(OneTimeCodeMail::class, fn ($mail) => $mail->hasTo('ava@example.com'));

        // The email keeps working until confirmed.
        $this->as($this->headers, 'GET', '/api/v1/me')->assertJsonPath('data.email', 'ava@example.com')->assertJsonPath('data.pending_email', 'ava.new@example.com');

        $this->as($this->headers, 'POST', '/api/v1/me/email/confirm', ['code' => $code === '000000' ? '000001' : '000000'])
            ->assertUnprocessable()->assertJsonValidationErrors(['code' => 'That code is incorrect or has expired.']);
        $this->as($this->headers, 'POST', '/api/v1/me/email/confirm', ['code' => $code])->assertOk()
            ->assertJsonPath('message', 'Your email is now ava.new@example.com.')
            ->assertJsonPath('data.email', 'ava.new@example.com')->assertJsonPath('data.pending_email', null)
            ->assertJsonPath('data.newsletter', true);

        Mail::assertSent(EmailChangedMail::class, fn ($mail) => $mail->hasTo('ava@example.com') && $mail->newEmail === 'ava.new@example.com');
        $this->as($other, 'GET', '/api/v1/me')->assertUnauthorized(); // other sessions signed out
        $this->as($this->headers, 'GET', '/api/v1/me')->assertOk(); // this one stays
        $this->assertSame('unsubscribed', NewsletterSubscriber::where('email', 'ava@example.com')->value('status'));
        $this->assertSame('subscribed', NewsletterSubscriber::where('email', 'ava.new@example.com')->value('status'));
        $this->assertDatabaseHas('audit_log', ['action' => 'customer.email_changed', 'subject_id' => $this->customer->id, 'admin_id' => null]);

        // The code was used up, and the new email signs in.
        $this->as($this->headers, 'POST', '/api/v1/me/email/confirm', ['code' => $code])->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->postJson('/api/v1/auth/login', ['email' => 'ava.new@example.com', 'password' => 'Password123'])->assertOk();
    }

    public function test_email_change_rules(): void
    {
        Customer::factory()->create(['email' => 'taken@example.com']);
        Customer::factory()->unverified()->create(['email' => 'abandoned@example.com']);

        $this->as($this->headers, 'POST', '/api/v1/me/email', ['email' => 'new@example.com', 'password' => 'wrong'])
            ->assertUnprocessable()->assertJsonValidationErrors(['password' => 'Your password is incorrect.']);
        $this->as($this->headers, 'POST', '/api/v1/me/email', ['email' => 'AVA@example.com', 'password' => 'Password123'])
            ->assertUnprocessable()->assertJsonValidationErrors(['email' => 'This is already your email address.']);
        // The same answer as sign-up gives for an existing account.
        $this->as($this->headers, 'POST', '/api/v1/me/email', ['email' => 'taken@example.com', 'password' => 'Password123'])
            ->assertUnprocessable()->assertJsonValidationErrors(['email' => 'An account with this email already exists. Sign in, or reset your password.']);
        $this->as($this->headers, 'POST', '/api/v1/me/email/confirm', ['code' => '123456'])
            ->assertUnprocessable()->assertJsonValidationErrors(['email' => 'Ask for a code first.']);
        $this->as($this->headers, 'POST', '/api/v1/me/email/confirm', ['code' => '12'])->assertUnprocessable()->assertJsonValidationErrors('code');

        // A never-used, unconfirmed sign-up gives way to the customer who proves the inbox.
        $this->as($this->headers, 'POST', '/api/v1/me/email', ['email' => 'abandoned@example.com', 'password' => 'Password123'])->assertOk();
        $this->as($this->headers, 'POST', '/api/v1/me/email', ['email' => 'abandoned@example.com', 'password' => 'Password123'])->assertOk()
            ->assertJsonPath('data.resend_in', fn ($wait) => $wait > 0 && $wait <= 60); // no second code within a minute
        $this->assertCount(1, Mail::sent(OneTimeCodeMail::class, fn ($mail) => $mail->hasTo('abandoned@example.com')));
        $this->as($this->headers, 'POST', '/api/v1/me/email/confirm', ['code' => $this->lastCodeFor('abandoned@example.com')])->assertOk();
        $this->assertSame(1, Customer::where('email', 'abandoned@example.com')->count());
        $this->assertSame('abandoned@example.com', $this->customer->fresh()->email);
    }

    public function test_the_new_templates_render_with_their_values(): void
    {
        $mail = new OneTimeCodeMail('123456', OneTimeCode::EMAIL_CHANGE, 'Ava', false, 'new@example.com');
        $html = $mail->render();
        $this->assertStringContainsString('123456', $html);
        $this->assertStringContainsString('new@example.com', $html);
        $this->assertSame('Confirm your new email for BuyNest', $mail->envelope()->subject);

        $changed = new EmailChangedMail('Ava', 'old@example.com', 'new@example.com');
        $this->assertStringContainsString('old@example.com', $changed->render());
        $this->assertSame('Your BuyNest email was changed', $changed->envelope()->subject);
        $this->assertSame('Your BuyNest account was deleted', (new AccountDeletedMail('Ava'))->envelope()->subject);
    }

    /*
     * §5 Cancel my order.
     */

    public function test_the_owner_cancels_an_unpaid_order_and_stock_comes_back(): void
    {
        $product = $this->product(['stock_quantity' => 10]);
        $number = $this->orderFor($this->customer, 'cod', $product);
        $this->assertSame(8, $product->fresh()->stock_quantity);
        $this->as($this->headers, 'GET', "/api/v1/orders/{$number}")->assertJsonPath('data.can_cancel', true);

        $this->as($this->headers, 'POST', "/api/v1/orders/{$number}/cancel", ['reason' => 'Ordered the wrong size.'])->assertOk()
            ->assertJsonPath('data.status', 'cancelled')->assertJsonPath('data.can_cancel', false)
            ->assertJsonPath('data.history.1.note', 'Cancelled by the customer. Reason: Ordered the wrong size.');
        $this->assertSame(10, $product->fresh()->stock_quantity);
        Mail::assertSent(OrderCancelledByCustomerMail::class, fn ($mail) => $mail->hasTo('ava@example.com') && $mail->reason === 'Ordered the wrong size.');
        $this->assertStringContainsString('Ordered the wrong size.', (new OrderCancelledByCustomerMail(Order::where('number', $number)->first(), 'Ordered the wrong size.'))->render());

        $this->as($this->headers, 'POST', "/api/v1/orders/{$number}/cancel")->assertUnprocessable()
            ->assertJsonValidationErrors(['order' => 'This order is already cancelled.']);
        $this->assertSame(10, $product->fresh()->stock_quantity); // never twice
    }

    public function test_guests_cancel_with_the_orders_email_and_others_get_not_found(): void
    {
        $number = $this->orderFor(null, 'card'); // pending payment, unpaid
        $stranger = Customer::factory()->create();

        $this->as(null, 'POST', "/api/v1/orders/{$number}/cancel", ['email' => 'someone@example.com'])->assertNotFound();
        $this->as($this->signIn($stranger), 'POST', "/api/v1/orders/{$number}/cancel")->assertNotFound();
        $this->as(null, 'POST', '/api/v1/orders/BN-999999/cancel', ['email' => 'guest@example.com'])->assertNotFound();

        $this->as(null, 'POST', "/api/v1/orders/{$number}/cancel", ['email' => 'GUEST@example.com'])->assertOk()
            ->assertJsonPath('data.status', 'cancelled');
        Mail::assertSent(OrderCancelledByCustomerMail::class, fn ($mail) => $mail->hasTo('guest@example.com'));
    }

    public function test_paid_or_shipped_orders_must_be_cancelled_by_staff(): void
    {
        $admin = $this->adminHeaders();
        $paid = $this->orderFor($this->customer, 'card');
        $this->asAdmin($admin, 'POST', "/api/admin/v1/orders/{$paid}/invoices")->assertCreated();
        $shipped = $this->orderFor($this->customer, 'cod');
        $this->asAdmin($admin, 'POST', "/api/admin/v1/orders/{$shipped}/shipments", ['carrier' => 'ups'])->assertCreated();

        foreach ([$paid, $shipped] as $number) {
            $this->as($this->headers, 'GET', "/api/v1/orders/{$number}")->assertJsonPath('data.can_cancel', false);
            $this->as($this->headers, 'POST', "/api/v1/orders/{$number}/cancel")->assertUnprocessable()
                ->assertJsonValidationErrors(['order' => 'This order has been paid or shipped, so it can\'t be cancelled online. Contact us to cancel it: support@buynest.example.com.']);
        }
        Mail::assertNotSent(OrderCancelledByCustomerMail::class);
    }

    /*
     * §6 Download my data.
     */

    public function test_the_export_has_my_data_without_ids_staff_notes_or_other_peoples_data(): void
    {
        $product = $this->product(['name' => 'Desk Lamp']);
        $number = $this->orderFor($this->customer, 'cod', $product);
        Order::where('number', $number)->first()->history()->create(['status' => 'processing', 'payment_status' => 'unpaid',
            'note' => 'Staff only: VIP', 'customer_notified' => false]);
        $this->orderFor(Customer::factory()->create(['email' => 'other@example.com']));
        $this->as($this->headers, 'POST', '/api/v1/me/addresses', ['first_name' => 'Ava', 'last_name' => 'Customer', 'phone' => '+1 555 010 0100',
            'line1' => '12 Market Street', 'city' => 'Springfield', 'postal_code' => '29112', 'country' => 'United States'])->assertCreated();
        Review::create(['product_id' => $product->id, 'customer_id' => $this->customer->id, 'status' => 'approved', 'author_name' => 'Ava',
            'rating' => 5, 'title' => 'Great', 'comment' => 'Bright and sturdy.']);
        CustomerCart::create(['customer_id' => $this->customer->id, 'items' => [['product_id' => $product->id, 'variant_id' => null, 'quantity' => 1]],
            'subtotal' => '20.00', 'item_count' => 1]);

        $response = $this->as($this->headers, 'GET', '/api/v1/me/export')->assertOk()
            ->assertHeader('Content-Disposition', 'attachment; filename="buynest-my-data-'.now()->format('Y-m-d').'.json"')
            ->assertJsonPath('profile.email', 'ava@example.com')
            ->assertJsonPath('profile.group.name', 'General')
            ->assertJsonPath('newsletter.status', 'not_subscribed')
            ->assertJsonCount(1, 'orders')->assertJsonPath('orders.0.number', $number)
            ->assertJsonPath('orders.0.items.0.name', 'Desk Lamp')
            ->assertJsonPath('addresses.0.line1', '12 Market Street')
            ->assertJsonPath('reviews.0.product', 'Desk Lamp')
            ->assertJsonPath('saved_cart.items.0.product', 'Desk Lamp')
            ->assertJsonPath('stock_alerts', []);
        $body = $response->getContent();
        $this->assertStringNotContainsString('Staff only', $body);
        $this->assertStringNotContainsString('other@example.com', $body);
        $this->assertStringNotContainsString('password', $body);

        // No database ids anywhere.
        $keys = [];
        $walk = function ($value) use (&$walk, &$keys) {
            foreach ((array) $value as $key => $child) {
                $keys[] = $key;
                if (is_array($child)) {
                    $walk($child);
                }
            }
        };
        $walk($response->json());
        $this->assertEmpty(array_filter($keys, fn ($key) => is_string($key) && ($key === 'id' || str_ends_with($key, '_id'))));
    }

    public function test_the_export_is_limited_to_three_an_hour(): void
    {
        for ($i = 0; $i < 3; $i++) {
            $this->as($this->headers, 'GET', '/api/v1/me/export')->assertOk();
        }
        $this->as($this->headers, 'GET', '/api/v1/me/export')->assertTooManyRequests();
    }

    /*
     * §6 Delete my account.
     */

    public function test_deleting_my_account_keeps_orders_and_reviews_without_the_link(): void
    {
        $product = $this->product();
        $number = $this->orderFor($this->customer, 'cod', $product);
        Review::create(['product_id' => $product->id, 'customer_id' => $this->customer->id, 'status' => 'approved', 'author_name' => 'Ava',
            'rating' => 4, 'comment' => 'Good.']);
        NewsletterSubscriber::create(['email' => 'ava@example.com', 'customer_id' => $this->customer->id, 'status' => 'subscribed', 'source' => 'account']);
        CustomerCart::create(['customer_id' => $this->customer->id, 'items' => [], 'subtotal' => '0.00', 'item_count' => 0]);
        $other = $this->signIn($this->customer);

        $this->as($this->headers, 'POST', '/api/v1/me/delete', ['password' => 'wrong', 'confirm' => 'DELETE'])
            ->assertUnprocessable()->assertJsonValidationErrors(['password' => 'Your password is incorrect.']);
        $this->as($this->headers, 'POST', '/api/v1/me/delete', ['password' => 'Password123', 'confirm' => 'delete'])
            ->assertUnprocessable()->assertJsonValidationErrors(['confirm' => 'Type DELETE to confirm.']);
        $this->as($this->headers, 'POST', '/api/v1/me/delete', ['password' => 'Password123', 'confirm' => 'DELETE'])
            ->assertUnprocessable()->assertJsonValidationErrors(['account' => 'You have 1 open order (pending payment, processing, or shipped). You can delete your account once it\'s delivered or cancelled.']);

        $this->as($this->headers, 'POST', "/api/v1/orders/{$number}/cancel")->assertOk();
        $this->as($this->headers, 'POST', '/api/v1/me/delete', ['password' => 'Password123', 'confirm' => 'DELETE'])->assertOk()
            ->assertExactJson(['message' => 'Your account was deleted.']);

        $id = $this->customer->id;
        $this->assertNull(Customer::find($id));
        $this->assertNull(Order::where('number', $number)->value('customer_id'));
        $this->assertSame('Ava', Review::where('product_id', $product->id)->value('author_name'));
        $this->assertSame('unsubscribed', NewsletterSubscriber::where('email', 'ava@example.com')->value('status'));
        $this->assertFalse(CustomerCart::where('customer_id', $id)->exists());
        $this->as($other, 'GET', '/api/v1/me')->assertUnauthorized();
        Mail::assertSent(AccountDeletedMail::class, fn ($mail) => $mail->hasTo('ava@example.com'));

        $entry = AuditLog::where('action', 'customer.deleted_own_account')->firstOrFail();
        $this->assertSame("Customer #{$id} deleted their account.", $entry->summary);
        $this->assertNull($entry->changes);
        $this->assertNull($entry->admin_id);
    }

    public function test_staff_deletion_also_unsubscribes_the_newsletter(): void
    {
        NewsletterSubscriber::create(['email' => 'ava@example.com', 'customer_id' => $this->customer->id, 'status' => 'subscribed', 'source' => 'account']);
        $this->asAdmin($this->adminHeaders(), 'DELETE', "/api/admin/v1/customers/{$this->customer->id}")->assertNoContent();
        $this->assertSame('unsubscribed', NewsletterSubscriber::where('email', 'ava@example.com')->value('status'));
    }
}
