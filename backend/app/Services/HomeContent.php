<?php

namespace App\Services;

use App\Http\Controllers\Api\V1\CatalogController;
use App\Models\Product;
use App\Support\Locale;
use Closure;
use Illuminate\Contracts\Validation\DataAwareRule;
use Illuminate\Contracts\Validation\ValidationRule;
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
 *   hero_mode "banner" | "slider"   (what the top of the page shows; the hero is kept in both modes)
 *   slides [up to 8: { id, eyebrow, title, description, primary_cta { label, url } | null,
 *            secondary_cta { label, url } | null, image_url, image_alt, tone, position, is_active, bn }]
 *   slider { autoplay, interval_seconds 3-15 }
 */
class HomeContent
{
    public const KEY = 'home_content';

    public const TONES = ['navy', 'emerald', 'amber', 'rose'];

    public const HERO_MODES = ['banner', 'slider'];

    public const MAX_SLIDES = 8;

    public const SLIDER_DEFAULTS = ['autoplay' => true, 'interval_seconds' => 6];

    public const NO_ACTIVE_SLIDE = 'Add at least one active slide, or show the single banner instead.';

    // A link is an address on this site ("/products", never "//evil.example") or an http(s) one.
    private const LINK = 'regex:#^(/(?!/)\S*|https?://\S+)$#i';

    public function __construct(private Settings $settings) {}

    public function get(): array
    {
        $content = $this->settings->get(self::KEY) ?? [];

        $slider = is_array($content['slider'] ?? null) ? $content['slider'] : [];

        // Content stored before the slider existed has no hero_mode / slides / slider: the single banner, no slides.
        return [
            'hero_mode' => in_array($content['hero_mode'] ?? null, self::HERO_MODES, true) ? $content['hero_mode'] : 'banner',
            'hero' => $content['hero'] ?? null,
            'banners' => $this->sorted($content['banners'] ?? []),
            'slides' => $this->sorted($content['slides'] ?? []),
            'slider' => [
                'autoplay' => (bool) ($slider['autoplay'] ?? self::SLIDER_DEFAULTS['autoplay']),
                'interval_seconds' => (int) ($slider['interval_seconds'] ?? self::SLIDER_DEFAULTS['interval_seconds']),
            ],
            'featured_product_ids' => array_map('intval', $content['featured_product_ids'] ?? []),
        ];
    }

    /** GET /api/v1/home: active banners only, and only products shoppers can buy (in the chosen order). */
    public function forStorefront(): array
    {
        $content = $this->get();

        // Phase 13: in Bangla, the filled fields of each `bn` object replace the English ones; `bn` never goes to the store.
        $bangla = Locale::isBangla();
        $slides = array_values(array_map(fn ($slide) => self::localizeSlide($slide, $bangla),
            array_filter($content['slides'], fn ($slide) => $slide['is_active'] ?? true)));

        return [
            // The page never shows an empty slider: without an active slide it is the single banner.
            'hero_mode' => $content['hero_mode'] === 'slider' && $slides !== [] ? 'slider' : 'banner',
            'hero' => $content['hero'] ? self::localizeHero($content['hero'], $bangla) : null,
            'banners' => array_values(array_map(fn ($banner) => self::localizeBanner($banner, $bangla),
                array_filter($content['banners'], fn ($banner) => $banner['is_active']))),
            'slides' => $slides,
            'slider' => $content['slider'],
            'featured_products' => $this->products($content['featured_product_ids'], Product::forSale()->with(['category', 'brand', ...CatalogController::translationRelations()])),
        ];
    }

    /** Phase 13: the hero in English or Bangla (per field), without its `bn` object. */
    private static function localizeHero(array $hero, bool $bangla): array
    {
        $bn = $bangla && is_array($hero['bn'] ?? null) ? $hero['bn'] : [];
        unset($hero['bn']);
        foreach (['eyebrow', 'title', 'description', 'image_alt'] as $field) {
            if (filled($bn[$field] ?? null)) {
                $hero[$field] = $bn[$field];
            }
        }
        foreach (['primary_cta', 'secondary_cta'] as $cta) {
            if (is_array($hero[$cta] ?? null) && filled($bn["{$cta}_label"] ?? null)) {
                $hero[$cta]['label'] = $bn["{$cta}_label"];
            }
        }
        if (! empty($bn['highlights'])) {
            $hero['highlights'] = $bn['highlights'];
        }

        return $hero;
    }

    /** Phase 13: a banner in English or Bangla (per field), without its `bn` object. */
    private static function localizeBanner(array $banner, bool $bangla): array
    {
        $bn = $bangla && is_array($banner['bn'] ?? null) ? $banner['bn'] : [];
        unset($banner['bn']);
        foreach (['eyebrow', 'title', 'description', 'image_alt'] as $field) {
            if (filled($bn[$field] ?? null)) {
                $banner[$field] = $bn[$field];
            }
        }
        if (is_array($banner['cta'] ?? null) && filled($bn['cta_label'] ?? null)) {
            $banner['cta']['label'] = $bn['cta_label'];
        }

        return $banner;
    }

    /** A slide in English or Bangla (per field), without its `bn` object. */
    private static function localizeSlide(array $slide, bool $bangla): array
    {
        $bn = $bangla && is_array($slide['bn'] ?? null) ? $slide['bn'] : [];
        unset($slide['bn']);
        foreach (['eyebrow', 'title', 'description', 'image_alt'] as $field) {
            if (filled($bn[$field] ?? null)) {
                $slide[$field] = $bn[$field];
            }
        }
        foreach (['primary_cta', 'secondary_cta'] as $cta) {
            if (is_array($slide[$cta] ?? null) && filled($bn["{$cta}_label"] ?? null)) {
                $slide[$cta]['label'] = $bn["{$cta}_label"];
            }
        }

        return $slide;
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
            // Phase 13: the Bangla texts (all optional; empty = English is shown).
            'hero.bn' => ['nullable', 'array:eyebrow,title,description,primary_cta_label,secondary_cta_label,image_alt,highlights'],
            'hero.bn.eyebrow' => $text(60),
            'hero.bn.title' => $text(120),
            'hero.bn.description' => $text(300),
            'hero.bn.primary_cta_label' => $text(40),
            'hero.bn.secondary_cta_label' => $text(40),
            'hero.bn.image_alt' => $text(160),
            'hero.bn.highlights' => ['nullable', 'array', 'max:3'],
            'hero.bn.highlights.*' => ['nullable', 'string', 'max:60'],
            'banners.*.bn' => ['nullable', 'array:eyebrow,title,description,cta_label,image_alt'],
            'banners.*.bn.eyebrow' => $text(60),
            'banners.*.bn.title' => $text(120),
            'banners.*.bn.description' => $text(300),
            'banners.*.bn.cta_label' => $text(40),
            'banners.*.bn.image_alt' => $text(160),

            'featured_product_ids' => ['present', 'array', 'max:8'],
            'featured_product_ids.*' => ['integer', 'distinct', Rule::exists('products', 'id')->whereNull('deleted_at')],

            // The slider (all optional on PUT: missing = the single banner, no slides, default settings).
            'hero_mode' => ['nullable', 'string', Rule::in(self::HERO_MODES)],
            'slides' => ['nullable', 'array', 'max:'.self::MAX_SLIDES, 'required_if:hero_mode,slider', new class implements DataAwareRule, ValidationRule
            {
                private array $data = [];

                public function setData(array $data): static
                {
                    $this->data = $data;

                    return $this;
                }

                public function validate(string $attribute, mixed $value, Closure $fail): void
                {
                    if (($this->data['hero_mode'] ?? null) !== 'slider' || ! is_array($value)) {
                        return;
                    }
                    $active = collect($value)->contains(fn ($slide) => is_array($slide) && ! in_array($slide['is_active'] ?? true, [false, 0, '0', 'false'], true));
                    if (! $active) {
                        $fail(HomeContent::NO_ACTIVE_SLIDE);
                    }
                }
            }],
            'slides.*' => ['array'],
            'slides.*.id' => ['nullable', 'string', 'max:60', 'regex:/^[a-z0-9]+(?:-[a-z0-9]+)*$/', 'distinct'],
            'slides.*.eyebrow' => $text(60),
            'slides.*.title' => ['required', 'string', 'max:120'],
            'slides.*.description' => $text(300),
            ...$cta('slides.*.primary_cta'),
            ...$cta('slides.*.secondary_cta'),
            'slides.*.image_url' => ['nullable', 'string', 'max:2048', 'url:http,https'],
            'slides.*.image_alt' => $text(160),
            'slides.*.tone' => ['nullable', Rule::in(self::TONES)],
            'slides.*.position' => ['nullable', 'integer', 'min:0', 'max:1000'],
            'slides.*.is_active' => ['nullable', 'boolean'],
            'slides.*.bn' => ['nullable', 'array:eyebrow,title,description,primary_cta_label,secondary_cta_label,image_alt'],
            'slides.*.bn.eyebrow' => $text(60),
            'slides.*.bn.title' => $text(120),
            'slides.*.bn.description' => $text(300),
            'slides.*.bn.primary_cta_label' => $text(40),
            'slides.*.bn.secondary_cta_label' => $text(40),
            'slides.*.bn.image_alt' => $text(160),
            'slider' => ['nullable', 'array'],
            'slider.autoplay' => ['nullable', 'boolean'],
            'slider.interval_seconds' => ['nullable', 'integer', 'between:3,15'],
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
            'hero_mode.in' => 'Choose what the top of the home page shows: banner or slider.',
            'slides.max' => 'The slider has at most 8 slides.',
            'slides.required_if' => self::NO_ACTIVE_SLIDE,
            'slides.*.primary_cta.url.regex' => 'A link must start with / (a page of this shop) or https://.',
            'slides.*.secondary_cta.url.regex' => 'A link must start with / (a page of this shop) or https://.',
            'slides.*.tone.in' => 'Choose a color: navy, emerald, amber, or rose.',
            'slides.*.id.regex' => 'A slide id has only lower-case letters, digits, and dashes.',
            'slider.interval_seconds.between' => 'Show each slide for 3 to 15 seconds.',
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
                'bn' => self::banglaFields($banner['bn'] ?? null, ['eyebrow', 'title', 'description', 'cta_label', 'image_alt']), // phase 13
            ];
        }
        // Renumber 0, 1, 2... in the sorted order, so positions never have gaps or ties.
        $sorted = $this->sorted($banners);
        $banners = array_map(fn ($banner, $position) => [...$banner, 'position' => $position], $sorted, array_keys($sorted));

        $slides = [];
        foreach (array_values($data['slides'] ?? []) as $index => $slide) {
            $slides[] = [
                'id' => filled($slide['id'] ?? null) ? $slide['id'] : 'slide-'.Str::lower(Str::random(8)),
                'eyebrow' => $text($slide['eyebrow'] ?? null),
                'title' => trim($slide['title']),
                'description' => $text($slide['description'] ?? null),
                'primary_cta' => $cta($slide['primary_cta'] ?? null),
                'secondary_cta' => $cta($slide['secondary_cta'] ?? null),
                'image_url' => $text($slide['image_url'] ?? null),
                'image_alt' => $text($slide['image_alt'] ?? null),
                'tone' => $slide['tone'] ?? 'navy',
                'position' => (int) ($slide['position'] ?? $index),
                'is_active' => (bool) ($slide['is_active'] ?? true),
                'bn' => self::banglaFields($slide['bn'] ?? null, ['eyebrow', 'title', 'description', 'primary_cta_label', 'secondary_cta_label', 'image_alt']),
            ];
        }
        $sorted = $this->sorted($slides);
        $slides = array_map(fn ($slide, $position) => [...$slide, 'position' => $position], $sorted, array_keys($sorted));
        $slider = $data['slider'] ?? [];

        return [
            'hero_mode' => $data['hero_mode'] ?? 'banner',
            'hero' => [
                'eyebrow' => $text($hero['eyebrow'] ?? null),
                'title' => trim($hero['title']),
                'description' => $text($hero['description'] ?? null),
                'primary_cta' => $cta($hero['primary_cta'] ?? null),
                'secondary_cta' => $cta($hero['secondary_cta'] ?? null),
                'image_url' => $text($hero['image_url'] ?? null),
                'image_alt' => $text($hero['image_alt'] ?? null),
                'highlights' => array_values(array_map('trim', $hero['highlights'] ?? [])),
                'bn' => self::banglaFields($hero['bn'] ?? null, ['eyebrow', 'title', 'description', 'primary_cta_label', 'secondary_cta_label', 'image_alt'], true), // phase 13
            ],
            'banners' => $banners,
            'slides' => $slides,
            'slider' => [
                'autoplay' => (bool) ($slider['autoplay'] ?? self::SLIDER_DEFAULTS['autoplay']),
                'interval_seconds' => (int) ($slider['interval_seconds'] ?? self::SLIDER_DEFAULTS['interval_seconds']),
            ],
            'featured_product_ids' => array_values(array_map('intval', $data['featured_product_ids'])),
        ];
    }

    /** Phase 13: a stored `bn` object (trimmed, empty fields null), or null when nothing is filled. */
    private static function banglaFields(mixed $input, array $fields, bool $highlights = false): ?array
    {
        if (! is_array($input)) {
            return null;
        }
        $out = [];
        foreach ($fields as $field) {
            $out[$field] = is_string($input[$field] ?? null) && trim($input[$field]) !== '' ? trim($input[$field]) : null;
        }
        if ($highlights) {
            $out['highlights'] = array_values(array_filter(array_map(fn ($h) => is_string($h) ? trim($h) : '', $input['highlights'] ?? []), fn ($h) => $h !== ''));
        }

        return array_filter($out, fn ($value) => $value !== null && $value !== []) === [] ? null : $out;
    }

    /** By position; equal positions keep the order they were sent in. */
    private function sorted(array $banners): array
    {
        $indexed = array_map(fn ($banner, $i) => [$banner, $i], $banners, array_keys($banners));
        usort($indexed, fn ($a, $b) => [$a[0]['position'] ?? 0, $a[1]] <=> [$b[0]['position'] ?? 0, $b[1]]);

        return array_map(fn ($pair) => $pair[0], $indexed);
    }
}
