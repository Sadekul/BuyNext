<?php

use App\Http\Controllers\Api\Admin\AdminAuthController;
use App\Http\Controllers\Api\Admin\CustomerController as AdminCustomerController;
use App\Http\Controllers\Api\V1\CustomerAuthController;
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
    });
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
    });
});
