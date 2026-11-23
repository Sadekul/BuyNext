<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Password;

class RegisterCustomerRequest extends FormRequest
{
    /** Tidy the input before the rules run: lower-case email, phone without spaces or dashes. */
    protected function prepareForValidation(): void
    {
        $this->merge([
            'email' => is_string($this->email) ? mb_strtolower(trim($this->email)) : $this->email,
            'phone' => is_string($this->phone) ? PhoneNumber::normalize($this->phone) : $this->phone,
            'first_name' => is_string($this->first_name) ? trim($this->first_name) : $this->first_name,
            'last_name' => is_string($this->last_name) ? trim($this->last_name) : $this->last_name,
        ]);
    }

    public function rules(): array
    {
        return [
            'first_name' => ['required', 'string', 'max:60'],
            'last_name' => ['required', 'string', 'max:60'],
            'email' => ['required', 'string', 'email:rfc', 'max:190'],
            'phone' => ['required', 'string', PhoneNumber::RULE],
            'password' => ['required', 'string', 'max:128', 'confirmed', Password::min(8)->letters()->numbers()],
            'accept_terms' => ['accepted'],
        ];
    }

    public function messages(): array
    {
        return [
            'phone.regex' => __('Enter a valid phone number, including the country code (for example +1 555 010 0100).'),
            'accept_terms.accepted' => __('Please accept the terms to create an account.'),
        ];
    }
}
