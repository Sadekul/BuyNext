<?php

namespace Tests\Feature;

use App\Models\Brand;
use App\Models\Category;
use App\Models\Customer;
use App\Models\Order;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

class AdminCatalogTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private array $admin;

    private Category $beauty;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->beauty = Category::factory()->create(['slug' => 'beauty', 'name' => 'Beauty']);
        $this->admin = $this->adminHeaders();
    }

    private function create(array $overrides = []): TestResponse
    {
        return $this->postJson('/api/admin/v1/products', array_merge([
            'name' => 'Blue Mug', 'category' => 'beauty', 'price' => 19.99, 'stock_quantity' => 12,
        ], $overrides), $this->admin);
    }

    public function test_staff_create_a_product(): void
    {
        $response = $this->create([
            'brand' => 'Nest Home', 'description' => 'A mug.', 'discount_percent' => 15, 'images' => ['https://cdn.example.com/mug/1.webp', 'https://cdn.example.com/mug/2.webp'],
        ])->assertCreated();

        $product = Product::sole();
        $response->assertJsonPath('data.id', $product->id)
            ->assertJsonPath('data.price', '19.99')
            ->assertJsonPath('data.sale_price', '16.99')
            ->assertJsonPath('data.status', 'active')
            ->assertJsonPath('data.slug', 'blue-mug')
            ->assertJsonPath('data.brand.name', 'Nest Home')
            ->assertJsonPath('data.sku', 'BEA-NES-BLU-'.str_pad((string) $product->id, 3, '0', STR_PAD_LEFT))
            ->assertJsonPath('data.thumbnail_url', 'https://cdn.example.com/mug/1.webp')
            ->assertJsonCount(2, 'data.images');
        $this->assertSame(1, Brand::where('name', 'Nest Home')->count());

        // Another "Blue Mug" gets its own slug.
        $this->create(['sku' => 'MUG-2'])->assertCreated()->assertJsonPath('data.slug', 'blue-mug-2')->assertJsonPath('data.sku', 'MUG-2');
    }

    public function test_product_validation(): void
    {
        $this->create(['price' => 19.999])->assertJsonValidationErrors(['price' => 'The price can have at most 2 decimal places.']);
        $this->create(['price' => '19.999'])->assertJsonValidationErrors('price');
        $this->create(['price' => -1])->assertJsonValidationErrors('price');
        $this->create(['price' => 1000000.01])->assertJsonValidationErrors('price');
        $this->create(['name' => 'X'])->assertJsonValidationErrors(['name' => 'The name must be at least 2 characters.']);
        $this->create(['name' => str_repeat('a', 121)])->assertJsonValidationErrors('name');
        $this->create(['stock_quantity' => 1.5])->assertJsonValidationErrors('stock_quantity');
        $this->create(['stock_quantity' => 100001])->assertJsonValidationErrors('stock_quantity');
        $this->create(['discount_percent' => 91])->assertJsonValidationErrors(['discount_percent' => 'The discount can be at most 90%.']);
        $this->create(['category' => 'nope'])->assertJsonValidationErrors(['category' => 'Choose a category from the list.']);
        $this->create(['status' => 'hidden'])->assertJsonValidationErrors('status');
        $this->postJson('/api/admin/v1/products', [], $this->admin)->assertJsonValidationErrors(['name', 'category', 'price', 'stock_quantity']);
        $this->assertSame(0, Product::count());

        $this->create(['price' => 19.99])->assertCreated();
        $this->create(['price' => 20])->assertCreated();
    }

    public function test_staff_update_only_the_fields_they_send(): void
    {
        $product = $this->product(['price' => '10.00', 'stock_quantity' => 5, 'category_id' => $this->beauty->id]);
        $other = $this->product(['sku' => 'TAKEN-1']);

        $this->patchJson("/api/admin/v1/products/{$product->id}", ['price' => '12.50'], $this->admin)->assertOk()
            ->assertJsonPath('data.price', '12.50')->assertJsonPath('data.stock_quantity', 5)->assertJsonPath('data.name', $product->name);
        $this->patchJson("/api/admin/v1/products/{$product->id}", ['price' => 12.505], $this->admin)->assertJsonValidationErrors('price');
        $this->patchJson("/api/admin/v1/products/{$product->id}", ['sku' => 'TAKEN-1'], $this->admin)->assertJsonValidationErrors(['sku' => 'Another product already has this SKU.']);
        $this->patchJson("/api/admin/v1/products/{$product->id}", ['sku' => $product->sku, 'stock_quantity' => 0], $this->admin)->assertOk()
            ->assertJsonPath('data.availability', 'out_of_stock');

        // A draft disappears from the store but staff still see it.
        $this->patchJson("/api/admin/v1/products/{$product->id}", ['status' => 'draft'], $this->admin)->assertOk()->assertJsonPath('data.status', 'draft');
        $this->getJson("/api/v1/products/{$product->id}")->assertNotFound();
        $this->getJson("/api/admin/v1/products/{$product->id}", $this->admin)->assertOk();
        $this->patchJson('/api/admin/v1/products/99999', ['price' => 1], $this->admin)->assertNotFound();
        $this->assertSame('TAKEN-1', $other->fresh()->sku);
    }

    public function test_deleting_is_a_soft_delete_and_orders_keep_their_snapshot(): void
    {
        $product = $this->product(['price' => '30.00']);
        $number = $this->placeOrder([['product_id' => $product->id, 'quantity' => 1]])->assertCreated()->json('data.number');

        $this->deleteJson("/api/admin/v1/products/{$product->id}", [], $this->admin)->assertNoContent();

        $this->assertSoftDeleted($product);
        $this->getJson("/api/v1/products/{$product->id}")->assertNotFound();
        $this->getJson("/api/admin/v1/products/{$product->id}", $this->admin)->assertNotFound();
        $this->getJson('/api/admin/v1/products', $this->admin)->assertJsonPath('meta.total', 0);
        $this->getJson("/api/admin/v1/orders/{$number}", $this->admin)->assertOk()
            ->assertJsonPath('data.items.0.name', $product->name)->assertJsonPath('data.items.0.price', '30.00');
    }

    public function test_staff_list_every_status_with_filters_and_sorting(): void
    {
        $this->product(['name' => 'Alpha Cream', 'stock_quantity' => 50, 'category_id' => $this->beauty->id]);
        $this->product(['name' => 'Beta Phone', 'stock_quantity' => 3, 'status' => 'draft']);
        $this->product(['name' => 'Gamma Lamp', 'stock_quantity' => 9, 'status' => 'archived', 'sku' => 'LAMP-77']);

        $all = $this->getJson('/api/admin/v1/products?sort=stock', $this->admin)->assertOk()->assertJsonPath('meta.total', 3);
        $this->assertSame(['Beta Phone', 'Gamma Lamp', 'Alpha Cream'], array_column($all->json('data'), 'name'));
        $this->assertSame(['status', 'created_at', 'updated_at'], array_slice(array_keys($all->json('data.0')), -3));

        $this->getJson('/api/admin/v1/products?status=draft', $this->admin)->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.name', 'Beta Phone');
        $this->getJson('/api/admin/v1/products?search=lamp-77', $this->admin)->assertJsonPath('data.0.name', 'Gamma Lamp');
        $this->getJson('/api/admin/v1/products?category=beauty', $this->admin)->assertJsonPath('meta.total', 1);
        $this->getJson('/api/admin/v1/products?sort=popularity', $this->admin)->assertJsonValidationErrors('sort');

        $this->getJson('/api/admin/v1/categories', $this->admin)->assertOk()
            ->assertJsonFragment(['slug' => 'beauty', 'name' => 'Beauty', 'product_count' => 1, 'id' => $this->beauty->id]);
    }

    public function test_the_overview(): void
    {
        $lamp = $this->product(['price' => '20.00', 'stock_quantity' => 3, 'category_id' => $this->beauty->id]);
        $this->product(['price' => '5.00', 'stock_quantity' => 0, 'status' => 'draft']);
        $this->product(['price' => '1.00', 'stock_quantity' => 100]);
        Customer::factory()->count(2)->create();
        $this->placeOrder([['product_id' => $lamp->id, 'quantity' => 2]])->assertCreated(); // 40.00 + 4.99
        $cancelled = Order::factory()->create(['status' => 'cancelled', 'grand_total' => '99.00']);

        $data = $this->getJson('/api/admin/v1/overview', $this->admin)->assertOk()->json('data');

        $this->assertSame(['total' => 3, 'active' => 2, 'out_of_stock' => 1, 'low_stock' => 1, 'inventory_value' => '120.00'], $data['products']);
        $this->assertSame('44.99', $data['orders']['revenue']);
        $this->assertSame(2, $data['orders']['total']);
        $this->assertSame(2, $data['orders']['units_sold']);
        $this->assertSame('44.99', $data['orders']['average_order']);
        $this->assertSame(['pending_payment' => 0, 'processing' => 1, 'shipped' => 0, 'delivered' => 0, 'cancelled' => 1, 'closed' => 0], $data['orders']['by_status']);
        $this->assertSame(['total' => 2], $data['customers']);
        $this->assertSame(10, $data['low_stock_threshold']);
        $this->assertSame([0, 1], array_column($data['low_stock_products'], 'stock_quantity'));
        $this->assertSame('beauty', $data['low_stock_products'][1]['category']);
        $this->assertSame([$cancelled->number, Order::where('status', 'processing')->value('number')], array_column($data['latest_orders'], 'number'));
        $this->assertSame(['number', 'customer_name', 'email', 'items', 'total', 'currency', 'status', 'placed_at'], array_keys($data['latest_orders'][1]));
        $this->assertSame('Ava Customer', $data['latest_orders'][1]['customer_name']);
        $this->assertSame(2, $data['latest_orders'][1]['items']);
    }
}
