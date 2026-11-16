<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Mail\AbandonedCartMail;
use App\Models\CustomerCart;
use App\Services\Audit;
use App\Services\CustomerCarts;
use App\Services\Pricing;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;

/**
 * Phase 7: Reports → Abandoned carts (reports.view) and the "remind" email
 * (newsletter.send): signed-in customers' carts that weren't bought and
 * haven't changed for at least an hour.
 */
class AbandonedCartController extends Controller
{
    public function __construct(private CustomerCarts $carts, private Audit $audit) {}

    /** GET /api/admin/v1/reports/abandoned-carts?min_age_hours&max_age_days&min_subtotal&search&sort&page&per_page */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'min_age_hours' => ['nullable', 'integer', 'min:1', 'max:8760'],
            'max_age_days' => ['nullable', 'integer', 'min:1', 'max:3650'],
            'min_subtotal' => ['nullable', 'numeric', 'min:0'],
            'search' => ['nullable', 'string', 'max:190'],
            'sort' => ['nullable', 'in:newest,oldest,subtotal'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = CustomerCart::with('customer')
            ->whereNull('converted_at')->where('item_count', '>', 0)
            ->where('updated_at', '<=', now()->subHours((int) ($data['min_age_hours'] ?? 1)))
            ->when($data['max_age_days'] ?? null, fn ($q, $days) => $q->where('updated_at', '>=', now()->subDays((int) $days)))
            ->when(isset($data['min_subtotal']), fn ($q) => $q->where('subtotal', '>=', $data['min_subtotal']))
            ->when($data['search'] ?? null, function ($q, $search) {
                $like = '%'.addcslashes($search, '%_\\').'%';
                $q->whereHas('customer', fn ($c) => $c->where('email', 'like', $like)->orWhere('first_name', 'like', $like)
                    ->orWhere('last_name', 'like', $like)->orWhereRaw("CONCAT(first_name, ' ', last_name) LIKE ?", [$like]));
            });
        match ($data['sort'] ?? 'newest') {
            'oldest' => $query->orderBy('updated_at')->orderBy('id'),
            'subtotal' => $query->orderByDesc('subtotal')->orderByDesc('id'),
            default => $query->orderByDesc('updated_at')->orderByDesc('id'),
        };

        return JsonResource::collection($query->paginate($data['per_page'] ?? 20)->withQueryString()
            ->through(fn (CustomerCart $cart) => $this->item($cart)));
    }

    /** POST /api/admin/v1/reports/abandoned-carts/{customer_id}/remind */
    public function remind(int $customer): JsonResponse
    {
        $customerId = $customer; // the route's {customer}; $customer becomes the model below
        $cart = CustomerCart::with('customer')->where('customer_id', $customerId)->first();
        if (! $cart || $cart->converted_at || $cart->item_count < 1 || ! $cart->customer) {
            return response()->json(['message' => 'Abandoned cart not found.'], 404);
        }
        if ($cart->updated_at->gt(now()->subMinutes(CustomerCart::ABANDONED_AFTER_MINUTES))) {
            throw ValidationException::withMessages(['cart' => 'This cart changed less than an hour ago: the customer is still shopping.']);
        }
        $customer = $cart->customer;
        if (! $customer->is_active || ! $customer->hasVerifiedEmail()) {
            throw ValidationException::withMessages(['customer' => 'Reminders go only to active customers with a confirmed email.']);
        }
        if ($wait = $this->secondsUntilRemind($cart)) {
            return response()->json([
                'message' => 'This customer was reminded less than '.CustomerCart::REMIND_EVERY_HOURS.' hours ago.',
                'code' => 'too_soon',
            ], 429, ['Retry-After' => (string) $wait]);
        }

        $lines = $this->carts->lines($cart->items ?? [])->filter(fn (array $line) => $line['available'])->values()->all();
        if ($lines === []) {
            throw ValidationException::withMessages(['cart' => 'Nothing in this cart is for sale any more.']);
        }

        DB::transaction(function () use ($cart, $customer) {
            // Locked, so two clicks at the same moment send one email.
            $locked = CustomerCart::whereKey($cart->id)->lockForUpdate()->first();
            if ($locked->reminded_at && $locked->reminded_at->gt(now()->subHours(CustomerCart::REMIND_EVERY_HOURS))) {
                throw ValidationException::withMessages(['cart' => 'This customer was just reminded.']);
            }
            // Not a change by the customer: updated_at stays as it was.
            CustomerCart::whereKey($cart->id)->toBase()->update(['reminded_at' => now()]);
            $this->audit->record('cart.reminded', "Abandoned cart reminder sent to {$customer->email}.", 'customer', $customer->id);
        });
        $cart->refresh();
        $subtotal = Pricing::format(collect($lines)->sum(fn (array $line) => $line['sale_cents'] * $line['quantity']));
        Mail::to($customer->email)->send(new AbandonedCartMail($customer, $lines, $subtotal));

        return response()->json([
            'message' => "Reminder sent to {$customer->email}.",
            'data' => ['customer_id' => $customer->id, 'email' => $customer->email, 'reminded_at' => $cart->reminded_at->toIso8601ZuluString()],
        ]);
    }

    private function item(CustomerCart $cart): array
    {
        $customer = $cart->customer;
        $wait = $this->secondsUntilRemind($cart);
        $eligible = $customer && $customer->is_active && $customer->hasVerifiedEmail();

        return [
            'customer' => $customer ? [
                'id' => $customer->id,
                'name' => trim("{$customer->first_name} {$customer->last_name}"),
                'email' => $customer->email,
                'is_active' => (bool) $customer->is_active,
            ] : null,
            'items' => $this->carts->lines($cart->items ?? [])->map(fn (array $line) => [
                'product_id' => $line['product_id'],
                'variant_id' => $line['variant_id'],
                'name' => $line['name'],
                'variant_label' => $line['variant_label'],
                'sku' => $line['sku'],
                'thumbnail_url' => $line['thumbnail_url'],
                'quantity' => $line['quantity'],
                'sale_price' => Pricing::format($line['sale_cents']),
                'available' => $line['available'],
            ])->all(),
            'item_count' => $cart->item_count,
            'subtotal' => $cart->subtotal,
            'updated_at' => $cart->updated_at?->toIso8601ZuluString(),
            'age_minutes' => (int) $cart->updated_at->diffInMinutes(now(), true),
            'reminded_at' => $cart->reminded_at?->toIso8601ZuluString(),
            'can_remind' => $eligible && $wait === 0,
            'remind_available_at' => $wait ? now()->addSeconds($wait)->toIso8601ZuluString() : null,
        ];
    }

    private function secondsUntilRemind(CustomerCart $cart): int
    {
        if (! $cart->reminded_at) {
            return 0;
        }
        $next = $cart->reminded_at->copy()->addHours(CustomerCart::REMIND_EVERY_HOURS);

        return $next->isFuture() ? (int) ceil(now()->diffInSeconds($next, true)) : 0;
    }
}
