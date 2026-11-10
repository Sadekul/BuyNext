<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\RegisterCustomerRequest;
use App\Http\Resources\CustomerResource;
use App\Models\Customer;
use App\Models\OneTimeCode;
use App\Services\OneTimeCodes;
use App\Services\TokenPairs;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

/**
 * Customer accounts: sign up → email code → signed in; sign in; renew; sign
 * out; forgot/reset password by email code.
 *
 * Answers never reveal whether an email has an account, except sign-up for an
 * already verified email (every store must say "you already have an account").
 */
class CustomerAuthController extends Controller
{
    public function __construct(private OneTimeCodes $codes, private TokenPairs $tokens) {}

    /** POST /api/v1/auth/register → 201; a 6-digit code is emailed. */
    public function register(RegisterCustomerRequest $request): JsonResponse
    {
        $data = $request->validated();
        $customer = Customer::where('email', $data['email'])->first();

        if ($customer?->hasVerifiedEmail()) {
            throw ValidationException::withMessages([
                'email' => 'An account with this email already exists. Sign in, or reset your password.',
            ]);
        }

        // An unverified sign-up for this email is replaced: whoever can read
        // the inbox decides which details and password the account gets.
        $customer ??= new Customer;
        $customer->fill(collect($data)->only(['first_name', 'last_name', 'email', 'phone', 'password'])->all())->save();

        $resendIn = $this->codes->send($customer->email, OneTimeCode::VERIFY_EMAIL, $customer->first_name);

        return response()->json([
            'message' => "We emailed a 6-digit code to {$customer->email}.",
            'data' => $this->codeInfo($customer->email, $resendIn),
        ], 201);
    }

    /** POST /api/v1/auth/verify-email { email, code, remember } → signed in. */
    public function verifyEmail(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'string', 'email', 'max:190'],
            'code' => ['required', 'string', 'regex:/^\d{6}$/'],
            'remember' => ['sometimes', 'boolean'],
        ], ['code.regex' => 'Enter the 6-digit code from the email.']);

        $customer = Customer::where('email', OneTimeCodes::normalize($data['email']))->first();
        $this->checkCode($data['email'], OneTimeCode::VERIFY_EMAIL, $data['code'], $customer !== null);

        if (! $customer->hasVerifiedEmail()) {
            $customer->email_verified_at = now();
        }
        if (! $customer->is_active) {
            return $this->disabled();
        }
        $customer->last_login_at = now();
        $customer->save();

        return $this->signedIn($customer, $request->boolean('remember'));
    }

    /** POST /api/v1/auth/resend-code { email, purpose } → always 200 (no account lookup leaks). */
    public function resendCode(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'string', 'email', 'max:190'],
            'purpose' => ['required', 'in:'.OneTimeCode::VERIFY_EMAIL.','.OneTimeCode::RESET_PASSWORD],
        ]);
        $email = OneTimeCodes::normalize($data['email']);
        $customer = Customer::where('email', $email)->first();

        $eligible = $customer && $customer->is_active && ($data['purpose'] === OneTimeCode::RESET_PASSWORD || ! $customer->hasVerifiedEmail());
        $resendIn = $eligible
            ? $this->codes->send($email, $data['purpose'], $customer->first_name)
            : config('buynest.codes.resend_cooldown_seconds');

        return response()->json([
            'message' => 'If that email needs a code, we sent a new one.',
            'data' => $this->codeInfo($email, $resendIn),
        ]);
    }

    /** POST /api/v1/auth/login { email, password, remember }. */
    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'string', 'email', 'max:190'],
            'password' => ['required', 'string', 'max:128'],
            'remember' => ['sometimes', 'boolean'],
        ]);
        $customer = Customer::where('email', OneTimeCodes::normalize($data['email']))->first();

        // Hash::check runs even without an account, so the response time doesn't tell whether the email exists.
        $passwordOk = Hash::check($data['password'], $customer?->password ?? '$2y$12$'.str_repeat('a', 53));
        if (! $customer || ! $passwordOk) {
            throw ValidationException::withMessages(['email' => 'The email or password is incorrect.']);
        }
        if (! $customer->is_active) {
            return $this->disabled();
        }
        if (! $customer->hasVerifiedEmail()) {
            $resendIn = $this->codes->send($customer->email, OneTimeCode::VERIFY_EMAIL, $customer->first_name);

            return response()->json([
                'message' => 'Please confirm your email first. We sent a code to '.$customer->email.'.',
                'code' => 'email_unverified',
                'data' => $this->codeInfo($customer->email, $resendIn),
            ], 403);
        }

        $customer->forceFill(['last_login_at' => now()])->save();

        return $this->signedIn($customer, $request->boolean('remember'));
    }

    /** POST /api/v1/auth/refresh { refresh_token } → a new token pair (the old one stops working). */
    public function refresh(Request $request): JsonResponse
    {
        $data = $request->validate(['refresh_token' => ['required', 'string', 'max:200']]);
        $tokens = $this->tokens->refresh($data['refresh_token'], TokenPairs::CUSTOMER);

        return $tokens
            ? response()->json(['data' => ['tokens' => $tokens]])
            : response()->json(['message' => 'Your session has expired. Please sign in again.'], 401);
    }

    /** POST /api/v1/auth/logout (access token) → this device is signed out. */
    public function logout(Request $request): JsonResponse
    {
        $this->tokens->revokePairOf($request->user()->currentAccessToken());

        return response()->json(['message' => 'Signed out.']);
    }

    /** POST /api/v1/auth/forgot-password { email } → always 200; a code is emailed if the account exists. */
    public function forgotPassword(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'string', 'email', 'max:190']]);
        $email = OneTimeCodes::normalize($data['email']);
        $customer = Customer::where('email', $email)->where('is_active', true)->first();

        $resendIn = $customer
            ? $this->codes->send($email, OneTimeCode::RESET_PASSWORD, $customer->first_name)
            : config('buynest.codes.resend_cooldown_seconds');

        return response()->json([
            'message' => "If an account exists for {$email}, we emailed it a 6-digit code.",
            'data' => $this->codeInfo($email, $resendIn),
        ]);
    }

    /** POST /api/v1/auth/reset-password { email, code, password, password_confirmation }. */
    public function resetPassword(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'string', 'email', 'max:190'],
            'code' => ['required', 'string', 'regex:/^\d{6}$/'],
            'password' => ['required', 'string', 'max:128', 'confirmed', Password::min(8)->letters()->numbers()],
        ], ['code.regex' => 'Enter the 6-digit code from the email.']);

        $customer = Customer::where('email', OneTimeCodes::normalize($data['email']))->first();
        $this->checkCode($data['email'], OneTimeCode::RESET_PASSWORD, $data['code'], $customer !== null);

        $customer->password = $data['password'];
        // Reading the code proves they own the inbox.
        $customer->email_verified_at ??= now();
        $customer->save();
        $this->tokens->revokeAll($customer); // every other device is signed out

        return response()->json(['message' => 'Your password has been changed. Sign in with the new password.']);
    }

    private function checkCode(string $email, string $purpose, string $code, bool $accountExists): void
    {
        $result = $accountExists ? $this->codes->verify($email, $purpose, $code) : 'invalid';
        if ($result === 'locked') {
            throw ValidationException::withMessages(['code' => 'Too many wrong attempts. Ask for a new code.']);
        }
        if ($result !== 'ok') {
            throw ValidationException::withMessages(['code' => 'That code is incorrect or has expired.']);
        }
    }

    private function signedIn(Customer $customer, bool $remember): JsonResponse
    {
        return response()->json([
            'data' => [
                'customer' => new CustomerResource($customer),
                'tokens' => $this->tokens->issue($customer, $remember),
            ],
        ]);
    }

    private function disabled(): JsonResponse
    {
        return response()->json([
            'message' => 'This account has been disabled. Please contact BuyNest support.',
            'code' => 'account_disabled',
        ], 403);
    }

    private function codeInfo(string $email, int $resendIn): array
    {
        return [
            'email' => $email,
            'expires_in' => config('buynest.codes.ttl_minutes') * 60,
            'resend_in' => $resendIn,
        ];
    }
}
