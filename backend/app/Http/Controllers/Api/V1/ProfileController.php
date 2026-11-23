<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\PhoneNumber;
use App\Http\Resources\CustomerResource;
use App\Services\Newsletter;
use App\Support\Locale;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** The signed-in customer's own profile. The account always comes from the token, never from the request. */
class ProfileController extends Controller
{
    /** GET /api/v1/me */
    public function show(Request $request): CustomerResource
    {
        return new CustomerResource($request->user());
    }

    /**
     * PATCH /api/v1/me { first_name?, last_name?, phone?, newsletter?, locale? }
     * Phase 13: locale "en" | "bn" | null (null = the store default): the language of the customer's emails,
     * and the store switches to it after sign-in.
     * The email isn't changed here: a new address must be verified first.
     * Phase 7: newsletter true/false subscribes or unsubscribes the account's
     * email at once (it's verified, so no confirmation email).
     */
    public function update(Request $request, Newsletter $newsletter): CustomerResource
    {
        if (is_string($request->phone)) {
            $request->merge(['phone' => PhoneNumber::normalize($request->phone)]);
        }
        $data = $request->validate([
            'first_name' => ['sometimes', 'required', 'string', 'max:60'],
            'last_name' => ['sometimes', 'required', 'string', 'max:60'],
            'phone' => ['sometimes', 'required', 'string', PhoneNumber::RULE],
            'newsletter' => ['sometimes', 'boolean'],
            'locale' => ['sometimes', 'nullable', 'string', Rule::in(Locale::SUPPORTED)], // phase 13
        ], ['phone.regex' => __('Enter a valid phone number, including the country code (for example +1 555 010 0100).')]);

        if (array_key_exists('newsletter', $data)) {
            $newsletter->setForCustomer($request->user(), (bool) $data['newsletter']);
            unset($data['newsletter']);
        }
        $request->user()->update(array_map(fn ($value) => is_string($value) ? trim($value) : $value, $data));

        return new CustomerResource($request->user()->fresh());
    }
}
