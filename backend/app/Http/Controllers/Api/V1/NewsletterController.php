<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\NewsletterSubscriber;
use App\Services\Newsletter;
use App\Services\Settings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/** Phase 7: the storefront newsletter form, and the confirm and unsubscribe links (no sign-in). */
class NewsletterController extends Controller
{
    public const ACCEPTED = 'Thanks! If this address isn\'t subscribed yet, we\'ve sent you a link to confirm.';

    public function __construct(private Newsletter $newsletter) {}

    /**
     * POST /api/v1/newsletter { email, source? } → always 202 with the same
     * message, so nobody can find out whether an address is on the list.
     */
    public function subscribe(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'string', 'email', 'max:190'],
            'source' => ['nullable', 'in:footer,checkout'],
        ], ['email.required' => 'Enter your email address.', 'email.email' => 'Enter a valid email address.']);

        $this->newsletter->subscribe($data['email'], $data['source'] ?? 'footer');

        return response()->json(['message' => self::ACCEPTED], 202);
    }

    /** POST /api/v1/newsletter/confirm { token } */
    public function confirm(Request $request): JsonResponse
    {
        $data = $request->validate(['token' => ['required', 'string', 'max:200']]);
        $subscriber = $this->newsletter->confirm($data['token']);
        if (! $subscriber) {
            throw ValidationException::withMessages(['token' => 'This confirmation link is invalid or has expired. Subscribe again to get a new one.']);
        }

        return response()->json([
            'message' => 'You\'re subscribed to the '.app(Settings::class)->get('store_name').' newsletter.',
            'data' => ['email' => $subscriber->email, 'status' => $subscriber->status],
        ]);
    }

    /** POST /api/v1/newsletter/unsubscribe { token } - the signed link in every newsletter. */
    public function unsubscribe(Request $request): JsonResponse
    {
        $data = $request->validate(['token' => ['required', 'string', 'max:200']]);
        $subscriber = NewsletterSubscriber::fromUnsubscribeToken($data['token']);
        if (! $subscriber) {
            throw ValidationException::withMessages(['token' => 'This unsubscribe link is invalid.']);
        }
        $this->newsletter->unsubscribe($subscriber);

        return response()->json([
            'message' => 'You\'re unsubscribed. You won\'t get any more newsletters.',
            'data' => ['email' => $subscriber->email, 'status' => 'unsubscribed'],
        ]);
    }
}
