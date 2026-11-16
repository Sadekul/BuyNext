<?php

namespace App\Providers;

use App\Models\Order;
use App\Models\OrderReturn;
use App\Models\Product;
use App\Models\Review;
use App\Services\AdminNotifications;
use App\Services\CustomerCarts;
use App\Services\Settings;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Throwable;

/**
 * Phase 7 (part B): the newsletter rate limit, and model events that feed
 * the admin notification bell and the saved carts. They are model events,
 * so checkout, returns, and reviews don't need to know about them.
 */
class MarketingServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // Newsletter sign-ups: per visitor, and per email address (so one inbox
        // can't be flooded with confirmation emails). Confirm/unsubscribe: per visitor.
        RateLimiter::for('newsletter', function (Request $request) {
            $limits = [Limit::perMinute(config('buynest.newsletter_per_minute'))->by('newsletter-ip:'.$request->ip())];
            $email = mb_strtolower(trim((string) $request->input('email')));
            if ($email !== '') {
                $limits[] = Limit::perHour(config('buynest.newsletter_per_email_per_hour'))->by('newsletter-email:'.$email);
            }

            return $limits;
        });

        // Low stock / out of stock: when an active product's stock crosses the threshold or reaches 0.
        Product::updated(function (Product $product) {
            if (! $product->wasChanged('stock_quantity') || $product->status !== 'active' || $product->trashed()) {
                return;
            }
            $old = (int) $product->getOriginal('stock_quantity');
            $new = (int) $product->stock_quantity;
            $threshold = (int) app(Settings::class)->get('low_stock_threshold');
            self::safely(function () use ($product, $old, $new, $threshold) {
                if ($new <= 0 && $old > 0) {
                    app(AdminNotifications::class)->notify('out_of_stock', "product:{$product->id}", "Out of stock: {$product->name}",
                        "{$product->sku} has no stock left.", "/products/{$product->id}");
                } elseif ($new > 0 && $new < $threshold && $old >= $threshold) {
                    app(AdminNotifications::class)->notify('low_stock', "product:{$product->id}", "Low stock: {$product->name}",
                        "Only {$new} left of {$product->sku} (the low-stock threshold is {$threshold}).", "/products/{$product->id}");
                }
            });
        });

        // A customer asked to return items (staff-created returns don't need telling).
        OrderReturn::created(function (OrderReturn $return) {
            if ($return->created_by_admin_id) {
                return;
            }
            self::safely(function () use ($return) {
                $number = OrderReturn::numberFor($return->id);
                $order = $return->order;
                app(AdminNotifications::class)->notify('return_requested', "return:{$return->id}", "New return request {$number}",
                    "Order {$order?->number}: {$return->reason}.", "/returns/{$number}");
            });
        });

        // A new review waits for approval (Settings → Catalog: approval on).
        Review::created(function (Review $review) {
            if ($review->status !== 'pending') {
                return;
            }
            self::safely(fn () => app(AdminNotifications::class)->notify('review_pending', "review:{$review->id}", 'New review waiting for approval',
                "{$review->author_name} rated {$review->product?->name} {$review->rating}/5.", '/reviews?status=pending'));
        });

        // A storefront order by a signed-in customer: their saved cart was bought.
        Order::created(function (Order $order) {
            if ($order->customer_id && ($order->source ?? 'storefront') === 'storefront') {
                self::safely(fn () => app(CustomerCarts::class)->markConverted($order->customer_id));
            }
        });
    }

    /** A notification must never break the change that caused it (checkout, a return, a review). */
    private static function safely(callable $callback): void
    {
        try {
            $callback();
        } catch (Throwable $e) {
            report($e);
        }
    }
}
