<?php

namespace Tests\Feature;

use App\Mail\GiftCardPurchasedMail;
use App\Mail\GiftCardReceivedMail;
use App\Models\Admin;
use App\Models\Category;
use App\Models\GiftCard;
use App\Models\GiftCardTransaction;
use App\Models\Order;
use App\Models\Product;
use App\Services\GiftCards;
use App\Services\Payments\StripeGateway;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/**
 * Phase 10 (part B): gift cards: buying them (a gift card product), paying
 * with them, refunds, and the admin. The normal product: lamp 20.00
 * (+ standard shipping 4.99 = 24.99).
 */
class GiftCardTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private array $admin;

    private Product $lamp;

    private Product $giftCard; // 25 / 50 / 100, or 10–500

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->admin = $this->adminHeaders();
        $this->lamp = $this->product(['price' => '20.00', 'stock_quantity' => 10]);
        $this->giftCard = $this->product(['name' => 'BuyNest Gift Card', 'type' => 'gift_card', 'price' => '0.00', 'stock_quantity' => 0,
            'gift_card_amounts' => ['25.00', '50.00', '100.00'], 'gift_card_min_amount' => '10.00', 'gift_card_max_amount' => '500.00']);
    }

    private function admin(string $method, string $uri, array $body = []): TestResponse
    {
        return $this->asAdmin($this->admin, $method, $uri, $body);
    }

    /** A card with $balance; returns [card, code]. */
    private function card(string $balance = '50.00', array $attributes = []): array
    {
        return app(GiftCards::class)->create((int) round((float) $balance * 100), $attributes);
    }

    private function giftLine(string $amount = '50.00', int $quantity = 1, string $email = 'sam@example.com'): array
    {
        return ['product_id' => $this->giftCard->id, 'quantity' => $quantity,
            'gift_card' => ['amount' => $amount, 'recipient_name' => 'Sam', 'recipient_email' => $email, 'message' => 'Happy birthday!']];
    }

    private function lampLine(int $quantity = 1): array
    {
        return ['product_id' => $this->lamp->id, 'quantity' => $quantity];
    }

    // ---- Gift card products -------------------------------------------------------

    public function test_staff_create_gift_card_products_and_shoppers_see_the_amounts(): void
    {
        $category = Category::factory()->create();
        $this->admin('POST', '/api/admin/v1/products', ['name' => 'E-gift card', 'category' => $category->slug, 'price' => 0,
            'stock_quantity' => 0, 'type' => 'gift_card'])->assertStatus(422)->assertJsonValidationErrors('gift_card_amounts');
        $id = $this->admin('POST', '/api/admin/v1/products', ['name' => 'E-gift card', 'category' => $category->slug, 'price' => 0,
            'stock_quantity' => 0, 'type' => 'gift_card', 'gift_card_amounts' => [100, 25], 'gift_card_min_amount' => 5, 'gift_card_max_amount' => 200,
            'weight' => 0])->assertCreated()->assertJsonPath('data.type', 'gift_card')->json('data.id');

        $this->getJson("/api/v1/products/{$id}")->assertOk()->assertJsonPath('data.type', 'gift_card')
            ->assertJsonPath('data.gift_card', ['amounts' => ['25.00', '100.00'], 'custom' => ['min' => '5.00', 'max' => '200.00']]);
        $this->getJson("/api/v1/products/{$this->lamp->id}")->assertOk()->assertJsonPath('data.type', 'simple')->assertJsonPath('data.gift_card', null);
    }

    public function test_gift_card_lines_cost_the_amount_with_no_discount_tax_or_shipping(): void
    {
        // Product discount, a 10% code, and 19% tax in Germany: none of them touches the gift card line.
        $this->giftCard->update(['discount_percent' => '20.00']);
        $this->admin('PATCH', '/api/admin/v1/settings', ['tax' => ['tax_enabled' => true, 'tax_rates' => [['country' => 'Germany', 'rate' => 19]]]])->assertOk();

        $response = $this->postJson('/api/v1/cart/validate', ['items' => [$this->giftLine('50.00'), $this->lampLine()],
            'coupon_code' => 'NEST10', 'country' => 'Germany'])->assertOk();
        $response->assertJsonPath('data.lines.0.type', 'gift_card')
            ->assertJsonPath('data.lines.0.price', '50.00')->assertJsonPath('data.lines.0.sale_price', '50.00')
            ->assertJsonPath('data.lines.0.discount', '0.00')->assertJsonPath('data.lines.0.requires_shipping', false)
            ->assertJsonPath('data.lines.0.gift_card', ['amount' => '50.00', 'recipient_name' => 'Sam', 'recipient_email' => 'sam@example.com', 'message' => 'Happy birthday!'])
            ->assertJsonPath('data.lines.1.discount', '2.00')
            // Lamp 20 − 2.00 = 18.00 (+ 4.99 shipping: the threshold ignores gift cards) → tax 19% of 22.99 = 4.37.
            ->assertJsonPath('data.totals.subtotal', '70.00')->assertJsonPath('data.totals.discount', '2.00')
            ->assertJsonPath('data.totals.shipping', '4.99')->assertJsonPath('data.totals.tax', '4.37')
            ->assertJsonPath('data.totals.total', '77.36');

        // Only gift cards: nothing to ship.
        $this->postJson('/api/v1/cart/validate', ['items' => [$this->giftLine('25.00', 2)]])->assertOk()
            ->assertJsonPath('data.shipping_required', false)->assertJsonPath('data.shipping_options', [])
            ->assertJsonPath('data.shipping_method', null)->assertJsonPath('data.totals.shipping', '0.00')->assertJsonPath('data.totals.total', '50.00');

        // Amounts outside the choices, and missing details.
        $this->postJson('/api/v1/cart/validate', ['items' => [$this->giftLine('600.00')]])->assertOk()
            ->assertJsonPath('data.problems.0.code', 'gift_card_amount_invalid')->assertJsonPath('data.totals.total', '0.00');
        $this->postJson('/api/v1/cart/validate', ['items' => [['product_id' => $this->giftCard->id, 'quantity' => 1]]])->assertOk()
            ->assertJsonPath('data.problems.0.code', 'gift_card_details_required');
        $this->postJson('/api/v1/cart/validate', ['items' => [['product_id' => $this->giftCard->id, 'quantity' => 1, 'gift_card' => ['amount' => '25']]]])
            ->assertStatus(422)->assertJsonValidationErrors(['items.0.gift_card.recipient_email', 'items.0.gift_card.recipient_name']);
    }

    public function test_cards_are_created_and_emailed_only_when_the_order_is_paid(): void
    {
        $number = $this->placeOrder([$this->giftLine('50.00', 2)], ['shipping_method' => null, 'payment_method' => 'cod'])->assertCreated()
            ->assertJsonPath('data.shipping_method.id', 'none')->assertJsonPath('data.items.0.gift_card.recipient_email', 'sam@example.com')
            ->json('data.number');
        $this->assertSame(0, GiftCard::count());
        $this->assertSame(0, $this->giftCard->fresh()->stock_quantity); // no stock is taken
        Mail::assertNotSent(GiftCardReceivedMail::class);

        $this->admin('POST', "/api/admin/v1/orders/{$number}/invoices")->assertCreated();
        $cards = GiftCard::orderBy('id')->get();
        $this->assertCount(2, $cards);
        $this->assertSame(['50.00', '50.00'], $cards->pluck('balance')->all());
        $this->assertSame('sam@example.com', $cards[0]->recipient_email);
        $this->assertSame(64, strlen($cards[0]->code_hash));

        $codes = [];
        Mail::assertSent(GiftCardReceivedMail::class, function (GiftCardReceivedMail $mail) use (&$codes) {
            $codes[] = $mail->code;

            return $mail->hasTo('sam@example.com');
        });
        $this->assertCount(2, array_unique($codes));
        foreach ($codes as $code) {
            $this->assertMatchesRegularExpression('/^['.GiftCards::ALPHABET.']{16}$/', $code);
            $this->assertNotNull(app(GiftCards::class)->find($code));
        }
        // The buyer's copy never has the code.
        Mail::assertSent(GiftCardPurchasedMail::class, function (GiftCardPurchasedMail $mail) use ($codes) {
            $html = $mail->render();

            return $mail->hasTo('guest@example.com') && ! str_contains($html, $codes[0]) && ! str_contains($html, GiftCards::format($codes[0]))
                && str_contains($html, $mail->card->last4);
        });
        $this->admin('GET', "/api/admin/v1/orders/{$number}")->assertOk()->assertJsonCount(2, 'data.gift_cards_issued')
            ->assertJsonPath('data.gift_cards_issued.0.amount', '50.00')->assertJsonPath('data.gift_cards_issued.0.status', 'active');

        // Invoicing never issues twice.
        app(GiftCards::class)->issueFor(Order::sole());
        $this->assertSame(2, GiftCard::count());
    }

    public function test_a_stripe_payment_issues_the_cards_too(): void
    {
        config(['buynest.stripe.secret_key' => 'sk_test_x', 'buynest.stripe.webhook_secret' => 'whsec_x']);
        Http::fake(['api.stripe.com/*' => Http::response(['id' => 'cs_1', 'url' => 'https://checkout.stripe.com/c/pay/cs_1', 'expires_at' => now()->addHour()->timestamp])]);
        $number = $this->placeOrder([$this->giftLine('25.00')], ['shipping_method' => null, 'payment_method' => 'card'])->assertCreated()->json('data.number');
        $this->assertSame(0, GiftCard::count());

        $payload = json_encode(['id' => 'evt_gc', 'type' => 'checkout.session.completed', 'data' => ['object' => [
            'id' => 'cs_1', 'amount_total' => 2500, 'currency' => 'usd', 'payment_status' => 'paid', 'payment_intent' => 'pi_1',
            'metadata' => ['order_number' => $number],
        ]]]);
        $this->call('POST', '/api/v1/payments/stripe/webhook', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json',
            'HTTP_STRIPE_SIGNATURE' => StripeGateway::signature($payload, 'whsec_x')], $payload)->assertOk()->assertJsonPath('result', 'paid');
        $this->assertSame(1, GiftCard::count());
        Mail::assertSent(GiftCardReceivedMail::class);
    }

    // ---- Checking and redeeming --------------------------------------------------------

    public function test_checking_a_balance_gives_the_same_answer_for_unknown_disabled_and_expired_codes(): void
    {
        [, $code] = $this->card('40.00');
        [$disabled, $disabledCode] = $this->card();
        $disabled->update(['status' => 'disabled']);
        [, $expiredCode] = $this->card('50.00', ['expires_at' => now()->subDay()]);

        $this->postJson('/api/v1/gift-cards/check', ['code' => strtolower(GiftCards::format($code))])->assertOk()
            ->assertJsonPath('data', ['last4' => substr($code, -4), 'balance' => '40.00', 'currency' => 'USD', 'expires_at' => null, 'status' => 'active']);
        $invalid = ['message' => 'This gift card code isn\'t valid.', 'errors' => ['code' => ['This gift card code isn\'t valid.']]];
        foreach (['NOPE-NOPE-NOPE-NOPE', $disabledCode, $expiredCode] as $bad) {
            $this->postJson('/api/v1/gift-cards/check', ['code' => $bad])->assertStatus(422)->assertExactJson($invalid);
        }

        config(['buynest.gift_card_checks_per_minute' => 5]);
        for ($i = 0; $i < 2; $i++) {
            $this->postJson('/api/v1/gift-cards/check', ['code' => $code]);
        }
        $this->postJson('/api/v1/gift-cards/check', ['code' => $code])->assertTooManyRequests();
    }

    public function test_a_card_pays_part_of_an_order_and_cancelling_gives_it_back(): void
    {
        [$card, $code] = $this->card('10.00');

        $this->postJson('/api/v1/cart/validate', ['items' => [$this->lampLine()], 'gift_card_code' => $code])->assertOk()
            ->assertJsonPath('data.gift_card', ['last4' => $card->last4, 'balance' => '10.00', 'applied' => '10.00', 'balance_after' => '0.00', 'expires_at' => null])
            ->assertJsonPath('data.totals.gift_card', '10.00')->assertJsonPath('data.totals.amount_due', '14.99');
        $this->postJson('/api/v1/cart/validate', ['items' => [$this->lampLine()], 'gift_card_code' => 'WRONGCODE'])->assertOk()
            ->assertJsonPath('data.gift_card', null)->assertJsonPath('data.gift_card_error', 'This gift card code isn\'t valid.');

        $order = $this->placeOrder([$this->lampLine()], ['gift_card_code' => $code])->assertCreated()
            ->assertJsonPath('data.totals.total', '24.99')->assertJsonPath('data.totals.gift_card', '10.00')
            ->assertJsonPath('data.totals.amount_due', '14.99')->assertJsonPath('data.gift_card', ['last4' => $card->last4, 'amount' => '10.00'])
            ->assertJsonPath('data.payment_method', 'cod')->assertJsonPath('data.payment_status', 'unpaid');
        $this->assertSame('0.00', $card->fresh()->balance);
        $this->assertSame('-10.00', GiftCardTransaction::where('order_id', Order::sole()->id)->sole()->amount);

        // The empty card is refused now.
        $this->placeOrder([$this->lampLine()], ['gift_card_code' => $code])->assertStatus(422)
            ->assertJsonPath('errors.gift_card_code.0', 'This gift card has no balance left.');

        $this->admin('PATCH', '/api/admin/v1/orders/'.$order->json('data.number'), ['status' => 'cancelled'])->assertOk();
        $this->assertSame('10.00', $card->fresh()->balance);
        $this->assertSame(['-10.00', '10.00'], GiftCardTransaction::where('order_id', Order::sole()->id)->orderBy('id')->pluck('amount')->all());
    }

    public function test_a_card_covering_everything_pays_the_order_with_no_other_payment(): void
    {
        [$card, $code] = $this->card('100.00');

        $this->placeOrder([$this->lampLine()], ['payment_method' => 'gift_card'])->assertStatus(422)
            ->assertJsonPath('errors.payment_method.0', 'Enter your gift card code, or choose another payment method.');
        [, $small] = $this->card('5.00');
        $this->placeOrder([$this->lampLine()], ['payment_method' => 'gift_card', 'gift_card_code' => $small])->assertStatus(422)
            ->assertJsonPath('errors.payment_method.0', 'Your gift card doesn\'t cover the whole total. Choose how to pay the rest.');

        $number = $this->placeOrder([$this->lampLine()], ['payment_method' => 'gift_card', 'gift_card_code' => $code])->assertCreated()
            ->assertJsonPath('data.payment_method', 'gift_card')->assertJsonPath('data.payment_status', 'paid')
            ->assertJsonPath('data.status', 'processing')->assertJsonPath('data.totals.amount_due', '0.00')
            ->assertJsonPath('data.payment.provider', 'gift_card')->json('data.number');
        $this->assertSame('75.01', $card->fresh()->balance);
        $this->assertStringContainsString("Paid with gift card ••••{$card->last4}.", Order::sole()->history()->reorder('id', 'desc')->value('note'));

        // Any method sent is replaced when the card covers it all (no Stripe page for nothing).
        $this->placeOrder([$this->lampLine()], ['payment_method' => 'card', 'gift_card_code' => $code])->assertCreated()
            ->assertJsonPath('data.payment_method', 'gift_card');
        $this->assertSame('50.02', $card->fresh()->balance);
        $this->assertNotNull($number);
    }

    public function test_gift_cards_cant_buy_gift_cards_and_stripe_charges_only_the_rest(): void
    {
        [, $code] = $this->card('100.00');
        $this->postJson('/api/v1/cart/validate', ['items' => [$this->giftLine()], 'gift_card_code' => $code])->assertOk()
            ->assertJsonPath('data.gift_card_error', 'Gift cards can\'t be used to buy other gift cards.');
        // Mixed cart: the card pays the lamp (24.99), not the 50.00 gift card.
        $this->postJson('/api/v1/cart/validate', ['items' => [$this->giftLine(), $this->lampLine()], 'gift_card_code' => $code])->assertOk()
            ->assertJsonPath('data.totals.gift_card', '24.99')->assertJsonPath('data.totals.amount_due', '50.00');

        config(['buynest.stripe.secret_key' => 'sk_test_x']);
        Http::fake(['api.stripe.com/*' => Http::response(['id' => 'cs_1', 'url' => 'https://checkout.stripe.com/c/pay/cs_1', 'expires_at' => now()->addHour()->timestamp])]);
        [, $ten] = $this->card('10.00');
        $this->placeOrder([$this->lampLine()], ['payment_method' => 'card', 'gift_card_code' => $ten])->assertCreated()
            ->assertJsonPath('data.payment.provider', 'stripe');
        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/checkout/sessions')
            && $request['line_items[0][price_data][unit_amount]'] === '1499');
    }

    public function test_refunds_go_back_to_the_gift_card_first(): void
    {
        [$card, $code] = $this->card('10.00');
        $number = $this->placeOrder([$this->lampLine(2)], ['gift_card_code' => $code])->assertCreated()->json('data.number'); // 40 + 4.99 = 44.99
        $this->admin('POST', "/api/admin/v1/orders/{$number}/invoices")->assertCreated();
        $item = Order::sole()->items->first();
        $this->admin('GET', "/api/admin/v1/orders/{$number}/refundable")->assertOk()->assertJsonPath('data.gift_card_refundable', '10.00');

        // One lamp (20.00): 10.00 back to the card, 10.00 by the other method.
        $this->admin('POST', "/api/admin/v1/orders/{$number}/credit-memos", ['items' => [['order_item_id' => $item->id, 'quantity' => 1]]])->assertCreated()
            ->assertJsonPath('data.total', '20.00')->assertJsonPath('data.gift_card_refund', '10.00')->assertJsonPath('data.other_refund', '10.00');
        $this->assertSame('10.00', $card->fresh()->balance);
        $this->admin('GET', "/api/admin/v1/orders/{$number}/refundable")->assertOk()->assertJsonPath('data.gift_card_refundable', '0.00');

        // The rest goes by the other method only.
        $this->admin('POST', "/api/admin/v1/orders/{$number}/credit-memos", ['items' => [['order_item_id' => $item->id, 'quantity' => 1]], 'shipping_refund' => '4.99'])
            ->assertCreated()->assertJsonPath('data.gift_card_refund', '0.00')->assertJsonPath('data.other_refund', '24.99');
        $this->assertSame('10.00', $card->fresh()->balance);
        $this->assertSame('refunded', Order::sole()->payment_status);
    }

    public function test_refunding_a_gift_card_purchase_disables_unused_cards(): void
    {
        $number = $this->placeOrder([$this->giftLine('25.00', 2)], ['shipping_method' => null])->assertCreated()->json('data.number');
        $this->admin('POST', "/api/admin/v1/orders/{$number}/invoices")->assertCreated();
        $item = Order::sole()->items->first();
        [$first, $second] = GiftCard::orderBy('id')->get()->all();
        $second->update(['balance' => '20.00']); // someone spent 5.00 of it

        $this->admin('POST', "/api/admin/v1/orders/{$number}/credit-memos", ['items' => [['order_item_id' => $item->id, 'quantity' => 2]]])
            ->assertStatus(422)->assertJsonPath('errors', ['items.0.quantity' => ['1 gift card from this line was already used, so it can\'t be refunded.']]);
        $this->assertSame('active', $first->fresh()->status);

        $this->admin('POST', "/api/admin/v1/orders/{$number}/credit-memos", ['items' => [['order_item_id' => $item->id, 'quantity' => 1]]])
            ->assertCreated()->assertJsonPath('data.total', '25.00');
        $this->assertSame('disabled', $first->fresh()->status);
        $this->assertSame('active', $second->fresh()->status);
    }

    // ---- Admin ------------------------------------------------------------------------

    public function test_staff_create_adjust_disable_and_read_cards(): void
    {
        $created = $this->admin('POST', '/api/admin/v1/gift-cards', ['amount' => '30', 'recipient_email' => 'VIP@example.com',
            'recipient_name' => 'Vic', 'message' => 'Sorry for the delay'])->assertCreated()
            ->assertJsonPath('data.balance', '30.00')->assertJsonPath('data.status', 'active')->assertJsonPath('data.recipient_email', 'vip@example.com')
            ->assertJsonPath('data.created_by_admin.name', 'Store Admin');
        $code = $created->json('data.code');
        $this->assertMatchesRegularExpression('/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/', $code);
        $id = $created->json('data.id');
        Mail::assertSent(GiftCardReceivedMail::class, fn ($mail) => $mail->hasTo('vip@example.com') && GiftCards::format($mail->code) === $code);
        // The code is never shown again.
        $this->admin('GET', "/api/admin/v1/gift-cards/{$id}")->assertOk()->assertJsonMissingPath('data.code')
            ->assertJsonPath('data.transactions.0.amount', '30.00');

        $this->admin('POST', "/api/admin/v1/gift-cards/{$id}/adjust", ['amount' => '-40.00', 'note' => 'Too much'])->assertStatus(422)->assertJsonValidationErrors('amount');
        $this->admin('POST', "/api/admin/v1/gift-cards/{$id}/adjust", ['amount' => '-5.50', 'note' => 'Used in store'])->assertOk()
            ->assertJsonPath('data.balance', '24.50')
            ->assertJsonPath('data.transactions.0', fn ($t) => $t['amount'] === '-5.50' && $t['balance_after'] === '24.50' && $t['admin_name'] === 'Store Admin');

        $this->admin('PATCH', "/api/admin/v1/gift-cards/{$id}", ['status' => 'disabled'])->assertOk()->assertJsonPath('data.status', 'disabled');
        $this->postJson('/api/v1/gift-cards/check', ['code' => $code])->assertStatus(422);
        $this->admin('PATCH', "/api/admin/v1/gift-cards/{$id}", ['status' => 'active', 'expires_at' => now()->subMinute()->toIso8601String()])->assertOk()
            ->assertJsonPath('data.status', 'expired');

        $last4 = substr(str_replace('-', '', $code), -4);
        $this->admin('GET', "/api/admin/v1/gift-cards?search={$last4}")->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.last4', $last4);
        $this->admin('GET', '/api/admin/v1/gift-cards?status=expired')->assertOk()->assertJsonPath('meta.total', 1);
        $this->admin('GET', '/api/admin/v1/gift-cards?status=active')->assertOk()->assertJsonPath('meta.total', 0);
        $this->assertDatabaseHas('audit_log', ['action' => 'gift_card.created']);
        $this->assertDatabaseHas('audit_log', ['action' => 'gift_card.adjusted']);

        // Viewer: gift_cards.view only.
        $viewer = $this->signInAdmin(Admin::factory()->role('Viewer')->create());
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/gift-cards')->assertOk();
        $this->asAdmin($viewer, 'POST', '/api/admin/v1/gift-cards', ['amount' => 5])->assertForbidden();
        $marketing = $this->signInAdmin(Admin::factory()->role('Marketing')->create());
        $this->asAdmin($marketing, 'POST', '/api/admin/v1/gift-cards', ['amount' => 5])->assertCreated();
    }

    public function test_the_gift_card_report(): void
    {
        $number = $this->placeOrder([$this->giftLine('25.00', 2)], ['shipping_method' => null])->assertCreated()->json('data.number');
        $this->admin('POST', "/api/admin/v1/orders/{$number}/invoices")->assertCreated();
        $this->admin('POST', '/api/admin/v1/gift-cards', ['amount' => '15.00'])->assertCreated();
        [, $code] = $this->card('10.00');
        $this->placeOrder([$this->lampLine()], ['gift_card_code' => $code])->assertCreated();

        $this->admin('GET', '/api/admin/v1/reports/gift-cards')->assertOk()
            ->assertJsonPath('data.sold', ['count' => 2, 'amount' => '50.00'])
            ->assertJsonPath('data.issued_by_staff', ['count' => 1, 'amount' => '15.00'])
            ->assertJsonPath('data.redeemed', '10.00')
            ->assertJsonPath('data.returned', '0.00')
            ->assertJsonPath('data.outstanding_balance', '65.00')
            ->assertJsonPath('data.active_cards', 4);
    }
}
