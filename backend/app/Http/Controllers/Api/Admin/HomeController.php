<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Services\Audit;
use App\Services\HomeContent;
use App\Services\Pricing;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** The home page editor: hero or slider (hero_mode), slides and banners (any status, by position), and featured products. */
class HomeController extends Controller
{
    public function __construct(private HomeContent $home, private Audit $audit) {}

    /** GET /api/admin/v1/home */
    public function show(): JsonResponse
    {
        return response()->json(['data' => $this->payload($this->home->get())]);
    }

    /** PUT /api/admin/v1/home { hero_mode?, hero, banners, slides?, slider?, featured_product_ids } - replaces the whole content. */
    public function update(Request $request): JsonResponse
    {
        // A save that leaves out the slider keys (an older client or script) keeps what is stored,
        // instead of resetting them: leaving out `slides` must never delete the slides.
        $stored = $this->home->get();
        $request->merge(collect(['hero_mode', 'slides', 'slider'])
            ->reject(fn (string $key) => $request->exists($key))
            ->mapWithKeys(fn (string $key) => [$key => $stored[$key]])
            ->all());
        $data = $request->validate($this->home->rules(), $this->home->messages());
        $content = $this->home->normalize($data);

        $saved = DB::transaction(function () use ($content) {
            $before = $this->home->get();
            $saved = $this->home->save($content);
            $changes = Audit::diff($before, $saved);
            if ($changes) {
                $this->audit->record('home.updated', 'Home page content updated ('.implode(', ', array_keys($changes['after'])).').', 'home', null, $changes);
            }

            return $saved;
        });

        return response()->json(['data' => $this->payload($saved)]);
    }

    /** The content, plus a short line per featured product so the picker can show names (any status: drafts are hidden on the storefront). */
    private function payload(array $content): array
    {
        return [
            ...$content,
            'featured_products' => $this->home->products($content['featured_product_ids'])->map(fn (Product $product) => [
                'id' => $product->id,
                'name' => $product->name,
                'sku' => $product->sku,
                'status' => $product->status,
                'sale_price' => Pricing::format($product->salePriceCents()),
                'thumbnail_url' => $product->thumbnail_url,
            ]),
        ];
    }
}
