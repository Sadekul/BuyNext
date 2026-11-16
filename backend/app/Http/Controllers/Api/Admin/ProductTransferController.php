<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Brand;
use App\Models\Category;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Services\Audit;
use App\Services\Pricing;
use App\Support\Csv;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Product import and export as CSV (Magento's System → Data Transfer),
 * permission products.import.
 *
 * Columns: sku,name,category_slug,brand,price,discount_percent,stock_quantity,
 * status,description,tags,image_urls (tags and image URLs separated by "|").
 *
 * Import rules: products are matched by sku (update) or created (then
 * category_slug and price are required; status defaults to draft). An empty
 * cell means "leave as it is". Every row is checked first; with any error
 * nothing is saved, whatever dry_run says. Row numbers count the header as
 * row 1, so the first product is row 2 (as a spreadsheet shows it).
 */
class ProductTransferController extends Controller
{
    public const COLUMNS = ['sku', 'name', 'category_slug', 'brand', 'price', 'discount_percent', 'stock_quantity', 'status', 'description', 'tags', 'image_urls'];

    public const MAX_ROWS = 5000;

    public const MAX_KILOBYTES = 2048;

    public function __construct(private Audit $audit) {}

    /** GET /api/admin/v1/products/export.csv - the same filters as the product list. */
    public function export(Request $request): Response
    {
        $data = $request->validate(ProductController::filterRules());

        $rows = [];
        ProductController::filtered($data)->with(['category', 'brand', 'images'])->get()->each(function (Product $product) use (&$rows) {
            $rows[] = [
                $product->sku,
                $product->name,
                $product->category?->slug,
                $product->brand?->name,
                $product->price,
                $product->discount_percent,
                $product->stock_quantity,
                $product->status,
                $product->description,
                implode('|', $product->tags ?? []),
                $product->images->pluck('url')->implode('|'),
            ];
        });

        return Csv::download('products-'.now()->format('Y-m-d').'.csv', self::COLUMNS, $rows);
    }

    /**
     * POST /api/admin/v1/products/import (multipart: file, dry_run = 1 by default)
     * → { data: { dry_run, rows, created, updated, unchanged, errors: [{ row, column, message }] } }
     * A file that can't be read at all (too big, not UTF-8, no rows, too many rows) → 422 on `file`.
     */
    public function import(Request $request): JsonResponse
    {
        $request->validate([
            'file' => ['required', 'file', 'max:'.self::MAX_KILOBYTES],
            'dry_run' => ['nullable', 'in:0,1,true,false'],
        ], [
            'file.required' => 'Choose a CSV file.',
            'file.max' => 'The file can be at most 2 MB.',
            'dry_run.in' => 'dry_run must be true or false.',
        ]);
        $dryRun = $request->has('dry_run') ? filter_var($request->input('dry_run'), FILTER_VALIDATE_BOOLEAN) : true;

        [$header, $rows] = $this->read((string) file_get_contents($request->file('file')->getRealPath()));

        $errors = [];
        $plans = [];
        $columns = $this->columns($header, $errors);
        if ($errors === []) {
            $plans = $this->plan($columns, $rows, $errors);
        }

        $counts = ['created' => 0, 'updated' => 0, 'unchanged' => 0];
        foreach ($plans as $plan) {
            $counts[$plan['action']]++;
        }

        if ($errors === [] && ! $dryRun) {
            DB::transaction(function () use ($plans, $counts, $rows) {
                $slugs = [];
                foreach ($plans as $plan) {
                    $this->apply($plan, $slugs);
                }
                $this->audit->record('product.imported', sprintf('Products imported: %d created, %d updated, %d unchanged.', $counts['created'], $counts['updated'], $counts['unchanged']),
                    'product', null, ['before' => [], 'after' => ['rows' => count($rows), ...$counts]]);
            });
        }

        return response()->json(['data' => [
            'dry_run' => $dryRun,
            'rows' => count($rows),
            ...$counts,
            'errors' => $errors,
        ]]);
    }

    /** [header cells, [row number => cells]]; 422 on `file` when it can't be read as a CSV. */
    private function read(string $contents): array
    {
        if (str_starts_with($contents, "\xEF\xBB\xBF")) {
            $contents = substr($contents, 3);
        }
        if (! mb_check_encoding($contents, 'UTF-8')) {
            throw ValidationException::withMessages(['file' => 'Save the file as CSV UTF-8 and try again.']);
        }
        if (str_contains($contents, "\0")) {
            throw ValidationException::withMessages(['file' => 'This isn\'t a CSV file.']);
        }

        $stream = fopen('php://temp', 'r+');
        fwrite($stream, $contents);
        rewind($stream);
        $header = null;
        $rows = [];
        $line = 0;
        while (($cells = fgetcsv($stream, escape: '')) !== false) {
            $line++;
            if ($cells === [null] || array_filter($cells, fn ($cell) => trim((string) $cell) !== '') === []) {
                continue; // blank line
            }
            if ($header === null) {
                $header = $cells;

                continue;
            }
            $rows[$line] = $cells;
            if (count($rows) > self::MAX_ROWS) {
                fclose($stream);
                throw ValidationException::withMessages(['file' => 'A file can have at most '.number_format(self::MAX_ROWS).' products. Split it into smaller files.']);
            }
        }
        fclose($stream);

        if ($header === null) {
            throw ValidationException::withMessages(['file' => 'The file is empty. The first row must name the columns (sku, name, ...).']);
        }
        if ($rows === []) {
            throw ValidationException::withMessages(['file' => 'The file has a header row but no products.']);
        }

        return [$header, $rows];
    }

    /** column name => cell index; header problems go into $errors (row 1). */
    private function columns(array $header, array &$errors): array
    {
        $columns = [];
        foreach ($header as $index => $name) {
            $name = mb_strtolower(trim((string) $name));
            if ($name === '') {
                continue;
            }
            if (! in_array($name, self::COLUMNS, true)) {
                $errors[] = ['row' => 1, 'column' => $name, 'message' => 'Unknown column. Known columns: '.implode(', ', self::COLUMNS).'.'];
            } elseif (isset($columns[$name])) {
                $errors[] = ['row' => 1, 'column' => $name, 'message' => 'This column appears twice.'];
            } else {
                $columns[$name] = $index;
            }
        }
        foreach (['sku', 'name'] as $required) {
            if (! isset($columns[$required])) {
                $errors[] = ['row' => 1, 'column' => $required, 'message' => "The file needs a {$required} column."];
            }
        }

        return $columns;
    }

    /** Checks every row; returns one plan per row (create, update, or unchanged). */
    private function plan(array $columns, array $rows, array &$errors): array
    {
        $categories = Category::pluck('id', 'slug');
        $skus = array_filter(array_map(fn ($cells) => trim((string) ($cells[$columns['sku']] ?? '')), $rows));
        $existing = Product::withTrashed()->with(['brand', 'images'])->whereIn('sku', $skus)->get()->keyBy('sku');
        $variantSkus = ProductVariant::whereIn('sku', $skus)->pluck('sku')->flip();

        $plans = [];
        $seen = [];
        foreach ($rows as $row => $cells) {
            $error = function (?string $column, string $message) use (&$errors, $row) {
                $errors[] = ['row' => $row, 'column' => $column, 'message' => $message];
            };
            if (count($cells) > max($columns) + 1 && array_filter(array_slice($cells, max($columns) + 1), fn ($c) => trim((string) $c) !== '') !== []) {
                $error(null, 'This row has more cells than the header has columns.');
            }
            // A cell: trimmed text, or null when the column is missing or the cell is empty ("leave as it is").
            $cell = function (string $column) use ($columns, $cells) {
                $value = isset($columns[$column]) ? trim((string) ($cells[$columns[$column]] ?? '')) : '';

                return $value === '' ? null : $value;
            };

            $sku = $cell('sku');
            $name = $cell('name');
            $errorCount = count($errors);
            if ($sku === null) {
                $error('sku', 'The SKU is required.');
            } elseif (! preg_match('/^[A-Za-z0-9-]{1,64}$/', $sku)) {
                $error('sku', 'The SKU can only contain letters, numbers, and dashes (at most 64).');
            } elseif (isset($seen[$sku])) {
                $error('sku', "This SKU is already on row {$seen[$sku]}.");
            } elseif (isset($variantSkus[$sku])) {
                $error('sku', 'A product variant already uses this SKU.');
            }
            if ($sku !== null) {
                $seen[$sku] ??= $row;
            }
            if ($name === null) {
                $error('name', 'The name is required.');
            } elseif (mb_strlen($name) < 2 || mb_strlen($name) > 120) {
                $error('name', 'The name must be 2 to 120 characters.');
            }

            /** @var Product|null $product */
            $product = $sku !== null ? $existing->get($sku) : null;
            if ($product?->trashed()) {
                $error('sku', 'A deleted product has this SKU. Use another SKU.');
            }
            $creating = $product === null;
            $fields = [];

            $slug = $cell('category_slug');
            if ($slug !== null) {
                isset($categories[$slug]) ? $fields['category_id'] = $categories[$slug] : $error('category_slug', "There is no category \"{$slug}\".");
            } elseif ($creating) {
                $error('category_slug', 'A new product needs a category_slug.');
            }

            $brand = $cell('brand');
            if ($brand !== null && mb_strlen($brand) > 80) {
                $error('brand', 'The brand can be at most 80 characters.');
            }

            $price = $cell('price');
            if ($price !== null) {
                preg_match('/^\d{1,7}(\.\d{1,2})?$/', $price) && (float) $price <= 1000000
                    ? $fields['price'] = Pricing::format(Pricing::toCents($price))
                    : $error('price', 'The price must be a number from 0 to 1,000,000 with at most 2 decimals.');
            } elseif ($creating) {
                $error('price', 'A new product needs a price.');
            }

            $discount = $cell('discount_percent');
            if ($discount !== null) {
                preg_match('/^\d{1,2}(\.\d{1,2})?$/', $discount) && (float) $discount <= 90
                    ? $fields['discount_percent'] = Pricing::format(Pricing::toCents($discount))
                    : $error('discount_percent', 'The discount must be a number from 0 to 90 with at most 2 decimals.');
            }

            $stock = $cell('stock_quantity');
            if ($stock !== null) {
                if (! preg_match('/^\d{1,6}$/', $stock) || (int) $stock > 100000) {
                    $error('stock_quantity', 'The stock must be a whole number from 0 to 100,000.');
                } elseif ($product?->has_variants && (int) $stock !== $product->stock_quantity) {
                    $error('stock_quantity', 'This product has variants: set the stock of each variant in the admin.');
                } else {
                    $fields['stock_quantity'] = (int) $stock;
                }
            }

            $status = $cell('status');
            if ($status !== null) {
                in_array(mb_strtolower($status), Product::STATUSES, true)
                    ? $fields['status'] = mb_strtolower($status)
                    : $error('status', 'The status must be draft, active, or archived.');
            }

            $description = $cell('description');
            if ($description !== null) {
                mb_strlen($description) <= 5000 ? $fields['description'] = $description : $error('description', 'The description can be at most 5,000 characters.');
            }

            $tags = $cell('tags');
            if ($tags !== null) {
                $list = array_values(array_unique(array_filter(array_map('trim', explode('|', $tags)), fn ($tag) => $tag !== '')));
                if (count($list) > 30 || array_filter($list, fn ($tag) => mb_strlen($tag) > 40)) {
                    $error('tags', 'At most 30 tags of at most 40 characters each.');
                } else {
                    $fields['tags'] = $list;
                }
            }

            // Only https:// URLs, and only the ones the product doesn't have yet (so an export imports back unchanged).
            $newImages = [];
            $imageUrls = $cell('image_urls');
            if ($imageUrls !== null) {
                $have = $product ? $product->images->pluck('url')->all() : [];
                foreach (array_unique(array_filter(array_map('trim', explode('|', $imageUrls)), fn ($url) => $url !== '')) as $url) {
                    if (in_array($url, $have, true)) {
                        continue;
                    }
                    if (! str_starts_with($url, 'https://') || filter_var($url, FILTER_VALIDATE_URL) === false || strlen($url) > 2048) {
                        $error('image_urls', "Not an https:// image address: {$url}");
                    } else {
                        $newImages[] = $url;
                    }
                }
                if (count($have) + count($newImages) > Product::MAX_IMAGES) {
                    $error('image_urls', 'A product can have at most '.Product::MAX_IMAGES.' images.');
                }
            }

            if (count($errors) > $errorCount) {
                continue;
            }

            if ($creating) {
                $plans[] = ['action' => 'created', 'sku' => $sku, 'name' => $name, 'fields' => $fields, 'brand' => $brand, 'images' => $newImages];

                continue;
            }

            // Only what differs from the product now.
            $changed = [];
            if ($name !== $product->name) {
                $changed['name'] = $name;
            }
            foreach ($fields as $field => $value) {
                $current = $product->{$field};
                $same = match ($field) {
                    'price', 'discount_percent' => Pricing::toCents((string) $current) === Pricing::toCents($value),
                    'tags' => ($current ?? []) === $value,
                    default => (string) $current === (string) $value,
                };
                if (! $same) {
                    $changed[$field] = $value;
                }
            }
            $brandChanged = $brand !== null && $brand !== $product->brand?->name;
            $plans[] = [
                'action' => $changed || $brandChanged || $newImages ? 'updated' : 'unchanged',
                'product' => $product,
                'fields' => $changed,
                'brand' => $brandChanged ? $brand : null,
                'images' => $newImages,
            ];
        }

        return $plans;
    }

    private function apply(array $plan, array &$slugs): void
    {
        if ($plan['action'] === 'unchanged') {
            return;
        }
        $fields = $plan['fields'];
        if ($plan['brand'] !== null) {
            $fields['brand_id'] = Brand::firstOrCreate(['name' => $plan['brand']])->id;
        }

        if ($plan['action'] === 'created') {
            $slug = Product::uniqueSlug($plan['name'], $slugs);
            $slugs[] = $slug;
            $product = new Product([
                'sku' => $plan['sku'],
                'name' => $plan['name'],
                'slug' => $slug,
                'status' => 'draft',
                'discount_percent' => '0.00',
                'stock_quantity' => 0,
                'min_order_quantity' => 1,
            ]);
            $product->forceFill($fields)->save();
        } else {
            $product = $plan['product'];
            $product->forceFill($fields)->save();
        }

        $hadImages = $product->images()->exists();
        $position = (int) $product->images()->max('position') + ($hadImages ? 1 : 0);
        foreach ($plan['images'] as $url) {
            $product->images()->create(['url' => $url, 'alt' => $product->name, 'position' => $position++]);
        }
        if (! $hadImages || ! $product->thumbnail_url) {
            $product->syncThumbnail();
        }
    }
}
