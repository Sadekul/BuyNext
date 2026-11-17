<?php

namespace Tests\Feature;

use App\Jobs\SendStockAlertBatch;
use App\Mail\BackInStockMail;
use App\Models\Admin;
use App\Models\Customer;
use App\Models\Order;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\StockAlert;
use App\Services\StockAlerts;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 9 (part B): "Email me when it's back in stock". */
class StockAlertTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private array $admin;

    private Product $mug;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->admin = $this->adminHeaders();
        $this->mug = $this->product(['sku' => 'MUG-1', 'name' => 'Blue Mug', 'stock_quantity' => 0]);
    }

    private function ask(int $productId, array $body = [], array $headers = [])
    {
        $this->app['auth']->forgetGuards();

        return $this->postJson("/api/v1/products/{$productId}/stock-alerts", $body, $headers);
    }

    private function customerHeaders(Customer $customer): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.$this->postJson('/api/v1/auth/login', ['email' => $customer->email, 'password' => 'Password123'])
            ->assertOk()->json('data.tokens.access_token')];
    }

    private function setStock(Product $product, int $stock)
    {
        return $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/products/{$product->id}", ['stock_quantity' => $stock])->assertOk();
    }

    /** A product with one option (Size: S, M) and both variants active with $stock each. */
    private function tee(int $stock = 0): array
    {
        $tee = $this->product(['sku' => 'TEE-9', 'name' => 'Tee', 'stock_quantity' => 0]);
        $this->asAdmin($this->admin, 'PUT', "/api/admin/v1/products/{$tee->id}/options", ['options' => [['name' => 'Size', 'values' => ['S', 'M']]]])->assertOk();
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/products/{$tee->id}/variants/generate")->assertOk();
        $variants = ProductVariant::where('product_id', $tee->id)->orderBy('id')->get();
        foreach ($variants as $variant) {
            $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/products/{$tee->id}/variants/{$variant->id}", ['stock_quantity' => $stock, 'is_active' => true])->assertOk();
        }

        return [$tee->fresh(), $variants[0]->fresh(), $variants[1]->fresh()];
    }

    public function test_the_answer_is_always_the_same_and_only_one_alert_waits(): void
    {
        $first = $this->ask($this->mug->id, ['email' => 'Ann@Example.com'])->assertStatus(202)->json();
        $again = $this->ask($this->mug->id, ['email' => 'ann@example.com'])->assertStatus(202)->json();

        $this->assertSame($first, $again);
        $this->assertSame(['data' => ['message' => StockAlerts::MESSAGE]], $first);
        $this->assertSame(1, StockAlert::count());
        $alert = StockAlert::sole();
        $this->assertSame('ann@example.com', $alert->email);
        $this->assertNull($alert->notified_at);
        $this->assertSame(64, strlen($alert->token_hash));
    }

    public function test_only_sold_out_products_for_sale_and_valid_requests(): void
    {
        $inStock = $this->product(['stock_quantity' => 5]);
        $this->ask($inStock->id, ['email' => 'a@example.com'])->assertUnprocessable()
            ->assertJsonValidationErrors(['stock' => 'This item is in stock, so you can order it now.']);

        // Below the minimum order quantity counts as sold out.
        $bulk = $this->product(['stock_quantity' => 3, 'min_order_quantity' => 5]);
        $this->ask($bulk->id, ['email' => 'a@example.com'])->assertStatus(202);

        $draft = $this->product(['stock_quantity' => 0, 'status' => 'draft']);
        $this->ask($draft->id, ['email' => 'a@example.com'])->assertNotFound();
        $this->ask(999999, ['email' => 'a@example.com'])->assertNotFound();

        $this->ask($this->mug->id, [])->assertJsonValidationErrors(['email' => 'Enter your email address.']);
        $this->ask($this->mug->id, ['email' => 'not-an-email'])->assertJsonValidationErrors('email');
        $this->ask($this->mug->id, ['email' => 'a@example.com', 'variant_id' => 1])->assertJsonValidationErrors('variant_id');
    }

    public function test_a_signed_in_customer_uses_the_account_email_and_manages_alerts(): void
    {
        $customer = Customer::factory()->create(['email' => 'ava@example.com']);
        $headers = $this->customerHeaders($customer);

        $this->ask($this->mug->id, ['email' => 'someone-else@example.com'], $headers)->assertStatus(202);
        $alert = StockAlert::sole();
        $this->assertSame('ava@example.com', $alert->email);
        $this->assertSame($customer->id, $alert->customer_id);

        // An alert asked as a guest with the same email shows too.
        $other = $this->product(['name' => 'Green Mug', 'stock_quantity' => 0]);
        $this->ask($other->id, ['email' => 'AVA@example.com'])->assertStatus(202);

        $this->app['auth']->forgetGuards();
        $list = $this->getJson('/api/v1/me/stock-alerts', $headers)->assertOk()->json('data');
        $this->assertCount(2, $list);
        $this->assertSame(['id', 'product', 'variant_id', 'variant_label', 'created_at'], array_keys($list[0]));
        $this->assertSame(['id' => $other->id, 'name' => 'Green Mug', 'thumbnail_url' => $other->thumbnail_url], $list[0]['product']);

        $stranger = StockAlert::create(['product_id' => $other->id, 'email' => 'x@example.com', 'token_hash' => str_repeat('a', 64), 'waiting_key' => str_repeat('b', 64)]);
        $this->app['auth']->forgetGuards();
        $this->deleteJson("/api/v1/me/stock-alerts/{$stranger->id}", [], $headers)->assertNotFound();
        $this->app['auth']->forgetGuards();
        $this->deleteJson("/api/v1/me/stock-alerts/{$alert->id}", [], $headers)->assertNoContent();
        $this->assertModelMissing($alert);

        // Part A's account deletion removes them all (by id or email).
        $this->assertSame(1, app(StockAlerts::class)->forgetCustomer($customer));
        $this->assertSame(1, StockAlert::count());
    }

    public function test_a_restock_in_the_admin_emails_each_waiting_alert_once(): void
    {
        $this->ask($this->mug->id, ['email' => 'ann@example.com']);
        $this->ask($this->mug->id, ['email' => 'bob@example.com']);

        $this->setStock($this->mug, 0);
        Mail::assertNothingSent();

        $this->setStock($this->mug, 4);
        Mail::assertSent(BackInStockMail::class, 2);
        Mail::assertSent(BackInStockMail::class, fn (BackInStockMail $mail) => $mail->hasTo('ann@example.com'));
        $this->assertSame(0, StockAlert::whereNull('notified_at')->count());
        $this->assertSame(2, StockAlert::whereNull('waiting_key')->count());

        // More stock, or a later sell-out and restock: never sent again.
        $this->setStock($this->mug, 9);
        $this->setStock($this->mug, 0);
        $this->setStock($this->mug, 3);
        Mail::assertSent(BackInStockMail::class, 2);

        // After the sell-out the same person can ask again.
        $this->setStock($this->mug, 0);
        $this->ask($this->mug->id, ['email' => 'ann@example.com'])->assertStatus(202);
        $this->assertSame(1, StockAlert::whereNull('notified_at')->count());
    }

    public function test_the_email_has_the_product_link_and_a_working_stop_link(): void
    {
        $this->ask($this->mug->id, ['email' => 'ann@example.com']);
        $other = $this->product(['stock_quantity' => 0]);
        $this->ask($other->id, ['email' => 'ann@example.com']);
        $this->ask($other->id, ['email' => 'bob@example.com']);
        $this->setStock($this->mug, 2);

        $mail = null;
        Mail::assertSent(BackInStockMail::class, function (BackInStockMail $sent) use (&$mail) {
            return $mail = $sent;
        });
        $html = $mail->render();
        $this->assertStringContainsString('Blue Mug', $mail->envelope()->subject);
        $this->assertStringContainsString(config('buynest.storefront_url').'/products/'.$this->mug->id, $html);
        $this->assertStringContainsString('Stop these alerts', $html);
        $this->assertSame("<{$mail->unsubscribeUrl}>", $mail->headers()->text['List-Unsubscribe']);

        parse_str(parse_url($mail->unsubscribeUrl, PHP_URL_QUERY), $query);
        $this->postJson('/api/v1/stock-alerts/unsubscribe', ['token' => $query['token'].'x'])->assertJsonValidationErrors('token');
        $this->postJson('/api/v1/stock-alerts/unsubscribe', ['token' => '1.'.str_repeat('a', 40)])->assertJsonValidationErrors('token');
        $this->postJson('/api/v1/stock-alerts/unsubscribe', ['token' => $query['token']])->assertOk()->assertExactJson(['data' => ['removed' => 1]]);
        $this->postJson('/api/v1/stock-alerts/unsubscribe', ['token' => $query['token']])->assertOk()->assertExactJson(['data' => ['removed' => 0]]);
        // Bob's alert for the other product still waits.
        $this->assertSame(['bob@example.com'], StockAlert::whereNull('notified_at')->pluck('email')->all());
    }

    public function test_bulk_set_stock_and_import_send_alerts(): void
    {
        $this->ask($this->mug->id, ['email' => 'ann@example.com']);
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/products/bulk', ['ids' => [$this->mug->id], 'action' => 'set_stock', 'value' => 7])->assertOk();
        Mail::assertSent(BackInStockMail::class, 1);

        $plate = $this->product(['sku' => 'PLATE-1', 'name' => 'Plate', 'stock_quantity' => 0]);
        $this->ask($plate->id, ['email' => 'bob@example.com']);
        $csv = "sku,name,stock_quantity\nPLATE-1,Plate,12\n";
        $this->app['auth']->forgetGuards();
        $this->post('/api/admin/v1/products/import', ['file' => UploadedFile::fake()->createWithContent('p.csv', $csv), 'dry_run' => '0'],
            [...$this->admin, 'Accept' => 'application/json'])->assertOk();
        $this->assertSame(12, $plate->fresh()->stock_quantity);
        Mail::assertSent(BackInStockMail::class, fn ($mail) => $mail->hasTo('bob@example.com'));
    }

    public function test_cancellations_and_refunds_with_restock_send_alerts(): void
    {
        $this->mug->update(['stock_quantity' => 2]);
        $first = $this->placeOrder([['product_id' => $this->mug->id, 'quantity' => 1]])->assertCreated()->json('data.number');
        $second = $this->placeOrder([['product_id' => $this->mug->id, 'quantity' => 1]], ['email' => 'second@example.com'])->assertCreated()->json('data.number');
        $this->assertSame(0, $this->mug->fresh()->stock_quantity);

        $this->ask($this->mug->id, ['email' => 'ann@example.com'])->assertStatus(202);
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/orders/{$first}", ['status' => 'cancelled', 'notify_customer' => false])->assertOk();
        Mail::assertSent(BackInStockMail::class, fn ($mail) => $mail->hasTo('ann@example.com'));

        // Sold out again; a refund that puts the unit back in stock tells the next person.
        $this->setStock($this->mug, 0);
        $this->ask($this->mug->id, ['email' => 'bob@example.com'])->assertStatus(202);
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$second}/invoices")->assertCreated();
        $item = Order::where('number', $second)->sole()->items[0];
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$second}/credit-memos", [
            'items' => [['order_item_id' => $item->id, 'quantity' => 1]], 'shipping_refund' => '0.00', 'adjustment' => '0.00', 'restock' => true,
        ])->assertCreated();
        $this->assertSame(1, $this->mug->fresh()->stock_quantity);
        Mail::assertSent(BackInStockMail::class, fn ($mail) => $mail->hasTo('bob@example.com'));
    }

    public function test_variant_alerts_follow_their_own_variant(): void
    {
        [$tee, $small, $medium] = $this->tee(0);

        $this->ask($tee->id, ['email' => 'small@example.com', 'variant_id' => $small->id])->assertStatus(202);
        $this->ask($tee->id, ['email' => 'any@example.com'])->assertStatus(202); // every variant sold out
        $this->ask($tee->id, ['email' => 'x@example.com', 'variant_id' => 999999])->assertJsonValidationErrors('variant_id');

        // Medium comes back: the "any variant" alert goes, the Small one waits.
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/products/{$tee->id}/variants/{$medium->id}", ['stock_quantity' => 3])->assertOk();
        Mail::assertSent(BackInStockMail::class, 1);
        Mail::assertSent(BackInStockMail::class, fn ($mail) => $mail->hasTo('any@example.com'));
        $this->ask($tee->id, ['email' => 'late@example.com'])->assertJsonValidationErrors('stock'); // Medium is available
        $this->ask($tee->id, ['email' => 'medium@example.com', 'variant_id' => $medium->id])->assertJsonValidationErrors('stock');

        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/products/{$tee->id}/variants/{$small->id}", ['stock_quantity' => 1])->assertOk();
        Mail::assertSent(BackInStockMail::class, function (BackInStockMail $mail) {
            return $mail->hasTo('small@example.com') && str_contains($mail->render(), '(Size: S)');
        });
        Mail::assertSent(BackInStockMail::class, 2);
    }

    public function test_nothing_is_sent_while_the_product_is_not_for_sale(): void
    {
        $this->ask($this->mug->id, ['email' => 'ann@example.com']);
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/products/{$this->mug->id}", ['status' => 'draft'])->assertOk();
        $this->setStock($this->mug, 5);
        Mail::assertNothingSent();
        $this->assertSame(1, StockAlert::whereNull('notified_at')->count());

        // Back on sale with stock: sent then.
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/products/{$this->mug->id}", ['status' => 'active'])->assertOk();
        Mail::assertSent(BackInStockMail::class, 1);
    }

    public function test_alerts_are_sent_in_queued_batches_of_100(): void
    {
        foreach (range(1, 150) as $n) {
            app(StockAlerts::class)->subscribe($this->mug, null, "person{$n}@example.com", null);
        }
        Bus::fake([SendStockAlertBatch::class]);
        $this->setStock($this->mug, 10);

        Bus::assertDispatchedTimes(SendStockAlertBatch::class, 2);
        Bus::assertDispatched(SendStockAlertBatch::class, fn ($job) => count($job->alertIds) === 100);
        Bus::assertDispatched(SendStockAlertBatch::class, fn ($job) => count($job->alertIds) === 50);

        // A job runs again (or two jobs share an alert): each alert is claimed once.
        $ids = StockAlert::orderBy('id')->limit(3)->pluck('id')->all();
        (new SendStockAlertBatch($ids))->handle(app(StockAlerts::class));
        (new SendStockAlertBatch($ids))->handle(app(StockAlerts::class));
        Mail::assertSent(BackInStockMail::class, 3);
    }

    public function test_the_report_and_the_product_page_count_waiting_alerts(): void
    {
        [$tee, $small] = $this->tee(0);
        $this->ask($tee->id, ['email' => 'a@example.com', 'variant_id' => $small->id]);
        $this->ask($tee->id, ['email' => 'b@example.com', 'variant_id' => $small->id]);
        $this->ask($tee->id, ['email' => 'c@example.com']);
        $this->ask($this->mug->id, ['email' => 'a@example.com']);

        $response = $this->asAdmin($this->admin, 'GET', '/api/admin/v1/reports/stock-alerts')->assertOk();
        $this->assertSame(['total' => 2, 'waiting_total' => 4, 'notified_last_30_days' => 0, 'limit' => 25, 'skip' => 0], $response->json('meta'));
        $first = $response->json('data.0');
        $this->assertSame(['product', 'waiting', 'variants', 'oldest_at', 'newest_at'], array_keys($first));
        $this->assertSame($tee->id, $first['product']['id']);
        $this->assertSame(3, $first['waiting']);
        $this->assertSame([['id' => $small->id, 'sku' => $small->sku, 'label' => 'Size: S', 'stock_quantity' => 0, 'waiting' => 2]], $first['variants']);
        $this->assertSame(1, $response->json('data.1.waiting'));

        $this->asAdmin($this->admin, 'GET', '/api/admin/v1/reports/stock-alerts?q=MUG-1')->assertOk()->assertJsonPath('meta.total', 1);
        $this->asAdmin($this->admin, 'GET', "/api/admin/v1/products/{$tee->id}")->assertOk()->assertJsonPath('data.stock_alerts_waiting', 3);

        $viewer = $this->signInAdmin(Admin::factory()->role(['products.view'])->create());
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/reports/stock-alerts')->assertForbidden();
    }

    public function test_asking_is_rate_limited_per_email(): void
    {
        $products = collect(range(1, 6))->map(fn () => $this->product(['stock_quantity' => 0]));
        foreach ($products->take(5) as $product) {
            $this->ask($product->id, ['email' => 'flood@example.com'])->assertStatus(202);
        }
        $this->ask($products->last()->id, ['email' => 'flood@example.com'])->assertTooManyRequests();
        $this->ask($products->last()->id, ['email' => 'other@example.com'])->assertStatus(202);
    }
}
