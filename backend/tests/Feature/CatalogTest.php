<?php

namespace Tests\Feature;

use App\Models\Brand;
use App\Models\Category;
use App\Models\Product;
use App\Models\Review;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class CatalogTest extends TestCase
{
    use RefreshDatabase;

    private Category $beauty;

    private Category $phones;

    protected function setUp(): void
    {
        parent::setUp();
        $this->beauty = Category::factory()->create(['slug' => 'beauty', 'name' => 'Beauty', 'position' => 1]);
        $this->phones = Category::factory()->create(['slug' => 'smartphones', 'name' => 'Smartphones', 'position' => 0]);
        $essence = Brand::factory()->create(['name' => 'Essence']);
        $apple = Brand::factory()->create(['name' => 'Apple']);

        Product::factory()->create(['id' => 1, 'name' => 'Essence Mascara Lash Princess', 'category_id' => $this->beauty->id, 'brand_id' => $essence->id,
            'price' => '9.99', 'discount_percent' => '10.48', 'rating_average' => '2.56', 'stock_quantity' => 99, 'min_order_quantity' => 48, 'created_at' => now()->subDays(3)]);
        Product::factory()->create(['id' => 2, 'name' => 'Eyeshadow Palette', 'category_id' => $this->beauty->id, 'brand_id' => null,
            'price' => '19.99', 'discount_percent' => '0.04', 'rating_average' => '4.50', 'stock_quantity' => 5, 'created_at' => now()->subDays(2)]);
        Product::factory()->create(['id' => 3, 'name' => 'iPhone 13 Pro', 'category_id' => $this->phones->id, 'brand_id' => $apple->id,
            'price' => '1099.99', 'discount_percent' => '9.37', 'rating_average' => '4.12', 'stock_quantity' => 0, 'created_at' => now()->subDay()]);
        Product::factory()->draft()->create(['id' => 4, 'name' => 'Secret Draft Phone', 'category_id' => $this->phones->id]);
        Product::factory()->archived()->create(['id' => 5, 'name' => 'Old Archived Phone', 'category_id' => $this->phones->id]);
        Product::factory()->create(['id' => 6, 'name' => 'Deleted Lipstick', 'category_id' => $this->beauty->id])->delete();
    }

    private function ids(string $query = ''): array
    {
        return array_column($this->getJson('/api/v1/products'.$query)->assertOk()->json('data'), 'id');
    }

    public function test_the_list_shows_only_active_products_with_the_contract_fields(): void
    {
        $response = $this->getJson('/api/v1/products')->assertOk()
            ->assertJsonPath('meta.total', 3)->assertJsonPath('meta.per_page', 12)->assertJsonPath('meta.current_page', 1)
            ->assertJsonPath('meta.last_page', 1);

        $this->assertSame([1, 2, 3], array_column($response->json('data'), 'id'));
        $first = $response->json('data.0');
        $this->assertSame('9.99', $first['price']);
        $this->assertSame(10.48, $first['discount_percent']);
        $this->assertSame('8.94', $first['sale_price']);
        $this->assertSame('2.56', $first['rating_average']);
        $this->assertSame(['name' => 'Essence'], $first['brand']);
        $this->assertSame(['slug' => 'beauty', 'name' => 'Beauty'], $first['category']);
        $this->assertSame('in_stock', $first['availability']);
        $this->assertArrayNotHasKey('description', $first);
        $this->assertArrayNotHasKey('reviews', $first);

        // A discount under 0.5% is ignored (like the storefront), and low/out of stock is flagged.
        $this->assertSame('19.99', $response->json('data.1.sale_price'));
        $this->assertSame('low_stock', $response->json('data.1.availability'));
        $this->assertNull($response->json('data.1.brand'));
        $this->assertSame('out_of_stock', $response->json('data.2.availability'));
    }

    public function test_filters(): void
    {
        $this->assertSame([1, 2], $this->ids('?category=beauty'));
        $this->assertSame([3], $this->ids('?brand[]=Apple'));
        $this->assertSame([1, 3], $this->ids('?brand[]=Apple&brand[]=Essence'));
        $this->assertSame([3], $this->ids('?search=iphone'));
        $this->assertSame([3], $this->ids('?search=smartphones')); // category name
        $this->assertSame([1], $this->ids('?search=essence'));     // brand name
        $this->assertSame([], $this->ids('?search=secret'));       // drafts never show
        $this->assertSame([], $this->ids('?search=%25'));          // "%" is a character, not a wildcard
        // On the sale price: the mascara costs 8.94 (not 9.99).
        $this->assertSame([1], $this->ids('?max_price=9'));
        $this->assertSame([2, 3], $this->ids('?min_price=9'));
        $this->assertSame([2, 3], $this->ids('?min_rating=4'));
        // available=1: some stock, and at least the minimum order (product 1 needs 48, has 99).
        $this->assertSame([1, 2], $this->ids('?available=1'));
        $this->assertSame([], $this->ids('?category=nope'));
    }

    public function test_sorting_and_pagination(): void
    {
        $this->assertSame([1, 2, 3], $this->ids('?sort=price'));
        $this->assertSame([3, 2, 1], $this->ids('?sort=price&direction=desc'));
        $this->assertSame([2, 3, 1], $this->ids('?sort=rating'));
        $this->assertSame([1, 3, 2], $this->ids('?sort=discount'));
        $this->assertSame([1, 2, 3], $this->ids('?sort=name'));
        $this->assertSame([3, 2, 1], $this->ids('?sort=newest'));

        $page = $this->getJson('/api/v1/products?per_page=2&page=2')->assertOk();
        $page->assertJsonPath('meta.total', 3)->assertJsonPath('meta.last_page', 2)->assertJsonPath('meta.per_page', 2);
        $this->assertSame([3], array_column($page->json('data'), 'id'));

        $this->getJson('/api/v1/products?per_page=101')->assertJsonValidationErrors('per_page');
        $this->getJson('/api/v1/products?sort=popularity')->assertJsonValidationErrors('sort');
    }

    public function test_product_detail_with_images_and_reviews(): void
    {
        Product::find(1)->images()->create(['url' => 'https://cdn.example.com/1.webp', 'alt' => 'Mascara', 'position' => 0]);
        Review::factory()->create(['product_id' => 1, 'rating' => 3, 'comment' => 'Would not recommend!', 'author_name' => 'Eleanor Collins']);

        $this->getJson('/api/v1/products/1')->assertOk()
            ->assertJsonPath('data.sale_price', '8.94')
            ->assertJsonPath('data.images.0', ['url' => 'https://cdn.example.com/1.webp', 'alt' => 'Mascara'])
            ->assertJsonPath('data.reviews.0.author_name', 'Eleanor Collins')
            ->assertJsonPath('data.reviews.0.rating', 3)
            ->assertJsonStructure(['data' => ['description', 'tags', 'warranty', 'shipping_info', 'return_policy', 'weight', 'min_order_quantity']]);
    }

    public function test_drafts_archived_deleted_and_unknown_products_are_not_found(): void
    {
        foreach ([4, 5, 6, 999] as $id) {
            $this->getJson("/api/v1/products/{$id}")->assertNotFound()->assertExactJson(['message' => 'Product not found.']);
        }
    }

    public function test_categories_list_only_those_with_active_products_in_order(): void
    {
        Category::factory()->create(['slug' => 'empty', 'name' => 'Empty']);
        // Phase 5: each item is a tree node (top level here).
        $node = fn (string $slug, string $name) => ['id' => Category::where('slug', $slug)->value('id'), 'slug' => $slug, 'name' => $name, 'image_url' => null,
            'description' => null, 'meta_title' => null, 'meta_description' => null, 'parent_id' => null, 'children' => []];

        $this->getJson('/api/v1/categories')->assertOk()->assertExactJson(['data' => [
            $node('smartphones', 'Smartphones'),
            $node('beauty', 'Beauty'),
        ]]);
    }

    public function test_the_import_command_keeps_dummyjson_ids_and_is_safe_to_run_twice(): void
    {
        Http::preventStrayRequests();
        Http::fake([
            'dummyjson.com/products/categories' => Http::response([['slug' => 'groceries', 'name' => 'Groceries', 'url' => 'x']]),
            'dummyjson.com/products?limit=0' => Http::response(['products' => [
                ['id' => 16, 'title' => 'Apple', 'description' => 'Fresh.', 'category' => 'groceries', 'price' => 1.99, 'discountPercentage' => 12.62,
                    'rating' => 2.96, 'stock' => 7, 'tags' => ['fruits'], 'sku' => 'GRO-BRD-APP-016', 'weight' => 9,
                    'warrantyInformation' => '3 year warranty', 'shippingInformation' => 'Ships overnight', 'returnPolicy' => 'No return policy',
                    'minimumOrderQuantity' => 2, 'meta' => ['createdAt' => '2025-04-30T09:41:02.053Z'],
                    'images' => ['https://cdn.example.com/apple/1.webp'], 'thumbnail' => 'https://cdn.example.com/apple/thumbnail.webp',
                    'reviews' => [['rating' => 5, 'comment' => 'Great!', 'date' => '2025-04-30T09:41:02.053Z', 'reviewerName' => 'Lucas Gordon']]],
            ]]),
        ]);

        $this->artisan('buynest:import-catalog')->assertSuccessful();
        Product::find(16)->update(['stock_quantity' => 3]); // an order took some
        $this->artisan('buynest:import-catalog')->assertSuccessful();

        $apple = Product::with(['images', 'reviews', 'category'])->find(16);
        $this->assertSame('GRO-BRD-APP-016', $apple->sku);
        $this->assertSame('groceries', $apple->category->slug);
        $this->assertSame(3, $apple->stock_quantity); // the shop's stock survives a re-run
        $this->assertCount(1, $apple->images);
        $this->assertCount(1, $apple->reviews);
        // Phase 5: imported reviews are approved (public), imported images are URLs (no file).
        $this->assertSame('approved', $apple->reviews->first()->status);
        $this->assertNull($apple->images->first()->path);
        $this->assertSame(1, $apple->review_count);
        $this->assertSame('2.96', $apple->rating_average); // DummyJSON's rating is kept
        $this->getJson('/api/v1/products/16')->assertOk()->assertJsonPath('data.sale_price', '1.74')
            ->assertJsonPath('data.reviews.0.author_name', 'Lucas Gordon')->assertJsonPath('data.review_count', 1);

        // An image staff uploaded survives a re-run (and leads the gallery's thumbnail).
        $apple->images()->update(['position' => 1]);
        $apple->images()->create(['url' => '/media/products/16/'.str_repeat('a', 32).'.png', 'path' => 'products/16/'.str_repeat('a', 32).'.png', 'position' => 0]);
        $this->artisan('buynest:import-catalog')->assertSuccessful();
        $this->assertSame(2, $apple->images()->count());
        $this->assertSame('/media/products/16/'.str_repeat('a', 32).'.png', $apple->fresh()->thumbnail_url);

        $this->artisan('buynest:import-catalog', ['--overwrite' => true])->assertSuccessful();
        $this->assertSame(7, $apple->fresh()->stock_quantity);
    }
}
