<?php

namespace Tests\Feature;

use App\Mail\InvoiceMail;
use App\Mail\OrderPlacedMail;
use App\Models\Admin;
use App\Models\Customer;
use App\Models\Invoice;
use App\Models\Order;
use App\Models\Product;
use App\Models\RewardTransaction;
use App\Services\GiftCards;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\Feature\Concerns\ReadsCodes;
use Tests\TestCase;

/**
 * Phase 11: reward points. Lamp 20.00; two lamps + standard shipping 4.99 = 44.99.
 * Defaults when switched on: 1 point per 1.00, a point is worth 0.01, at least 100 points, at most 50% of the total.
 */
class RewardPointsTest extends TestCase
{
    use PlacesOrders, ReadsCodes, RefreshDatabase;

    private array $admin;

    private Customer $customer;

    private array $headers;

    private Product $lamp;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->admin = $this->adminHeaders();
        $this->customer = Customer::factory()->create(['email' => 'ava@example.com']);
        $this->headers = $this->customerHeaders($this->customer);
        $this->lamp = $this->product(['price' => '20.00', 'stock_quantity' => 50]);
    }

    private function customerHeaders(Customer $customer): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.$this->postJson('/api/v1/auth/login', ['email' => $customer->email, 'password' => 'Password123'])
            ->assertOk()->json('data.tokens.access_token')];
    }

    private function admin(string $method, string $uri, array $body = []): TestResponse
    {
        return $this->asAdmin($this->admin, $method, $uri, $body);
    }

    private function me(string $method, string $uri, array $body = []): TestResponse
    {
        return $this->asAdmin($this->headers, $method, $uri, $body);
    }

    private function enable(array $settings = []): void
    {
        $this->admin('PATCH', '/api/admin/v1/settings', ['rewards' => ['enabled' => true, ...$settings]])->assertOk();
    }

    private function balance(int $points): void
    {
        $this->customer->forceFill(['reward_points' => $points])->save();
    }

    private function lamps(int $quantity = 2): array
    {
        return [['product_id' => $this->lamp->id, 'quantity' => $quantity]];
    }

    private function cart(array $body): TestResponse
    {
        return $this->me('POST', '/api/v1/cart/validate', ['items' => $this->lamps(), ...$body]);
    }

    private function order(array $overrides = []): TestResponse
    {
        $this->app['auth']->forgetGuards();

        return $this->placeOrder($this->lamps(), ['email' => 'ava@example.com', ...$overrides], $this->headers);
    }

    public function test_settings_are_off_by_default_and_change_nothing_while_off(): void
    {
        $this->admin('GET', '/api/admin/v1/settings')->assertOk()->assertJsonPath('data.rewards', [
            'enabled' => false, 'earn_rate' => '1.00', 'point_value' => '0.0100', 'min_redeem' => 100, 'max_percent' => 50,
            'signup_bonus' => 0, 'review_bonus' => 0,
        ]);
        $this->getJson('/api/v1/store')->assertOk()->assertJsonPath('data.rewards.enabled', false);
        $this->balance(1000);

        $this->cart([])->assertOk()->assertJsonPath('data.rewards', null)->assertJsonPath('data.reward_points_error', null)
            ->assertJsonPath('data.totals.reward_points', '0.00')->assertJsonPath('data.totals.amount_due', '44.99');
        $this->cart(['reward_points' => 200])->assertOk()->assertJsonPath('data.reward_points_error', 'Reward points aren\'t available right now.')
            ->assertJsonPath('data.totals.amount_due', '44.99');
        $this->order(['reward_points' => 200])->assertStatus(422)->assertJsonValidationErrors('reward_points');

        $number = $this->order()->assertCreated()->assertJsonPath('data.reward_points', null)->json('data.number');
        $this->admin('POST', "/api/admin/v1/orders/{$number}/invoices", [])->assertCreated();
        $this->assertNull(Order::where('number', $number)->value('reward_points_earned'));
        $this->assertSame(0, RewardTransaction::count());

        $this->admin('PATCH', '/api/admin/v1/settings', ['rewards' => ['max_percent' => 0]])->assertStatus(422)->assertJsonValidationErrors('rewards.max_percent');
        $this->admin('PATCH', '/api/admin/v1/settings', ['rewards' => ['point_value' => '0.00001']])->assertStatus(422)->assertJsonValidationErrors('rewards.point_value');
        $this->admin('PATCH', '/api/admin/v1/settings', ['rewards' => ['earn_rate' => 2.5, 'point_value' => 0.02]])->assertOk()
            ->assertJsonPath('data.rewards.earn_rate', '2.50')->assertJsonPath('data.rewards.point_value', '0.0200');
    }

    public function test_points_are_earned_once_when_the_order_is_invoiced(): void
    {
        $this->enable();
        $giftCard = $this->product(['type' => 'gift_card', 'price' => '0.00', 'gift_card_amounts' => ['25.00']]);
        $items = [...$this->lamps(), ['product_id' => $giftCard->id, 'quantity' => 1,
            'gift_card' => ['amount' => '25.00', 'recipient_name' => 'Sam', 'recipient_email' => 'sam@example.com']]];

        $this->me('POST', '/api/v1/cart/validate', ['items' => $items])->assertOk()->assertJsonPath('data.rewards.earn_estimate', 40);
        $this->app['auth']->forgetGuards();
        $number = $this->placeOrder($items, ['email' => 'ava@example.com'], $this->headers)->assertCreated()
            ->assertJsonPath('data.reward_points', null)->json('data.number');
        $this->assertSame(0, (int) $this->customer->fresh()->reward_points); // placing earns nothing

        $this->admin('POST', "/api/admin/v1/orders/{$number}/invoices", ['notify_customer' => true])->assertCreated();
        // 40.00 of lamps: the gift card line and shipping don't earn.
        $this->assertSame(40, $this->customer->fresh()->reward_points);
        $this->me('GET', "/api/v1/orders/{$number}")->assertOk()->assertJsonPath('data.reward_points', ['spent' => 0, 'amount' => '0.00', 'earned' => 40]);
        $this->admin('POST', "/api/admin/v1/orders/{$number}/invoices", [])->assertStatus(422);
        $this->assertSame(1, RewardTransaction::where('type', 'earn')->count());

        // The invoice email says so.
        $html = (new InvoiceMail(Invoice::firstOrFail()))->render();
        $this->assertStringContainsString('You earned 40 reward points with this order.', $html);

        // Guests earn nothing.
        $guest = $this->placeOrder($this->lamps())->assertCreated()->json('data.number');
        $this->admin('POST', "/api/admin/v1/orders/{$guest}/invoices", [])->assertCreated();
        $this->assertNull(Order::where('number', $guest)->value('reward_points_earned'));
    }

    public function test_signup_and_review_bonuses_are_given_once(): void
    {
        $this->enable(['signup_bonus' => 50, 'review_bonus' => 20]);

        $this->signUp(['email' => 'new@example.com'])->assertCreated();
        $this->postJson('/api/v1/auth/verify-email', ['email' => 'new@example.com', 'code' => $this->lastCodeFor('new@example.com')])->assertOk();
        $new = Customer::where('email', 'new@example.com')->firstOrFail();
        $this->assertSame(50, $new->reward_points);
        $this->assertSame(['signup'], RewardTransaction::where('customer_id', $new->id)->pluck('type')->all());

        // Staff-made accounts get it at once.
        $id = $this->admin('POST', '/api/admin/v1/customers', ['first_name' => 'Sam', 'last_name' => 'Lee', 'email' => 'sam@example.com', 'phone' => '+15550100199'])
            ->assertCreated()->json('data.id');
        $this->assertSame(50, Customer::find($id)->reward_points);

        // Reviews: when approved, once per customer and product.
        $id = $this->me('POST', "/api/v1/products/{$this->lamp->id}/reviews", ['rating' => 5, 'comment' => 'Lovely warm light.'])->assertCreated()->json('data.id');
        $this->assertSame(0, (int) $this->customer->fresh()->reward_points); // pending
        $this->admin('PATCH', "/api/admin/v1/reviews/{$id}", ['status' => 'approved'])->assertOk();
        $this->assertSame(20, $this->customer->fresh()->reward_points);
        $this->admin('PATCH', "/api/admin/v1/reviews/{$id}", ['status' => 'rejected'])->assertOk();
        $this->admin('PATCH', "/api/admin/v1/reviews/{$id}", ['status' => 'approved'])->assertOk();
        $this->assertSame(20, $this->customer->fresh()->reward_points);
    }

    public function test_spending_limits_balance_minimum_maximum_and_sign_in(): void
    {
        $this->enable();
        $this->balance(1000);

        $this->cart([])->assertOk()->assertJsonPath('data.rewards', [
            'enabled' => true, 'balance' => 1000, 'point_value' => '0.0100', 'min_redeem' => 100, 'max_points' => 1000,
            'earn_estimate' => 40, 'applied_points' => 0, 'applied_amount' => '0.00',
        ]);
        $this->cart(['reward_points' => 1500])->assertOk()->assertJsonPath('data.reward_points_error', 'You have only 1,000 points.')
            ->assertJsonPath('data.totals.reward_points', '0.00');
        $this->cart(['reward_points' => 50])->assertOk()->assertJsonPath('data.reward_points_error', 'Use at least 100 points.');
        $this->cart(['reward_points' => 500])->assertOk()->assertJsonPath('data.reward_points_error', null)
            ->assertJsonPath('data.rewards.applied_points', 500)->assertJsonPath('data.rewards.applied_amount', '5.00')
            ->assertJsonPath('data.rewards.earn_estimate', 35)
            ->assertJsonPath('data.totals.total', '44.99')->assertJsonPath('data.totals.reward_points', '5.00')->assertJsonPath('data.totals.amount_due', '39.99');

        // At most 10% of 44.99 = 4.49 = 449 points.
        $this->enable(['max_percent' => 10]);
        $this->cart(['reward_points' => 500])->assertOk()->assertJsonPath('data.rewards.max_points', 449)
            ->assertJsonPath('data.reward_points_error', 'You can use at most 449 points on this order.');
        $this->order(['reward_points' => 500])->assertStatus(422)->assertJsonPath('errors.reward_points.0', 'You can use at most 449 points on this order.');
        $this->order(['reward_points' => 1500])->assertStatus(422)->assertJsonValidationErrors('reward_points');

        // Guests: no rewards, and points are refused.
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/cart/validate', ['items' => $this->lamps()])->assertOk()->assertJsonPath('data.rewards', null);
        $this->app['auth']->forgetGuards();
        $this->placeOrder($this->lamps(), ['reward_points' => 200])->assertStatus(422)->assertJsonPath('errors.reward_points.0', 'Sign in to use reward points.');

        // Placing takes the points; the order and the confirmation show them.
        $this->enable(['max_percent' => 50]);
        $order = $this->order(['reward_points' => 400])->assertCreated()
            ->assertJsonPath('data.reward_points', ['spent' => 400, 'amount' => '4.00', 'earned' => null])
            ->assertJsonPath('data.totals.reward_points', '4.00')->assertJsonPath('data.totals.amount_due', '40.99')
            ->assertJsonPath('data.payment_method', 'cod')->json('data');
        $this->assertSame(600, $this->customer->fresh()->reward_points);
        $this->assertSame(-400, RewardTransaction::where('type', 'spend')->value('points'));
        $html = (new OrderPlacedMail(Order::where('number', $order['number'])->firstOrFail()))->render();
        $this->assertStringContainsString('You used 400 reward points ($4.00) on this order.', $html);
        $this->assertStringContainsString('Reward points (400 pts)', $html);
    }

    public function test_points_pay_before_a_gift_card_and_can_cover_everything(): void
    {
        $this->enable(['max_percent' => 100]);
        $this->balance(10000);

        // Points alone cover the total: placed paid, "reward_points".
        $order = $this->order(['reward_points' => 4499, 'payment_method' => 'card'])->assertCreated()
            ->assertJsonPath('data.payment_method', 'reward_points')->assertJsonPath('data.payment_status', 'paid')
            ->assertJsonPath('data.payment.provider', 'reward_points')->assertJsonPath('data.totals.amount_due', '0.00')->json('data');
        $this->assertSame('processing', $order['status']);
        $this->assertSame(10000 - 4499, $this->customer->fresh()->reward_points);
        $this->assertStringContainsString('Paid with reward points (4,499 pts).', Order::where('number', $order['number'])->first()->history->pluck('note')->implode(' '));

        // Not covered: "reward_points" as the method is refused.
        $this->order(['reward_points' => 1000, 'payment_method' => 'reward_points'])->assertStatus(422)->assertJsonValidationErrors('payment_method');

        // Points first (50% = 22.49), then the gift card pays the rest.
        $this->enable(['max_percent' => 50]);
        $this->balance(5000);
        [$card, $code] = app(GiftCards::class)->create(5000, []);
        $this->cart(['reward_points' => 2249, 'gift_card_code' => $code])->assertOk()
            ->assertJsonPath('data.totals.reward_points', '22.49')->assertJsonPath('data.totals.gift_card', '22.50')
            ->assertJsonPath('data.totals.amount_due', '0.00')->assertJsonPath('data.gift_card.applied', '22.50');
        $number = $this->order(['reward_points' => 2249, 'gift_card_code' => $code, 'payment_method' => 'card'])->assertCreated()
            ->assertJsonPath('data.payment_method', 'gift_card')->assertJsonPath('data.payment_status', 'paid')->json('data.number');
        $this->assertSame('27.50', $card->fresh()->balance);
        // Paid at once, so it earns at once: floor(40.00 − 22.49) = 17.
        $this->assertSame(5000 - 2249 + 17, $this->customer->fresh()->reward_points);
        $this->assertStringContainsString("Paid with gift card ••••{$card->last4} and reward points (2,249 pts).",
            Order::where('number', $number)->first()->history->pluck('note')->implode(' '));
    }

    public function test_cancelling_returns_the_spent_points(): void
    {
        $this->enable();
        $this->balance(1000);
        $number = $this->order(['reward_points' => 500])->assertCreated()->json('data.number');
        $this->assertSame(500, $this->customer->fresh()->reward_points);

        $this->me('POST', "/api/v1/orders/{$number}/cancel", [])->assertOk();
        $this->assertSame(1000, $this->customer->fresh()->reward_points);
        $this->assertSame(500, RewardTransaction::where('type', 'cancel_return')->value('points'));

        // Staff cancel too, and only once.
        $other = $this->order(['reward_points' => 300])->assertCreated()->json('data.number');
        $this->admin('PATCH', "/api/admin/v1/orders/{$other}", ['status' => 'cancelled'])->assertOk();
        $this->assertSame(1000, $this->customer->fresh()->reward_points);
    }

    public function test_refunds_return_spent_points_first_and_take_back_earned_points_without_going_below_zero(): void
    {
        $this->enable();
        $this->balance(1000);
        $order = Order::where('number', $this->order(['reward_points' => 500])->assertCreated()->json('data.number'))->firstOrFail();
        $this->admin('POST', "/api/admin/v1/orders/{$order->number}/invoices", [])->assertCreated();
        $this->assertSame(35, $order->fresh()->reward_points_earned); // 40 − 5 points
        $this->assertSame(535, $this->customer->fresh()->reward_points);

        $this->admin('GET', "/api/admin/v1/orders/{$order->number}/refundable")->assertOk()
            ->assertJsonPath('data.reward_points_refundable', '5.00')->assertJsonPath('data.reward_points', ['spent' => 500, 'earned' => 35, 'reversed' => 0]);

        // One lamp (20.00): 5.00 back as the 500 points, 15.00 by the payment method; earned: round(35 × 20 / 44.99) = 16 back.
        $item = $order->items()->first();
        $this->admin('POST', "/api/admin/v1/orders/{$order->number}/credit-memos", ['items' => [['order_item_id' => $item->id, 'quantity' => 1]]])
            ->assertCreated()->assertJsonPath('data.reward_points_refund', '5.00')->assertJsonPath('data.reward_points_returned', 500)
            ->assertJsonPath('data.reward_points_reversed', 16)->assertJsonPath('data.other_refund', '15.00');
        $this->assertSame(535 + 500 - 16, $this->customer->fresh()->reward_points);

        // The rest; the balance is too low to take back all 19: it stops at 0 and the shortfall is noted.
        $this->balance(10);
        $this->admin('POST', "/api/admin/v1/orders/{$order->number}/credit-memos", ['items' => [['order_item_id' => $item->id, 'quantity' => 1]],
            'shipping_refund' => '4.99'])->assertCreated()->assertJsonPath('data.reward_points_refund', '0.00')
            ->assertJsonPath('data.reward_points_returned', 0)->assertJsonPath('data.reward_points_reversed', 10);
        $this->assertSame(0, $this->customer->fresh()->reward_points);
        $reverse = RewardTransaction::where('type', 'refund_reverse')->orderByDesc('id')->first();
        $this->assertStringContainsString('9 points could not be taken back', $reverse->note);
        $this->assertSame(0, $reverse->balance_after);
        $this->assertStringContainsString('could not be taken back', $order->fresh()->history->last()->note);
    }

    public function test_staff_see_and_adjust_balances_with_a_note_and_the_right_permission(): void
    {
        $this->balance(100);
        $viewer = $this->signInAdmin(Admin::factory()->role(['customers.view', 'reports.view'])->create());
        $this->asAdmin($viewer, 'GET', "/api/admin/v1/customers/{$this->customer->id}/rewards")->assertOk()
            ->assertJsonPath('data.balance', 100)->assertJsonPath('data.value', '1.00')->assertJsonPath('data.transactions', []);
        $this->asAdmin($viewer, 'POST', "/api/admin/v1/customers/{$this->customer->id}/rewards/adjust", ['points' => 10, 'note' => 'Sorry'])->assertForbidden();
        $this->asAdmin($viewer, 'GET', "/api/admin/v1/customers/{$this->customer->id}")->assertOk()->assertJsonPath('data.reward_points', 100);

        $marketing = $this->signInAdmin(Admin::factory()->role('Marketing')->create(['name' => 'Mia']));
        $this->asAdmin($marketing, 'POST', "/api/admin/v1/customers/{$this->customer->id}/rewards/adjust", ['points' => 50])->assertStatus(422)->assertJsonValidationErrors('note');
        $this->asAdmin($marketing, 'POST', "/api/admin/v1/customers/{$this->customer->id}/rewards/adjust", ['points' => -500, 'note' => 'Oops'])
            ->assertStatus(422)->assertJsonPath('errors.points.0', 'The balance can\'t go below 0 (it is 100 points).');
        $this->asAdmin($marketing, 'POST', "/api/admin/v1/customers/{$this->customer->id}/rewards/adjust", ['points' => 250, 'note' => 'Late delivery'])
            ->assertOk()->assertJsonPath('data.balance', 350)->assertJsonPath('data.value', '3.50')
            ->assertJsonPath('data.transaction.type', 'adjust')->assertJsonPath('data.transaction.points', 250)->assertJsonPath('data.transaction.admin_name', 'Mia');
        $this->assertDatabaseHas('audit_log', ['action' => 'reward_points.adjusted', 'subject_id' => $this->customer->id]);

        // The customer's own page, and the export.
        $this->me('GET', '/api/v1/me/rewards')->assertOk()->assertJsonPath('data.balance', 350)->assertJsonPath('data.enabled', false)
            ->assertJsonPath('data.transactions.0.note', 'Late delivery')->assertJsonPath('meta.total', 1);
        $this->assertArrayNotHasKey('admin_name', $this->me('GET', '/api/v1/me/rewards')->json('data.transactions.0'));
        $this->me('GET', '/api/v1/me')->assertOk()->assertJsonPath('data.reward_points', 350);
        $this->me('GET', '/api/v1/me/export')->assertOk()->assertJsonPath('reward_transactions.0.points', 250)->assertJsonPath('profile.reward_points', 350);

        // Report: issued / spent / outstanding.
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/reports/rewards')->assertOk()
            ->assertJsonPath('data.totals.adjusted', 250)->assertJsonPath('data.outstanding_points', 350)->assertJsonPath('data.outstanding_value', '3.50');

        // Deleting the account deletes its history.
        $this->me('POST', '/api/v1/me/delete', ['password' => 'Password123', 'confirm' => 'DELETE'])->assertOk();
        $this->assertSame(0, RewardTransaction::count());
    }
}
