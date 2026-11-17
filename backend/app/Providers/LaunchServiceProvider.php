<?php

namespace App\Providers;

use App\Models\Product;
use App\Models\ProductVariant;
use App\Services\StockAlerts;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

/**
 * Phase 9 (part B): launch readiness. Rate limits for browser error reports
 * and stock alerts, and the one hook that sends "it's back in stock" emails.
 */
class LaunchServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // Browser error reports, per visitor (the sign-in service passes the visitor's address).
        RateLimiter::for('client-errors', fn (Request $request) => Limit::perMinute(config('buynest.client_errors_per_minute'))->by('client-errors:'.$request->ip()));

        // "Email me when it's back": per visitor, and per email address (so one inbox can't be signed up for everything).
        RateLimiter::for('stock-alerts', function (Request $request) {
            $limits = [Limit::perMinute(config('buynest.stock_alerts_per_minute'))->by('stock-alerts-ip:'.$request->ip())];
            $email = mb_strtolower(trim((string) ($request->user()?->email ?? $request->input('email'))));
            if ($email !== '') {
                $limits[] = Limit::perHour(config('buynest.stock_alerts_per_email_per_hour'))->by('stock-alerts-email:'.$email);
            }

            return $limits;
        });

        // Stock alerts: any change that can make a product or variant buyable again
        // (the admin form, variant edits, bulk set_stock, imports, refunds with
        // restock, cancellations, received returns: they all save these models)
        // checks for waiting alerts after the transaction commits.
        Product::updated(function (Product $product) {
            if ($product->wasChanged(['stock_quantity', 'status', 'min_order_quantity', 'category_id', 'has_variants'])) {
                app(StockAlerts::class)->queueCheck($product->id);
            }
        });
        Product::restored(fn (Product $product) => app(StockAlerts::class)->queueCheck($product->id));
        ProductVariant::updated(function (ProductVariant $variant) {
            if ($variant->wasChanged(['stock_quantity', 'is_active'])) {
                app(StockAlerts::class)->queueCheck($variant->product_id);
            }
        });
    }
}
