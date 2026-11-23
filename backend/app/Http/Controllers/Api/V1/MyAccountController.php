<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\CustomerResource;
use App\Mail\AccountDeletedMail;
use App\Mail\EmailChangedMail;
use App\Models\Customer;
use App\Models\CustomerAddress;
use App\Models\CustomerCart;
use App\Models\NewsletterSubscriber;
use App\Models\OneTimeCode;
use App\Models\Order;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Review;
use App\Models\RewardTransaction;
use App\Models\WishlistItem;
use App\Services\Audit;
use App\Services\CustomerAccounts;
use App\Services\Newsletter;
use App\Services\OneTimeCodes;
use App\Services\Pricing;
use App\Services\TokenPairs;
use App\Services\Wishlists;
use App\Support\Locale;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;

/**
 * Phase 9 (part A): customer self-service. Change the account email (a code
 * goes to the new address first), download my data, delete my account. The
 * account always comes from the token.
 */
class MyAccountController extends Controller
{
    private const TAKEN = 'An account with this email already exists. Sign in, or reset your password.';

    public function __construct(private OneTimeCodes $codes, private TokenPairs $tokens, private Audit $audit) {}

    /** POST /api/v1/me/email { email, password } → a 6-digit code to the NEW address; the account keeps its email until confirmed. */
    public function requestEmailChange(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'string', 'email', 'max:190'],
            'password' => ['required', 'string', 'max:128'],
        ]);
        $customer = $request->user();
        $email = OneTimeCodes::normalize($data['email']);

        $this->checkPassword($customer, $data['password']);
        if ($email === mb_strtolower($customer->email)) {
            throw ValidationException::withMessages(['email' => __('This is already your email address.')]);
        }
        if ($this->emailTaken($email, $customer)) {
            throw ValidationException::withMessages(['email' => __(self::TAKEN)]);
        }

        $customer->forceFill(['pending_email' => $email])->save();
        $resendIn = $this->codes->send($email, OneTimeCode::EMAIL_CHANGE, $customer->first_name);

        return response()->json([
            'message' => __('We emailed a 6-digit code to :email. Your email stays the same until you enter it.', ['email' => $email]),
            'data' => [
                'email' => $email,
                'expires_in' => config('buynest.codes.ttl_minutes') * 60,
                'resend_in' => $resendIn,
            ],
        ]);
    }

    /**
     * POST /api/v1/me/email/confirm { code } → the email is switched (and
     * verified), other devices are signed out, the old address is told.
     */
    public function confirmEmailChange(Request $request, Newsletter $newsletter): JsonResponse
    {
        $data = $request->validate(['code' => ['required', 'string', 'regex:/^\d{6}$/']], ['code.regex' => __('Enter the 6-digit code from the email.')]);
        $customer = $request->user();
        $new = $customer->pending_email;
        if (! $new) {
            throw ValidationException::withMessages(['email' => __('Ask for a code first.')]);
        }

        $result = $this->codes->verify($new, OneTimeCode::EMAIL_CHANGE, $data['code']);
        if ($result === 'locked') {
            throw ValidationException::withMessages(['code' => __('Too many wrong attempts. Ask for a new code.')]);
        }
        if ($result !== 'ok') {
            throw ValidationException::withMessages(['code' => __('That code is incorrect or has expired.')]);
        }

        $old = $customer->email;
        DB::transaction(function () use ($customer, $new, $old, $newsletter, $request) {
            // Someone may have signed up with the address meanwhile. A never-used, unconfirmed sign-up
            // gives way (this customer just proved they own the inbox); a real account doesn't.
            $other = Customer::where('email', $new)->whereKeyNot($customer->id)->lockForUpdate()->first();
            if ($other && $this->isRealAccount($other)) {
                throw ValidationException::withMessages(['email' => __(self::TAKEN)]);
            }
            $other?->delete();

            $wasSubscribed = $newsletter->isSubscribed($customer);
            $customer->forceFill(['email' => $new, 'pending_email' => null, 'email_verified_at' => $customer->email_verified_at ?? now()])->save();
            if ($wasSubscribed) {
                // The subscription moves with the account.
                NewsletterSubscriber::where('email', mb_strtolower($old))->get()->each(fn ($subscriber) => $newsletter->unsubscribe($subscriber));
                $newsletter->setForCustomer($customer, true);
            }
            $this->tokens->revokeOthers($customer, $request->user()->currentAccessToken());
            $this->audit->record('customer.email_changed', "Customer #{$customer->id} changed their email address.", 'customer', $customer->id,
                Audit::diff(['email' => $old], ['email' => $new]));
        });
        Mail::to($old)->send(new EmailChangedMail($customer->first_name, $old, $new));

        return response()->json([
            'message' => __('Your email is now :email.', ['email' => $new]),
            'data' => new CustomerResource($customer->fresh()),
        ]);
    }

    /** GET /api/v1/me/export → buynest-my-data-YYYY-MM-DD.json (3 per hour). Only this customer's own data, no internal ids. */
    public function export(Request $request): JsonResponse
    {
        $customer = $request->user();
        $group = $customer->priceGroup()?->summary();
        $subscriber = NewsletterSubscriber::where('email', mb_strtolower($customer->email))->first();

        $data = [
            'exported_at' => now()->toIso8601ZuluString(),
            'profile' => [
                'first_name' => $customer->first_name,
                'last_name' => $customer->last_name,
                'email' => $customer->email,
                'pending_email' => $customer->pending_email,
                'phone' => $customer->phone,
                'email_verified_at' => self::date($customer->email_verified_at),
                'created_at' => self::date($customer->created_at),
                'last_login_at' => self::date($customer->last_login_at),
                'group' => $group,
                'reward_points' => (int) $customer->reward_points, // phase 11
            ],
            'newsletter' => [
                'status' => $subscriber?->status ?? 'not_subscribed',
                'subscribed_at' => self::date($subscriber?->confirmed_at),
                'unsubscribed_at' => self::date($subscriber?->unsubscribed_at),
            ],
            'addresses' => $customer->addresses()->get()->map(fn (CustomerAddress $address) => [
                ...collect($address->only(['first_name', 'last_name', 'company', 'phone', 'line1', 'line2', 'city', 'state', 'postal_code', 'country']))->all(),
                'is_default_shipping' => (bool) $address->is_default_shipping,
                'is_default_billing' => (bool) $address->is_default_billing,
                'created_at' => self::date($address->created_at),
            ])->values(),
            'orders' => $customer->orders()->with(['items', 'history', 'invoices', 'shipments', 'creditMemos', 'returns.items.orderItem'])
                ->orderBy('id')->get()->map(fn (Order $order) => $this->exportOrder($order))->values(),
            'reviews' => Review::where('customer_id', $customer->id)->with('product:id,name')->orderBy('id')->get()->map(fn (Review $review) => [
                'product' => $review->product?->name,
                'rating' => $review->rating,
                'title' => $review->title,
                'comment' => $review->comment,
                'status' => $review->status,
                'created_at' => self::date($review->created_at),
            ])->values(),
            'saved_cart' => $this->exportCart($customer),
            'stock_alerts' => $this->exportStockAlerts($customer),
            // Phase 11: the wishlist kept on the server and the reward point history.
            'wishlist' => WishlistItem::where('customer_id', $customer->id)->with(['product' => fn ($q) => $q->withTrashed(), 'product.options.values', 'variant'])
                ->orderBy('id')->get()->map(fn (WishlistItem $item) => [
                    'product' => $item->product?->name,
                    'variant' => Wishlists::variant($item)['label'] ?? null,
                    'note' => $item->note,
                    'added_at' => self::date($item->created_at),
                ])->values(),
            'reward_transactions' => RewardTransaction::where('customer_id', $customer->id)->with('order:id,number')->orderBy('id')->get()
                ->map(fn (RewardTransaction $tx) => [
                    'points' => $tx->points,
                    'balance_after' => $tx->balance_after,
                    'type' => $tx->type,
                    'order_number' => $tx->order?->number,
                    'note' => $tx->note,
                    'created_at' => self::date($tx->created_at),
                ])->values(),
        ];

        return response()->json($data, 200, [
            'Content-Disposition' => 'attachment; filename="buynest-my-data-'.now()->format('Y-m-d').'.json"',
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }

    /**
     * POST /api/v1/me/delete { password, confirm: "DELETE" } → the account is
     * deleted with the same rules as staff deletion (refused while an order is
     * open); a confirmation goes to the old address.
     */
    public function destroy(Request $request, CustomerAccounts $accounts): JsonResponse
    {
        $data = $request->validate([
            'password' => ['required', 'string', 'max:128'],
            'confirm' => ['required', 'string'],
        ]);
        $customer = $request->user();
        $this->checkPassword($customer, $data['password']);
        if ($data['confirm'] !== 'DELETE') {
            throw ValidationException::withMessages(['confirm' => __('Type DELETE to confirm.')]);
        }
        $open = $accounts->openOrderCount($customer);
        if ($open > 0) {
            throw ValidationException::withMessages(['account' => $open === 1
                ? __('You have 1 open order (pending payment, processing, or shipped). You can delete your account once it\'s delivered or cancelled.')
                : __('You have :count open orders (pending payment, processing, or shipped). You can delete your account once they\'re delivered or cancelled.',
                    ['count' => Locale::digits($open)])]);
        }

        $email = $customer->email;
        $firstName = $customer->first_name;
        DB::transaction(function () use ($customer, $accounts) {
            $id = $customer->id;
            $accounts->delete($customer);
            // No personal data in the log: the account is gone.
            $this->audit->record('customer.deleted_own_account', "Customer #{$id} deleted their account.", 'customer', $id);
        });
        Mail::to($email)->send(new AccountDeletedMail($firstName));

        return response()->json(['message' => __('Your account was deleted.')]);
    }

    private function checkPassword(Customer $customer, string $password): void
    {
        if (! Hash::check($password, $customer->password)) {
            throw ValidationException::withMessages(['password' => __('Your password is incorrect.')]);
        }
    }

    /** Another account holds the address (an abandoned, never-used sign-up doesn't count). */
    private function emailTaken(string $email, Customer $customer): bool
    {
        $other = Customer::where('email', $email)->whereKeyNot($customer->id)->first();

        return $other !== null && $this->isRealAccount($other);
    }

    /** Confirmed, created by staff, ever signed in, or with orders: not a sign-up that can give way. */
    private function isRealAccount(Customer $other): bool
    {
        return $other->hasVerifiedEmail() || $other->created_by_admin_id !== null || $other->last_login_at !== null || $other->orders()->exists();
    }

    private function exportOrder(Order $order): array
    {
        return [
            'number' => $order->number,
            'status' => $order->status,
            'payment_status' => $order->payment_status,
            'payment_method' => $order->payment_method,
            'shipping_method' => $order->shipping_label,
            'email' => $order->email,
            'phone' => $order->phone,
            'shipping_address' => $order->shipping_address,
            'billing_address' => $order->billing_address,
            'coupon_code' => $order->coupon_code,
            'placed_at' => self::date($order->placed_at),
            'items' => $order->items->map(fn ($item) => [
                'sku' => $item->sku,
                'name' => $item->name,
                'variant_label' => $item->variant_label,
                'price' => $item->unit_price,
                'sale_price' => $item->sale_price,
                'quantity' => $item->quantity,
                'line_total' => $item->line_total,
            ])->values(),
            'totals' => collect([
                'subtotal' => $order->subtotal,
                'discount' => $order->discount_total,
                'shipping' => $order->shipping_total,
                'tax' => $order->tax_total,
                'total' => $order->grand_total,
            ])->merge([
                'paid' => Pricing::format($order->paidCents()),
                'refunded' => Pricing::format($order->refundedCents()),
            ])->all(),
            // Staff-only notes (the customer wasn't told) and who on staff did what stay out.
            'history' => $order->history->map(fn ($entry) => [
                'status' => $entry->status,
                'note' => $entry->customer_notified ? $entry->note : null,
                'created_at' => self::date($entry->created_at),
            ])->values(),
            'invoices' => $order->invoices->map(fn ($invoice) => [
                'number' => $invoice->number, 'amount' => $invoice->amount, 'created_at' => self::date($invoice->created_at),
            ])->values(),
            'shipments' => $order->shipments->map(fn ($shipment) => [
                'number' => $shipment->number, 'carrier' => $shipment->carrier, 'tracking_number' => $shipment->tracking_number,
                'created_at' => self::date($shipment->created_at),
            ])->values(),
            'refunds' => $order->creditMemos->map(fn ($memo) => [
                'number' => $memo->number, 'total' => $memo->total, 'created_at' => self::date($memo->created_at),
            ])->values(),
            'returns' => $order->returns->map(fn ($return) => [
                'number' => $return->number,
                'status' => $return->status,
                'reason' => $return->reason,
                'comment' => $return->comment,
                'resolution' => $return->resolution,
                'created_at' => self::date($return->created_at),
                'items' => $return->items->map(fn ($item) => [
                    'sku' => $item->orderItem?->sku,
                    'name' => $item->orderItem?->name,
                    'variant_label' => $item->orderItem?->variant_label,
                    'quantity' => $item->quantity,
                ])->values(),
            ])->values(),
        ];
    }

    private function exportCart(Customer $customer): ?array
    {
        $cart = CustomerCart::where('customer_id', $customer->id)->whereNull('converted_at')->first();
        if (! $cart || empty($cart->items)) {
            return null;
        }
        $products = Product::withTrashed()->whereIn('id', collect($cart->items)->pluck('product_id'))->pluck('name', 'id');

        return [
            'items' => collect($cart->items)->map(fn ($item) => [
                'product' => $products[$item['product_id']] ?? null,
                'variant' => self::variantLabel($item['variant_id'] ?? null),
                'quantity' => (int) $item['quantity'],
            ])->values()->all(),
            'updated_at' => self::date($cart->updated_at),
        ];
    }

    /** Phase 9 (part B) owns stock alerts; until its table exists the list is empty. */
    private function exportStockAlerts(Customer $customer): array
    {
        if (! Schema::hasTable('stock_alerts')) {
            return [];
        }

        return DB::table('stock_alerts')
            ->leftJoin('products', 'products.id', '=', 'stock_alerts.product_id')
            ->where(fn ($q) => $q->where('stock_alerts.customer_id', $customer->id)->orWhere('stock_alerts.email', mb_strtolower($customer->email)))
            ->orderBy('stock_alerts.id')
            ->get(['products.name as product', 'stock_alerts.variant_id', 'stock_alerts.created_at', 'stock_alerts.notified_at'])
            ->map(fn ($alert) => [
                'product' => $alert->product,
                'variant' => self::variantLabel($alert->variant_id),
                'created_at' => self::date($alert->created_at ? Carbon::parse($alert->created_at) : null),
                'notified_at' => self::date($alert->notified_at ? Carbon::parse($alert->notified_at) : null),
            ])->values()->all();
    }

    /** "Size: M / Color: Red", or null. */
    private static function variantLabel(?int $variantId): ?string
    {
        $variant = $variantId ? ProductVariant::with('product')->find($variantId) : null;

        return $variant?->product ? $variant->label($variant->product->optionValueMap()) : null;
    }

    private static function date($value): ?string
    {
        return $value?->toIso8601ZuluString();
    }
}
