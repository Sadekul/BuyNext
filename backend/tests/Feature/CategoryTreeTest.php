<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\AuditLog;
use App\Models\Category;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 5: categories as a tree (at most 3 levels), visibility, and subcategory listings. */
class CategoryTreeTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private array $admin;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->admin = $this->adminHeaders();
    }

    private function category(array $attributes = []): Category
    {
        return Category::factory()->create($attributes);
    }

    public function test_staff_build_a_tree_and_read_it_back(): void
    {
        $electronics = $this->asAdmin($this->admin, 'POST', '/api/admin/v1/categories', [
            'name' => 'Electronics', 'description' => 'Gadgets.', 'meta_title' => 'Electronics | BuyNest',
        ])->assertCreated()
            ->assertJsonPath('data.slug', 'electronics')
            ->assertJsonPath('data.parent_id', null)
            ->assertJsonPath('data.is_active', true)
            ->assertJsonPath('data.children', [])
            ->json('data.id');
        $phones = $this->asAdmin($this->admin, 'POST', '/api/admin/v1/categories', ['name' => 'Phones', 'slug' => 'phones', 'parent_id' => $electronics])
            ->assertCreated()->assertJsonPath('data.parent_id', $electronics)->assertJsonPath('data.position', 0)->json('data.id');
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/categories', ['name' => 'Cases', 'parent_id' => $phones])->assertCreated();
        $this->product(['category_id' => $phones]);

        $tree = $this->asAdmin($this->admin, 'GET', '/api/admin/v1/categories')->assertOk()->json('data');
        $this->assertCount(1, $tree);
        $this->assertSame(['id', 'name', 'slug', 'parent_id', 'position', 'is_active', 'image_url', 'description', 'meta_title', 'meta_description',
            'product_count', 'translations', 'bangla', 'children'], array_keys($tree[0])); // phase 13: translations, bangla
        $this->assertSame('Gadgets.', $tree[0]['description']);
        $this->assertSame(0, $tree[0]['product_count']); // direct products only
        $this->assertSame('phones', $tree[0]['children'][0]['slug']);
        $this->assertSame(1, $tree[0]['children'][0]['product_count']);
        $this->assertSame('cases', $tree[0]['children'][0]['children'][0]['slug']);

        $this->assertSame(3, AuditLog::where('action', 'category.created')->count());
    }

    public function test_slugs_are_unique_and_lower_case(): void
    {
        $this->category(['slug' => 'beauty']);

        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/categories', ['name' => 'Beauty', 'slug' => 'beauty'])->assertJsonValidationErrors('slug');
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/categories', ['name' => 'Make up', 'slug' => 'Make Up'])->assertJsonValidationErrors('slug');
        // No slug: one is made from the name, unique.
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/categories', ['name' => 'Beauty'])->assertCreated()->assertJsonPath('data.slug', 'beauty-2');
    }

    public function test_depth_is_at_most_three_levels(): void
    {
        $top = $this->category();
        $child = $this->category(['parent_id' => $top->id]);
        $grandchild = $this->category(['parent_id' => $child->id]);

        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/categories', ['name' => 'Too deep', 'parent_id' => $grandchild->id])
            ->assertJsonValidationErrors(['parent_id' => 'at most 3 levels']);

        // Moving a 2-level branch under a child would make 4 levels.
        $other = $this->category();
        $otherChild = $this->category(['parent_id' => $other->id]);
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/categories/{$other->id}", ['parent_id' => $child->id])
            ->assertJsonValidationErrors(['parent_id' => 'at most 3 levels']);
        // ...but under the top level it fits (3 levels).
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/categories/{$other->id}", ['parent_id' => $top->id])->assertOk()
            ->assertJsonPath('data.parent_id', $top->id)
            ->assertJsonPath('data.children.0.id', $otherChild->id);
    }

    public function test_a_category_cannot_move_under_itself_or_a_descendant(): void
    {
        $top = $this->category();
        $child = $this->category(['parent_id' => $top->id]);

        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/categories/{$top->id}", ['parent_id' => $top->id])
            ->assertJsonValidationErrors(['parent_id' => 'under itself']);
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/categories/{$top->id}", ['parent_id' => $child->id])
            ->assertJsonValidationErrors(['parent_id' => 'under itself']);
        $this->assertNull($top->fresh()->parent_id);
    }

    public function test_edits_are_audited(): void
    {
        $category = $this->category(['name' => 'Old']);

        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/categories/{$category->id}", ['name' => 'New', 'is_active' => false, 'meta_description' => 'Hi'])
            ->assertOk()->assertJsonPath('data.name', 'New')->assertJsonPath('data.is_active', false);

        $entry = AuditLog::where('action', 'category.updated')->sole();
        $this->assertSame(['name' => 'Old', 'is_active' => true, 'meta_description' => null], $entry->changes['before']);
        $this->assertSame(['name' => 'New', 'is_active' => false, 'meta_description' => 'Hi'], $entry->changes['after']);
    }

    public function test_delete_is_refused_while_there_are_children_or_products(): void
    {
        $top = $this->category();
        $child = $this->category(['parent_id' => $top->id]);
        $this->product(['category_id' => $child->id]);
        $this->product(['category_id' => $child->id]);

        $this->asAdmin($this->admin, 'DELETE', "/api/admin/v1/categories/{$top->id}")
            ->assertJsonValidationErrors(['category' => 'This category has 1 subcategory']);
        $this->asAdmin($this->admin, 'DELETE', "/api/admin/v1/categories/{$child->id}")
            ->assertJsonValidationErrors(['category' => 'This category has 2 products']);

        $empty = $this->category();
        $this->asAdmin($this->admin, 'DELETE', "/api/admin/v1/categories/{$empty->id}")->assertNoContent();
        $this->assertModelMissing($empty);
        $this->assertSame(1, AuditLog::where('action', 'category.deleted')->count());
        $this->asAdmin($this->admin, 'DELETE', '/api/admin/v1/categories/999999')->assertNotFound();
    }

    public function test_reorder_sets_positions_among_siblings_only(): void
    {
        $top = $this->category();
        $a = $this->category(['parent_id' => $top->id, 'name' => 'A', 'position' => 0]);
        $b = $this->category(['parent_id' => $top->id, 'name' => 'B', 'position' => 1]);
        $stranger = $this->category();

        $tree = $this->asAdmin($this->admin, 'POST', '/api/admin/v1/categories/reorder', ['parent_id' => $top->id, 'ids' => [$b->id, $a->id]])
            ->assertOk()->json('data');
        $this->assertSame([$b->id, $a->id], array_column(collect($tree)->firstWhere('id', $top->id)['children'], 'id'));
        $this->assertSame([1, 0], [$a->fresh()->position, $b->fresh()->position]);

        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/categories/reorder', ['parent_id' => $top->id, 'ids' => [$a->id, $stranger->id]])
            ->assertJsonValidationErrors('ids.1');
    }

    public function test_storefront_tree_shows_visible_categories_with_products(): void
    {
        $top = $this->category(['slug' => 'electronics', 'name' => 'Electronics']);
        $phones = $this->category(['slug' => 'phones', 'name' => 'Phones', 'parent_id' => $top->id]);
        $hiddenChild = $this->category(['slug' => 'hidden', 'name' => 'Hidden', 'parent_id' => $top->id, 'is_active' => false]);
        $this->category(['slug' => 'empty', 'parent_id' => $top->id]);
        $this->product(['category_id' => $phones->id]);
        $this->product(['category_id' => $hiddenChild->id]);

        $data = $this->getJson('/api/v1/categories')->assertOk()->json('data');
        $this->assertSame(['electronics'], array_column($data, 'slug'));
        $this->assertSame(['phones'], array_column($data[0]['children'], 'slug'));
        $this->assertSame($top->id, $data[0]['children'][0]['parent_id']);
        $this->assertSame([], $data[0]['children'][0]['children']);
    }

    public function test_a_category_lists_its_descendants_products(): void
    {
        $top = $this->category(['slug' => 'electronics']);
        $phones = $this->category(['slug' => 'phones', 'parent_id' => $top->id]);
        $cases = $this->category(['slug' => 'cases', 'parent_id' => $phones->id]);
        $own = $this->product(['category_id' => $top->id]);
        $phone = $this->product(['category_id' => $phones->id]);
        $case = $this->product(['category_id' => $cases->id]);
        $this->product(); // elsewhere

        $ids = fn (string $slug) => collect($this->getJson("/api/v1/products?category={$slug}")->assertOk()->json('data'))->pluck('id')->sort()->values()->all();
        $this->assertSame([$own->id, $phone->id, $case->id], $ids('electronics'));
        $this->assertSame([$phone->id, $case->id], $ids('phones'));
        $this->assertSame([$case->id], $ids('cases'));
        $this->assertSame([], $ids('nope'));
    }

    public function test_products_in_a_hidden_category_are_not_for_sale(): void
    {
        $top = $this->category(['slug' => 'electronics']);
        $phones = $this->category(['slug' => 'phones', 'parent_id' => $top->id]);
        $phone = $this->product(['category_id' => $phones->id, 'name' => 'Pixel Thing']);
        $visible = $this->product();

        // Deactivating the parent hides the child's products too.
        $top->update(['is_active' => false]);

        $this->assertSame([$visible->id], array_column($this->getJson('/api/v1/products')->json('data'), 'id'));
        $this->assertSame([], $this->getJson('/api/v1/products?search=Pixel')->json('data'));
        $this->getJson("/api/v1/products/{$phone->id}")->assertNotFound();
        $this->postJson('/api/v1/cart/validate', ['items' => [['product_id' => $phone->id, 'quantity' => 1]]])->assertOk()
            ->assertJsonPath('data.lines.0.available', false)
            ->assertJsonPath('data.problems.0.code', 'unavailable');
        $this->placeOrder([['product_id' => $phone->id, 'quantity' => 1]])->assertUnprocessable()->assertJsonPath('problems.0.code', 'unavailable');

        // The admin still sees it.
        $this->asAdmin($this->admin, 'GET', "/api/admin/v1/products/{$phone->id}")->assertOk();

        $top->update(['is_active' => true]);
        $this->getJson("/api/v1/products/{$phone->id}")->assertOk();
    }

    public function test_reading_needs_products_view_and_changing_needs_categories_edit(): void
    {
        $category = $this->category();
        $viewer = $this->signInAdmin(Admin::factory()->role(['products.view'])->create());

        $this->asAdmin($viewer, 'GET', '/api/admin/v1/categories')->assertOk();
        foreach ([['POST', '/api/admin/v1/categories'], ['PATCH', "/api/admin/v1/categories/{$category->id}"],
            ['DELETE', "/api/admin/v1/categories/{$category->id}"], ['POST', '/api/admin/v1/categories/reorder']] as [$method, $uri]) {
            $this->asAdmin($viewer, $method, $uri, ['name' => 'X'])->assertForbidden()->assertJsonPath('permission', 'categories.edit');
        }
        $this->assertModelExists($category);
    }
}
