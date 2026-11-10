<?php

namespace App\Services;

use App\Mail\OneTimeCodeMail;
use App\Models\OneTimeCode;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

/**
 * Emailed 6-digit codes: sign-up verification and password reset.
 *
 * - Only an HMAC of the code is stored (keyed with APP_KEY), never the code.
 * - A new code replaces any earlier unused one for the same email and purpose.
 * - Each code expires (10 minutes), allows 5 wrong guesses, and works once.
 * - Sending is limited to one code per minute per email and purpose.
 */
class OneTimeCodes
{
    /**
     * Emails a new code unless one was sent less than a minute ago.
     * Returns the seconds until another code may be sent.
     */
    public function send(string $email, string $purpose, string $firstName): int
    {
        $email = self::normalize($email);
        $wait = $this->secondsUntilResend($email, $purpose);
        if ($wait > 0) {
            return $wait;
        }

        $code = str_pad((string) random_int(0, 10 ** config('buynest.codes.length') - 1), config('buynest.codes.length'), '0', STR_PAD_LEFT);

        DB::transaction(function () use ($email, $purpose, $code) {
            OneTimeCode::where('email', $email)->where('purpose', $purpose)->delete();
            OneTimeCode::create([
                'email' => $email,
                'purpose' => $purpose,
                'code_hash' => $this->hash($email, $purpose, $code),
                'expires_at' => now()->addMinutes(config('buynest.codes.ttl_minutes')),
            ]);
        });

        Mail::to($email)->send(new OneTimeCodeMail($code, $purpose, $firstName));

        return config('buynest.codes.resend_cooldown_seconds');
    }

    /**
     * Checks a code. On success the code is used up and 'ok' is returned;
     * otherwise 'invalid' (wrong, expired, or unknown) or 'locked' (too many wrong guesses).
     */
    public function verify(string $email, string $purpose, string $code): string
    {
        $email = self::normalize($email);

        return DB::transaction(function () use ($email, $purpose, $code) {
            // lockForUpdate: two guesses at the same moment can't both slip under the attempt limit.
            $record = OneTimeCode::where('email', $email)->where('purpose', $purpose)
                ->whereNull('consumed_at')->latest('id')->lockForUpdate()->first();

            if (! $record || $record->expires_at->isPast()) {
                return 'invalid';
            }
            if ($record->attempts >= config('buynest.codes.max_attempts')) {
                return 'locked';
            }
            if (! hash_equals($record->code_hash, $this->hash($email, $purpose, $code))) {
                $record->increment('attempts');

                return $record->attempts >= config('buynest.codes.max_attempts') ? 'locked' : 'invalid';
            }

            $record->update(['consumed_at' => now()]);

            return 'ok';
        });
    }

    public function secondsUntilResend(string $email, string $purpose): int
    {
        $last = OneTimeCode::where('email', self::normalize($email))->where('purpose', $purpose)->latest('id')->value('created_at');
        if (! $last) {
            return 0;
        }
        $elapsed = now()->getTimestamp() - $last->getTimestamp();

        return max(0, config('buynest.codes.resend_cooldown_seconds') - $elapsed);
    }

    public static function normalize(string $email): string
    {
        return mb_strtolower(trim($email));
    }

    private function hash(string $email, string $purpose, string $code): string
    {
        return hash_hmac('sha256', "{$purpose}|{$email}|{$code}", config('app.key'));
    }
}
