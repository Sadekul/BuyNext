<?php

namespace Tests\Feature;

use App\Mail\NewsletterConfirmationMail;
use App\Mail\WelcomeCouponMail;
use App\Models\Admin;
use App\Models\AuditLog;
use App\Models\Coupon;
use App\Models\CouponRedemption;
use App\Models\Customer;
use App\Models\NewsletterSubscriber;
use App\Models\Order;
use App\Models\Product;
use App\Models\WelcomeCouponGrant;
use App\Services\Audit;
use App\Services\CustomerAccounts;
use App\Services\Settings;
use App\Services\WelcomeCoupons;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use RuntimeException;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\Feature\Concerns\ReadsCodes;
use Tests\TestCase;

/** Phase 19: the welcome coupon (one personal code per confirmed email address, off by default). */
class WelcomeCouponTest extends TestCase
{
    use PlacesOrders, ReadsCodes, RefreshDatabase;

    private Product $lamp; // 25.00

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->lamp = $this->product(['price' => '25.00', 'stock_quantity' => 50]);
    }

    private function switchOn(array $settings = []): void
    {
        app(Settings::class)->put(['welcome_coupon_enabled' => true, ...$settings]);
    }

    private function subscribeAndConfirm(string $email, array $headers = [])
    {
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/newsletter', ['email' => $email], $headers)->assertStatus(202);
        $token = Mail::sent(NewsletterConfirmationMail::class, fn ($m) => $m->hasTo($email))->last()->token;

        return $this->postJson('/api/v1/newsletter/confirm', ['token' => $token], $headers)->assertOk();
    }

    private function signUpAndVerify(string $email, array $headers = [])
    {
        $this->app['auth']->forgetGuards();
        $this->signUp(['email' => $email, 'phone' => '+1555'.random_int(1000000, 9999999)])->assertCreated();

        return $this->postJson('/api/v1/auth/verify-email', ['email' => $email, 'code' => $this->lastCodeFor($email)], $headers)->assertOk();
    }

    private function couponError(string $code, array $extra = [], array $headers = []): ?string
    {
        $this->app['auth']->forgetGuards();

        return $this->postJson('/api/v1/cart/validate', [
            'items' => [['product_id' => $this->lamp->id, 'quantity' => 1]], 'coupon_code' => $code, 'shipping_method' => 'standard', ...$extra,
        ], $headers)->assertOk()->json('data.coupon_error');
    }

    private function order(string $code, string $email, array $headers = [])
    {
        $this->app['auth']->forgetGuards();

        return $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]], ['coupon_code' => $code, 'email' => $email], $headers);
    }

    public function test_off_by_default_nothing_is_granted_and_nothing_is_promised(): void
    {
        $this->getJson('/api/v1/store')->assertOk()->assertJsonPath('data.welcome_offer', null);
        $this->subscribeAndConfirm('news@example.com')->assertJsonPath('data.welcome_coupon_sent', false);
        $this->signUpAndVerify('nadia@example.com')->assertJsonPath('data.customer.welcome_coupon', null);

        $this->assertSame(0, WelcomeCouponGrant::count());
        $this->assertSame(0, Coupon::where('source', 'welcome')->count());
        Mail::assertNotSent(WelcomeCouponMail::class);
    }

    public function test_the_store_shows_the_offer_while_on(): void
    {
        $this->switchOn(['welcome_coupon_min_subtotal' => '50.00']);

        $this->getJson('/api/v1/store')->assertOk()->assertJsonPath('data.welcome_offer', [
            'type' => 'percent', 'value' => '10.00', 'label' => '10% off', 'min_subtotal' => '$50', 'valid_days' => 30,
            'first_order_only' => true, 'triggers' => ['signup', 'newsletter'],
        ]);
        $this->getJson('/api/v1/store', ['Accept-Language' => 'bn'])->assertJsonPath('data.welcome_offer.label', '১০% ছাড়')
            ->assertJsonPath('data.welcome_offer.min_subtotal', '$৫০');

        $this->switchOn(['welcome_coupon_type' => 'fixed', 'welcome_coupon_value' => '100.00', 'welcome_coupon_min_subtotal' => null]);
        $this->getJson('/api/v1/store')->assertJsonPath('data.welcome_offer.label', '$100 off')->assertJsonPath('data.welcome_offer.min_subtotal', null);
    }

    public function test_sign_up_earns_the_code_when_the_email_is_verified_not_before(): void
    {
        $this->switchOn();
        $this->signUp(['email' => 'nadia@example.com'])->assertCreated();
        $this->assertSame(0, WelcomeCouponGrant::count());

        $this->postJson('/api/v1/auth/verify-email', ['email' => 'nadia@example.com', 'code' => $this->lastCodeFor('nadia@example.com')])->assertOk()
            ->assertJsonPath('data.customer.welcome_coupon.status', 'active')
            ->assertJsonPath('data.customer.welcome_coupon.label', '10% off');

        $grant = WelcomeCouponGrant::sole();
        $customer = Customer::where('email', 'nadia@example.com')->sole();
        $this->assertSame(['nadia@example.com', 'signup', $customer->id], [$grant->email, $grant->trigger, $grant->customer_id]);

        $coupon = $grant->coupon;
        $this->assertMatchesRegularExpression('/^WELCOME-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/', $coupon->code);
        $this->assertSame(['welcome', 'nadia@example.com', true, 'percent', '10.00', null, 1, 1, true, 'all', false],
            [$coupon->source, $coupon->issued_to_email, $coupon->first_order_only, $coupon->type, $coupon->value, $coupon->min_subtotal,
                $coupon->usage_limit, $coupon->usage_limit_per_customer, $coupon->is_active, $coupon->applies_to, $coupon->auto_apply]);
        $this->assertSame('Welcome offer for nadia@example.com', $coupon->description);
        $this->assertTrue($coupon->starts_at->lte(now()));
        $this->assertSame(now()->addDays(30)->endOfDay()->toDateTimeString(), $coupon->ends_at->toDateTimeString());
        $this->assertNotNull(AuditLog::where('action', 'coupon.welcome_issued')->where('subject_id', $coupon->id)->whereNull('admin_id')->first());

        Mail::assertSent(WelcomeCouponMail::class, function (WelcomeCouponMail $mail) use ($coupon) {
            $html = $mail->render();

            return $mail->hasTo('nadia@example.com') && $mail->locale === 'en'
                && str_contains($html, $coupon->code) && str_contains($html, 'Hi Nadia')
                && $mail->envelope()->subject === 'Your welcome code: 10% off your first order';
        });

        // The account page shows it.
        $this->app['auth']->forgetGuards();
        $token = $this->postJson('/api/v1/auth/login', ['email' => 'nadia@example.com', 'password' => 'Secret123'])->json('data.tokens.access_token');
        $this->getJson('/api/v1/me', $this->bearer($token))->assertOk()
            ->assertJsonPath('data.welcome_coupon.code', $coupon->code)
            ->assertJsonPath('data.welcome_coupon.min_subtotal', null)
            ->assertJsonPath('data.welcome_coupon.expires_at', $coupon->ends_at->toIso8601ZuluString());
    }

    public function test_the_email_is_in_the_customers_language(): void
    {
        $this->switchOn(['welcome_coupon_min_subtotal' => '50.00', 'welcome_coupon_first_order_only' => false]);
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/auth/register', [
            'first_name' => 'Nadia', 'last_name' => 'Rahman', 'email' => 'bn@example.com', 'phone' => '+880 1712-345679',
            'password' => 'Secret123', 'password_confirmation' => 'Secret123', 'accept_terms' => true,
        ], ['Accept-Language' => 'bn'])->assertCreated();
        $this->postJson('/api/v1/auth/verify-email', ['email' => 'bn@example.com', 'code' => $this->lastCodeFor('bn@example.com')])->assertOk();

        $mail = Mail::sent(WelcomeCouponMail::class)->sole();
        $this->assertSame('bn', $mail->locale);
        $html = $mail->render();
        $this->assertStringContainsString('প্রিয় Nadia', $html);
        $this->assertStringContainsString('আপনার পরের অর্ডারে ১০% ছাড়', $html);
        $this->assertStringContainsString('$৫০ বা তার বেশি মূল্যের অর্ডারে প্রযোজ্য।', $html);
        $this->assertStringContainsString(Coupon::where('source', 'welcome')->value('code'), $html);
        $this->assertSame('আপনার স্বাগত কোড: আপনার পরের অর্ডারে ১০% ছাড়', $mail->envelope()->subject);
    }

    public function test_newsletter_earns_the_code_on_confirmation_only(): void
    {
        $this->switchOn();
        $this->postJson('/api/v1/newsletter', ['email' => 'News@Example.com'])->assertStatus(202);
        $this->assertSame(0, WelcomeCouponGrant::count());
        Mail::assertNotSent(WelcomeCouponMail::class);

        $token = Mail::sent(NewsletterConfirmationMail::class)->last()->token;
        $this->postJson('/api/v1/newsletter/confirm', ['token' => $token])->assertOk()->assertJsonPath('data.welcome_coupon_sent', true);
        $this->assertSame(['news@example.com', 'newsletter', null], [WelcomeCouponGrant::sole()->email, WelcomeCouponGrant::sole()->trigger, WelcomeCouponGrant::sole()->customer_id]);
        Mail::assertSent(WelcomeCouponMail::class, fn ($m) => $m->hasTo('news@example.com') && str_contains($m->render(), 'Hi there'));

        // Clicking the link again issues nothing more.
        $this->postJson('/api/v1/newsletter/confirm', ['token' => $token])->assertOk()->assertJsonPath('data.welcome_coupon_sent', false);
        Mail::assertSentCount(1 + Mail::sent(NewsletterConfirmationMail::class)->count());
    }

    public function test_the_account_newsletter_switch_earns_the_code(): void
    {
        $this->switchOn();
        $customer = Customer::factory()->create(['email' => 'cust@example.com', 'first_name' => 'Ben']);
        $this->app['auth']->forgetGuards();
        $headers = $this->bearer($this->postJson('/api/v1/auth/login', ['email' => 'cust@example.com', 'password' => 'Password123'])->json('data.tokens.access_token'));

        $this->patchJson('/api/v1/me', ['newsletter' => true], $headers)->assertOk()->assertJsonPath('data.welcome_coupon.status', 'active');
        $this->assertSame(['newsletter', $customer->id], [WelcomeCouponGrant::sole()->trigger, WelcomeCouponGrant::sole()->customer_id]);
        Mail::assertSent(WelcomeCouponMail::class, fn ($m) => $m->hasTo('cust@example.com') && str_contains($m->render(), 'Hi Ben'));

        // Off, on again: still one code.
        $this->patchJson('/api/v1/me', ['newsletter' => false], $headers)->assertOk();
        $this->patchJson('/api/v1/me', ['newsletter' => true], $headers)->assertOk();
        $this->assertSame(1, WelcomeCouponGrant::count());
        Mail::assertSentCount(1);
    }

    public function test_one_code_per_email_ever_across_triggers_resubscribing_and_a_recreated_account(): void
    {
        $this->switchOn();
        $this->subscribeAndConfirm('nadia@example.com')->assertJsonPath('data.welcome_coupon_sent', true);
        $first = Coupon::where('source', 'welcome')->sole();

        // Unsubscribe, subscribe and confirm again.
        $subscriber = NewsletterSubscriber::where('email', 'nadia@example.com')->sole();
        $this->postJson('/api/v1/newsletter/unsubscribe', ['token' => $subscriber->unsubscribeToken()])->assertOk();
        $this->subscribeAndConfirm('nadia@example.com')->assertJsonPath('data.welcome_coupon_sent', false);

        // Sign up with the same address.
        $this->signUpAndVerify('nadia@example.com')->assertJsonPath('data.customer.welcome_coupon.code', $first->code);

        // Delete the account (and the coupon), then sign up again.
        $first->delete();
        app(CustomerAccounts::class)->delete(Customer::where('email', 'nadia@example.com')->sole());
        $this->assertSame([null, null], [WelcomeCouponGrant::sole()->coupon_id, WelcomeCouponGrant::sole()->customer_id]);
        $this->signUpAndVerify('nadia@example.com')->assertJsonPath('data.customer.welcome_coupon', null);

        $this->assertSame(1, WelcomeCouponGrant::count());
        $this->assertSame(0, Coupon::where('source', 'welcome')->count());
        Mail::assertSent(WelcomeCouponMail::class, 1);
    }

    public function test_only_the_chosen_triggers_issue_codes(): void
    {
        $this->switchOn(['welcome_coupon_triggers' => ['signup']]);
        $this->subscribeAndConfirm('news@example.com')->assertJsonPath('data.welcome_coupon_sent', false);
        $this->signUpAndVerify('nadia@example.com');
        $this->assertSame(['nadia@example.com'], WelcomeCouponGrant::pluck('email')->all());

        $this->switchOn(['welcome_coupon_triggers' => ['newsletter']]);
        $this->signUpAndVerify('omar@example.com');
        $this->subscribeAndConfirm('news2@example.com')->assertJsonPath('data.welcome_coupon_sent', true);
        $this->assertEqualsCanonicalizing(['nadia@example.com', 'news2@example.com'], WelcomeCouponGrant::pluck('email')->all());
    }

    public function test_a_failing_grant_never_blocks_the_sign_up_or_the_confirmation(): void
    {
        $this->switchOn();
        $this->app->bind(WelcomeCoupons::class, fn () => new class(app(Settings::class), app(Audit::class)) extends WelcomeCoupons
        {
            public function grant(string $email, string $trigger, ?Customer $customer = null, ?string $locale = null): ?Coupon
            {
                throw new RuntimeException('Welcome coupon test failure');
            }
        });

        $this->signUpAndVerify('nadia@example.com')->assertJsonPath('data.customer.email', 'nadia@example.com');
        $this->subscribeAndConfirm('news@example.com')->assertJsonPath('data.status', 'subscribed')->assertJsonPath('data.welcome_coupon_sent', false);
        $this->assertSame(0, WelcomeCouponGrant::count());
    }

    public function test_the_code_works_once_for_its_email_and_waits_for_the_email_on_a_guest_cart(): void
    {
        $this->switchOn();
        $this->subscribeAndConfirm('guest@example.com');
        $code = Coupon::where('source', 'welcome')->value('code');

        $this->assertNull($this->couponError($code)); // no email yet: checked at checkout
        $this->assertNull($this->couponError($code, ['email' => 'Guest@Example.com']));
        $this->assertSame('This code isn\'t available for your account.', $this->couponError($code, ['email' => 'other@example.com']));
        $this->assertSame('এই কোডটি আপনার অ্যাকাউন্টের জন্য প্রযোজ্য নয়।',
            $this->couponError($code, ['email' => 'other@example.com'], ['Accept-Language' => 'bn']));
        $this->order($code, 'other@example.com')->assertJsonValidationErrors(['coupon_code' => 'This code isn\'t available for your account.']);

        $number = $this->order($code, 'guest@example.com')->assertCreated()->assertJsonPath('data.totals.discount', '2.50')->json('data.number');
        $order = Order::where('number', $number)->sole();
        $this->assertDatabaseHas('coupon_redemptions', ['order_id' => $order->id, 'email' => 'guest@example.com']);
        $this->assertSame(1, Coupon::where('code', $code)->value('times_used'));
        $this->order($code, 'guest@example.com')->assertJsonValidationErrors('coupon_code');
        $this->assertSame('used', app(WelcomeCoupons::class)->forEmail('guest@example.com')['status']);
    }

    public function test_a_signed_in_customer_is_checked_by_their_account_email(): void
    {
        $this->switchOn();
        $ava = Customer::factory()->create(['email' => 'ava@example.com']);
        $ben = Customer::factory()->create(['email' => 'ben@example.com']);
        app(WelcomeCoupons::class)->grant('ava@example.com', 'signup', $ava);
        $code = Coupon::where('source', 'welcome')->value('code');

        $login = fn (Customer $c) => $this->bearer($this->postJson('/api/v1/auth/login', ['email' => $c->email, 'password' => 'Password123'])->json('data.tokens.access_token'));
        $this->app['auth']->forgetGuards();
        $benHeaders = $login($ben);
        // Ben types Ava's address as the checkout email: the account's email decides.
        $this->assertSame('This code isn\'t available for your account.', $this->couponError($code, ['email' => 'ava@example.com'], $benHeaders));
        $this->app['auth']->forgetGuards();
        $this->assertNull($this->couponError($code, [], $login($ava)));
    }

    public function test_first_order_only(): void
    {
        $coupon = Coupon::create(['code' => 'FIRST', 'description' => 'First', 'type' => 'fixed', 'value' => '5.00', 'is_active' => true,
            'first_order_only' => true]);
        $this->assertNull($this->couponError('FIRST')); // nobody known yet
        $this->assertNull($this->couponError('FIRST', ['email' => 'new@example.com']));

        Order::factory()->create(['email' => 'old@example.com', 'status' => 'cancelled']);
        $this->assertNull($this->couponError('FIRST', ['email' => 'old@example.com'])); // only cancelled orders
        Order::factory()->create(['email' => 'old@example.com', 'status' => 'delivered']);
        $this->assertSame('This code is for your first order only.', $this->couponError('FIRST', ['email' => 'OLD@example.com']));
        $this->assertSame('এই কোডটি শুধু আপনার প্রথম অর্ডারের জন্য।', $this->couponError('FIRST', ['email' => 'old@example.com'], ['Accept-Language' => 'bn']));

        // By account too (an order under another email still counts).
        $ava = Customer::factory()->create(['email' => 'ava@example.com']);
        Order::factory()->create(['email' => 'ava.old@example.com', 'customer_id' => $ava->id, 'status' => 'processing']);
        $this->app['auth']->forgetGuards();
        $headers = $this->bearer($this->postJson('/api/v1/auth/login', ['email' => 'ava@example.com', 'password' => 'Password123'])->json('data.tokens.access_token'));
        $this->assertSame('This code is for your first order only.', $this->couponError('FIRST', [], $headers));

        // The first order itself goes through; the second is refused.
        $this->order('FIRST', 'fresh@example.com')->assertCreated();
        $this->order('FIRST', 'fresh@example.com')->assertJsonValidationErrors(['coupon_code' => 'This code is for your first order only.']);
        $this->assertSame(1, CouponRedemption::where('coupon_id', $coupon->id)->count());
    }

    public function test_admin_settings_validation_partial_put_and_audit(): void
    {
        $headers = $this->adminHeaders();
        $this->asAdmin($headers, 'GET', '/api/admin/v1/marketing/welcome-coupon')->assertOk()
            ->assertJsonPath('data.settings', [
                'welcome_coupon_enabled' => false, 'welcome_coupon_triggers' => ['signup', 'newsletter'], 'welcome_coupon_type' => 'percent',
                'welcome_coupon_value' => '10.00', 'welcome_coupon_min_subtotal' => null, 'welcome_coupon_valid_days' => 30,
                'welcome_coupon_first_order_only' => true,
            ])
            ->assertJsonPath('data.offer.label', '10% off') // a preview, also while off
            ->assertJsonPath('data.stats', ['issued' => 0, 'used' => 0, 'expired' => 0, 'active' => 0]);

        $this->asAdmin($headers, 'PUT', '/api/admin/v1/marketing/welcome-coupon', ['welcome_coupon_triggers' => []])
            ->assertJsonValidationErrors(['welcome_coupon_triggers' => 'Choose at least one way to earn the code.']);
        $this->asAdmin($headers, 'PUT', '/api/admin/v1/marketing/welcome-coupon', ['welcome_coupon_triggers' => ['sms']])
            ->assertJsonValidationErrors('welcome_coupon_triggers.0');
        $this->asAdmin($headers, 'PUT', '/api/admin/v1/marketing/welcome-coupon', ['welcome_coupon_value' => '95'])
            ->assertJsonValidationErrors(['welcome_coupon_value' => 'A percentage discount is between 1 and 90.']);
        $this->asAdmin($headers, 'PUT', '/api/admin/v1/marketing/welcome-coupon', ['welcome_coupon_type' => 'fixed', 'welcome_coupon_value' => '0'])
            ->assertJsonValidationErrors(['welcome_coupon_value' => 'A fixed discount is more than 0 and at most 100,000.']);
        $this->asAdmin($headers, 'PUT', '/api/admin/v1/marketing/welcome-coupon', ['welcome_coupon_valid_days' => 0])
            ->assertJsonValidationErrors(['welcome_coupon_valid_days' => 'A code is valid for 1 to 365 days.']);
        $this->asAdmin($headers, 'PUT', '/api/admin/v1/marketing/welcome-coupon', ['welcome_coupon_min_subtotal' => 'abc'])
            ->assertJsonValidationErrors('welcome_coupon_min_subtotal');
        $this->assertSame(0, AuditLog::where('action', 'settings.welcome_coupon_updated')->count());

        // Partial: only what is sent changes.
        $this->asAdmin($headers, 'PUT', '/api/admin/v1/marketing/welcome-coupon', ['welcome_coupon_enabled' => true, 'welcome_coupon_type' => 'fixed',
            'welcome_coupon_value' => '100', 'welcome_coupon_min_subtotal' => '500'])->assertOk()
            ->assertJsonPath('data.settings.welcome_coupon_enabled', true)
            ->assertJsonPath('data.settings.welcome_coupon_value', '100.00')
            ->assertJsonPath('data.settings.welcome_coupon_min_subtotal', '500.00')
            ->assertJsonPath('data.settings.welcome_coupon_valid_days', 30)
            ->assertJsonPath('data.offer.label', '$100 off')
            ->assertJsonPath('data.offer.min_subtotal', '$500');
        $entry = AuditLog::where('action', 'settings.welcome_coupon_updated')->sole();
        $this->assertEqualsCanonicalizing(['welcome_coupon_enabled' => true, 'welcome_coupon_type' => 'fixed', 'welcome_coupon_value' => '100.00',
            'welcome_coupon_min_subtotal' => '500.00'], $entry->changes['after']);
        $this->asAdmin($headers, 'PUT', '/api/admin/v1/marketing/welcome-coupon', ['welcome_coupon_min_subtotal' => null])->assertOk()
            ->assertJsonPath('data.settings.welcome_coupon_min_subtotal', null)->assertJsonPath('data.settings.welcome_coupon_type', 'fixed');
    }

    public function test_settings_changes_never_touch_issued_codes(): void
    {
        $this->switchOn();
        $this->subscribeAndConfirm('a@example.com');
        $this->switchOn(['welcome_coupon_type' => 'fixed', 'welcome_coupon_value' => '20.00', 'welcome_coupon_valid_days' => 5]);
        $this->subscribeAndConfirm('b@example.com');

        $this->assertSame(['percent', '10.00'], [Coupon::where('issued_to_email', 'a@example.com')->value('type'), Coupon::where('issued_to_email', 'a@example.com')->value('value')]);
        $this->assertSame('fixed', Coupon::where('issued_to_email', 'b@example.com')->value('type'));
        $this->assertSame('10% off', app(WelcomeCoupons::class)->forEmail('a@example.com')['label']);
    }

    public function test_admin_stats_codes_list_and_coupon_source_filter(): void
    {
        $this->switchOn();
        $ava = Customer::factory()->create(['email' => 'ava@example.com', 'first_name' => 'Ava', 'last_name' => 'Customer']);
        $service = app(WelcomeCoupons::class);
        $used = $service->grant('ava@example.com', 'signup', $ava);
        $expired = $service->grant('old@example.com', 'newsletter');
        $expired->forceFill(['ends_at' => now()->subDay()])->save();
        $active = $service->grant('new@example.com', 'newsletter');
        $number = $this->order($used->code, 'ava@example.com')->assertCreated()->json('data.number');

        $headers = $this->adminHeaders();
        $this->asAdmin($headers, 'GET', '/api/admin/v1/marketing/welcome-coupon')->assertOk()
            ->assertJsonPath('data.stats', ['issued' => 3, 'used' => 1, 'expired' => 1, 'active' => 1]);

        $list = $this->asAdmin($headers, 'GET', '/api/admin/v1/marketing/welcome-coupon/codes')->assertOk();
        $this->assertSame([$active->code, $expired->code, $used->code], array_column($list->json('data'), 'code'));
        $this->assertSame([
            'id' => $used->id, 'code' => $used->code, 'email' => 'ava@example.com', 'trigger' => 'signup',
            'customer' => ['id' => $ava->id, 'name' => 'Ava Customer'], 'issued_at' => $used->created_at->toIso8601ZuluString(),
            'expires_at' => $used->ends_at->toIso8601ZuluString(), 'status' => 'used', 'used_on_order' => $number,
        ], $list->json('data.2'));
        $this->assertNull($list->json('data.0.customer'));
        $this->assertSame(3, $list->json('meta.total'));

        $this->assertSame([$expired->code], array_column($this->asAdmin($headers, 'GET', '/api/admin/v1/marketing/welcome-coupon/codes?status=expired')->json('data'), 'code'));
        $this->assertSame([$active->code], array_column($this->asAdmin($headers, 'GET', '/api/admin/v1/marketing/welcome-coupon/codes?status=active')->json('data'), 'code'));
        $this->assertSame([$used->code], array_column($this->asAdmin($headers, 'GET', '/api/admin/v1/marketing/welcome-coupon/codes?search=AVA@')->json('data'), 'code'));
        $this->asAdmin($headers, 'GET', '/api/admin/v1/marketing/welcome-coupon/codes?status=nope')->assertJsonValidationErrors('status');

        // Coupons: all by default (as before), or by source; the new fields.
        $this->assertSame(5, $this->asAdmin($headers, 'GET', '/api/admin/v1/coupons')->json('meta.total')); // NEST10, SAVE20 + 3
        $this->assertEqualsCanonicalizing(['NEST10', 'SAVE20'], array_column($this->asAdmin($headers, 'GET', '/api/admin/v1/coupons?source=staff')->json('data'), 'code'));
        $this->asAdmin($headers, 'GET', "/api/admin/v1/coupons/{$active->id}")->assertOk()
            ->assertJsonPath('data.source', 'welcome')->assertJsonPath('data.issued_to_email', 'new@example.com')->assertJsonPath('data.first_order_only', true);

        // A welcome code: only Active can be changed.
        $this->asAdmin($headers, 'PATCH', "/api/admin/v1/coupons/{$active->id}", ['is_active' => false, 'value' => '90.00', 'code' => 'MINE'])->assertOk()
            ->assertJsonPath('data.is_active', false)->assertJsonPath('data.value', '10.00')->assertJsonPath('data.code', $active->code);

        // A staff coupon may be first-order-only.
        $id = $this->asAdmin($headers, 'POST', '/api/admin/v1/coupons', ['code' => 'HELLO', 'type' => 'percent', 'value' => '15', 'first_order_only' => true])
            ->assertCreated()->assertJsonPath('data.first_order_only', true)->assertJsonPath('data.source', 'staff')->json('data.id');
        $this->asAdmin($headers, 'PATCH', "/api/admin/v1/coupons/{$id}", ['first_order_only' => false])->assertOk()->assertJsonPath('data.first_order_only', false);
    }

    public function test_permissions(): void
    {
        $viewer = $this->signInAdmin(Admin::factory()->role('Viewer')->create());
        $this->asAdmin($viewer, 'PUT', '/api/admin/v1/marketing/welcome-coupon', ['welcome_coupon_enabled' => true])->assertForbidden()
            ->assertJsonPath('permission', 'coupons.edit');

        $this->asAdmin($viewer, 'GET', '/api/admin/v1/marketing/welcome-coupon')->assertOk();
        $catalog = $this->signInAdmin(Admin::factory()->role('Catalog manager')->create());
        $this->asAdmin($catalog, 'GET', '/api/admin/v1/marketing/welcome-coupon')->assertForbidden()->assertJsonPath('permission', 'coupons.view');
        $this->asAdmin($catalog, 'GET', '/api/admin/v1/marketing/welcome-coupon/codes')->assertForbidden();

        $marketing = $this->signInAdmin(Admin::factory()->role('Marketing')->create());
        $this->asAdmin($marketing, 'GET', '/api/admin/v1/marketing/welcome-coupon')->assertOk();
        $this->asAdmin($marketing, 'PUT', '/api/admin/v1/marketing/welcome-coupon', ['welcome_coupon_enabled' => true])->assertOk();
        $this->asAdmin($marketing, 'GET', '/api/admin/v1/marketing/welcome-coupon/codes')->assertOk();
    }
}
