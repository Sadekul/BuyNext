<?php

namespace App\Services\Sms;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Phase 20: the only class that talks to BulkSMSBD. No SDK: Laravel's HTTP
 * client (tests use Http::fake()).
 *
 * The wire format below is from BulkSMSBD's published API page and community
 * SDKs; it has NOT yet been verified against a real BulkSMSBD account. Send a
 * test SMS from Settings → SMS before going live (docs/BANGLADESH.md → SMS);
 * a correction is a change to this file only.
 *
 * - Send: POST {api}/smsapi (form fields; the API also takes them as a GET
 *   query, but a POST keeps the key out of URLs and proxy logs): api_key,
 *   type (text | unicode: any Bangla is unicode), number (8801XXXXXXXXX),
 *   senderid, message → JSON { response_code, success_message | error_message }.
 *   Success when response_code is 202. No message id is documented; one is
 *   kept if the answer has one.
 * - Failures are logged with BulkSMSBD's code and reason only: never the key,
 *   never the number or the text.
 */
class BulkSmsBdDriver implements SmsDriver
{
    public function key(): string
    {
        return 'bulksmsbd';
    }

    public function label(): string
    {
        return 'BulkSMSBD';
    }

    public function configured(): bool
    {
        return filled($this->config('api_key')) && filled($this->config('sender_id'));
    }

    public function send(string $to, string $body, string $reference): SmsResult
    {
        if (! $this->configured()) {
            throw new SmsException(__('Set up :provider first (Settings → SMS).', ['provider' => $this->label()]));
        }

        try {
            $response = Http::acceptJson()->asForm()
                ->connectTimeout((int) config('buynest.sms.connect_timeout_seconds', 5))
                ->timeout((int) config('buynest.sms.timeout_seconds', 15))
                ->post($this->config('api_url').'/smsapi', [
                    'api_key' => (string) $this->config('api_key'),
                    'type' => SmsText::measure($body)['encoding'] === 'unicode' ? 'unicode' : 'text',
                    'number' => ltrim($to, '+'),
                    'senderid' => (string) $this->config('sender_id'),
                    'message' => $body,
                ]);
        } catch (ConnectionException) {
            Log::warning('BulkSMSBD could not be reached.', ['reference' => $reference]);
            throw new SmsException(__(':provider could not be reached. Please try again in a moment.', ['provider' => $this->label()]));
        } catch (Throwable $e) {
            Log::error('BulkSMSBD request failed before an answer.', ['reference' => $reference, 'exception' => $e::class]);
            throw new SmsException(__(':provider could not be reached. Please try again in a moment.', ['provider' => $this->label()]));
        }

        $json = $response->json();
        if ($response->serverError() || ! is_array($json)) {
            Log::warning('BulkSMSBD answered with an error.', ['reference' => $reference, 'status' => $response->status()]);

            return SmsResult::failed(__(':provider is having trouble right now. Please try again in a moment.', ['provider' => $this->label()]));
        }
        if ((int) ($json['response_code'] ?? 0) !== 202) {
            $reason = self::text($json['error_message'] ?? null) ?? self::text($json['success_message'] ?? null) ?? 'no reason given';
            Log::warning('BulkSMSBD refused a text.', ['reference' => $reference, 'response_code' => $json['response_code'] ?? null, 'reason' => $reason]);

            return SmsResult::failed(__(':provider refused the text: :reason', ['provider' => $this->label(), 'reason' => rtrim($reason, '.')]));
        }

        return SmsResult::sent(self::text($json['message_id'] ?? null));
    }

    private static function text(mixed $value): ?string
    {
        return is_scalar($value) && trim((string) $value) !== '' ? mb_substr(trim((string) $value), 0, 100) : null;
    }

    private function config(string $key): mixed
    {
        return config("buynest.sms.bulksmsbd.{$key}");
    }
}
