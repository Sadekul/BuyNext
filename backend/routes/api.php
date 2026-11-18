<?php

use App\Http\Controllers\Api\Admin\AbandonedCartController;
use App\Http\Controllers\Api\Admin\AdminAuthController;
use App\Http\Controllers\Api\Admin\AdminUserController;
use App\Http\Controllers\Api\Admin\AuditController;
use App\Http\Controllers\Api\Admin\BackupController;
use App\Http\Controllers\Api\Admin\CatalogRuleController;
use App\Http\Controllers\Api\Admin\CategoryController as AdminCategoryController;
use App\Http\Controllers\Api\Admin\CouponController;
use App\Http\Controllers\Api\Admin\CreditMemoController;
use App\Http\Controllers\Api\Admin\CustomerAddressController;
use App\Http\Controllers\Api\Admin\CustomerController as AdminCustomerController;
use App\Http\Controllers\Api\Admin\CustomerGroupController;
use App\Http\Controllers\Api\Admin\CustomerNoteController;
use App\Http\Controllers\Api\Admin\DocumentPdfController;
use App\Http\Controllers\Api\Admin\EmailTemplateController;
use App\Http\Controllers\Api\Admin\GiftCardController as AdminGiftCardController;
use App\Http\Controllers\Api\Admin\HomeController as AdminHomeController;
use App\Http\Controllers\Api\Admin\InvoiceController;
use App\Http\Controllers\Api\Admin\NewsletterCampaignController;
use App\Http\Controllers\Api\Admin\NewsletterSubscriberController;
use App\Http\Controllers\Api\Admin\NotificationController;
use App\Http\Controllers\Api\Admin\OrderBulkController;
use App\Http\Controllers\Api\Admin\OrderController as AdminOrderController;
use App\Http\Controllers\Api\Admin\OrderCreateController;
use App\Http\Controllers\Api\Admin\OverviewController;
use App\Http\Controllers\Api\Admin\PageController as AdminPageController;
use App\Http\Controllers\Api\Admin\PreferenceController;
use App\Http\Controllers\Api\Admin\ProductBulkController;
use App\Http\Controllers\Api\Admin\ProductController as AdminProductController;
use App\Http\Controllers\Api\Admin\ProductImageController;
use App\Http\Controllers\Api\Admin\ProductTransferController;
use App\Http\Controllers\Api\Admin\ProductVariantController;
use App\Http\Controllers\Api\Admin\ReportController;
use App\Http\Controllers\Api\Admin\ReturnController as AdminReturnController;
use App\Http\Controllers\Api\Admin\ReviewController as AdminReviewController;
use App\Http\Controllers\Api\Admin\RoleController;
use App\Http\Controllers\Api\Admin\SearchTermController;
use App\Http\Controllers\Api\Admin\SettingsController;
use App\Http\Controllers\Api\Admin\ShipmentController;
use App\Http\Controllers\Api\Admin\ShippingRateController;
use App\Http\Controllers\Api\Admin\StockAlertReportController;
use App\Http\Controllers\Api\Admin\TwoFactorController;
use App\Http\Controllers\Api\Admin\UrlRedirectController;
use App\Http\Controllers\Api\V1\AddressController;
use App\Http\Controllers\Api\V1\CartController;
use App\Http\Controllers\Api\V1\CatalogController;
use App\Http\Controllers\Api\V1\ClientErrorController;
use App\Http\Controllers\Api\V1\ContentController;
use App\Http\Controllers\Api\V1\CustomerAuthController;
use App\Http\Controllers\Api\V1\CustomerCartController;
use App\Http\Controllers\Api\V1\GiftCardController;
use App\Http\Controllers\Api\V1\InvoicePdfController;
use App\Http\Controllers\Api\V1\MyAccountController;
use App\Http\Controllers\Api\V1\NewsletterController;
use App\Http\Controllers\Api\V1\OrderController;
use App\Http\Controllers\Api\V1\PayPalWebhookController;
use App\Http\Controllers\Api\V1\ProfileController;
use App\Http\Controllers\Api\V1\ReturnController;
use App\Http\Controllers\Api\V1\ReviewController;
use App\Http\Controllers\Api\V1\SeoController;
use App\Http\Controllers\Api\V1\StockAlertController;
use App\Http\Controllers\Api\V1\StripeWebhookController;
use Illuminate\Support\Facades\Route;

/*
 * Storefront API (customers): /api/v1/...
 * Admin API (shop staff):     /api/admin/v1/...
 * Customer and admin tokens are different kinds (TokenPairs); token.kind
 * refuses the wrong kind on every route.
 */

Route::prefix('v1')->group(function () {
    Route::prefix('auth')->middleware('throttle:auth')->controller(CustomerAuthController::class)->group(function () {
        Route::post('register', 'register');
        Route::post('verify-email', 'verifyEmail');
        Route::post('resend-code', 'resendCode');
        Route::post('login', 'login');
        Route::post('refresh', 'refresh');
        Route::post('forgot-password', 'forgotPassword');
        Route::post('reset-password', 'resetPassword');
    });

    Route::middleware(['auth:sanctum', 'token.kind:customer', 'throttle:api'])->group(function () {
        Route::post('auth/logout', [CustomerAuthController::class, 'logout']);
        Route::get('me', [ProfileController::class, 'show']);
        Route::patch('me', [ProfileController::class, 'update']);
        Route::get('orders', [OrderController::class, 'index']);
        Route::get('orders/{number}', [OrderController::class, 'show']);
        Route::get('orders/{number}/invoices/{invoice}', [OrderController::class, 'invoice'])->where('invoice', '[^/.]+'); // phase 10 (part A): "….pdf" is the PDF route
        // Phase 6: the address book and returns.
        Route::get('me/addresses', [AddressController::class, 'index']);
        Route::post('me/addresses', [AddressController::class, 'store']);
        Route::patch('me/addresses/{id}', [AddressController::class, 'update'])->whereNumber('id');
        Route::delete('me/addresses/{id}', [AddressController::class, 'destroy'])->whereNumber('id');
        Route::post('orders/{number}/returns', [ReturnController::class, 'store']);
        Route::get('returns', [ReturnController::class, 'index']);
        Route::get('returns/{number}', [ReturnController::class, 'show']);
        // Phase 7: newsletter, templates, SEO, carts, dashboard, notifications (part B) - the saved cart.
        Route::get('me/cart', [CustomerCartController::class, 'show']);
        Route::post('me/cart/merge', [CustomerCartController::class, 'merge']);
        // Phase 9 (part A): change email (code to the new address), download my data, delete my account.
        Route::post('me/email', [MyAccountController::class, 'requestEmailChange'])->middleware('throttle:account-codes');
        Route::post('me/email/confirm', [MyAccountController::class, 'confirmEmailChange'])->middleware('throttle:account-codes');
        Route::get('me/export', [MyAccountController::class, 'export'])->middleware('throttle:data-export');
        Route::post('me/delete', [MyAccountController::class, 'destroy'])->middleware('throttle:account-codes');
        // End of phase 9 part A store routes (signed in).
        // Phase 9 (part B): the account's "back in stock" alerts.
        Route::get('me/stock-alerts', [StockAlertController::class, 'index']);
        Route::delete('me/stock-alerts/{id}', [StockAlertController::class, 'destroy'])->whereNumber('id');
        // End of phase 9 part B store routes (signed in).
    });

    // Phase 7: newsletter, templates, SEO, carts, dashboard, notifications (part B) - public store routes.
    Route::middleware('throttle:newsletter')->controller(NewsletterController::class)->group(function () {
        Route::post('newsletter', 'subscribe');
        Route::post('newsletter/confirm', 'confirm');
        Route::post('newsletter/unsubscribe', 'unsubscribe');
    });
    Route::middleware('throttle:api')->group(function () {
        Route::get('sitemap.xml', [SeoController::class, 'sitemap']);
        Route::get('redirects', [SeoController::class, 'redirect']);
    });
    // End of phase 7 part B store routes.

    // Phase 5: customers write reviews (10 per hour per customer; staff approve them unless Settings → Catalog says otherwise).
    Route::post('products/{id}/reviews', [ReviewController::class, 'store'])->whereNumber('id')
        ->middleware(['auth:sanctum', 'token.kind:customer', 'throttle:reviews']);

    // Public: the catalog and cart pricing (no sign-in).
    Route::middleware('throttle:api')->group(function () {
        Route::get('products', [CatalogController::class, 'index']);
        Route::get('products/{id}', [CatalogController::class, 'show'])->whereNumber('id');
        Route::get('categories', [CatalogController::class, 'categories']);
        // Phase 4: the home page, content pages, and the store's rules (shipping, countries, payment, tax).
        Route::get('home', [ContentController::class, 'home']);
        Route::get('pages/{slug}', [ContentController::class, 'page'])->where('slug', '[a-z0-9-]+');
        Route::get('store', [ContentController::class, 'store']);
    });
    // Cart pricing: public, but a customer token (optional) identifies the shopper for per-customer coupon limits.
    Route::post('cart/validate', [CartController::class, 'validateCart'])->middleware(['customer.optional', 'throttle:api']);

    // Guests and customers both check out here (customer.optional: a token, if sent, must be a customer's).
    Route::post('orders', [OrderController::class, 'store'])->middleware(['customer.optional', 'throttle:orders']);
    // Guest order lookup: limited like sign-in, so order numbers can't be guessed quickly.
    Route::post('orders/lookup', [OrderController::class, 'lookup'])->middleware('throttle:auth');
    // Phase 10 (part A): an invoice as a PDF: the order's customer, or the order's email (?email=, the lookup's proof), limited like the lookup.
    Route::get('orders/{number}/invoices/{invoice}.pdf', InvoicePdfController::class)->where('invoice', '[^/.]+')
        ->middleware(['customer.optional', 'throttle:auth']);

    // Phase 8: Stripe card payments. Pay now: the order's customer, or the order's email (the lookup's proof), limited like the lookup.
    Route::post('orders/{number}/pay', [OrderController::class, 'pay'])->middleware(['customer.optional', 'throttle:auth']);
    // Phase 9 (part A): customers (and guests with the order's email) cancel an unpaid, unshipped order.
    Route::post('orders/{number}/cancel', [OrderController::class, 'cancel'])->middleware(['customer.optional', 'throttle:auth']);
    // Stripe's webhook: no sign-in (the signature is the proof), its own rate limit.
    Route::post('payments/stripe/webhook', StripeWebhookController::class)->middleware('throttle:stripe-webhooks');

    // Phase 10 (part B): PayPal (capture after the approval, its webhook) and gift card balance checks.
    Route::post('orders/{number}/paypal/capture', [OrderController::class, 'paypalCapture'])->middleware(['customer.optional', 'throttle:auth']);
    Route::post('payments/paypal/webhook', PayPalWebhookController::class)->middleware('throttle:paypal-webhooks');
    Route::post('gift-cards/check', [GiftCardController::class, 'check'])->middleware('throttle:gift-card-check');
    // End of phase 10 part B store routes.

    // Phase 9 (part B): "email me when it's back" (guests and customers), its "stop these alerts" link,
    // and browser error reports (only from the sign-in service: the shared key is always required).
    Route::post('products/{id}/stock-alerts', [StockAlertController::class, 'store'])->whereNumber('id')
        ->middleware(['customer.optional', 'throttle:stock-alerts']);
    Route::post('stock-alerts/unsubscribe', [StockAlertController::class, 'unsubscribe'])->middleware('throttle:stock-alerts');
    Route::post('client-errors', ClientErrorController::class)->middleware(['bff.key:always', 'throttle:client-errors']);
    // End of phase 9 part B public store routes.
});

/*
 * Every admin route names the permission it needs (can.admin:<key>, keys in
 * App\Support\Permissions). Only signing in/out and "who am I" don't:
 * tests/Feature/AdminPermissionsTest fails if any other route forgets one.
 */
Route::prefix('admin/v1')->group(function () {
    Route::prefix('auth')->middleware('throttle:auth')->controller(AdminAuthController::class)->group(function () {
        Route::post('login', 'login');
        Route::post('refresh', 'refresh');
    });

    // Phase 9 (part A): two-step sign-in. The second step needs no token (the challenge is the proof).
    Route::post('auth/two-factor', [AdminAuthController::class, 'twoFactor'])->middleware('throttle:two-factor');
    // These also accept the limited setup token (token.kind:admin,setup), so an admin who must set up
    // two-step sign-in can do it; nothing else does (EnsureTokenKind, tests/Feature/AdminTwoFactorTest).
    Route::middleware(['auth:sanctum', 'token.kind:admin,setup', 'throttle:api'])->group(function () {
        Route::post('auth/logout', [AdminAuthController::class, 'logout']);
        Route::get('me', [AdminAuthController::class, 'me']);
        Route::post('me/two-factor', [TwoFactorController::class, 'begin']);
        Route::post('me/two-factor/confirm', [TwoFactorController::class, 'confirm']);
    });
    // End of phase 9 part A setup routes.

    Route::middleware(['auth:sanctum', 'token.kind:admin', 'throttle:api'])->group(function () {
        // Phase 9 (part A): the signed-in admin's own two-step sign-in (no permission key).
        Route::post('me/two-factor/recovery-codes', [TwoFactorController::class, 'recoveryCodes']);
        Route::delete('me/two-factor', [TwoFactorController::class, 'disable']);

        Route::get('overview', OverviewController::class)->middleware('can.admin:dashboard.view');

        Route::get('customers', [AdminCustomerController::class, 'index'])->middleware('can.admin:customers.view');
        // Phase 6: the full customer profile, create, delete, export, addresses, notes, password reset, groups.
        Route::get('customers/export.csv', [AdminCustomerController::class, 'export'])->middleware('can.admin:customers.view');
        Route::post('customers', [AdminCustomerController::class, 'store'])->middleware('can.admin:customers.create');
        Route::whereNumber(['id', 'address'])->group(function () {
            Route::get('customers/{id}', [AdminCustomerController::class, 'show'])->middleware('can.admin:customers.view');
            Route::patch('customers/{id}', [AdminCustomerController::class, 'update'])->middleware('can.admin:customers.edit');
            Route::delete('customers/{id}', [AdminCustomerController::class, 'destroy'])->middleware('can.admin:customers.delete');
            Route::post('customers/{id}/password-reset', [AdminCustomerController::class, 'passwordReset'])->middleware('can.admin:customers.edit');
            Route::get('customers/{id}/addresses', [CustomerAddressController::class, 'index'])->middleware('can.admin:customers.view');
            Route::post('customers/{id}/addresses', [CustomerAddressController::class, 'store'])->middleware('can.admin:customers.edit');
            Route::patch('customers/{id}/addresses/{address}', [CustomerAddressController::class, 'update'])->middleware('can.admin:customers.edit');
            Route::delete('customers/{id}/addresses/{address}', [CustomerAddressController::class, 'destroy'])->middleware('can.admin:customers.edit');
            Route::get('customers/{id}/notes', [CustomerNoteController::class, 'index'])->middleware('can.admin:customers.view');
            Route::post('customers/{id}/notes', [CustomerNoteController::class, 'store'])->middleware('can.admin:customers.edit');
        });
        Route::get('customer-groups', [CustomerGroupController::class, 'index'])->middleware('can.admin:customers.view|coupons.view|price_rules.manage');
        Route::post('customer-groups', [CustomerGroupController::class, 'store'])->middleware('can.admin:customer_groups.manage');
        Route::patch('customer-groups/{id}', [CustomerGroupController::class, 'update'])->whereNumber('id')->middleware('can.admin:customer_groups.manage');
        Route::delete('customer-groups/{id}', [CustomerGroupController::class, 'destroy'])->whereNumber('id')->middleware('can.admin:customer_groups.manage');

        // Categories are listed for the product form, so products.view is enough.
        Route::get('categories', [AdminCategoryController::class, 'index'])->middleware('can.admin:products.view|coupons.view|price_rules.manage');
        // Phase 5: the category tree.
        Route::post('categories', [AdminCategoryController::class, 'store'])->middleware('can.admin:categories.edit');
        Route::post('categories/reorder', [AdminCategoryController::class, 'reorder'])->middleware('can.admin:categories.edit');
        Route::patch('categories/{id}', [AdminCategoryController::class, 'update'])->whereNumber('id')->middleware('can.admin:categories.edit');
        Route::delete('categories/{id}', [AdminCategoryController::class, 'destroy'])->whereNumber('id')->middleware('can.admin:categories.edit');

        Route::get('products', [AdminProductController::class, 'index'])->middleware('can.admin:products.view|coupons.view|price_rules.manage');
        // Phase 5: CSV import/export, mass actions (delete also checks products.delete).
        Route::get('products/export.csv', [ProductTransferController::class, 'export'])->middleware('can.admin:products.import');
        Route::post('products/import', [ProductTransferController::class, 'import'])->middleware('can.admin:products.import');
        Route::post('products/bulk', ProductBulkController::class)->middleware('can.admin:products.edit');
        Route::post('products', [AdminProductController::class, 'store'])->middleware('can.admin:products.edit');
        Route::get('products/{id}', [AdminProductController::class, 'show'])->whereNumber('id')->middleware('can.admin:products.view');
        Route::patch('products/{id}', [AdminProductController::class, 'update'])->whereNumber('id')->middleware('can.admin:products.edit');
        Route::delete('products/{id}', [AdminProductController::class, 'destroy'])->whereNumber('id')->middleware('can.admin:products.delete');

        // Phase 5: uploaded images, options and variants.
        Route::middleware('can.admin:products.edit')->whereNumber(['id', 'image', 'variant'])->group(function () {
            Route::post('products/{id}/images', [ProductImageController::class, 'store']);
            Route::post('products/{id}/images/reorder', [ProductImageController::class, 'reorder']);
            Route::patch('products/{id}/images/{image}', [ProductImageController::class, 'update']);
            Route::delete('products/{id}/images/{image}', [ProductImageController::class, 'destroy']);
            Route::put('products/{id}/options', [ProductVariantController::class, 'options']);
            Route::post('products/{id}/variants/generate', [ProductVariantController::class, 'generate']);
            Route::patch('products/{id}/variants/{variant}', [ProductVariantController::class, 'update']);
        });

        // Phase 5: review moderation.
        Route::get('reviews', [AdminReviewController::class, 'index'])->middleware('can.admin:reviews.view');
        Route::post('reviews/bulk', [AdminReviewController::class, 'bulk'])->middleware('can.admin:reviews.moderate');
        Route::patch('reviews/{id}', [AdminReviewController::class, 'update'])->whereNumber('id')->middleware('can.admin:reviews.moderate');
        Route::delete('reviews/{id}', [AdminReviewController::class, 'destroy'])->whereNumber('id')->middleware('can.admin:reviews.moderate');

        Route::get('orders', [AdminOrderController::class, 'index'])->middleware('can.admin:orders.view');
        // Phase 6: phone orders, CSV export, mass actions (each action also checks its own permission), packing slips.
        Route::get('orders/export.csv', [AdminOrderController::class, 'export'])->middleware('can.admin:orders.view');
        Route::post('orders/quote', [OrderCreateController::class, 'quote'])->middleware('can.admin:orders.create');
        Route::post('orders/bulk', OrderBulkController::class)->middleware('can.admin:orders.view');
        Route::post('orders', [OrderCreateController::class, 'store'])->middleware('can.admin:orders.create');
        Route::get('orders/{number}/packing-slip', [AdminOrderController::class, 'packingSlip'])->middleware('can.admin:orders.view');
        Route::get('orders/{number}', [AdminOrderController::class, 'show'])->middleware('can.admin:orders.view');
        // Phase 8: a (new) Stripe payment link for an unpaid card order, to copy and send.
        Route::post('orders/{number}/payment-link', [AdminOrderController::class, 'paymentLink'])->middleware('can.admin:orders.edit');
        Route::patch('orders/{number}', [AdminOrderController::class, 'update'])->middleware('can.admin:orders.edit');

        // Phase 3: order documents (invoice = payment, shipment = tracking, credit memo = refund).
        Route::post('orders/{number}/invoices', [InvoiceController::class, 'store'])->middleware('can.admin:invoices.create');
        Route::post('orders/{number}/shipments', [ShipmentController::class, 'store'])->middleware('can.admin:shipments.create');
        Route::get('orders/{number}/refundable', [CreditMemoController::class, 'refundable'])->middleware('can.admin:orders.view');
        Route::post('orders/{number}/credit-memos', [CreditMemoController::class, 'store'])->middleware('can.admin:credit_memos.create');
        Route::get('invoices', [InvoiceController::class, 'index'])->middleware('can.admin:orders.view');
        Route::get('invoices/{number}', [InvoiceController::class, 'show'])->where('number', '[^/.]+')->middleware('can.admin:orders.view');
        Route::get('credit-memos', [CreditMemoController::class, 'index'])->middleware('can.admin:orders.view');
        Route::get('credit-memos/{number}', [CreditMemoController::class, 'show'])->where('number', '[^/.]+')->middleware('can.admin:orders.view');
        // Phase 10 (part A): the documents as PDF files.
        Route::get('invoices/{number}.pdf', [DocumentPdfController::class, 'invoice'])->where('number', '[^/.]+')->middleware('can.admin:orders.view');
        Route::get('credit-memos/{number}.pdf', [DocumentPdfController::class, 'creditMemo'])->where('number', '[^/.]+')->middleware('can.admin:orders.view');
        // End of phase 10 part A admin routes.
        // Phase 6: the shipments list, and returns (RMA).
        Route::get('shipments', [ShipmentController::class, 'index'])->middleware('can.admin:orders.view');
        Route::get('shipments/{number}', [ShipmentController::class, 'show'])->middleware('can.admin:orders.view');
        Route::get('returns', [AdminReturnController::class, 'index'])->middleware('can.admin:returns.view');
        Route::get('returns/{number}', [AdminReturnController::class, 'show'])->middleware('can.admin:returns.view');
        Route::patch('returns/{number}', [AdminReturnController::class, 'update'])->middleware('can.admin:returns.manage');
        Route::post('orders/{number}/returns', [AdminReturnController::class, 'store'])->middleware('can.admin:returns.manage');

        Route::get('coupons', [CouponController::class, 'index'])->middleware('can.admin:coupons.view');
        Route::post('coupons', [CouponController::class, 'store'])->middleware('can.admin:coupons.edit');
        Route::get('coupons/{id}', [CouponController::class, 'show'])->whereNumber('id')->middleware('can.admin:coupons.view');
        Route::patch('coupons/{id}', [CouponController::class, 'update'])->whereNumber('id')->middleware('can.admin:coupons.edit');
        Route::delete('coupons/{id}', [CouponController::class, 'destroy'])->whereNumber('id')->middleware('can.admin:coupons.edit');

        // Phase 7: price rules and search terms (part A). Catalog price rules are read with coupons.view.
        Route::get('catalog-rules', [CatalogRuleController::class, 'index'])->middleware('can.admin:coupons.view');
        Route::post('catalog-rules', [CatalogRuleController::class, 'store'])->middleware('can.admin:price_rules.manage');
        Route::whereNumber('id')->group(function () {
            Route::get('catalog-rules/{id}', [CatalogRuleController::class, 'show'])->middleware('can.admin:coupons.view');
            Route::get('catalog-rules/{id}/preview', [CatalogRuleController::class, 'preview'])->middleware('can.admin:coupons.view');
            Route::patch('catalog-rules/{id}', [CatalogRuleController::class, 'update'])->middleware('can.admin:price_rules.manage');
            Route::delete('catalog-rules/{id}', [CatalogRuleController::class, 'destroy'])->middleware('can.admin:price_rules.manage');
            Route::patch('search-terms/{id}', [SearchTermController::class, 'update'])->middleware('can.admin:seo.manage');
            Route::delete('search-terms/{id}', [SearchTermController::class, 'destroy'])->middleware('can.admin:seo.manage');
        });
        Route::get('search-terms', [SearchTermController::class, 'index'])->middleware('can.admin:seo.manage');
        Route::post('search-terms', [SearchTermController::class, 'store'])->middleware('can.admin:seo.manage');
        Route::get('reports/search-terms', [SearchTermController::class, 'report'])->middleware('can.admin:reports.view');
        // End of phase 7 part A routes.

        // Phase 7: newsletter, templates, SEO, carts, dashboard, notifications (part B).
        Route::get('newsletter/subscribers', [NewsletterSubscriberController::class, 'index'])->middleware('can.admin:newsletter.view');
        Route::get('newsletter/subscribers/export.csv', [NewsletterSubscriberController::class, 'export'])->middleware('can.admin:newsletter.view');
        Route::post('newsletter/subscribers/{id}/unsubscribe', [NewsletterSubscriberController::class, 'unsubscribe'])->whereNumber('id')->middleware('can.admin:newsletter.send');
        Route::get('newsletter/campaigns', [NewsletterCampaignController::class, 'index'])->middleware('can.admin:newsletter.view');
        Route::post('newsletter/campaigns', [NewsletterCampaignController::class, 'store'])->middleware('can.admin:newsletter.send');
        Route::whereNumber('id')->controller(NewsletterCampaignController::class)->group(function () {
            Route::get('newsletter/campaigns/{id}', 'show')->middleware('can.admin:newsletter.view');
            Route::patch('newsletter/campaigns/{id}', 'update')->middleware('can.admin:newsletter.send');
            Route::delete('newsletter/campaigns/{id}', 'destroy')->middleware('can.admin:newsletter.send');
            Route::post('newsletter/campaigns/{id}/test', 'test')->middleware('can.admin:newsletter.send');
            Route::post('newsletter/campaigns/{id}/send', 'send')->middleware('can.admin:newsletter.send');
        });
        Route::middleware('can.admin:email_templates.manage')->controller(EmailTemplateController::class)->group(function () {
            Route::get('email-templates', 'index');
            Route::get('email-templates/{key}', 'show');
            Route::put('email-templates/{key}', 'update');
            Route::post('email-templates/{key}/preview', 'preview');
            Route::post('email-templates/{key}/test', 'test');
            Route::post('email-templates/{key}/reset', 'reset');
        });
        Route::middleware('can.admin:seo.manage')->controller(UrlRedirectController::class)->group(function () {
            Route::get('redirects', 'index');
            Route::post('redirects', 'store');
            Route::post('redirects/import', 'import');
            Route::get('redirects/{id}', 'show')->whereNumber('id');
            Route::patch('redirects/{id}', 'update')->whereNumber('id');
            Route::delete('redirects/{id}', 'destroy')->whereNumber('id');
        });
        Route::get('reports/abandoned-carts', [AbandonedCartController::class, 'index'])->middleware('can.admin:reports.view');
        Route::post('reports/abandoned-carts/{customer}/remind', [AbandonedCartController::class, 'remind'])->whereNumber('customer')->middleware('can.admin:newsletter.send');
        // No permission key: filtered by each notification's own permission / the admin's own preferences.
        Route::get('notifications', [NotificationController::class, 'index']);
        Route::post('notifications/read-all', [NotificationController::class, 'readAll']);
        Route::post('notifications/{id}/read', [NotificationController::class, 'read'])->whereNumber('id');
        Route::get('preferences/{key}', [PreferenceController::class, 'show'])->where('key', '[a-z_]+');
        Route::put('preferences/{key}', [PreferenceController::class, 'update'])->where('key', '[a-z_]+');
        // End of phase 7 part B admin routes.

        // Phase 4: admin users, roles, audit log, content, reports, settings.
        Route::middleware('can.admin:admins.manage')->group(function () {
            Route::get('admins', [AdminUserController::class, 'index']);
            Route::post('admins', [AdminUserController::class, 'store']);
            Route::get('admins/{id}', [AdminUserController::class, 'show'])->whereNumber('id');
            Route::patch('admins/{id}', [AdminUserController::class, 'update'])->whereNumber('id');
            Route::post('admins/{id}/reset-password', [AdminUserController::class, 'resetPassword'])->whereNumber('id');
            // Phase 9 (part A): Owner only (checked in the controller).
            Route::post('admins/{id}/two-factor/reset', [TwoFactorController::class, 'reset'])->whereNumber('id');
            Route::get('roles', [RoleController::class, 'index']);
            Route::post('roles', [RoleController::class, 'store']);
            Route::patch('roles/{id}', [RoleController::class, 'update'])->whereNumber('id');
            Route::delete('roles/{id}', [RoleController::class, 'destroy'])->whereNumber('id');
            Route::get('permissions', [RoleController::class, 'permissions']);
        });

        Route::get('audit', [AuditController::class, 'index'])->middleware('can.admin:audit.view');

        Route::get('pages', [AdminPageController::class, 'index'])->middleware('can.admin:content.view');
        Route::post('pages', [AdminPageController::class, 'store'])->middleware('can.admin:content.edit');
        Route::get('pages/{id}', [AdminPageController::class, 'show'])->whereNumber('id')->middleware('can.admin:content.view');
        Route::patch('pages/{id}', [AdminPageController::class, 'update'])->whereNumber('id')->middleware('can.admin:content.edit');
        Route::delete('pages/{id}', [AdminPageController::class, 'destroy'])->whereNumber('id')->middleware('can.admin:content.edit');
        Route::get('home', [AdminHomeController::class, 'show'])->middleware('can.admin:content.view');
        Route::put('home', [AdminHomeController::class, 'update'])->middleware('can.admin:content.edit');

        Route::prefix('reports')->middleware('can.admin:reports.view')->controller(ReportController::class)->group(function () {
            Route::get('sales', 'sales');
            Route::get('sales.csv', 'salesCsv');
            Route::get('products', 'products');
            Route::get('products.csv', 'productsCsv');
            Route::get('customers', 'customers');
            Route::get('coupons', 'coupons');
            Route::get('low-stock', 'lowStock');
        });

        Route::get('settings', [SettingsController::class, 'show'])->middleware('can.admin:settings.view');
        Route::patch('settings', [SettingsController::class, 'update'])->middleware('can.admin:settings.edit');

        // Phase 10 (part B): shipping table rates (Settings → Shipping) and gift cards (Marketing).
        Route::get('shipping-rates', [ShippingRateController::class, 'index'])->middleware('can.admin:settings.view');
        Route::get('shipping-rates/export.csv', [ShippingRateController::class, 'export'])->middleware('can.admin:settings.view');
        Route::post('shipping-rates/check', [ShippingRateController::class, 'check'])->middleware('can.admin:settings.view');
        Route::middleware('can.admin:settings.edit')->controller(ShippingRateController::class)->group(function () {
            Route::post('shipping-rates', 'store');
            Route::post('shipping-rates/import', 'import');
            Route::post('shipping-rates/reorder', 'reorder');
            Route::patch('shipping-rates/{id}', 'update')->whereNumber('id');
            Route::delete('shipping-rates/{id}', 'destroy')->whereNumber('id');
        });
        Route::get('gift-cards', [AdminGiftCardController::class, 'index'])->middleware('can.admin:gift_cards.view');
        Route::post('gift-cards', [AdminGiftCardController::class, 'store'])->middleware('can.admin:gift_cards.manage');
        Route::get('gift-cards/{id}', [AdminGiftCardController::class, 'show'])->whereNumber('id')->middleware('can.admin:gift_cards.view');
        Route::patch('gift-cards/{id}', [AdminGiftCardController::class, 'update'])->whereNumber('id')->middleware('can.admin:gift_cards.manage');
        Route::post('gift-cards/{id}/adjust', [AdminGiftCardController::class, 'adjust'])->whereNumber('id')->middleware('can.admin:gift_cards.manage');
        Route::get('reports/gift-cards', [AdminGiftCardController::class, 'report'])->middleware('can.admin:reports.view');
        // End of phase 10 part B admin routes.

        // Phase 9 (part B): Reports → Stock alerts, and System → Backups (Owner only by default).
        Route::get('reports/stock-alerts', StockAlertReportController::class)->middleware('can.admin:reports.view');
        // {name}: only buynest-YYYYMMDD-HHMMSS.sql.gz files of the backups disk (checked in the controller).
        Route::middleware('can.admin:backups.view')->controller(BackupController::class)->group(function () {
            Route::get('backups', 'index');
            Route::post('backups', 'store');
            Route::post('backups/{name}/link', 'link');
            Route::get('backups/{name}/download', 'download')->name('admin.backups.download');
        });
        // End of phase 9 part B admin routes.
    });
});
