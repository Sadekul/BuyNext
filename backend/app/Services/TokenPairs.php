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
 *
 * Phase 9 (part A): a LIMITED admin pair (scope "two_factor_setup") for an
 * admin who must set up two-step sign-in first: the access token has the
 * ability "admin:setup" instead of "admin", so it only passes routes marked
 * token.kind:admin,setup (enrolment, me, logout). Its refresh token carries
 * "setup" and gives another limited pair until two-step sign-in is on.
 */
class TokenPairs
{
    public const CUSTOMER = 'customer';

    public const ADMIN = 'admin';

    /** Phase 9 (part A): the ability of a limited admin access token, and the pair's scope names. */
    public const SETUP_ABILITY = 'admin:setup';

    public const SCOPE_FULL = 'full';

    public const SCOPE_SETUP = 'two_factor_setup';

    /** $limited (phase 9, admins only): the two-step setup pair described above. */
    public function issue(Authenticatable $account, bool $remember, bool $limited = false): array
    {
        $kind = self::kindOf($account);
        $limited = $limited && $kind === self::ADMIN;
        $pair = Str::random(20);
        $accessMinutes = config('buynest.tokens.access_minutes');
        $refreshMinutes = config($remember ? 'buynest.tokens.refresh_remember_minutes' : 'buynest.tokens.refresh_minutes');

        $access = $account->createToken("{$kind}-access:{$pair}", [$limited ? self::SETUP_ABILITY : $kind], now()->addMinutes($accessMinutes));
        $refresh = $account->createToken(
            "{$kind}-refresh:{$pair}",
            ["refresh:{$kind}", $remember ? 'remember' : 'session', ...($limited ? ['setup'] : [])],
            now()->addMinutes($refreshMinutes),
        );

        return [
            'access_token' => $access->plainTextToken,
            'access_expires_in' => $accessMinutes * 60,
            'refresh_token' => $refresh->plainTextToken,
            'refresh_expires_in' => $refreshMinutes * 60,
            'remember' => $remember,
            'scope' => $limited ? self::SCOPE_SETUP : self::SCOPE_FULL,
        ];
    }

    /** Phase 9 (part A): whether "Keep me signed in" was chosen for the pair this access token belongs to. */
    public function remembers(PersonalAccessToken $access): bool
    {
        $pair = Str::after($access->name, ':');

        return (bool) $access->tokenable?->tokens()->where('name', 'like', '%-refresh:'.$pair)->get()
            ->contains(fn (PersonalAccessToken $token) => $token->can('remember'));
    }

    /** Phase 9 (part A): signs out every other device, keeping the pair of $current. */
    public function revokeOthers(Authenticatable $account, PersonalAccessToken $current): void
    {
        $pair = Str::after($current->name, ':');
        $account->tokens()->where('name', 'not like', '%:'.$pair)->delete();
    }

    public static function isLimited(PersonalAccessToken $token): bool
    {
        return in_array(self::SETUP_ABILITY, $token->abilities ?? [], true);
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
        // Phase 9 (part A): a limited pair stays limited until two-step sign-in is set up (or no longer required).
        $limited = in_array('setup', $token->abilities ?? [], true) && $account instanceof Admin
            && app(TwoFactor::class)->setupRequired($account);

        return $this->issue($account, $remember, $limited);
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
