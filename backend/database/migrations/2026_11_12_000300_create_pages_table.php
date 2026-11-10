<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Content pages (Magento's Content → Pages): About, Shipping & returns, ...
 * The body is HTML that was sanitized when it was saved (App\Services\HtmlSanitizer),
 * so the storefront can show it as it is. The starter pages are data, so
 * `php artisan migrate` adds them to an existing database too.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pages', function (Blueprint $table) {
            $table->id();
            $table->string('slug', 80)->unique(); // a-z, 0-9 and dashes: the address /pages/{slug}
            $table->string('title', 160);
            $table->mediumText('body');
            $table->string('meta_title', 160)->nullable();
            $table->string('meta_description', 300)->nullable();
            $table->boolean('is_published')->default(true);
            $table->timestamps();
        });

        $now = now();
        foreach ($this->starterPages() as $page) {
            DB::table('pages')->insertOrIgnore([...$page, 'is_published' => true, 'created_at' => $now, 'updated_at' => $now]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('pages');
    }

    /** Placeholder copy: edit it in the admin (Content → Pages) before launch. */
    private function starterPages(): array
    {
        return [
            [
                'slug' => 'about',
                'title' => 'About BuyNest',
                'meta_title' => 'About us',
                'meta_description' => 'Who we are and what we care about.',
                'body' => '<p>BuyNest is an online store for everyday essentials: electronics, fashion, beauty, and home goods, picked for quality and priced for everyday life.</p>'
                    .'<h2>What we care about</h2><ul><li><strong>Fair prices</strong> with no surprises at checkout.</li>'
                    .'<li><strong>Fast, tracked delivery</strong> to every country we ship to.</li>'
                    .'<li><strong>Real people</strong> answering your questions, seven days a week.</li></ul>'
                    .'<p>Questions? Visit our <a href="/pages/contact" rel="noopener">contact page</a>.</p>',
            ],
            [
                'slug' => 'shipping-and-returns',
                'title' => 'Shipping and returns',
                'meta_title' => 'Shipping and returns',
                'meta_description' => 'Delivery options, prices, and our 30-day returns.',
                'body' => '<h2>Shipping</h2><p>Standard shipping is free on orders over $50 (after discounts). Express and next-day delivery are available at checkout.</p>'
                    .'<table><thead><tr><th>Method</th><th>Delivery time</th></tr></thead><tbody>'
                    .'<tr><td>Standard</td><td>3–5 business days</td></tr><tr><td>Express</td><td>1–2 business days</td></tr>'
                    .'<tr><td>Next day</td><td>Next business day (order by 2 pm)</td></tr></tbody></table>'
                    .'<h2>Returns</h2><p>You have 30 days from delivery to return an item in its original condition. Once we receive it, we refund the item to your original payment method.</p>',
            ],
            [
                'slug' => 'privacy',
                'title' => 'Privacy policy',
                'meta_title' => 'Privacy policy',
                'meta_description' => 'What we collect, why, and your choices.',
                'body' => '<p>We collect only what we need to run your account and deliver your orders: your name, email, phone number, and addresses.</p>'
                    .'<h2>What we never do</h2><ul><li>We never see or store your card number: payments are handled by our payment partners.</li>'
                    .'<li>We never sell your personal data.</li></ul>'
                    .'<h2>Your choices</h2><p>You can update your details in your account at any time, or ask us to delete your account by writing to <a href="mailto:support@buynest.example.com" rel="noopener">support@buynest.example.com</a>.</p>',
            ],
            [
                'slug' => 'terms',
                'title' => 'Terms of service',
                'meta_title' => 'Terms of service',
                'meta_description' => 'The rules for shopping at BuyNest.',
                'body' => '<p>By placing an order at BuyNest you agree to these terms.</p>'
                    .'<h2>Orders and prices</h2><p>Prices are shown in US dollars. We confirm the final price, shipping, and any tax before you place your order.</p>'
                    .'<h2>Cancellations</h2><p>You can ask us to cancel an order until it has been paid or shipped; after that, return it under our <a href="/pages/shipping-and-returns" rel="noopener">returns policy</a>.</p>',
            ],
            [
                'slug' => 'contact',
                'title' => 'Contact us',
                'meta_title' => 'Contact us',
                'meta_description' => 'How to reach the BuyNest team.',
                'body' => '<p>We are happy to help with orders, returns, and product questions.</p>'
                    .'<ul><li>Email: <a href="mailto:support@buynest.example.com" rel="noopener">support@buynest.example.com</a></li>'
                    .'<li>Phone: +1 (555) 010-2030</li></ul><p>We answer within one business day.</p>',
            ],
        ];
    }
};
