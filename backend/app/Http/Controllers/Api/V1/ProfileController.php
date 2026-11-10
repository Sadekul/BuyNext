<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\PhoneNumber;
use App\Http\Resources\CustomerResource;
use Illuminate\Http\Request;

/** The signed-in customer's own profile. The account always comes from the token, never from the request. */
class ProfileController extends Controller
{
    /** GET /api/v1/me */
    public function show(Request $request): CustomerResource
    {
        return new CustomerResource($request->user());
    }

    /**
     * PATCH /api/v1/me { first_name?, last_name?, phone? }
     * The email isn't changed here: a new address must be verified first.
     */
    public function update(Request $request): CustomerResource
    {
        if (is_string($request->phone)) {
            $request->merge(['phone' => PhoneNumber::normalize($request->phone)]);
        }
        $data = $request->validate([
            'first_name' => ['sometimes', 'required', 'string', 'max:60'],
            'last_name' => ['sometimes', 'required', 'string', 'max:60'],
            'phone' => ['sometimes', 'required', 'string', PhoneNumber::RULE],
        ], ['phone.regex' => 'Enter a valid phone number, including the country code (for example +1 555 010 0100).']);

        $request->user()->update(array_map(fn ($value) => is_string($value) ? trim($value) : $value, $data));

        return new CustomerResource($request->user()->fresh());
    }
}
