<?php

namespace App\Services\Payments;

use App\Support\Currency;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Phase 12: the only class that talks to SSLCommerz (bKash, Nagad, Rocket,
 * Upay, cards, internet banking on SSLCommerz's hosted page). No SDK:
 * Laravel's HTTP client (tests use Http::fake()).
 *
 * - Sessions: POST {api}/gwprocess/v4/api.php (form-encoded).
 * - Validation and transaction queries: GET {api}/validator/api/....
 * - Every request carries store_id and store_passwd (SSLCommerz's own
 *   scheme); they are never logged. Failures are logged with SSLCommerz's
 *   status and reason only.
 * - Base URL: SSLCOMMERZ_API_URL, else sandbox or live by SSLCOMMERZ_MODE.
 */
class SslCommerzGateway
{
    /** The store id and password are set (refunds and checks work even after a currency switch). */
    public function configured(): bool
    {
        return filled(config('buynest.sslcommerz.store_id')) && filled(config('buynest.sslcommerz.store_password'));
    }

    /** New payments: configured, and the store charges in taka. */
    public function enabled(): bool
    {
        return $this->configured() && Currency::sslcommerzAccepts();
    }

    public function live(): bool
    {
        return config('buynest.sslcommerz.mode') === 'live';
    }

    /**
     * Opens a payment session → SSLCommerz's answer ({ status: "SUCCESS",
     * GatewayPageURL, sessionkey, ... }). Anything but SUCCESS with a page
     * address throws SslCommerzException with SSLCommerz's reason.
     */
    public function createSession(array $fields): array
    {
        $body = $this->send('post', '/gwprocess/v4/api.php', $fields);
        if (strtoupper((string) ($body['status'] ?? '')) !== 'SUCCESS' || ! is_string($body['GatewayPageURL'] ?? null) || $body['GatewayPageURL'] === '') {
            $reason = is_string($body['failedreason'] ?? null) && $body['failedreason'] !== '' ? $body['failedreason'] : 'it gave no payment page';
            Log::warning('SSLCommerz refused to open a payment session.', ['tran_id' => $fields['tran_id'] ?? null, 'status' => $body['status'] ?? null,
                'reason' => $reason]);
            throw new SslCommerzException('SSLCommerz could not start the payment ('.rtrim($reason, '.').'). Please try again in a moment.');
        }

        return $body;
    }

    /** The validation API's answer for $valId (status VALID / VALIDATED / INVALID_TRANSACTION, tran_id, amount, ...). */
    public function validate(string $valId): array
    {
        return $this->send('get', '/validator/api/validationserverAPI.php', ['val_id' => $valId, 'format' => 'json', 'v' => 1]);
    }

    /**
     * Every transaction SSLCommerz knows for $tranId (the query API's
     * "element" list; [] when none). Throws when the query itself is refused.
     *
     * @return list<array>
     */
    public function transactions(string $tranId): array
    {
        $body = $this->send('get', '/validator/api/merchantTransIDvalidationAPI.php', ['tran_id' => $tranId, 'format' => 'json']);
        $connect = strtoupper((string) ($body['APIConnect'] ?? ''));
        if ($connect !== 'DONE') {
            Log::warning('SSLCommerz refused a transaction query.', ['tran_id' => $tranId, 'api_connect' => $body['APIConnect'] ?? null]);
            throw new SslCommerzException('SSLCommerz refused the payment query ('.($connect ?: 'no answer').').');
        }

        return array_values(array_filter(is_array($body['element'] ?? null) ? $body['element'] : [], 'is_array'));
    }

    /** Refunds $amount ("12.50") of the payment $bankTranId → { APIConnect, status: success|processing|failed, refund_ref_id, errorReason }. */
    public function refund(string $bankTranId, string $amount, string $remarks, string $referenceId): array
    {
        $body = $this->send('get', '/validator/api/merchantTransIDvalidationAPI.php', [
            'bank_tran_id' => $bankTranId,
            'refund_amount' => $amount,
            'refund_remarks' => mb_substr($remarks, 0, 255),
            'refe_id' => $referenceId,
            'format' => 'json',
        ]);
        if (strtoupper((string) ($body['APIConnect'] ?? 'DONE')) !== 'DONE') {
            throw new SslCommerzException('SSLCommerz refused the request ('.$body['APIConnect'].').');
        }

        return $body;
    }

    /**
     * An IPN's own signature: md5 over the fields listed in verify_key plus
     * md5(store password), sorted by name, as "k=v&k=v". null when the IPN
     * isn't signed (then only the validation API vouches for it).
     */
    public function verifySign(array $post): ?bool
    {
        if (! is_string($post['verify_sign'] ?? null) || ! is_string($post['verify_key'] ?? null) || $post['verify_key'] === '') {
            return null;
        }
        if (! $this->configured()) {
            return false;
        }

        return hash_equals(self::sign($post, (string) config('buynest.sslcommerz.store_password')), strtolower($post['verify_sign']));
    }

    /** The verify_sign of $post (whose verify_key lists the signed fields): tests and the e2e stand-in sign with it. */
    public static function sign(array $post, string $storePassword): string
    {
        $data = [];
        foreach (explode(',', (string) ($post['verify_key'] ?? '')) as $key) {
            if ($key !== '') {
                $data[$key] = (string) ($post[$key] ?? '');
            }
        }
        $data['store_passwd'] = md5($storePassword);
        ksort($data);

        return md5(implode('&', array_map(fn ($key, $value) => "{$key}={$value}", array_keys($data), $data)));
    }

    private function send(string $method, string $path, array $params): array
    {
        if (! $this->configured()) {
            throw new SslCommerzException('SSLCommerz payments are not set up (SSLCOMMERZ_STORE_ID / SSLCOMMERZ_STORE_PASSWORD are empty).');
        }
        $params = [
            'store_id' => (string) config('buynest.sslcommerz.store_id'),
            'store_passwd' => (string) config('buynest.sslcommerz.store_password'),
            ...$params,
        ];
        $url = rtrim((string) config('buynest.sslcommerz.api_url'), '/').$path;

        try {
            $request = Http::acceptJson()->connectTimeout(5)->timeout((int) config('buynest.sslcommerz.timeout_seconds'));
            /** @var Response $response */
            $response = $method === 'get' ? $request->get($url, $params) : $request->asForm()->post($url, $params);
        } catch (ConnectionException $e) {
            Log::warning('SSLCommerz could not be reached.', ['path' => $path]);
            throw new SslCommerzException('SSLCommerz could not be reached. Please try again in a moment.', unreachable: true);
        } catch (Throwable $e) {
            Log::error('SSLCommerz request failed before an answer.', ['path' => $path, 'exception' => $e::class]);
            throw new SslCommerzException('SSLCommerz could not be reached. Please try again in a moment.', unreachable: true);
        }

        $body = $response->json();
        if ($response->successful() && is_array($body)) {
            return $body;
        }
        Log::warning('SSLCommerz answered with an error.', ['path' => $path, 'status' => $response->status()]);
        if ($response->serverError() || ! is_array($body)) {
            throw new SslCommerzException('SSLCommerz is having trouble right now. Please try again in a moment.', unreachable: true);
        }

        throw new SslCommerzException('SSLCommerz refused the request.');
    }
}
