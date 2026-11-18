<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\WishlistItem;
use App\Services\Wishlists;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Phase 11: the signed-in customer's wishlist (kept on the server), its share
 * link, and the public view of a shared wishlist.
 */
class WishlistController extends Controller
{
    public function __construct(private Wishlists $wishlists) {}

    /** GET /api/v1/me/wishlist → { data: [item], meta: { shared, shared_at, count, limit } } */
    public function index(Request $request): JsonResponse
    {
        return $this->list($request, $request->user());
    }

    /** POST /api/v1/me/wishlist { product_id, variant_id?, note? } → 201 (new) / 200 (already there) { data: item } */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'product_id' => ['required', 'integer', 'min:1'],
            'variant_id' => ['nullable', 'integer', 'min:1'],
            'note' => ['nullable', 'string', 'max:255'],
        ], ['note.max' => 'The note can be at most 255 characters.']);

        [$item, $created] = $this->wishlists->add($request->user(), (int) $data['product_id'], isset($data['variant_id']) ? (int) $data['variant_id'] : null,
            self::note($data['note'] ?? null), array_key_exists('note', $data));

        return response()->json(['data' => $this->wishlists->api($this->fresh($item), $request)], $created ? 201 : 200);
    }

    /** PATCH /api/v1/me/wishlist/{id} { note } → { data: item } */
    public function update(Request $request, int $id): JsonResponse
    {
        $data = $request->validate(['note' => ['present', 'nullable', 'string', 'max:255']], ['note.max' => 'The note can be at most 255 characters.']);
        $item = $this->own($request, $id);
        if (! $item) {
            return $this->notFound();
        }
        $item->update(['note' => self::note($data['note'])]);

        return response()->json(['data' => $this->wishlists->api($this->fresh($item), $request)]);
    }

    /** DELETE /api/v1/me/wishlist/{id} → 204 */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $item = $this->own($request, $id);
        if (! $item) {
            return $this->notFound();
        }
        $item->delete();

        return response()->json(null, 204);
    }

    /** POST /api/v1/me/wishlist/merge { items: [{ product_id, variant_id? }] } → the full list, meta.added and meta.skipped. */
    public function merge(Request $request): JsonResponse
    {
        $data = $request->validate([
            'items' => ['present', 'array', 'max:'.WishlistItem::LIMIT],
            'items.*.product_id' => ['required', 'integer', 'min:1'],
            'items.*.variant_id' => ['nullable', 'integer', 'min:1'],
        ]);
        [$added, $skipped] = $this->wishlists->merge($request->user(), $data['items']);

        return $this->list($request, $request->user(), ['added' => $added, 'skipped' => $skipped]);
    }

    /**
     * POST /api/v1/me/wishlist/share { regenerate? } → 201 { data: { shared: true, token, shared_at } } for a new link;
     * 200 with token null when it is already shared (the token can't be shown again).
     */
    public function share(Request $request): JsonResponse
    {
        $data = $request->validate(['regenerate' => ['sometimes', 'boolean']]);
        /** @var Customer $customer */
        $customer = $request->user();
        $token = null;
        if ($customer->wishlist_share_hash === null || ($data['regenerate'] ?? false)) {
            $token = $this->wishlists->share($customer);
        }

        return response()->json(['data' => [
            'shared' => true,
            'token' => $token,
            'shared_at' => $customer->wishlist_shared_at?->toIso8601ZuluString(),
        ]], $token ? 201 : 200);
    }

    /** DELETE /api/v1/me/wishlist/share → 204 (old links stop working). */
    public function unshare(Request $request): JsonResponse
    {
        $this->wishlists->unshare($request->user());

        return response()->json(null, 204);
    }

    /** GET /api/v1/wishlists/{token} → { data: { owner_first_name, items: [{ product, variant, note, added_at }] } } (public, no personal data). */
    public function shared(Request $request, string $token): JsonResponse
    {
        $customer = $this->wishlists->sharedBy($token);
        if (! $customer) {
            return response()->json(['message' => 'This wishlist isn\'t shared any more.'], 404);
        }

        return response()->json(['data' => [
            'owner_first_name' => $customer->first_name,
            'items' => $this->wishlists->items($customer)->map(fn (WishlistItem $item) => $this->wishlists->api($item, $request, false))->values(),
        ]]);
    }

    private function list(Request $request, Customer $customer, array $extraMeta = []): JsonResponse
    {
        $items = $this->wishlists->items($customer);

        return response()->json([
            'data' => $items->map(fn (WishlistItem $item) => $this->wishlists->api($item, $request))->values(),
            'meta' => [...$this->wishlists->meta($customer->fresh(), $items->count()), ...$extraMeta],
        ]);
    }

    private function own(Request $request, int $id): ?WishlistItem
    {
        return WishlistItem::where('customer_id', $request->user()->id)->find($id);
    }

    private function fresh(WishlistItem $item): WishlistItem
    {
        return $item->fresh(['product.category', 'product.brand', 'product.options.values', 'variant']);
    }

    private static function note(?string $note): ?string
    {
        return filled($note) ? trim($note) : null;
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Wishlist item not found.'], 404);
    }
}
