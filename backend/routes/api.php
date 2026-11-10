<?php

use App\Http\Controllers\Api\Admin\AdminAuthController;
use App\Http\Controllers\Api\Admin\AdminUserController;
use App\Http\Controllers\Api\Admin\AuditController;
use App\Http\Controllers\Api\Admin\CategoryController as AdminCategoryController;
use App\Http\Controllers\Api\Admin\CouponController;
use App\Http\Controllers\Api\Admin\CreditMemoController;
use App\Http\Controllers\Api\Admin\CustomerController as AdminCustomerController;
use App\Http\Controllers\Api\Admin\HomeController as AdminHomeController;
use App\Http\Controllers\Api\Admin\InvoiceController;
use App\Http\Controllers\Api\Admin\OrderController as AdminOrderController;
use App\Http\Controllers\Api\Admin\OverviewController;
use App\Http\Controllers\Api\Admin\PageController as AdminPageController;
use App\Http\Controllers\Api\Admin\ProductController as AdminProductController;
use App\Http\Controllers\Api\Admin\ReportController;
use App\Http\Controllers\Api\Admin\RoleController;
use App\Http\Controllers\Api\Admin\SettingsController;
use App\Http\Controllers\Api\Admin\ShipmentController;
use App\Http\Controllers\Api\V1\CartController;
use App\Http\Controllers\Api\V1\CatalogController;
use App\Http\Controllers\Api\V1\ContentController;
use App\Http\Controllers\Api\V1\CustomerAuthController;
use App\Http\Controllers\Api\V1\OrderController;
use App\Http\Controllers\Api\V1\ProfileController;
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
        Route::get('orders/{number}/invoices/{invoice}', [OrderController::class, 'invoice']);
    });

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

    Route::middleware(['auth:sanctum', 'token.kind:admin', 'throttle:api'])->group(function () {
        Route::post('auth/logout', [AdminAuthController::class, 'logout']);
        Route::get('me', [AdminAuthController::class, 'me']);

        Route::get('overview', OverviewController::class)->middleware('can.admin:dashboard.view');

        Route::get('customers', [AdminCustomerController::class, 'index'])->middleware('can.admin:customers.view');
        Route::get('customers/{customer}', [AdminCustomerController::class, 'show'])->whereNumber('customer')->middleware('can.admin:customers.view');
        Route::patch('customers/{customer}', [AdminCustomerController::class, 'update'])->whereNumber('customer')->middleware('can.admin:customers.edit');

        // Categories are listed for the product form, so products.view is enough.
        Route::get('categories', [AdminCategoryController::class, 'index'])->middleware('can.admin:products.view');
        Route::get('products', [AdminProductController::class, 'index'])->middleware('can.admin:products.view');
        Route::post('products', [AdminProductController::class, 'store'])->middleware('can.admin:products.edit');
        Route::get('products/{id}', [AdminProductController::class, 'show'])->whereNumber('id')->middleware('can.admin:products.view');
        Route::patch('products/{id}', [AdminProductController::class, 'update'])->whereNumber('id')->middleware('can.admin:products.edit');
        Route::delete('products/{id}', [AdminProductController::class, 'destroy'])->whereNumber('id')->middleware('can.admin:products.delete');

        Route::get('orders', [AdminOrderController::class, 'index'])->middleware('can.admin:orders.view');
        Route::get('orders/{number}', [AdminOrderController::class, 'show'])->middleware('can.admin:orders.view');
        Route::patch('orders/{number}', [AdminOrderController::class, 'update'])->middleware('can.admin:orders.edit');

        // Phase 3: order documents (invoice = payment, shipment = tracking, credit memo = refund).
        Route::post('orders/{number}/invoices', [InvoiceController::class, 'store'])->middleware('can.admin:invoices.create');
        Route::post('orders/{number}/shipments', [ShipmentController::class, 'store'])->middleware('can.admin:shipments.create');
        Route::get('orders/{number}/refundable', [CreditMemoController::class, 'refundable'])->middleware('can.admin:orders.view');
        Route::post('orders/{number}/credit-memos', [CreditMemoController::class, 'store'])->middleware('can.admin:credit_memos.create');
        Route::get('invoices', [InvoiceController::class, 'index'])->middleware('can.admin:orders.view');
        Route::get('invoices/{number}', [InvoiceController::class, 'show'])->middleware('can.admin:orders.view');
        Route::get('credit-memos', [CreditMemoController::class, 'index'])->middleware('can.admin:orders.view');
        Route::get('credit-memos/{number}', [CreditMemoController::class, 'show'])->middleware('can.admin:orders.view');

        Route::get('coupons', [CouponController::class, 'index'])->middleware('can.admin:coupons.view');
        Route::post('coupons', [CouponController::class, 'store'])->middleware('can.admin:coupons.edit');
        Route::get('coupons/{id}', [CouponController::class, 'show'])->whereNumber('id')->middleware('can.admin:coupons.view');
        Route::patch('coupons/{id}', [CouponController::class, 'update'])->whereNumber('id')->middleware('can.admin:coupons.edit');
        Route::delete('coupons/{id}', [CouponController::class, 'destroy'])->whereNumber('id')->middleware('can.admin:coupons.edit');

        // Phase 4: admin users, roles, audit log, content, reports, settings.
        Route::middleware('can.admin:admins.manage')->group(function () {
            Route::get('admins', [AdminUserController::class, 'index']);
            Route::post('admins', [AdminUserController::class, 'store']);
            Route::get('admins/{id}', [AdminUserController::class, 'show'])->whereNumber('id');
            Route::patch('admins/{id}', [AdminUserController::class, 'update'])->whereNumber('id');
            Route::post('admins/{id}/reset-password', [AdminUserController::class, 'resetPassword'])->whereNumber('id');
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
    });
});
