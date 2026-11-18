<?php

namespace App\Services;

use App\Http\Resources\ProductResource;
use App\Models\Customer;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\WishlistItem;
use App\Support\CategoryTree;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Phase 11: the wishlist of a signed-in customer, kept on the server, and its
 * share link. Products that aren't for sale any more are left out of every
 * answer (their rows stay, so they come back if the product does). The share
 * token is stored only as a SHA-256 hash: the plain token is shown once.
 */
class Wishlists
{
    public const FULL = 'Your wishlist is full (100 items). Remove something to add more.';

    /** The customer's rows (newest first) with what the answers need; $visibleOnly drops products not for sale. */
    public function items(Customer $customer, bool $visibleOnly = true): Collection
    {
        $items = WishlistItem::where('customer_id', $customer->id)
            ->with(['product.category', 'product.brand', 'product.options.values', 'variant'])
            ->orderByDesc('id')->get();
        if (! $visibleOnly) {
            return $items;
        }
        $tree = CategoryTree::load();

        return $items->filter(fn (WishlistItem $item) => $item->product && $item->product->isForSale($tree))->values();
    }

    /** { id, product: card, variant: { id, label } | null, note, added_at } (without id for the public view). */
    public function api(WishlistItem $item, Request $request, bool $withId = true): array
    {
        return [
            ...($withId ? ['id' => $item->id] : []),
            'product' => (new ProductResource($item->product))->resolve($request),
            'variant' => self::variant($item),
            'note' => $item->note,
            'added_at' => $item->created_at?->toIso8601ZuluString(),
        ];
    }

    public static function variant(WishlistItem $item): ?array
    {
        if (! $item->variant || ! $item->product) {
            return null;
        }

        return ['id' => $item->variant->id, 'label' => $item->variant->label($item->product->optionValueMap())];
    }

    /** meta of the customer's list answers. */
    public function meta(Customer $customer, int $count): array
    {
        return [
            'shared' => $customer->wishlist_share_hash !== null,
            'shared_at' => $customer->wishlist_shared_at?->toIso8601ZuluString(),
            'count' => $count,
            'limit' => WishlistItem::LIMIT,
        ];
    }

    /**
     * Adds a product (variant) for the customer: [item, created?]. An item
     * already there is returned as it is ($note, when given, replaces its note).
     * 422: product not for sale (product_id), bad variant (variant_id), full (wishlist_full).
     */
    public function add(Customer $customer, int $productId, ?int $variantId, ?string $note, bool $noteGiven): array
    {
        $this->check($productId, $variantId);

        return DB::transaction(function () use ($customer, $productId, $variantId, $note, $noteGiven) {
            Customer::whereKey($customer->id)->lockForUpdate()->value('id'); // one add at a time per customer (the limit)
            $existing = WishlistItem::where('customer_id', $customer->id)->where('product_id', $productId)
                ->where('variant_key', $variantId ?? 0)->first();
            if ($existing) {
                if ($noteGiven) {
                    $existing->update(['note' => $note]);
                }

                return [$existing, false];
            }
            if (WishlistItem::where('customer_id', $customer->id)->count() >= WishlistItem::LIMIT) {
                throw new HttpResponseException(response()->json([
                    'message' => self::FULL, 'code' => 'wishlist_full', 'errors' => ['product_id' => [self::FULL]],
                ], 422));
            }
            try {
                $item = WishlistItem::create(['customer_id' => $customer->id, 'product_id' => $productId, 'product_variant_id' => $variantId, 'note' => $note]);
            } catch (UniqueConstraintViolationException) {
                $item = WishlistItem::where('customer_id', $customer->id)->where('product_id', $productId)->where('variant_key', $variantId ?? 0)->firstOrFail();

                return [$item, false];
            }

            return [$item, true];
        });
    }

    /**
     * After sign-in: adds the guest list. Returns [added, skipped: [{ product_id, variant_id, reason }]].
     */
    public function merge(Customer $customer, array $items): array
    {
        $added = 0;
        $skipped = [];
        foreach ($items as $entry) {
            $productId = (int) $entry['product_id'];
            $variantId = isset($entry['variant_id']) ? (int) $entry['variant_id'] : null;
            try {
                [, $created] = $this->add($customer, $productId, $variantId, null, false);
                $added += $created ? 1 : 0;
            } catch (ValidationException) {
                $skipped[] = ['product_id' => $productId, 'variant_id' => $variantId, 'reason' => 'unavailable'];
            } catch (HttpResponseException) {
                $skipped[] = ['product_id' => $productId, 'variant_id' => $variantId, 'reason' => 'full'];
            }
        }

        return [$added, $skipped];
    }

    /** A new share token (returned once; only its hash is kept). */
    public function share(Customer $customer): string
    {
        do {
            $token = Str::random(32); // A–Z a–z 0–9
        } while (Customer::where('wishlist_share_hash', hash('sha256', $token))->exists());
        $customer->forceFill(['wishlist_share_hash' => hash('sha256', $token), 'wishlist_shared_at' => now()])->save();

        return $token;
    }

    public function unshare(Customer $customer): void
    {
        $customer->forceFill(['wishlist_share_hash' => null, 'wishlist_shared_at' => null])->save();
    }

    public function sharedBy(string $token): ?Customer
    {
        if (! preg_match('/^[A-Za-z0-9_-]{32}$/', $token)) {
            return null;
        }

        return Customer::where('wishlist_share_hash', hash('sha256', $token))->where('is_active', true)->first();
    }

    /** 422 when the product isn't for sale, or the variant isn't one of its active variants. */
    private function check(int $productId, ?int $variantId): void
    {
        $product = Product::find($productId);
        if (! $product || ! $product->isForSale()) {
            throw ValidationException::withMessages(['product_id' => 'This product isn\'t available.']);
        }
        if ($variantId !== null) {
            $variant = ProductVariant::find($variantId);
            if (! $variant || $variant->product_id !== $product->id || ! $variant->is_active || ! $product->has_variants) {
                throw ValidationException::withMessages(['variant_id' => 'This option isn\'t available.']);
            }
        }
    }
}
