<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\AdminRole;
use App\Models\AuditLog;
use App\Models\Category;
use App\Models\Product;
use App\Models\ProductImage;
use App\Models\ProductOption;
use App\Models\ProductOptionValue;
use App\Models\ProductVariant;
use Database\Seeders\ConfigurableDemoSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 16: option types and colour swatches, photos per choice, list price ranges and swatches, the demo catalog. */
class ConfigurableProductTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private const EN = ['Accept-Language' => 'en'];

    private const BN = ['Accept-Language' => 'bn'];

    private array $admin;

    private Product $shirt;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = $this->adminHeaders();
        $this->shirt = $this->product(['sku' => 'SHIRT-1', 'name' => 'Shirt', 'price' => '20.00', 'discount_percent' => '0.00', 'stock_quantity' => 10]);
    }

    private function setOptions(array $options, ?Product $product = null)
    {
        return $this->asAdmin($this->admin, 'PUT', '/api/admin/v1/products/'.($product ?? $this->shirt)->id.'/options', ['options' => $options]);
    }

    /** Color (Red #FF0000, Blue #0000FF) × Size (S, M), generated, all active with stock 2 except Blue/M (inactive); Blue/S costs 25.00. */
    private function configure(): void
    {
        $this->setOptions([
            ['name' => 'Color', 'type' => 'color', 'name_bn' => 'রং', 'values' => [
                ['value' => 'Red', 'swatch' => '#ff0000', 'value_bn' => 'লাল'], ['value' => 'Blue', 'swatch' => '#0000FF']]],
            ['name' => 'Size', 'values' => ['S', 'M']],
        ])->assertOk();
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/products/{$this->shirt->id}/variants/generate")->assertOk();
        foreach (ProductVariant::where('product_id', $this->shirt->id)->get() as $variant) {
            $body = ['stock_quantity' => 2, 'is_active' => $variant->sku !== 'SHIRT-1-BLUE-M'];
            if ($variant->sku === 'SHIRT-1-BLUE-S') {
                $body['price'] = '25.00';
            }
            $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/products/{$this->shirt->id}/variants/{$variant->id}", $body)->assertOk();
        }
    }

    private function value(string $value): ProductOptionValue
    {
        return ProductOptionValue::whereHas('option', fn ($q) => $q->where('product_id', $this->shirt->id))->where('value', $value)->sole();
    }

    public function test_option_types_and_swatches_in_the_admin(): void
    {
        $data = $this->setOptions([
            ['name' => 'Color', 'type' => 'color', 'values' => [['value' => 'Red', 'swatch' => '#ff0000'], ['value' => 'Blue', 'swatch' => '#0000FF']]],
            ['name' => 'Size', 'values' => ['S', ['value' => 'M']]],
        ])->assertOk()->json('data');

        $this->assertSame(['id', 'name', 'name_bn', 'code', 'type', 'position', 'values'], array_keys($data['options'][0]));
        $this->assertSame(['id', 'value', 'value_bn', 'code', 'swatch', 'position'], array_keys($data['options'][0]['values'][0]));
        $this->assertSame(['color', 'red'], [$data['options'][0]['code'], $data['options'][0]['values'][0]['code']]);
        $this->assertSame(['color', 'text'], array_column($data['options'], 'type'));
        $this->assertSame(['#FF0000', '#0000FF'], array_column($data['options'][0]['values'], 'swatch')); // stored upper-case
        $this->assertSame([null, null], array_column($data['options'][1]['values'], 'swatch'));
        $redId = $data['options'][0]['values'][0]['id'];

        // Plain strings still work: a kept color value keeps its swatch and its id; type left out keeps the type.
        $again = $this->setOptions([
            ['name' => 'Color', 'values' => ['Red', ['value' => 'Blue', 'swatch' => '#123abc']]],
            ['name' => 'Size', 'values' => ['S', 'M']],
        ])->assertOk()->json('data.options.0');
        $this->assertSame('color', $again['type']);
        $this->assertSame([$redId, '#FF0000'], [$again['values'][0]['id'], $again['values'][0]['swatch']]);
        $this->assertSame('#123ABC', $again['values'][1]['swatch']);

        // Switching to text drops the swatches.
        $text = $this->setOptions([['name' => 'Color', 'type' => 'text', 'values' => ['Red', 'Blue']], ['name' => 'Size', 'values' => ['S', 'M']]])
            ->assertOk()->json('data.options.0');
        $this->assertSame(['text', null], [$text['type'], $text['values'][0]['swatch']]);
        $this->assertSame($redId, $text['values'][0]['id']);

        // The admin detail shows them too; changes are audited.
        $this->asAdmin($this->admin, 'GET', "/api/admin/v1/products/{$this->shirt->id}")->assertOk()->assertJsonPath('data.options.0.type', 'text');
        $this->assertSame(3, AuditLog::where('action', 'product.options_updated')->count());
    }

    public function test_option_type_and_swatch_validation(): void
    {
        $this->setOptions([['name' => 'Color', 'type' => 'pattern', 'values' => ['Red']]])
            ->assertStatus(422)->assertJsonValidationErrors(['options.0.type' => 'Choose "text" (buttons) or "color" (colour swatches).']);
        $this->setOptions([['name' => 'Color', 'type' => 'color', 'values' => [['value' => 'Red', 'swatch' => '#ff00'], ['value' => 'Blue', 'swatch' => 'blue']]]])
            ->assertStatus(422)->assertJsonValidationErrors([
                'options.0.values.0.swatch' => 'Enter the colour as #RRGGBB (for example #1E40AF).',
                'options.0.values.1.swatch' => 'Enter the colour as #RRGGBB (for example #1E40AF).',
            ]);
        // A color value needs a swatch (a new value has none to keep); null is the same.
        $this->setOptions([['name' => 'Color', 'type' => 'color', 'values' => ['Red', ['value' => 'Blue', 'swatch' => null]]]])
            ->assertStatus(422)->assertJsonValidationErrors([
                'options.0.values.0.swatch' => 'Choose a colour for Red.',
                'options.0.values.1.swatch' => 'Choose a colour for Blue.',
            ]);
        // One color option per product.
        $this->setOptions([
            ['name' => 'Color', 'type' => 'color', 'values' => [['value' => 'Red', 'swatch' => '#FF0000']]],
            ['name' => 'Trim', 'type' => 'color', 'values' => [['value' => 'Gold', 'swatch' => '#FFD700']]],
        ])->assertStatus(422)->assertJsonValidationErrors(['options.1.type' => 'Only one option can use colour swatches.']);
        // Phase 5 paths are unchanged for value objects.
        $this->setOptions([['name' => 'Size', 'values' => [['value' => 'S'], ['value' => 's']]]])
            ->assertStatus(422)->assertJsonValidationErrors(['options.0.values.1' => 'Each value can be listed once.']);
        $this->setOptions([['name' => 'Size', 'values' => [['swatch' => '#FFFFFF']]]])
            ->assertStatus(422)->assertJsonValidationErrors('options.0.values.0');
        // A text option ignores swatches sent with it.
        $this->setOptions([['name' => 'Size', 'values' => [['value' => 'S', 'swatch' => 'nope']]]])
            ->assertOk()->assertJsonPath('data.options.0.values.0.swatch', null);
        $this->assertSame(0, ProductOption::where('type', 'color')->count());
    }

    public function test_images_per_choice(): void
    {
        $this->configure();
        $other = $this->product(['sku' => 'OTHER-1']);
        $this->setOptions([['name' => 'Color', 'type' => 'color', 'values' => [['value' => 'Green', 'swatch' => '#00FF00']]]], $other)->assertOk();
        $a = ProductImage::create(['product_id' => $this->shirt->id, 'url' => 'https://cdn.example.com/a.webp', 'alt' => 'A', 'position' => 0]);
        $b = ProductImage::create(['product_id' => $this->shirt->id, 'url' => 'https://cdn.example.com/b.webp', 'alt' => 'B', 'position' => 1]);
        $url = "/api/admin/v1/products/{$this->shirt->id}/images/{$b->id}";
        $blue = $this->value('Blue');

        $images = $this->asAdmin($this->admin, 'PATCH', $url, ['option_value_id' => $blue->id])->assertOk()->json('data');
        $this->assertSame(['id', 'url', 'alt', 'position', 'is_upload', 'variants', 'option_value_id'], array_keys($images[0]));
        $this->assertSame([null, $blue->id], array_column($images, 'option_value_id'));
        $this->assertSame('B', $images[1]['alt']); // alt untouched
        $this->asAdmin($this->admin, 'PATCH', $url, ['alt' => 'Blue back'])->assertOk()->assertJsonPath('data.1.option_value_id', $blue->id);

        // Another product's value, an unknown one, or nothing to change: 422.
        $green = ProductOptionValue::where('value', 'Green')->sole();
        $this->asAdmin($this->admin, 'PATCH', $url, ['option_value_id' => $green->id])
            ->assertStatus(422)->assertJsonValidationErrors(['option_value_id' => 'Choose a value of this product\'s options.']);
        $this->asAdmin($this->admin, 'PATCH', $url, ['option_value_id' => 999999])->assertStatus(422)->assertJsonValidationErrors('option_value_id');
        $this->asAdmin($this->admin, 'PATCH', $url, ['option_value_id' => 'blue'])->assertStatus(422)->assertJsonValidationErrors('option_value_id');
        $this->asAdmin($this->admin, 'PATCH', $url, [])->assertStatus(422)->assertJsonValidationErrors('alt');

        // The store's product page has option types, swatches, and each image's choice.
        $page = $this->getJson("/api/v1/products/{$this->shirt->id}", self::EN)->assertOk()->json('data');
        $this->assertSame(['id', 'name', 'code', 'type', 'values'], array_keys($page['options'][0]));
        $this->assertSame(['color', 'text'], array_column($page['options'], 'type'));
        $this->assertSame(['id' => $blue->id, 'value' => 'Blue', 'code' => 'blue', 'swatch' => '#0000FF'], $page['options'][0]['values'][1]);
        $this->assertSame(['id' => $this->value('S')->id, 'value' => 'S', 'code' => 's', 'swatch' => null], $page['options'][1]['values'][0]);
        // Codes are the same in Bangla (names are translated, codes are not).
        $bnPage = $this->getJson("/api/v1/products/{$this->shirt->id}", self::BN)->assertOk()->json('data.options.0');
        $this->assertSame(['রং', 'color', 'লাল', 'red'], [$bnPage['name'], $bnPage['code'], $bnPage['values'][0]['value'], $bnPage['values'][0]['code']]);
        $this->assertSame([null, $blue->id], array_column($page['images'], 'option_value_id'));

        // null = every choice again; removing the value does the same.
        $this->asAdmin($this->admin, 'PATCH', $url, ['option_value_id' => null])->assertOk()->assertJsonPath('data.1.option_value_id', null);
        $this->asAdmin($this->admin, 'PATCH', $url, ['option_value_id' => $blue->id])->assertOk();
        $this->setOptions([['name' => 'Color', 'values' => ['Red']], ['name' => 'Size', 'values' => ['S', 'M']]])->assertOk();
        $this->assertNull($b->fresh()->option_value_id);
        $this->assertNotNull($a->fresh());
        $this->assertSame(4, AuditLog::where('action', 'product.image_updated')->count());
    }

    public function test_list_items_have_price_ranges_and_swatches(): void
    {
        $this->configure();
        ProductImage::create(['product_id' => $this->shirt->id, 'url' => 'https://cdn.example.com/all.webp', 'alt' => 'All', 'position' => 0]);
        ProductImage::create(['product_id' => $this->shirt->id, 'url' => 'https://cdn.example.com/red-2.webp', 'alt' => 'Red', 'position' => 2,
            'option_value_id' => $this->value('Red')->id]);
        ProductImage::create(['product_id' => $this->shirt->id, 'url' => 'https://cdn.example.com/red-1.webp', 'alt' => 'Red', 'position' => 1,
            'option_value_id' => $this->value('Red')->id]);
        $simple = $this->product(['sku' => 'MUG-1', 'name' => 'Mug', 'price' => '5.00', 'discount_percent' => '0.00']);

        $items = collect($this->getJson('/api/v1/products?per_page=50', self::EN)->assertOk()->json('data'))->keyBy('id');
        $card = $items[$this->shirt->id];
        $this->assertSame(['min' => '20.00', 'max' => '25.00'], $card['price_range']);
        $this->assertSame([
            ['value_id' => $this->value('Red')->id, 'value' => 'Red', 'swatch' => '#FF0000', 'image_url' => 'https://cdn.example.com/red-1.webp'],
            ['value_id' => $this->value('Blue')->id, 'value' => 'Blue', 'swatch' => '#0000FF', 'image_url' => null],
        ], $card['swatches']);
        $this->assertNull($items[$simple->id]['price_range']);
        $this->assertSame([], $items[$simple->id]['swatches']);

        // Bangla value names; only values with an active variant (Blue/S is still active).
        $bn = collect($this->getJson('/api/v1/products?per_page=50', self::BN)->json('data'))->firstWhere('id', $this->shirt->id);
        $this->assertSame(['লাল', 'Blue'], array_column($bn['swatches'], 'value'));
        $blueS = ProductVariant::where('sku', 'SHIRT-1-BLUE-S')->sole();
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/products/{$this->shirt->id}/variants/{$blueS->id}", ['is_active' => false])->assertOk();
        $card = collect($this->getJson('/api/v1/products?per_page=50', self::EN)->json('data'))->firstWhere('id', $this->shirt->id);
        $this->assertSame(['Red'], array_column($card['swatches'], 'value'));
        $this->assertSame(['min' => '20.00', 'max' => '20.00'], $card['price_range']);

        // A discount applies to the range; the product page has the same fields.
        $this->shirt->update(['discount_percent' => '10.00']);
        $this->getJson("/api/v1/products/{$this->shirt->id}", self::EN)->assertOk()
            ->assertJsonPath('data.price_range', ['min' => '18.00', 'max' => '18.00'])->assertJsonPath('data.swatches.0.value', 'Red');
    }

    public function test_listings_load_card_data_without_a_query_per_product(): void
    {
        $this->configure();
        foreach (range(1, 6) as $n) {
            $copy = $this->product(['sku' => "COPY-{$n}"]);
            $this->setOptions([['name' => 'Color', 'type' => 'color', 'values' => [['value' => 'Red', 'swatch' => '#FF0000']]]], $copy)->assertOk();
            $this->asAdmin($this->admin, 'POST', "/api/admin/v1/products/{$copy->id}/variants/generate")->assertOk();
            ProductVariant::where('product_id', $copy->id)->update(['is_active' => true, 'stock_quantity' => 1]);
        }
        $count = function (int $perPage): int {
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->getJson("/api/v1/products?per_page={$perPage}", self::EN)->assertOk();
            $n = count(DB::getQueryLog());
            DB::disableQueryLog();

            return $n;
        };
        $this->assertSame($count(2), $count(8));
    }

    public function test_the_demo_catalog_becomes_configurable_once_and_leaves_staff_products_alone(): void
    {
        $shirts = Category::factory()->create(['slug' => 'mens-shirts']);
        $shirt = $this->product(['sku' => 'MEN-FAS-BLU-083', 'name' => 'Blue & Black Check Shirt', 'category_id' => $shirts->id, 'price' => '29.99', 'discount_percent' => '0.00', 'stock_quantity' => 38]);
        foreach (range(0, 3) as $i) {
            ProductImage::create(['product_id' => $shirt->id, 'url' => "https://cdn.example.com/shirt-{$i}.webp", 'alt' => 'Shirt', 'position' => $i]);
        }
        $phone = $this->product(['sku' => 'SMA-SAM-SAM-133', 'name' => 'Samsung Galaxy S10', 'price' => '699.99', 'discount_percent' => '0.00', 'stock_quantity' => 19]);
        foreach (range(0, 2) as $i) {
            ProductImage::create(['product_id' => $phone->id, 'url' => "https://cdn.example.com/s10-{$i}.webp", 'alt' => 'S10', 'position' => $i]);
        }
        // Staff products: a renamed demo product and one that already has options.
        $renamed = $this->product(['sku' => 'SMA-APP-IPH-123', 'name' => 'Our own phone']);
        $own = $this->product(['sku' => 'LAP-DEL-DEL-082', 'name' => 'New DELL XPS 13 9300 Laptop']);
        $this->setOptions([['name' => 'Finish', 'values' => ['Matte']]], $own)->assertOk();

        (new ConfigurableDemoSeeder)->run();
        (new ConfigurableDemoSeeder)->run();

        $shirt->refresh()->load('options.values', 'variants', 'images');
        $this->assertTrue($shirt->has_variants);
        $this->assertSame(['Color', 'Size'], $shirt->options->pluck('name')->all());
        $this->assertSame(['color', 'text'], $shirt->options->pluck('type')->all());
        $this->assertSame('রং', $shirt->options[0]->translations['bn']['name']);
        $this->assertSame(['নীল', 'কালো', 'ধূসর'], $shirt->options[0]->values->map->translatedValue('bn')->all());
        $this->assertSame(['#1E3A8A', '#111827', '#6B7280'], $shirt->options[0]->values->pluck('swatch')->all());
        $this->assertCount(12, $shirt->variants);
        $this->assertTrue($shirt->variants->every->is_active);
        $this->assertSame(0, ProductVariant::where('sku', 'MEN-FAS-BLU-083-BLACK-S')->value('stock_quantity'));
        $this->assertSame(38, $shirt->stock_quantity); // the stock was split, not added
        $this->assertSame(38, (int) $shirt->variants->sum('stock_quantity'));
        // 4 images, 3 colours: image 0 stays shared, 1-3 go to the colours.
        $this->assertSame([null, ...$shirt->options[0]->values->pluck('id')->all()], $shirt->images->pluck('option_value_id')->all());

        $phone->refresh()->load('options', 'variants', 'images');
        $this->assertSame(['Storage', 'Color'], $phone->options->pluck('name')->all());
        $this->assertCount(9, $phone->variants);
        $this->assertSame([null, '804.99', '944.99'], ProductVariant::whereIn('sku', ['SMA-SAM-SAM-133-128-GB-PRISM-BLACK',
            'SMA-SAM-SAM-133-256-GB-PRISM-BLACK', 'SMA-SAM-SAM-133-512-GB-PRISM-BLACK'])->orderBy('id')->pluck('price')->all());
        $this->assertTrue($phone->images->every(fn ($image) => $image->option_value_id === null)); // 3 images, 3 colours: none per colour

        // Staff products untouched; nothing added twice.
        $this->assertFalse($renamed->fresh()->has_variants);
        $this->assertSame(0, ProductVariant::where('product_id', $renamed->id)->count());
        $this->assertSame(['Finish'], $own->options()->pluck('name')->all());
        $this->assertSame(0, ProductVariant::where('product_id', $own->id)->count());
        $this->assertSame(2, ProductOption::where('product_id', $shirt->id)->count());
        $this->assertSame(21, ProductVariant::count());

        // The store shows the card fields for the demo products.
        $card = collect($this->getJson('/api/v1/products?per_page=50', self::BN)->assertOk()->json('data'))->firstWhere('id', $phone->id);
        $this->assertSame(['min' => '699.99', 'max' => '944.99'], $card['price_range']);
        $this->assertSame(['প্রিজম কালো', 'প্রিজম সাদা', 'প্রিজম নীল'], array_column($card['swatches'], 'value'));
    }

    public function test_category_rules_give_every_other_demo_product_choices(): void
    {
        $cat = fn (string $slug) => Category::factory()->create(['slug' => $slug])->id;
        [$shirts, $phones, $laptops, $watches, $beauty] = [$cat('mens-shirts'), $cat('smartphones'), $cat('laptops'), $cat('womens-watches'), $cat('beauty')];
        $demo = fn (int $id, string $sku, string $name, int $category, int $stock = 40) => $this->product(['id' => $id, 'sku' => $sku, 'name' => $name,
            'category_id' => $category, 'price' => '100.00', 'discount_percent' => '0.00', 'stock_quantity' => $stock]);
        $tee = $demo(84, 'MEN-GIG-GIG-084', 'Gigabyte Aorus Men Tshirt', $shirts);
        $gray = $demo(86, 'MEN-MAN-MAN-086', 'Man Gray Short Sleeve Shirt', $shirts);
        $oppo = $demo(125, 'SMA-OPP-OPP-125', 'Oppo A57', $phones);
        $yoga = $demo(81, 'LAP-LEN-LEN-081', 'Lenovo Yoga 920', $laptops);
        $watch = $demo(194, 'WOM-WOM-WOM-194', "Women's Wrist Watch", $watches);
        $iphoneX = $demo(124, 'SMA-APP-IPH-124', 'iPhone X', $phones);
        $mascara = $demo(1, 'BEA-ESS-ESS-001', 'Essence Mascara', $beauty);
        $staff = $this->product(['sku' => 'OUR-TEE-1', 'name' => 'Our own tee', 'category_id' => $shirts]);

        (new ConfigurableDemoSeeder)->run();
        (new ConfigurableDemoSeeder)->run();

        $optionsOf = fn ($product) => $product->fresh()->options()->with('values')->get()
            ->map(fn ($option) => $option->name.':'.$option->type.':'.$option->values->pluck('value')->implode(','))->all();
        $this->assertSame(['Color:color:White,Black,Navy,Grey', 'Size:text:S,M,L,XL,XXL'], $optionsOf($tee));
        $this->assertSame(['Color:color:Grey,White,Black,Navy', 'Size:text:S,M,L,XL,XXL'], $optionsOf($gray), 'a colour in the name comes first');
        $this->assertSame(['Storage:text:64 GB,128 GB,256 GB', 'Color:color:Black,Silver,Blue,Green'], $optionsOf($oppo));
        $this->assertSame(['RAM:text:8 GB,16 GB,32 GB', 'Storage:text:512 GB,1 TB'], $optionsOf($yoga));
        $this->assertSame(['Color:color:Silver,Gold,Rose Gold'], $optionsOf($watch));
        $this->assertCount(20, $tee->fresh()->variants);
        $this->assertSame(40, $tee->fresh()->stock_quantity, 'the stock is split, not added');
        $this->assertSame(1, ProductVariant::where('product_id', $tee->id)->where('stock_quantity', 0)->count(), 'one sold-out combination');
        $this->assertSame('#F9FAFB', $tee->fresh()->options()->first()->values()->first()->swatch);
        $this->assertSame('সাদা', $tee->fresh()->options()->first()->values()->first()->translatedValue('bn'));
        $this->assertNotNull(ProductVariant::where('product_id', $yoga->id)->where('sku', 'LAP-LEN-LEN-081-32-GB-1-TB')->value('price'));

        // Kept simple: the suites' products, other categories, and staff products.
        foreach ([$iphoneX, $mascara, $staff] as $simple) {
            $this->assertFalse($simple->fresh()->has_variants, $simple->name);
            $this->assertSame(0, $simple->options()->count());
        }
        $this->assertTrue(ConfigurableDemoSeeder::isDemo($tee));
        $this->assertFalse(ConfigurableDemoSeeder::isDemo($staff));
    }

    public function test_viewers_cannot_change_options_or_image_choices(): void
    {
        $this->configure();
        $image = ProductImage::create(['product_id' => $this->shirt->id, 'url' => 'https://cdn.example.com/a.webp', 'alt' => 'A', 'position' => 0]);
        $viewer = $this->signInAdmin(Admin::factory()->create(['role_id' => AdminRole::where('name', 'Viewer')->sole()->id]));

        $this->asAdmin($viewer, 'PUT', "/api/admin/v1/products/{$this->shirt->id}/options", ['options' => []])->assertForbidden();
        $this->asAdmin($viewer, 'PATCH', "/api/admin/v1/products/{$this->shirt->id}/images/{$image->id}", ['option_value_id' => $this->value('Red')->id])
            ->assertForbidden();
        $this->asAdmin($viewer, 'GET', "/api/admin/v1/products/{$this->shirt->id}")->assertOk()
            ->assertJsonPath('data.options.0.type', 'color')->assertJsonPath('data.options.0.values.0.swatch', '#FF0000')
            ->assertJsonPath('data.images.0.option_value_id', null);
        $this->assertNull($image->fresh()->option_value_id);
    }
}
