<?php

use App\Http\Controllers\Api\Admin\AdminAuthController;
use App\Http\Controllers\Api\Admin\CategoryController as AdminCategoryController;
use App\Http\Controllers\Api\Admin\CustomerController as AdminCustomerController;
use App\Http\Controllers\Api\Admin\OrderController as AdminOrderController;
use App\Http\Controllers\Api\Admin\OverviewController;
use App\Http\Controllers\Api\Admin\ProductController as AdminProductController;
use App\Http\Controllers\Api\V1\CartController;
use App\Http\Controllers\Api\V1\CatalogController;
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
    });

    // Public: the catalog and cart pricing (no sign-in).
    Route::middleware('throttle:api')->group(function () {
        Route::get('products', [CatalogController::class, 'index']);
        Route::get('products/{id}', [CatalogController::class, 'show'])->whereNumber('id');
        Route::get('categories', [CatalogController::class, 'categories']);
        Route::post('cart/validate', [CartController::class, 'validateCart']);
    });

    // Guests and customers both check out here (customer.optional: a token, if sent, must be a customer's).
    Route::post('orders', [OrderController::class, 'store'])->middleware(['customer.optional', 'throttle:orders']);
    // Guest order lookup: limited like sign-in, so order numbers can't be guessed quickly.
    Route::post('orders/lookup', [OrderController::class, 'lookup'])->middleware('throttle:auth');
});

Route::prefix('admin/v1')->group(function () {
    Route::prefix('auth')->middleware('throttle:auth')->controller(AdminAuthController::class)->group(function () {
        Route::post('login', 'login');
        Route::post('refresh', 'refresh');
    });

    Route::middleware(['auth:sanctum', 'token.kind:admin', 'throttle:api'])->group(function () {
        Route::post('auth/logout', [AdminAuthController::class, 'logout']);
        Route::get('me', [AdminAuthController::class, 'me']);
        Route::get('customers', [AdminCustomerController::class, 'index']);
        Route::get('customers/{customer}', [AdminCustomerController::class, 'show'])->whereNumber('customer');
        Route::patch('customers/{customer}', [AdminCustomerController::class, 'update'])->whereNumber('customer');

        Route::get('overview', OverviewController::class);
        Route::get('categories', [AdminCategoryController::class, 'index']);
        Route::get('products', [AdminProductController::class, 'index']);
        Route::post('products', [AdminProductController::class, 'store']);
        Route::get('products/{id}', [AdminProductController::class, 'show'])->whereNumber('id');
        Route::patch('products/{id}', [AdminProductController::class, 'update'])->whereNumber('id');
        Route::delete('products/{id}', [AdminProductController::class, 'destroy'])->whereNumber('id');
        Route::get('orders', [AdminOrderController::class, 'index']);
        Route::get('orders/{number}', [AdminOrderController::class, 'show']);
        Route::patch('orders/{number}', [AdminOrderController::class, 'update']);
    });
});
