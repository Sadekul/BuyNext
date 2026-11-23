<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Services\Settings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\Feature\Concerns\ReadsCodes;
use Tests\TestCase;

/** Phase 13: the store's API answers validation and error messages in the request's language (Bangla or English). */
class BanglaMessagesTest extends TestCase
{
    use PlacesOrders, ReadsCodes, RefreshDatabase;

    private const BN = ['Accept-Language' => 'bn'];

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
    }

    public function test_no_header_answers_in_english(): void
    {
        // (The test client sends "en-us,en;q=0.5" by default; an empty header is a request without one.)
        $this->getJson('/api/v1/orders', ['Accept-Language' => ''])
            ->assertUnauthorized()
            ->assertHeader('Content-Language', 'en')
            ->assertJsonPath('message', 'Unauthenticated.');
    }

    public function test_bangla_header_answers_in_bangla(): void
    {
        foreach (['bn', 'bn-BD,bn;q=0.9,en;q=0.8', 'BN-bd'] as $header) {
            $this->getJson('/api/v1/orders', ['Accept-Language' => $header])
                ->assertUnauthorized()
                ->assertHeader('Content-Language', 'bn')
                ->assertJsonPath('message', 'আপনি সাইন ইন করা নেই। অনুগ্রহ করে সাইন ইন করুন।');
        }
    }

    public function test_an_unknown_language_uses_the_store_default(): void
    {
        $this->getJson('/api/v1/orders', ['Accept-Language' => 'fr'])->assertHeader('Content-Language', 'en')->assertJsonPath('message', 'Unauthenticated.');

        app(Settings::class)->put(['default_locale' => 'bn']);
        $this->getJson('/api/v1/orders', ['Accept-Language' => 'fr'])->assertHeader('Content-Language', 'bn')
            ->assertJsonPath('message', 'আপনি সাইন ইন করা নেই। অনুগ্রহ করে সাইন ইন করুন।');
        // No header at all: the store default too; an explicit "en" still wins.
        $this->getJson('/api/v1/orders', ['Accept-Language' => ''])->assertHeader('Content-Language', 'bn');
        $this->getJson('/api/v1/orders', ['Accept-Language' => 'en'])->assertHeader('Content-Language', 'en')->assertJsonPath('message', 'Unauthenticated.');
    }

    public function test_admin_routes_stay_english(): void
    {
        $headers = [...$this->adminHeaders(), ...self::BN];

        $this->asAdmin($headers, 'PATCH', '/api/admin/v1/settings', ['general' => ['store_name' => '']])
            ->assertUnprocessable()
            ->assertHeader('Content-Language', 'en')
            ->assertJsonPath('message', 'The general.store name field must be a string. (and 1 more error)');
        $this->app['auth']->forgetGuards();
        $this->json('GET', '/api/admin/v1/orders', [], self::BN)->assertUnauthorized()->assertJsonPath('message', 'Unauthenticated.');
    }

    public function test_sign_up_validation_in_bangla_with_field_names(): void
    {
        $this->postJson('/api/v1/auth/register', ['email' => 'not-an-email', 'phone' => '123', 'accept_terms' => false], self::BN)
            ->assertUnprocessable()
            ->assertJsonPath('errors.first_name.0', 'নামের প্রথম অংশ দেওয়া আবশ্যক।')
            ->assertJsonPath('errors.email.0', 'ইমেইল সঠিক একটি ইমেইল ঠিকানা হতে হবে।')
            ->assertJsonPath('errors.password.0', 'পাসওয়ার্ড দেওয়া আবশ্যক।')
            ->assertJsonPath('errors.phone.0', 'দেশের কোডসহ সঠিক একটি ফোন নম্বর দিন (যেমন +880 1712 345678)।')
            ->assertJsonPath('errors.accept_terms.0', 'অ্যাকাউন্ট খুলতে অনুগ্রহ করে শর্তাবলিতে সম্মতি দিন।')
            // The summary: first error + "(and N more errors)".
            ->assertJsonPath('message', fn (string $message) => str_starts_with($message, 'নামের প্রথম অংশ দেওয়া আবশ্যক। (এবং আরও'));

        // English is unchanged.
        $this->postJson('/api/v1/auth/register', ['email' => 'not-an-email'])
            ->assertJsonPath('errors.first_name.0', 'The first name field is required.');
    }

    public function test_sign_up_remembers_an_explicit_language(): void
    {
        $this->postJson('/api/v1/auth/register', [
            'first_name' => 'Nadia', 'last_name' => 'Rahman', 'email' => 'nadia@example.com', 'phone' => '+8801712345678',
            'password' => 'Secret123', 'password_confirmation' => 'Secret123', 'accept_terms' => true,
        ], ['Accept-Language' => ''])->assertCreated();
        $this->assertNull(Customer::where('email', 'nadia@example.com')->value('locale'));

        $this->postJson('/api/v1/auth/register', [
            'first_name' => 'Rafi', 'last_name' => 'Ahmed', 'email' => 'rafi@example.com', 'phone' => '+8801712345679',
            'password' => 'Secret123', 'password_confirmation' => 'Secret123', 'accept_terms' => true,
        ], self::BN)->assertCreated()->assertJsonPath('message', 'rafi@example.com ঠিকানায় আমরা ৬ সংখ্যার একটি কোড পাঠিয়েছি।');
        $this->assertSame('bn', Customer::where('email', 'rafi@example.com')->value('locale'));
    }

    public function test_sign_in_and_account_messages_in_bangla(): void
    {
        $customer = Customer::factory()->create(['email' => 'mina@example.com']);

        $this->postJson('/api/v1/auth/login', ['email' => 'mina@example.com', 'password' => 'wrong-password'], self::BN)
            ->assertUnprocessable()->assertJsonPath('errors.email.0', 'ইমেইল বা পাসওয়ার্ড সঠিক নয়।');

        $token = $this->postJson('/api/v1/auth/login', ['email' => 'mina@example.com', 'password' => 'Password123'])->json('data.tokens.access_token');
        $this->postJson('/api/v1/me/delete', ['password' => 'Password123', 'confirm' => 'no'], [...$this->bearer($token), ...self::BN])
            ->assertUnprocessable()->assertJsonPath('errors.confirm.0', 'নিশ্চিত করতে DELETE লিখুন।');
        $this->assertNotNull($customer->fresh());
    }

    public function test_checkout_messages_in_bangla(): void
    {
        $product = $this->product(['stock_quantity' => 2, 'name' => 'Cotton Tee']);

        // Field errors with translated nested address names, and custom messages.
        $errors = $this->placeOrder([['product_id' => $product->id, 'quantity' => 1]], [
            'payment_method' => 'nope',
            'shipping_address' => ['first_name' => 'Ava', 'last_name' => '', 'line1' => 'x', 'city' => 'Dhaka', 'postal_code' => '!!', 'country' => 'Mars'],
        ], self::BN)
            ->assertUnprocessable()->json('errors');
        $this->assertSame('একটি পেমেন্ট পদ্ধতি বেছে নিন।', $errors['payment_method'][0]);
        $this->assertSame('নামের শেষ অংশ দেওয়া আবশ্যক।', $errors['shipping_address.last_name'][0]);
        $this->assertSame('পোস্টাল কোডটি সঠিক নয়।', $errors['shipping_address.postal_code'][0]);
        $this->assertSame('এই দেশে আমরা এখনো ডেলিভারি দিই না।', $errors['shipping_address.country'][0]);

        // Stock problems.
        $this->placeOrder([['product_id' => $product->id, 'quantity' => 5]], [], self::BN)
            ->assertUnprocessable()
            ->assertJsonPath('message', 'আপনার কার্টের কিছু পণ্য অর্ডার করা যাচ্ছে না।')
            ->assertJsonPath('errors.items.0', 'Cotton Tee স্টকে মাত্র ২টি আছে।');

        // An empty cart.
        $this->placeOrder([], [], self::BN)->assertUnprocessable()->assertJsonPath('errors.items.0', 'আপনার কার্ট খালি।');
    }

    public function test_bangla_digits_follow_the_setting(): void
    {
        $product = $this->product(['stock_quantity' => 2, 'name' => 'Cotton Tee']);
        app(Settings::class)->put(['bangla_digits' => false]);

        $this->placeOrder([['product_id' => $product->id, 'quantity' => 5]], [], self::BN)
            ->assertJsonPath('errors.items.0', 'Cotton Tee স্টকে মাত্র 2টি আছে।');
    }

    public function test_cart_coupon_and_shipping_labels_in_bangla(): void
    {
        $product = $this->product();

        $this->postJson('/api/v1/cart/validate', ['items' => [['product_id' => $product->id, 'quantity' => 1]], 'coupon_code' => 'NOPE-123'], self::BN)
            ->assertOk()
            ->assertJsonPath('data.coupon_error', 'এই কোডটি সঠিক নয়।')
            ->assertJsonPath('data.shipping_options.0.label', 'স্ট্যান্ডার্ড')
            ->assertJsonPath('data.shipping_options.0.eta', '৩–৫ কর্মদিবস');

        // English unchanged.
        $this->postJson('/api/v1/cart/validate', ['items' => [['product_id' => $product->id, 'quantity' => 1]], 'coupon_code' => 'NOPE-123'])
            ->assertJsonPath('data.coupon_error', 'This code is not valid.')
            ->assertJsonPath('data.shipping_options.0.label', 'Standard');
    }

    public function test_placed_order_keeps_english_labels_but_answers_in_bangla(): void
    {
        $product = $this->product();

        $this->placeOrder([['product_id' => $product->id, 'quantity' => 1]], [], self::BN)
            ->assertCreated()
            ->assertJsonPath('data.shipping_method', ['id' => 'standard', 'label' => 'স্ট্যান্ডার্ড', 'eta' => '৩–৫ কর্মদিবস']);
        $this->assertDatabaseHas('orders', ['shipping_label' => 'Standard', 'shipping_eta' => '3–5 business days']);
    }

    public function test_gift_card_order_lookup_and_stock_alert_messages_in_bangla(): void
    {
        $this->postJson('/api/v1/gift-cards/check', ['code' => 'NOPE-NOPE-NOPE'], self::BN)
            ->assertUnprocessable()->assertJsonPath('errors.code.0', 'এই গিফট কার্ড কোডটি সঠিক নয়।');

        $this->postJson('/api/v1/orders/lookup', ['number' => 'BN-999999', 'email' => 'a@example.com'], self::BN)
            ->assertNotFound()->assertJsonPath('message', 'এই নম্বর ও ইমেইলে কোনো অর্ডার খুঁজে পাওয়া যায়নি।');

        $product = $this->product(['stock_quantity' => 5]);
        $this->postJson("/api/v1/products/{$product->id}/stock-alerts", ['email' => 'a@example.com'], self::BN)
            ->assertUnprocessable()->assertJsonPath('errors.stock.0', 'পণ্যটি স্টকে আছে, তাই আপনি এখনই অর্ডার করতে পারেন।');
    }

    public function test_framework_404_and_429_in_bangla(): void
    {
        $this->getJson('/api/v1/no-such-route', self::BN)->assertNotFound()->assertJsonPath('message', 'পাওয়া যায়নি।');
        $this->getJson('/api/v1/no-such-route')->assertNotFound()->assertJsonPath('message', fn ($message) => ! preg_match('/\p{Bengali}/u', (string) $message));

        $limit = (int) config('buynest.gift_card_checks_per_minute');
        for ($i = 0; $i < $limit; $i++) {
            $this->postJson('/api/v1/gift-cards/check', ['code' => 'NOPE'], self::BN);
        }
        $this->postJson('/api/v1/gift-cards/check', ['code' => 'NOPE'], self::BN)
            ->assertStatus(429)->assertJsonPath('message', 'অনেকবার চেষ্টা করা হয়েছে। একটু পরে আবার চেষ্টা করুন।');
    }

    public function test_every_bangla_translation_keeps_its_placeholders(): void
    {
        $translations = json_decode(file_get_contents(lang_path('bn.json')), true, flags: JSON_THROW_ON_ERROR);
        $this->assertNotEmpty($translations);
        $names = function (string $text): array {
            preg_match_all('/:([a-z_]+)/', $text, $matches);
            $found = array_values(array_unique($matches[1]));
            sort($found);

            return $found;
        };
        foreach ($translations as $english => $bangla) {
            $this->assertNotSame('', trim($bangla), "Empty Bangla for \"{$english}\"");
            $this->assertSame($names($english), $names($bangla), "Placeholders differ for \"{$english}\"");
        }
    }

    public function test_bangla_validation_file_has_every_laravel_key(): void
    {
        $english = require base_path('vendor/laravel/framework/src/Illuminate/Translation/lang/en/validation.php');
        $bangla = require lang_path('bn/validation.php');
        foreach ($english as $key => $line) {
            $this->assertArrayHasKey($key, $bangla, "lang/bn/validation.php misses {$key}");
            if (is_array($line) && ! in_array($key, ['custom', 'attributes'], true)) {
                $this->assertSame(array_keys($line), array_keys($bangla[$key]), "lang/bn/validation.php {$key}");
            }
        }
        foreach (['auth', 'passwords', 'pagination'] as $file) {
            $en = require base_path("vendor/laravel/framework/src/Illuminate/Translation/lang/en/{$file}.php");
            $this->assertSame(array_keys($en), array_keys(require lang_path("bn/{$file}.php")), "lang/bn/{$file}.php");
        }
    }
}
