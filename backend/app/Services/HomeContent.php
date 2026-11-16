<?php

namespace App\Services;

use App\Models\Product;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * The home page content: hero, promo banners, and the featured products.
 * Kept as one JSON value (settings key "home_content"), because it is edited
 * and shown as a whole; it shares the settings cache.
 *
 * Shape (also what PUT /api/admin/v1/home takes):
 *   hero { eyebrow, title, description, primary_cta { label, url } | null,
 *          secondary_cta { label, url } | null, image_url, image_alt, highlights [up to 3] }
 *   banners [{ id, eyebrow, title, description, cta { label, url } | null,
 *              image_url, image_alt, tone, position, is_active }]
 *   featured_product_ids [up to 8 product ids]
 */
class HomeContent
{
    public const KEY = 'home_content';

    public const TONES = ['navy', 'emerald', 'amber', 'rose'];

    // A link is an address on this site ("/products", never "//evil.example") or an http(s) one.
    private const LINK = 'regex:#^(/(?!/)\S*|https?://\S+)$#i';

    public function __construct(private Settings $settings) {}

    public function get(): array
    {
        $content = $this->settings->get(self::KEY) ?? [];

        return [
            'hero' => $content['hero'] ?? null,
            'banners' => $this->sorted($content['banners'] ?? []),
            'featured_product_ids' => array_map('intval', $content['featured_product_ids'] ?? []),
        ];
    }

    /** GET /api/v1/home: active banners only, and only products shoppers can buy (in the chosen order). */
    public function forStorefront(): array
    {
        $content = $this->get();

        return [
            'hero' => $content['hero'],
            'banners' => array_values(array_filter($content['banners'], fn ($banner) => $banner['is_active'])),
            'featured_products' => $this->products($content['featured_product_ids'], Product::forSale()->with(['category', 'brand'])),
        ];
    }

    /** Products by id, in the order of $ids (missing ones skipped). */
    public function products(array $ids, $query = null): Collection
    {
        if ($ids === []) {
            return collect();
        }
        $found = ($query ?? Product::query())->whereIn('id', $ids)->get()->keyBy('id');

        return collect($ids)->map(fn ($id) => $found->get($id))->filter()->values();
    }

    public function save(array $content): array
    {
        $this->settings->put([self::KEY => $content]);

        return $this->get();
    }

    /** Validation rules for PUT /api/admin/v1/home (the whole content is replaced). */
    public function rules(): array
    {
        $text = fn (int $max) => ['nullable', 'string', 'max:'.$max];
        $cta = fn (string $prefix) => [
            $prefix => ['nullable', 'array'],
            "{$prefix}.label" => ["required_with:{$prefix}", 'string', 'max:40'],
            "{$prefix}.url" => ["required_with:{$prefix}", 'string', 'max:2048', self::LINK],
        ];

        return [
            'hero' => ['required', 'array'],
            'hero.eyebrow' => $text(60),
            'hero.title' => ['required', 'string', 'max:120'],
            'hero.description' => $text(300),
            ...$cta('hero.primary_cta'),
            ...$cta('hero.secondary_cta'),
            'hero.image_url' => ['nullable', 'string', 'max:2048', 'url:http,https'],
            'hero.image_alt' => $text(160),
            'hero.highlights' => ['nullable', 'array', 'max:3'],
            'hero.highlights.*' => ['required', 'string', 'max:60'],

            'banners' => ['present', 'array', 'max:12'],
            'banners.*.id' => ['nullable', 'string', 'max:60', 'regex:/^[a-z0-9]+(?:-[a-z0-9]+)*$/', 'distinct'],
            'banners.*.eyebrow' => $text(60),
            'banners.*.title' => ['required', 'string', 'max:120'],
            'banners.*.description' => $text(300),
            ...$cta('banners.*.cta'),
            'banners.*.image_url' => ['nullable', 'string', 'max:2048', 'url:http,https'],
            'banners.*.image_alt' => $text(160),
            'banners.*.tone' => ['required', Rule::in(self::TONES)],
            'banners.*.position' => ['nullable', 'integer', 'min:0', 'max:1000'],
            'banners.*.is_active' => ['nullable', 'boolean'],

            'featured_product_ids' => ['present', 'array', 'max:8'],
            'featured_product_ids.*' => ['integer', 'distinct', Rule::exists('products', 'id')->whereNull('deleted_at')],
        ];
    }

    public function messages(): array
    {
        return [
            '*.url.regex' => 'A link must start with / (a page of this shop) or https://.',
            '*.*.url.regex' => 'A link must start with / (a page of this shop) or https://.',
            'banners.*.cta.url.regex' => 'A link must start with / (a page of this shop) or https://.',
            'banners.*.tone.in' => 'Choose a color: navy, emerald, amber, or rose.',
            'banners.*.id.regex' => 'A banner id has only lower-case letters, digits, and dashes.',
            'featured_product_ids.max' => 'Feature at most 8 products.',
            'featured_product_ids.*.exists' => 'This product doesn\'t exist (or was deleted).',
            'hero.highlights.max' => 'The hero has at most 3 highlights.',
        ];
    }

    /** Validated input → the stored shape: every field present, trimmed, banners numbered 0, 1, 2... by position. */
    public function normalize(array $data): array
    {
        $text = fn ($value) => is_string($value) && trim($value) !== '' ? trim($value) : null;
        $cta = fn ($link) => is_array($link) && filled($link['label'] ?? null) ? ['label' => trim($link['label']), 'url' => trim($link['url'])] : null;
        $hero = $data['hero'];

        $banners = [];
        foreach (array_values($data['banners']) as $index => $banner) {
            $banners[] = [
                'id' => filled($banner['id'] ?? null) ? $banner['id'] : 'banner-'.Str::lower(Str::random(8)),
                'eyebrow' => $text($banner['eyebrow'] ?? null),
                'title' => trim($banner['title']),
                'description' => $text($banner['description'] ?? null),
                'cta' => $cta($banner['cta'] ?? null),
                'image_url' => $text($banner['image_url'] ?? null),
                'image_alt' => $text($banner['image_alt'] ?? null),
                'tone' => $banner['tone'],
                'position' => (int) ($banner['position'] ?? $index),
                'is_active' => (bool) ($banner['is_active'] ?? true),
            ];
        }
        // Renumber 0, 1, 2... in the sorted order, so positions never have gaps or ties.
        $sorted = $this->sorted($banners);
        $banners = array_map(fn ($banner, $position) => [...$banner, 'position' => $position], $sorted, array_keys($sorted));

        return [
            'hero' => [
                'eyebrow' => $text($hero['eyebrow'] ?? null),
                'title' => trim($hero['title']),
                'description' => $text($hero['description'] ?? null),
                'primary_cta' => $cta($hero['primary_cta'] ?? null),
                'secondary_cta' => $cta($hero['secondary_cta'] ?? null),
                'image_url' => $text($hero['image_url'] ?? null),
                'image_alt' => $text($hero['image_alt'] ?? null),
                'highlights' => array_values(array_map('trim', $hero['highlights'] ?? [])),
            ],
            'banners' => $banners,
            'featured_product_ids' => array_values(array_map('intval', $data['featured_product_ids'])),
        ];
    }

    /** By position; equal positions keep the order they were sent in. */
    private function sorted(array $banners): array
    {
        $indexed = array_map(fn ($banner, $i) => [$banner, $i], $banners, array_keys($banners));
        usort($indexed, fn ($a, $b) => [$a[0]['position'] ?? 0, $a[1]] <=> [$b[0]['position'] ?? 0, $b[1]]);

        return array_map(fn ($pair) => $pair[0], $indexed);
    }
}
