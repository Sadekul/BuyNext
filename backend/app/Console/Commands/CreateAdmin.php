<?php

namespace App\Console\Commands;

use App\Models\Admin;
use App\Models\AdminRole;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;

use function Laravel\Prompts\password;
use function Laravel\Prompts\text;

/**
 * php artisan buynest:create-admin - the only way to make the first admin (the storefront can't).
 * The account gets the Owner role (everything), or --role="Sales staff" etc.
 */
#[Signature('buynest:create-admin {email?} {--name=} {--role=Owner}')]
#[Description('Create a shop admin account for the admin dashboard')]
class CreateAdmin extends Command
{
    public function handle(): int
    {
        $email = mb_strtolower(trim($this->argument('email') ?? text('Admin email', required: true)));
        $name = $this->option('name') ?? text('Full name', required: true);
        $secret = password('Password (at least 12 characters, letters and numbers)', required: true);

        $validator = Validator::make(compact('email', 'name') + ['password' => $secret], [
            'email' => ['required', 'email', 'max:190', 'unique:admins,email'],
            'name' => ['required', 'string', 'max:120'],
            'password' => ['required', Password::min(12)->letters()->numbers()],
        ]);
        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $error) {
                $this->error($error);
            }

            return self::FAILURE;
        }

        $role = AdminRole::where('name', $this->option('role'))->first();
        if (! $role) {
            $this->error('Unknown role. Roles: '.AdminRole::orderBy('name')->pluck('name')->implode(', ').'.');

            return self::FAILURE;
        }

        Admin::create(['email' => $email, 'name' => $name, 'password' => $secret, 'role_id' => $role->id]);
        $this->info("Admin {$email} created with the role {$role->name}. Sign in at /admin/.");

        return self::SUCCESS;
    }
}
