<?php

namespace Tests\Feature;

use App\Mail\OrderStatusMail;
use App\Models\Customer;
use App\Models\Order;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\Feature\Concerns\ReadsCodes;
use Tests\TestCase;

class AdminOrderTest extends TestCase
{
    use PlacesOrders, ReadsCodes, RefreshDatabase;

    /** Every admin route added in phase 2 (customer tokens must get 403 on all of them). */
    private const NEW_ADMIN_ROUTES = [
        ['GET', '/api/admin/v1/overview'],
        ['GET', '/api/admin/v1/categories'],
        ['GET', '/api/admin/v1/products'],
        ['POST', '/api/admin/v1/products'],
        ['GET', '/api/admin/v1/products/1'],
        ['PATCH', '/api/admin/v1/products/1'],
        ['DELETE', '/api/admin/v1/products/1'],
        ['GET', '/api/admin/v1/orders'],
        ['GET', '/api/admin/v1/orders/BN-100001'],
        ['PATCH', '/api/admin/v1/orders/BN-100001'],
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

    private function order(string $payment = 'cod', int $quantity = 2): string
    {
        $this->app['auth']->forgetGuards();

        return $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => $quantity]], ['payment_method' => $payment])
            ->assertCreated()->json('data.number');
    }

    private function patchOrder(string $number, array $body)
    {
        $this->app['auth']->forgetGuards();

        return $this->patchJson("/api/admin/v1/orders/{$number}", $body, $this->admin);
    }

    public function test_every_new_admin_route_refuses_customer_tokens(): void
    {
        $customer = Customer::factory()->create();
        $token = $this->postJson('/api/v1/auth/login', ['email' => $customer->email, 'password' => 'Password123'])->json('data.tokens.access_token');

        foreach (self::NEW_ADMIN_ROUTES as [$method, $uri]) {
            $this->app['auth']->forgetGuards();
            $this->json($method, $uri, ['status' => 'cancelled', 'name' => 'Hacked'], $this->bearer($token))->assertForbidden();
            $this->app['auth']->forgetGuards();
            $this->json($method, $uri)->assertUnauthorized();
        }
        $this->assertSame(1, Product::count());
    }

    public function test_staff_list_search_and_read_orders(): void
    {
        $ava = Customer::factory()->create(['first_name' => 'Ava', 'last_name' => 'Rahman', 'email' => 'ava@example.com']);
        $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]], ['email' => null, 'phone' => null],
            $this->bearer($this->postJson('/api/v1/auth/login', ['email' => 'ava@example.com', 'password' => 'Password123'])->json('data.tokens.access_token')))
            ->assertCreated();
        $guest = $this->order('card', 1);

        $list = $this->getJson('/api/admin/v1/orders', $this->admin)->assertOk()->assertJsonPath('meta.total', 2);
        $this->assertSame($guest, $list->json('data.0.number')); // newest first
        $list->assertJsonPath('data.0.customer', null)
            ->assertJsonPath('data.1.customer', ['id' => $ava->id, 'name' => 'Ava Rahman', 'email' => 'ava@example.com']);

        $this->getJson('/api/admin/v1/orders?search=rahman', $this->admin)->assertJsonPath('meta.total', 1);
        $this->getJson('/api/admin/v1/orders?search=ava%20customer', $this->admin)->assertJsonPath('meta.total', 2); // shipping names (guests have no account)
        $this->getJson("/api/admin/v1/orders?search={$guest}", $this->admin)->assertJsonPath('data.0.number', $guest);
        $this->getJson('/api/admin/v1/orders?status=pending_payment', $this->admin)->assertJsonPath('meta.total', 1);
        $this->getJson('/api/admin/v1/orders?payment_status=paid', $this->admin)->assertJsonPath('meta.total', 0);

        $this->getJson("/api/admin/v1/orders/{$guest}", $this->admin)->assertOk()
            ->assertJsonPath('data.id', Order::where('number', $guest)->value('id'))
            ->assertJsonPath('data.history.0.admin_name', null)
            ->assertJsonPath('data.history.0.note', 'Order placed.');
        $this->getJson('/api/admin/v1/orders/BN-1', $this->admin)->assertNotFound();
    }

    public function test_allowed_transitions_and_emails(): void
    {
        $number = $this->order();

        $this->patchOrder($number, ['status' => 'shipped', 'note' => 'Tracking 1Z999'])->assertOk()
            ->assertJsonPath('data.status', 'shipped')
            ->assertJsonPath('data.history.1.admin_name', 'Store Admin')
            ->assertJsonPath('data.history.1.customer_notified', true);
        Mail::assertSent(OrderStatusMail::class, fn ($mail) => $mail->hasTo('guest@example.com') && $mail->order->status === 'shipped' && $mail->note === 'Tracking 1Z999');

        $this->patchOrder($number, ['status' => 'delivered', 'notify_customer' => false, 'note' => 'Left with the neighbour, who was rude.'])->assertOk();
        Mail::assertSentCount(2); // confirmation + shipped, nothing for the silent update

        // The customer sees the shipping note, but not the internal one.
        $this->app['auth']->forgetGuards();
        $history = $this->postJson('/api/v1/orders/lookup', ['number' => $number, 'email' => 'guest@example.com'])->json('data.history');
        $this->assertSame(['processing', 'shipped', 'delivered'], array_column($history, 'status'));
        $this->assertSame(['Order placed.', 'Tracking 1Z999', null], array_column($history, 'note'));
    }

    public function test_disallowed_transitions_are_refused(): void
    {
        $number = $this->order();

        $this->patchOrder($number, ['status' => 'pending_payment'])->assertJsonValidationErrors('status');
        $this->patchOrder($number, ['status' => 'delivered'])->assertJsonValidationErrors('status');
        $this->patchOrder($number, ['status' => 'shipped'])->assertOk();
        $this->patchOrder($number, ['status' => 'cancelled'])->assertJsonValidationErrors(['status' => 'A shipped order can\'t be moved to cancelled. It can go to: delivered.']);
        $this->patchOrder($number, ['status' => 'delivered'])->assertOk();
        $this->patchOrder($number, ['status' => 'processing'])->assertJsonValidationErrors(['status' => 'A delivered order can\'t be changed any more.']);
        $this->patchOrder($number, [])->assertJsonValidationErrors('status');
        $this->patchOrder($number, ['status' => 'lost'])->assertJsonValidationErrors('status');
        $this->patchOrder('BN-1', ['status' => 'shipped'])->assertNotFound();

        $this->assertSame('delivered', Order::sole()->status);
        $this->assertSame(3, Order::sole()->history()->count());
    }

    public function test_cancelling_puts_the_stock_back_once(): void
    {
        $number = $this->order('cod', 3);
        $this->assertSame(7, $this->lamp->fresh()->stock_quantity);
        $this->lamp->delete(); // even a product deleted since gets its stock back

        $this->patchOrder($number, ['status' => 'cancelled'])->assertOk()
            ->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('data.history.1.note', 'Order cancelled; items returned to stock.');
        $this->assertSame(10, Product::withTrashed()->find($this->lamp->id)->stock_quantity);
        Mail::assertSent(OrderStatusMail::class, fn ($mail) => $mail->order->status === 'cancelled');

        $this->patchOrder($number, ['status' => 'cancelled', 'note' => 'again'])->assertOk(); // same status: just a note
        $this->patchOrder($number, ['payment_status' => 'paid'])->assertJsonValidationErrors('payment_status');
        $this->assertSame(10, Product::withTrashed()->find($this->lamp->id)->stock_quantity);
    }

    public function test_marking_a_card_order_paid_starts_processing_it(): void
    {
        $number = $this->order('card');

        $this->patchOrder($number, ['payment_status' => 'paid'])->assertOk()
            ->assertJsonPath('data.status', 'processing')
            ->assertJsonPath('data.payment_status', 'paid')
            ->assertJsonPath('data.history.1.payment_status', 'paid')
            ->assertJsonPath('data.history.1.customer_notified', false);
        Mail::assertNotSent(OrderStatusMail::class);

        // Cash on delivery: paid on delivery, and the status stays where it is.
        $cod = $this->order('cod', 1);
        $this->patchOrder($cod, ['status' => 'shipped'])->assertOk();
        $this->patchOrder($cod, ['status' => 'delivered', 'payment_status' => 'paid'])->assertOk()
            ->assertJsonPath('data.status', 'delivered')->assertJsonPath('data.payment_status', 'paid');
        $this->patchOrder($cod, ['payment_status' => 'unpaid'])->assertJsonValidationErrors('payment_status');
    }
}
