<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Category;
use App\Models\Page;
use App\Models\Product;
use App\Models\UrlRedirect;
use App\Support\CategoryTree;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Cache;

/** Phase 7 SEO (public): the sitemap and the URL redirect lookup for the storefront's "not found" page. */
class SeoController extends Controller
{
    public const SITEMAP_CACHE_KEY = 'buynest.sitemap';

    private const REDIRECT_VERSION_KEY = 'buynest.redirects.version';

    /** Redirect answers are cached per path under a version number; changing any redirect bumps it (forgets them all). */
    public static function forgetRedirects(): void
    {
        Cache::forever(self::REDIRECT_VERSION_KEY, ((int) Cache::get(self::REDIRECT_VERSION_KEY, 1)) + 1);
    }

    /**
     * GET /api/v1/sitemap.xml - the home page, visible categories, products
     * for sale, and published pages, as storefront addresses. Cached 15 minutes.
     */
    public function sitemap(): Response
    {
        $xml = Cache::remember(self::SITEMAP_CACHE_KEY, now()->addMinutes(15), function () {
            $base = config('buynest.storefront_url');
            $tree = CategoryTree::load();
            $urls = [[$base.'/', null]];
            foreach (Category::whereIn('id', $tree->visibleIds())->orderBy('position')->orderBy('id')->get(['slug', 'updated_at']) as $category) {
                $urls[] = [$base.'/categories/'.rawurlencode($category->slug), $category->updated_at];
            }
            foreach (Product::forSale($tree)->orderBy('id')->cursor() as $product) {
                $urls[] = [$base.'/products/'.$product->id, $product->updated_at];
            }
            foreach (Page::where('is_published', true)->orderBy('slug')->get(['slug', 'updated_at']) as $page) {
                $urls[] = [$base.'/pages/'.rawurlencode($page->slug), $page->updated_at];
            }

            $body = '<?xml version="1.0" encoding="UTF-8"?>'."\n".'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'."\n";
            foreach ($urls as [$loc, $updated]) {
                $body .= '  <url><loc>'.htmlspecialchars($loc, ENT_XML1 | ENT_QUOTES, 'UTF-8').'</loc>'
                    .($updated ? '<lastmod>'.$updated->toDateString().'</lastmod>' : '').'</url>'."\n";
            }

            return $body.'</urlset>'."\n";
        });

        return response($xml, 200, ['Content-Type' => 'application/xml; charset=UTF-8', 'Cache-Control' => 'public, max-age=900']);
    }

    /** GET /api/v1/redirects?path=/old-path → { data: { from_path, to_path, status_code } } or 404. */
    public function redirect(Request $request): JsonResponse
    {
        $data = $request->validate(['path' => ['required', 'string', 'max:2048']]);
        $path = UrlRedirect::normalize($data['path']);

        // The answer (or "none") is cached; the cache is cleared when redirects change.
        $found = Cache::remember('buynest.redirect:'.Cache::get(self::REDIRECT_VERSION_KEY, 1).':'.sha1($path), now()->addMinutes(10),
            fn () => UrlRedirect::where('from_path', $path)->first(['id', 'from_path', 'to_path', 'status_code'])?->toArray() ?? false);

        $headers = ['Cache-Control' => 'public, max-age=300'];
        if (! $found) {
            return response()->json(['message' => 'No redirect for this path.'], 404, $headers);
        }
        UrlRedirect::whereKey($found['id'])->increment('hits');

        return response()->json(['data' => [
            'from_path' => $found['from_path'],
            'to_path' => $found['to_path'],
            'status_code' => (int) $found['status_code'],
        ]], 200, $headers);
    }
}
