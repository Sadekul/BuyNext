<?php

namespace App\Services\Sms;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Phase 20: the only class that talks to SSL Wireless (SMS Plus API v3).
 * No SDK: Laravel's HTTP client (tests use Http::fake()).
 *
 * The wire format below is from SSL Wireless's published API notes and
 * community SDKs; it has NOT yet been verified against a real SSL Wireless
 * account. Send a test SMS from Settings → SMS before going live
 * (docs/BANGLADESH.md → SMS); a correction is a change to this file only.
 *
 * - Send: POST {api}/api/v3/send-sms JSON { api_token, sid, msisdn
 *   (8801XXXXXXXXX), sms, csms_id (our unique reference, ≤ 20 characters) }
 *   → { status: "SUCCESS", status_code: 200, error_message, smsinfo: [{
 *   sms_status, reference_id, ... }] }. Anything else is a refusal, with
 *   error_message as the reason.
 * - Failures are logged with the HTTP status and SSL Wireless's reason only:
 *   never the token, never the number or the text.
 */
class SslWirelessDriver implements SmsDriver
{
    public function key(): string
    {
        return 'ssl_wireless';
    }

    public function label(): string
    {
        return 'SSL Wireless';
    }

    public function configured(): bool
    {
        return filled($this->config('api_token')) && filled($this->config('sid'));
    }

    public function send(string $to, string $body, string $reference): SmsResult
    {
        if (! $this->configured()) {
            throw new SmsException(__('Set up :provider first (Settings → SMS).', ['provider' => $this->label()]));
        }

        try {
            $response = Http::acceptJson()->asJson()
                ->connectTimeout((int) config('buynest.sms.connect_timeout_seconds', 5))
                ->timeout((int) config('buynest.sms.timeout_seconds', 15))
                ->post($this->config('api_url').'/api/v3/send-sms', [
                    'api_token' => (string) $this->config('api_token'),
                    'sid' => (string) $this->config('sid'),
                    'msisdn' => ltrim($to, '+'),
                    'sms' => $body,
                    'csms_id' => mb_substr($reference, 0, 20),
                ]);
        } catch (ConnectionException) {
            Log::warning('SSL Wireless could not be reached.', ['reference' => $reference]);
            throw new SmsException(__(':provider could not be reached. Please try again in a moment.', ['provider' => $this->label()]));
        } catch (Throwable $e) {
            Log::error('SSL Wireless request failed before an answer.', ['reference' => $reference, 'exception' => $e::class]);
            throw new SmsException(__(':provider could not be reached. Please try again in a moment.', ['provider' => $this->label()]));
        }

        $json = $response->json();
        if ($response->serverError() || ! is_array($json)) {
            Log::warning('SSL Wireless answered with an error.', ['reference' => $reference, 'status' => $response->status()]);

            return SmsResult::failed(__(':provider is having trouble right now. Please try again in a moment.', ['provider' => $this->label()]));
        }
        $info = is_array($json['smsinfo'][0] ?? null) ? $json['smsinfo'][0] : [];
        $ok = strtoupper((string) ($json['status'] ?? '')) === 'SUCCESS'
            && (! isset($json['status_code']) || (int) $json['status_code'] === 200);
        if (! $ok) {
            $reason = self::text($json['error_message'] ?? null) ?? self::text($info['status_message'] ?? null) ?? 'no reason given';
            Log::warning('SSL Wireless refused a text.', ['reference' => $reference, 'status' => $response->status(),
                'status_code' => $json['status_code'] ?? null, 'reason' => $reason]);

            return SmsResult::failed(__(':provider refused the text: :reason', ['provider' => $this->label(), 'reason' => rtrim($reason, '.')]));
        }

        return SmsResult::sent(self::text($info['reference_id'] ?? null) ?? self::text($info['csms_id'] ?? null));
    }

    private static function text(mixed $value): ?string
    {
        return is_scalar($value) && trim((string) $value) !== '' ? mb_substr(trim((string) $value), 0, 100) : null;
    }

    private function config(string $key): mixed
    {
        return config("buynest.sms.ssl_wireless.{$key}");
    }
}
