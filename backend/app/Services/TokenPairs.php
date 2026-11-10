<?php

namespace App\Services;

use App\Models\Admin;
use App\Models\Customer;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Support\Str;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Sign-in tokens, issued in pairs (Sanctum personal access tokens):
 *   access  - 60 minutes, ability "customer" or "admin": used on every request
 *   refresh - 1 day (7 with "Keep me signed in"), ability "refresh:<kind>":
 *             only exchanges itself for a new pair, then stops working (rotation)
 * Both share an id in their name, so signing out revokes the pair together.
 * The two kinds never mix: a customer token can't pass the admin check.
 */
class TokenPairs
{
    public const CUSTOMER = 'customer';

    public const ADMIN = 'admin';

    public function issue(Authenticatable $account, bool $remember): array
    {
        $kind = self::kindOf($account);
        $pair = Str::random(20);
        $accessMinutes = config('buynest.tokens.access_minutes');
        $refreshMinutes = config($remember ? 'buynest.tokens.refresh_remember_minutes' : 'buynest.tokens.refresh_minutes');

        $access = $account->createToken("{$kind}-access:{$pair}", [$kind], now()->addMinutes($accessMinutes));
        $refresh = $account->createToken(
            "{$kind}-refresh:{$pair}",
            ["refresh:{$kind}", $remember ? 'remember' : 'session'],
            now()->addMinutes($refreshMinutes),
        );

        return [
            'access_token' => $access->plainTextToken,
            'access_expires_in' => $accessMinutes * 60,
            'refresh_token' => $refresh->plainTextToken,
            'refresh_expires_in' => $refreshMinutes * 60,
            'remember' => $remember,
        ];
    }

    /** Swaps a valid refresh token for a new pair. Null when it is unknown, expired, the wrong kind, or the account is blocked. */
    public function refresh(string $plainRefreshToken, string $kind): ?array
    {
        $token = PersonalAccessToken::findToken($plainRefreshToken);
        $account = $token?->tokenable;

        if (! $token || ! $account || ! $token->can("refresh:{$kind}") || self::kindOf($account) !== $kind
            || ($token->expires_at && $token->expires_at->isPast()) || ! $account->is_active) {
            return null;
        }

        $remember = $token->can('remember');
        $this->revokePairOf($token);

        return $this->issue($account, $remember);
    }

    /** Signs out one device: the access token in use and its refresh token. */
    public function revokePairOf(PersonalAccessToken $token): void
    {
        $pair = Str::after($token->name, ':');
        $token->tokenable->tokens()->where('name', 'like', '%:'.$pair)->delete();
    }

    /** Signs out everywhere (password reset, account blocked). */
    public function revokeAll(Authenticatable $account): void
    {
        $account->tokens()->delete();
    }

    public static function kindOf(Authenticatable $account): string
    {
        return match (true) {
            $account instanceof Admin => self::ADMIN,
            $account instanceof Customer => self::CUSTOMER,
        };
    }
}
