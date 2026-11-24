<?php

namespace Tests\Feature;

use App\Models\Coupon;
use App\Models\CouponRedemption;
use App\Models\Customer;
use App\Models\Order;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\Feature\Concerns\ReadsCodes;
use Tests\TestCase;

/** Phase 3: coupons in the database, their validity rules, usage counting, and the admin screens. */
class CouponTest extends TestCase
{
    use PlacesOrders, ReadsCodes, RefreshDatabase;

    private Product $lamp; // 25.00

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->lamp = $this->product(['price' => '25.00', 'stock_quantity' => 50]);
    }

    private function coupon(array $attributes = []): Coupon
    {
        return Coupon::create([
            'code' => 'TEST5', 'description' => '$5 off', 'type' => 'fixed', 'value' => '5.00', 'is_active' => true, ...$attributes,
        ])->refresh();
    }

    private function cart(string $code, int $quantity = 1, array $extra = [], array $headers = [])
    {
        $this->app['auth']->forgetGuards();

        return $this->postJson('/api/v1/cart/validate', [
            'items' => [['product_id' => $this->lamp->id, 'quantity' => $quantity]], 'coupon_code' => $code, 'shipping_method' => 'standard', ...$extra,
        ], $headers)->assertOk();
    }

    private function couponError(string $code, int $quantity = 1, array $extra = [], array $headers = []): ?string
    {
        return $this->cart($code, $quantity, $extra, $headers)->json('data.coupon_error');
    }

    private function order(string $code, array $overrides = [], array $headers = [])
    {
        $this->app['auth']->forgetGuards();

        return $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]], ['coupon_code' => $code, ...$overrides], $headers);
    }

    private function customerHeaders(Customer $customer): array
    {
        $this->app['auth']->forgetGuards();

        return $this->bearer($this->postJson('/api/v1/auth/login', ['email' => $customer->email, 'password' => 'Password123'])->json('data.tokens.access_token'));
    }

    public function test_the_phase_2_codes_are_seeded(): void
    {
        $this->assertSame(
            [['NEST10', 'percent', '10.00', null, '10% off your order'], ['SAVE20', 'fixed', '20.00', '150.00', '$20 off orders of $150 or more']],
            Coupon::orderBy('code')->get()->map(fn ($c) => [$c->code, $c->type, $c->value, $c->min_subtotal, $c->description])->all(),
        );
        $this->assertSame('10% off your order', $this->cart('nest10')->json('data.coupon.description'));
    }

    public function test_each_rule_and_its_message(): void
    {
        $this->assertSame('This code is not valid.', $this->couponError('NOPE'));
        $this->coupon(['code' => 'OFF', 'is_active' => false]);
        $this->assertSame('This code is not valid.', $this->couponError('OFF'));
        $this->coupon(['code' => 'SOON', 'starts_at' => now()->addDay()]);
        $this->assertSame('This code isn\'t active yet.', $this->couponError('SOON'));
        $this->coupon(['code' => 'OLD', 'ends_at' => now()->subMinute()]);
        $this->assertSame('This code has expired.', $this->couponError('OLD'));
        $this->coupon(['code' => 'BIG', 'min_subtotal' => '60.50']);
        $this->assertSame('Spend $10.50 more to use this code.', $this->couponError('BIG', 2));
        $this->assertNull($this->couponError('BIG', 3));
        $this->coupon(['code' => 'GONE', 'usage_limit' => 2])->forceFill(['times_used' => 2])->save();
        $this->assertSame('This code has been fully used.', $this->couponError('GONE'));
        $this->coupon();
        $this->assertNull($this->couponError('test5'));
        $this->coupon(['code' => 'NOW', 'starts_at' => now()->subDay(), 'ends_at' => now()->addDay()]);
        $this->assertNull($this->couponError('NOW'));
    }

    public function test_the_first_failing_rule_wins(): void
    {
        $everythingWrong = ['is_active' => false, 'starts_at' => now()->addDay(), 'min_subtotal' => '1000.00', 'usage_limit' => 1, 'usage_limit_per_customer' => 1];
        $coupon = $this->coupon(['code' => 'ALLBAD', ...$everythingWrong]);
        $coupon->forceFill(['times_used' => 1])->save();
        CouponRedemption::create(['coupon_id' => $coupon->id, 'order_id' => Order::factory()->create()->id, 'email' => 'guest@example.com']);

        $expected = [
            'This code is not valid.',                    // inactive
            'This code isn\'t active yet.',               // not started
            'This code has expired.',                     // ended (starts_at cleared, ends_at past)
            'Spend $975.00 more to use this code.',     // minimum (phase 7: says how much more)
            'This code has been fully used.',             // total uses
            'You\'ve already used this code.',            // per customer (guest email)
            null,
        ];
        $fixes = [
            ['is_active' => true],
            ['starts_at' => null, 'ends_at' => now()->subDay()],
            ['ends_at' => null],
            ['min_subtotal' => null],
            ['usage_limit' => null],
            ['usage_limit_per_customer' => 2],
        ];
        foreach ($expected as $step => $message) {
            $this->assertSame($message, $this->couponError('allbad', 1, ['email' => 'Guest@Example.com']), "step {$step}");
            if (isset($fixes[$step])) {
                $coupon->forceFill($fixes[$step])->save();
            }
        }
    }

    public function test_per_customer_limits_by_email_and_by_account(): void
    {
        $this->coupon(['code' => 'ONCE', 'usage_limit_per_customer' => 1]);

        // Guests: by email.
        $this->order('ONCE', ['email' => 'guest@example.com'])->assertCreated();
        $this->assertSame('You\'ve already used this code.', $this->couponError('ONCE', 1, ['email' => 'GUEST@example.com']));
        $this->assertNull($this->couponError('ONCE')); // no email yet: checked at checkout
        $this->order('ONCE', ['email' => 'guest@example.com'])->assertJsonValidationErrors(['coupon_code' => 'You\'ve already used this code.']);
        $this->order('ONCE', ['email' => 'someone@example.com'])->assertCreated();

        // Customers: by account (the token on cart/validate and checkout).
        $ava = Customer::factory()->create(['email' => 'ava@example.com']);
        $headers = $this->customerHeaders($ava);
        $this->assertNull($this->couponError('ONCE', 1, [], $headers));
        $this->order('ONCE', ['email' => null, 'phone' => null], $headers)->assertCreated();
        $this->assertSame('You\'ve already used this code.', $this->couponError('ONCE', 1, [], $headers));
        $this->order('ONCE', ['email' => null, 'phone' => null], $headers)->assertJsonValidationErrors(['coupon_code' => 'You\'ve already used this code.']);

        // cart/validate refuses a bad token instead of treating it as a guest.
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/cart/validate', ['items' => [], 'coupon_code' => 'ONCE'], $this->bearer('1|nonsense'))->assertUnauthorized();
        $this->postJson('/api/v1/cart/validate', ['items' => [], 'email' => 'not-an-email'])->assertJsonValidationErrors('email');
    }

    public function test_usage_is_counted_at_checkout_under_a_row_lock(): void
    {
        $coupon = $this->coupon(['code' => 'TWICE', 'usage_limit' => 2]);

        $queries = [];
        DB::listen(function ($query) use (&$queries) {
            $queries[] = $query->sql;
        });
        $number = $this->order('twice')->assertCreated()->assertJsonPath('data.coupon_code', 'TWICE')->json('data.number');
        $this->assertNotEmpty(array_filter($queries, fn ($sql) => str_contains($sql, 'from `coupons`') && str_contains($sql, 'for update')),
            'checkout must lock the coupon row');

        $this->assertSame(1, $coupon->fresh()->times_used);
        $this->assertDatabaseHas('coupon_redemptions', ['coupon_id' => $coupon->id, 'order_id' => Order::where('number', $number)->value('id'), 'email' => 'guest@example.com', 'customer_id' => null]);
        $this->order('TWICE', ['email' => 'b@example.com'])->assertCreated();
        $this->assertSame(2, $coupon->fresh()->times_used);
        $this->order('TWICE', ['email' => 'c@example.com'])->assertJsonValidationErrors(['coupon_code' => 'This code has been fully used.']);
        $this->assertSame(2, $coupon->fresh()->times_used);
        $this->assertSame(2, Order::count()); // the refused checkout left nothing behind
    }

    public function test_cancelling_gives_the_use_back(): void
    {
        $coupon = $this->coupon(['code' => 'SINGLE', 'usage_limit' => 1]);
        $number = $this->order('SINGLE')->assertCreated()->json('data.number');
        $this->assertSame('This code has been fully used.', $this->couponError('SINGLE'));

        $this->app['auth']->forgetGuards();
        $this->patchJson("/api/admin/v1/orders/{$number}", ['status' => 'cancelled'], $this->adminHeaders())->assertOk();
        $this->assertSame(0, $coupon->fresh()->times_used);
        $this->assertSame(0, CouponRedemption::count());
        $this->assertNull($this->couponError('SINGLE'));
        $this->order('SINGLE', ['email' => 'next@example.com'])->assertCreated();
    }

    public function test_free_shipping_makes_every_method_free(): void
    {
        $this->coupon(['code' => 'SHIPFREE', 'type' => 'free_shipping', 'value' => '0.00', 'description' => 'Free shipping']);

        $express = $this->cart('shipfree', 1, ['shipping_method' => 'express']);
        $express->assertJsonPath('data.coupon', ['code' => 'SHIPFREE', 'description' => 'Free shipping'])
            ->assertJsonPath('data.totals', ['item_count' => 1, 'subtotal' => '25.00', 'discount' => '0.00', 'group_discount' => '0.00', 'shipping' => '0.00', 'tax' => '0.00', 'total' => '25.00',
                'gift_card' => '0.00', 'reward_points' => '0.00', 'amount_due' => '25.00', 'cod_fee' => '0.00']); // phase 14: cod_fee
        $this->assertSame(['0.00', '0.00', '0.00'], array_column($express->json('data.shipping_options'), 'price'));

        $this->order('SHIPFREE', ['shipping_method' => 'nextDay', 'expected_total' => '25.00'])->assertCreated()
            ->assertJsonPath('data.totals.shipping', '0.00')
            ->assertJsonPath('data.totals.discount', '0.00')
            ->assertJsonPath('data.coupon_code', 'SHIPFREE');
    }

    public function test_staff_create_list_edit_and_remove_coupons(): void
    {
        $admin = $this->adminHeaders();
        $api = function (string $method, string $uri, array $body = []) use ($admin) {
            $this->app['auth']->forgetGuards();

            return $this->json($method, "/api/admin/v1/coupons{$uri}", $body, $admin);
        };

        $created = $api('POST', '', ['code' => ' spring-25 ', 'type' => 'percent', 'value' => '25', 'min_subtotal' => '40', 'ends_at' => '2099-05-31', 'usage_limit' => 100])
            ->assertCreated();
        $id = $created->json('data.id');
        $created->assertJsonPath('data.code', 'SPRING-25')
            ->assertJsonPath('data.description', '25% off orders of $40 or more')
            ->assertJsonPath('data.value', '25.00')
            ->assertJsonPath('data.min_subtotal', '40.00')
            ->assertJsonPath('data.ends_at', '2099-05-31T23:59:59Z')
            ->assertJsonPath('data.starts_at', null)
            ->assertJsonPath('data.usage_limit', 100)
            ->assertJsonPath('data.usage_limit_per_customer', null)
            ->assertJsonPath('data.times_used', 0)
            ->assertJsonPath('data.is_active', true)
            ->assertJsonPath('data.status', 'active');
        $this->assertSame('Spend $15.00 more to use this code.', $this->couponError('spring-25', 1));
        $this->assertSame('12.50', $this->cart('spring-25', 2)->json('data.totals.discount'));

        // Validation.
        $api('POST', '', ['code' => 'Spring-25', 'type' => 'fixed', 'value' => '5'])->assertJsonValidationErrors(['code' => 'There is already a coupon with this code.']);
        $api('POST', '', ['code' => 'NEW', 'type' => 'percent', 'value' => '0'])->assertJsonValidationErrors(['value' => 'A percent discount is between 1 and 100.']);
        $api('POST', '', ['code' => 'NEW', 'type' => 'percent', 'value' => '101'])->assertJsonValidationErrors('value');
        $api('POST', '', ['code' => 'NEW', 'type' => 'fixed'])->assertJsonValidationErrors(['value' => 'A fixed discount must be more than $0.00.']);
        $api('POST', '', ['code' => 'NEW', 'type' => 'bogo', 'value' => '1'])->assertJsonValidationErrors('type');
        $api('POST', '', ['code' => 'NO WAY', 'type' => 'fixed', 'value' => '1'])->assertJsonValidationErrors('code');
        $api('POST', '', ['code' => 'NEW', 'type' => 'fixed', 'value' => '1', 'starts_at' => '2099-02-01', 'ends_at' => '2099-01-01'])
            ->assertJsonValidationErrors(['ends_at' => 'The end date must be after the start date.']);
        $api('POST', '', ['code' => 'SHIP', 'type' => 'free_shipping', 'value' => '9'])->assertCreated()
            ->assertJsonPath('data.value', '0.00')->assertJsonPath('data.description', 'Free shipping');

        // Statuses.
        $api('POST', '', ['code' => 'LATER', 'type' => 'fixed', 'value' => '1', 'starts_at' => now()->addWeek()->toIso8601String()])->assertJsonPath('data.status', 'scheduled');
        $api('POST', '', ['code' => 'PAST', 'type' => 'fixed', 'value' => '1', 'ends_at' => now()->subDay()->toIso8601String()])->assertJsonPath('data.status', 'expired');
        $used = $this->coupon(['code' => 'USED', 'usage_limit' => 1]);
        $used->forceFill(['times_used' => 1])->save();
        $api('GET', "/{$used->id}")->assertOk()->assertJsonPath('data.status', 'used_up');
        $api('PATCH', "/{$id}", ['is_active' => false])->assertOk()->assertJsonPath('data.status', 'inactive');

        $codes = fn (string $query) => array_column($api('GET', $query)->assertOk()->json('data'), 'code');
        $this->assertSame(['SHIP', 'SAVE20', 'NEST10'], $codes('?status=active'));
        $this->assertSame(['SPRING-25'], $codes('?status=inactive'));
        $this->assertSame(['PAST'], $codes('?status=expired'));
        $this->assertSame(['LATER'], $codes('?status=scheduled'));
        $this->assertSame(['USED'], $codes('?status=used_up'));
        $this->assertSame(['SAVE20'], $codes('?search=save'));
        $api('GET', '?status=lost')->assertJsonValidationErrors('status');

        // Partial edits are checked against the whole coupon.
        $api('PATCH', "/{$id}", ['value' => '150'])->assertJsonValidationErrors('value');
        $api('PATCH', "/{$id}", ['type' => 'fixed', 'value' => '7.5', 'is_active' => true, 'description' => 'Spring sale'])->assertOk()
            ->assertJsonPath('data.type', 'fixed')->assertJsonPath('data.value', '7.50')->assertJsonPath('data.description', 'Spring sale');
        $api('PATCH', "/{$id}", ['starts_at' => '2099-06-01'])->assertJsonValidationErrors('ends_at');
        $api('PATCH', '/999999', ['value' => '1'])->assertNotFound();

        // Removing: unused → deleted (204); used by an order → only disabled (200).
        $api('DELETE', "/{$id}")->assertNoContent();
        $this->assertNull(Coupon::find($id));
        $this->order('NEST10')->assertCreated();
        $nest = Coupon::where('code', 'NEST10')->sole();
        $api('DELETE', "/{$nest->id}")->assertOk()->assertJsonPath('data.is_active', false)->assertJsonPath('data.times_used', 1);
        $this->assertSame('This code is not valid.', $this->couponError('NEST10'));
        $api('DELETE', '/999999')->assertNotFound();
    }
}
