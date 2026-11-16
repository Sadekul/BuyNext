<?php

namespace App\Providers;

use App\Models\DevMail;
use App\Services\CatalogRules;
use App\Services\HtmlSanitizer;
use App\Services\Settings;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Mail\Events\MessageSent;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // One Settings per request: it remembers the values it read, so the
        // cache is read once however many prices a page needs.
        $this->app->singleton(Settings::class);
        // The sanitizer's allow-list is built once.
        $this->app->singleton(HtmlSanitizer::class);
        // Phase 7 (part A): the compiled catalog price rules, read once per request.
        $this->app->singleton(CatalogRules::class);
    }

    public function boot(): void
    {
        // Sign-in, sign-up, and code routes: per visitor, and per email address
        // (so one inbox can't be flooded with codes from many addresses).
        RateLimiter::for('auth', function (Request $request) {
            $email = mb_strtolower(trim((string) $request->input('email')));

            return [
                Limit::perMinute(config('buynest.auth_per_minute'))->by('ip:'.$request->ip()),
                Limit::perMinute(config('buynest.auth_per_email_per_minute'))->by('email:'.$request->path().'|'.$email),
            ];
        });
        // Placing orders: per visitor (the BFF passes the visitor's IP, see TrustBffClientIp).
        // Reviews: 10 per hour per customer (the route requires a customer token).
        RateLimiter::for('reviews', fn (Request $request) => Limit::perHour(config('buynest.reviews_per_hour'))->by('customer:'.($request->user()?->getKey() ?? $request->ip())));
        RateLimiter::for('orders', fn (Request $request) => Limit::perMinute(config('buynest.orders_per_minute'))->by('ip:'.$request->ip()));
        RateLimiter::for('api', fn (Request $request) => Limit::perMinute(config('buynest.api_per_minute'))->by(
            $request->user() ? $request->user()->getMorphClass().':'.$request->user()->getKey() : 'ip:'.$request->ip(),
        ));

        // Local test inbox: keep a copy of every email sent (see DevMailboxController).
        if ($this->app->environment('local') && config('buynest.dev_mailbox')) {
            Event::listen(function (MessageSent $event) {
                $message = $event->message;
                foreach ($message->getTo() as $address) {
                    DevMail::create([
                        'to' => mb_strtolower($address->getAddress()),
                        'subject' => (string) $message->getSubject(),
                        'html' => $message->getHtmlBody(),
                        'text' => $message->getTextBody(),
                        // Phase 7: the List-Unsubscribe header of newsletters, so it can be checked by hand.
                        'headers' => $message->getHeaders()->has('List-Unsubscribe')
                            ? ['List-Unsubscribe' => $message->getHeaders()->get('List-Unsubscribe')->getBodyAsString()] : null,
                    ]);
                }
            });
        }
    }
}
