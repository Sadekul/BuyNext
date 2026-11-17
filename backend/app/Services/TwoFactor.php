<?php

namespace App\Services;

use App\Models\Admin;
use App\Models\AdminTwoFactorChallenge;
use BaconQrCode\Renderer\Image\SvgImageBackEnd;
use BaconQrCode\Renderer\ImageRenderer;
use BaconQrCode\Renderer\RendererStyle\RendererStyle;
use BaconQrCode\Writer;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Phase 9 (part A): two-step sign-in for admins with an authenticator app.
 *
 * Codes are TOTP (RFC 6238): HOTP (RFC 4226) over the number of 30-second
 * steps since 1970, HMAC-SHA1, 6 digits. A code from the step before or after
 * the current one is accepted too (clock drift), and a code's step must be
 * newer than the last accepted one, so no code works twice (replay guard).
 *
 * The secret is 20 random bytes, shown as Base32 (what authenticator apps
 * expect) and stored encrypted (the Admin model's "encrypted" cast).
 * Recovery codes are stored as keyed hashes (HMAC-SHA256 with APP_KEY): they
 * are long random strings, so a slow password hash isn't needed.
 */
class TwoFactor
{
    public const DIGITS = 6;

    public const PERIOD = 30;

    public const RECOVERY_CODES = 10;

    public const CHALLENGE_MINUTES = 5;

    public const CHALLENGE_ATTEMPTS = 5;

    private const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    /** Recovery code characters: lower-case letters and digits that can't be mistaken for each other (no 0/o, 1/l/i). */
    private const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

    public function __construct(private Settings $settings) {}

    /*
     * The store rule (Settings → Security).
     */

    public function requiredByStore(): bool
    {
        return (bool) $this->settings->get('require_admin_two_factor', false);
    }

    /** The store requires two-step sign-in and this admin hasn't set it up yet. */
    public function setupRequired(Admin $admin): bool
    {
        return ! $admin->hasTwoFactor() && $this->requiredByStore();
    }

    /** For GET /me and sign-in answers. */
    public function status(Admin $admin): array
    {
        return [
            'enabled' => $admin->hasTwoFactor(),
            'confirmed_at' => $admin->hasTwoFactor() ? $admin->two_factor_confirmed_at?->toIso8601ZuluString() : null,
            'recovery_codes_left' => $admin->hasTwoFactor() ? count($admin->two_factor_recovery_codes ?? []) : 0,
            'required' => $this->requiredByStore(),
        ];
    }

    /*
     * TOTP (RFC 6238).
     */

    public static function newSecret(): string
    {
        return self::base32Encode(random_bytes(20));
    }

    /** The HOTP value for a counter (RFC 4226 §5.3), $key being the raw secret bytes. */
    public static function codeAt(string $key, int $step, int $digits = self::DIGITS, string $algorithm = 'sha1'): string
    {
        $hash = hash_hmac($algorithm, pack('J', $step), $key, true); // the counter as 8 bytes, big-endian
        $offset = ord($hash[strlen($hash) - 1]) & 0x0F;
        $binary = ((ord($hash[$offset]) & 0x7F) << 24)
            | (ord($hash[$offset + 1]) << 16)
            | (ord($hash[$offset + 2]) << 8)
            | ord($hash[$offset + 3]);

        return str_pad((string) ($binary % (10 ** $digits)), $digits, '0', STR_PAD_LEFT);
    }

    public static function stepAt(int $timestamp): int
    {
        return intdiv($timestamp, self::PERIOD);
    }

    /** The step (now ±1) a 6-digit code belongs to, or null when it matches none. */
    public static function matchingStep(string $base32Secret, string $code, int $timestamp): ?int
    {
        if (! preg_match('/^\d{'.self::DIGITS.'}$/', $code)) {
            return null;
        }
        $key = self::base32Decode($base32Secret);
        $now = self::stepAt($timestamp);
        $found = null;
        foreach ([$now - 1, $now, $now + 1] as $step) {
            // Every step is checked (no early exit), so the timing doesn't tell which one matched.
            if (hash_equals(self::codeAt($key, $step), $code)) {
                $found ??= $step;
            }
        }

        return $found;
    }

    /**
     * Checks a code against the admin's secret (also a secret still being
     * enrolled) and, when it's right, remembers its step so it can't be used
     * again. The admin row is locked: two requests with the same code can't
     * both pass.
     */
    public function verifyCode(Admin $admin, string $code): bool
    {
        return DB::transaction(function () use ($admin, $code) {
            $fresh = Admin::lockForUpdate()->find($admin->id);
            if (! $fresh?->two_factor_secret) {
                return false;
            }
            $step = self::matchingStep($fresh->two_factor_secret, trim($code), now()->getTimestamp());
            if ($step === null || ($fresh->two_factor_last_step !== null && $step <= $fresh->two_factor_last_step)) {
                return false;
            }
            $fresh->forceFill(['two_factor_last_step' => $step])->save();
            $admin->two_factor_last_step = $step;

            return true;
        });
    }

    /*
     * Enrolment.
     */

    /** Starts (or restarts) enrolment: a new secret, not active until confirmed. */
    public function begin(Admin $admin): array
    {
        $secret = self::newSecret();
        $admin->forceFill([
            'two_factor_secret' => $secret,
            'two_factor_confirmed_at' => null,
            'two_factor_recovery_codes' => null,
            'two_factor_last_step' => null,
        ])->save();
        $url = $this->otpauthUrl($admin, $secret);

        return ['secret' => $secret, 'otpauth_url' => $url, 'qr_svg' => $this->qrSvg($url)];
    }

    /** Turns two-step on (after a right code) and returns the plain recovery codes, shown once. */
    public function confirm(Admin $admin): array
    {
        $admin->forceFill(['two_factor_confirmed_at' => now()])->save();

        return $this->regenerateRecoveryCodes($admin);
    }

    public function disable(Admin $admin): void
    {
        $admin->forceFill([
            'two_factor_secret' => null,
            'two_factor_confirmed_at' => null,
            'two_factor_recovery_codes' => null,
            'two_factor_last_step' => null,
        ])->save();
        AdminTwoFactorChallenge::where('admin_id', $admin->id)->delete();
    }

    public function otpauthUrl(Admin $admin, string $secret): string
    {
        $issuer = (string) ($this->settings->get('store_name') ?: 'BuyNest');

        return 'otpauth://totp/'.rawurlencode($issuer).':'.rawurlencode($admin->email)
            .'?'.http_build_query(['secret' => $secret, 'issuer' => $issuer, 'algorithm' => 'SHA1', 'digits' => self::DIGITS, 'period' => self::PERIOD], '', '&', PHP_QUERY_RFC3986);
    }

    /** The QR code as an inline SVG, drawn here (bacon/bacon-qr-code): the secret never goes to another service. */
    public function qrSvg(string $text): string
    {
        $svg = (new Writer(new ImageRenderer(new RendererStyle(240, 2), new SvgImageBackEnd)))->writeString($text);

        // Without the XML declaration, so it can be placed straight into a page.
        return trim(preg_replace('/^<\?xml[^>]*\?>/', '', $svg));
    }

    /*
     * Recovery codes.
     */

    /** @return list<string> 10 new plain codes ("abcde-23456"); the old ones stop working. */
    public function regenerateRecoveryCodes(Admin $admin): array
    {
        $plain = [];
        for ($i = 0; $i < self::RECOVERY_CODES; $i++) {
            $chars = '';
            for ($c = 0; $c < 10; $c++) {
                $chars .= self::RECOVERY_ALPHABET[random_int(0, strlen(self::RECOVERY_ALPHABET) - 1)];
            }
            $plain[] = substr($chars, 0, 5).'-'.substr($chars, 5);
        }
        $admin->forceFill(['two_factor_recovery_codes' => array_map(fn ($code) => $this->recoveryHash($admin, $code), $plain)])->save();

        return $plain;
    }

    /** Uses up a recovery code: true when it was one of the admin's unused codes. */
    public function useRecoveryCode(Admin $admin, string $code): bool
    {
        $hash = $this->recoveryHash($admin, $code);

        return DB::transaction(function () use ($admin, $hash) {
            $fresh = Admin::lockForUpdate()->find($admin->id);
            $codes = $fresh?->two_factor_recovery_codes ?? [];
            $match = null;
            foreach ($codes as $index => $stored) {
                if (hash_equals($stored, $hash)) {
                    $match = $index;
                }
            }
            if ($match === null) {
                return false;
            }
            unset($codes[$match]);
            $fresh->forceFill(['two_factor_recovery_codes' => array_values($codes)])->save();
            $admin->two_factor_recovery_codes = array_values($codes);

            return true;
        });
    }

    /** Case and the dash don't matter when typing a recovery code. */
    private function recoveryHash(Admin $admin, string $code): string
    {
        $normalized = preg_replace('/[^a-z0-9]/', '', mb_strtolower($code));

        return hash_hmac('sha256', "recovery|{$admin->id}|{$normalized}", (string) config('app.key'));
    }

    /*
     * The sign-in challenge (step two).
     */

    /** @return array{0: string, 1: CarbonInterface} the plain challenge and when it expires */
    public function createChallenge(Admin $admin): array
    {
        // Old challenges of this admin are useless now: a new sign-in starts over.
        AdminTwoFactorChallenge::where('admin_id', $admin->id)->delete();
        $token = Str::random(64);
        $challenge = AdminTwoFactorChallenge::create([
            'admin_id' => $admin->id,
            'token_hash' => self::challengeHash($token),
            'expires_at' => now()->addMinutes(self::CHALLENGE_MINUTES),
            'created_at' => now(),
        ]);

        return [$token, $challenge->expires_at];
    }

    public static function challengeHash(string $token): string
    {
        return hash('sha256', $token);
    }

    /*
     * Base32 (RFC 4648, no padding), what authenticator apps use for the key.
     */

    public static function base32Encode(string $bytes): string
    {
        $bits = '';
        foreach (str_split($bytes) as $byte) {
            $bits .= str_pad(decbin(ord($byte)), 8, '0', STR_PAD_LEFT);
        }
        $out = '';
        foreach (str_split($bits, 5) as $chunk) {
            $out .= self::BASE32[bindec(str_pad($chunk, 5, '0'))];
        }

        return $out;
    }

    public static function base32Decode(string $text): string
    {
        $text = strtoupper(preg_replace('/[\s=-]/', '', $text));
        $bits = '';
        foreach (str_split($text) as $char) {
            $value = strpos(self::BASE32, $char);
            if ($value === false) {
                return '';
            }
            $bits .= str_pad(decbin($value), 5, '0', STR_PAD_LEFT);
        }
        $out = '';
        foreach (str_split($bits, 8) as $byte) {
            if (strlen($byte) === 8) {
                $out .= chr(bindec($byte));
            }
        }

        return $out;
    }
}
