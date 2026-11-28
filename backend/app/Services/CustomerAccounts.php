<?php

namespace App\Services;

use App\Models\Customer;
use App\Models\CustomerCart;
use App\Models\NewsletterSubscriber;
use App\Models\OneTimeCode;
use App\Models\Order;
use App\Models\Review;
use App\Models\ReviewPhoto;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Deleting a customer account, the same way whether staff do it (phase 6,
 * DELETE /api/admin/v1/customers/{id}) or the customer does (phase 9,
 * POST /api/v1/me/delete).
 *
 * Refused while an order is still open. Deletes the sign-ins, codes,
 * addresses and notes (cascade), the saved cart, and stock alerts, and takes
 * the address off the newsletter. Orders, reviews (with the author name),
 * coupon uses, and returns stay, with customer_id null.
 *
 * Phase 22: the photos on the customer's reviews are deleted (rows, and the
 * files once the transaction commits), because a photo can show who they are.
 * The reviews themselves stay, as before.
 */
class CustomerAccounts
{
    public function __construct(private TokenPairs $tokens, private Newsletter $newsletter) {}

    /** Orders that are pending payment, processing, or shipped. */
    public function openOrderCount(Customer $customer): int
    {
        return $customer->orders()->whereIn('status', Order::OPEN_STATUSES)->count();
    }

    /** Call openOrderCount() first; the caller writes its own audit entry in the same transaction. */
    public function delete(Customer $customer): void
    {
        DB::transaction(function () use ($customer) {
            $this->tokens->revokeAll($customer);
            OneTimeCode::whereIn('email', array_filter([$customer->email, $customer->pending_email]))->delete();
            NewsletterSubscriber::where('email', mb_strtolower($customer->email))->orWhere('customer_id', $customer->id)->get()
                ->each(fn (NewsletterSubscriber $subscriber) => $this->newsletter->unsubscribe($subscriber));
            CustomerCart::where('customer_id', $customer->id)->delete();
            // Phase 9 (part B) adds stock alerts; they go with the account.
            if (Schema::hasTable('stock_alerts')) {
                DB::table('stock_alerts')->where('customer_id', $customer->id)
                    ->orWhere(fn ($q) => $q->where('email', mb_strtolower($customer->email))->whereNull('notified_at'))->delete();
            }
            // Phase 22: review photos go with the account (the reviews stay).
            $photos = ReviewPhoto::whereIn('review_id', Review::where('customer_id', $customer->id)->select('id'))->get();
            if ($photos->isNotEmpty()) {
                ReviewPhoto::whereKey($photos->modelKeys())->delete();
                DB::afterCommit(fn () => ReviewPhoto::deleteFiles($photos));
            }
            // Addresses and notes cascade; orders, reviews, coupon uses, and returns keep their rows with customer_id null.
            $customer->delete();
        });
    }
}
