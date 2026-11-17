<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Support\SentryScrubber;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Sentry\Severity;
use Sentry\State\Scope;

use function Sentry\captureMessage;
use function Sentry\withScope;

/**
 * Phase 9 (part B): errors from the store's and the admin's browsers.
 * The browser posts them to the sign-in service (POST /api/client-errors),
 * which forwards them here with the shared key (route middleware
 * bff.key:always), so nobody else can fill Sentry with junk.
 *
 * Personal data stays out: the URL is cut to its path, and email addresses
 * and token=/code=/password=... values in the message and stack are
 * replaced. The same error (app, message, first stack line) is reported once
 * per 10 minutes; the answer is the same 202 either way.
 */
class ClientErrorController extends Controller
{
    public const DEDUPE_MINUTES = 10;

    public const MAX_STACK = 8192;

    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'message' => ['required', 'string', 'max:1000'],
            'stack' => ['nullable', 'string', 'max:'.self::MAX_STACK],
            'url' => ['nullable', 'string', 'max:2048'],
            'app' => ['required', 'in:store,admin'],
            'release' => ['nullable', 'string', 'max:64'],
        ]);

        $message = SentryScrubber::text(trim($data['message']));
        $stack = SentryScrubber::text((string) ($data['stack'] ?? ''));
        $path = self::path($data['url'] ?? null);
        $firstFrame = trim(strtok($stack, "\n") ?: '');

        $key = 'client-error:'.hash('sha256', $data['app']."\n".$message."\n".$firstFrame);
        if (! Cache::add($key, true, now()->addMinutes(self::DEDUPE_MINUTES))) {
            return response()->json(['data' => ['received' => true, 'duplicate' => true]], 202);
        }

        $this->report($data['app'], $message, $stack, $path, $data['release'] ?? null);

        return response()->json(['data' => ['received' => true, 'duplicate' => false]], 202);
    }

    /** "https://shop.example/products/1?q=x#top" → "/products/1"; anything odd → null. */
    public static function path(?string $url): ?string
    {
        if (blank($url)) {
            return null;
        }
        $path = parse_url($url, PHP_URL_PATH);

        return is_string($path) && str_starts_with($path, '/') ? mb_substr($path, 0, 500) : null;
    }

    private function report(string $app, string $message, string $stack, ?string $path, ?string $release): void
    {
        if (! config('sentry.dsn')) {
            Log::warning("Browser error ({$app}) on ".($path ?? '?').": {$message}", array_filter(['release' => $release, 'stack' => mb_substr($stack, 0, 2000)]));

            return;
        }
        withScope(function (Scope $scope) use ($app, $message, $stack, $path, $release) {
            $scope->setTag('source', 'client');
            $scope->setTag('app', $app);
            if ($release) {
                $scope->setTag('client_release', $release);
            }
            $scope->setContext('browser_error', array_filter(['path' => $path, 'stack' => $stack, 'release' => $release]));
            // Group by app and message, not by the server code that forwards them.
            $scope->setFingerprint(['client', $app, $message]);
            captureMessage("[{$app}] {$message}", Severity::error());
        });
    }
}
