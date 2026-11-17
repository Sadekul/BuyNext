<?php

namespace App\Support;

use App\Models\Admin;
use App\Models\Customer;
use Sentry\Breadcrumb;
use Sentry\Event;
use Sentry\EventHint;
use Sentry\UserDataBag;
use Throwable;

/**
 * Phase 9 (part B): the last look at every Sentry event before it leaves the
 * server (config/sentry.php `before_send`). Sentry is told not to collect
 * personal data (send_default_pii = false, no request bodies); this makes
 * sure of it whatever an integration added:
 *
 * - request: only the method, the URL without its query string, and a few
 *   harmless headers (User-Agent, Accept, Content-Type) are kept. Bodies,
 *   cookies, the query string (unsubscribe tokens, download signatures),
 *   the Authorization header and the BFF key never go.
 * - user: { id, kind: "customer"|"admin" } only (no email, name or IP).
 * - text values in tags, extra data and breadcrumbs: email addresses and
 *   token=/code=/password=... values are replaced with [scrubbed].
 *
 * It must never throw: a failing scrubber would lose the error report.
 */
final class SentryScrubber
{
    private const KEEP_HEADERS = ['user-agent', 'accept', 'content-type'];

    private const SECRET_PARAMS = '/\b(token|code|password|signature|secret|key|challenge|recovery_code)=([^&\s"\'#]+)/i';

    private const EMAIL = '/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i';

    public static function beforeSend(Event $event, ?EventHint $hint = null): ?Event
    {
        try {
            $event->setRequest(self::request($event->getRequest()));
            $event->setUser(self::user());
            $event->setTags(array_map(fn ($value) => is_string($value) ? self::text($value) : $value, $event->getTags()));
            $event->setExtra(self::deep($event->getExtra()));
            $event->setBreadcrumb(array_map(fn ($crumb) => self::breadcrumb($crumb), $event->getBreadcrumbs()));
            if ($event->getMessage() !== null) {
                $event->setMessage(self::text($event->getMessage()), $event->getMessageParams(), $event->getMessageFormatted());
            }
        } catch (Throwable) {
            // Better a less clean report than none; the request part is the risky one, so drop it.
            try {
                $event->setRequest([]);
                $event->setUser(null);
            } catch (Throwable) {
            }
        }

        return $event;
    }

    /** Replaces email addresses and secret query values in $text with [scrubbed]. */
    public static function text(string $text): string
    {
        $text = preg_replace(self::EMAIL, '[scrubbed]', $text) ?? '';

        return preg_replace(self::SECRET_PARAMS, '$1=[scrubbed]', $text) ?? '';
    }

    /** Only the method, the URL without query or fragment, and harmless headers. */
    public static function request(array $request): array
    {
        $clean = [];
        if (isset($request['method'])) {
            $clean['method'] = $request['method'];
        }
        if (isset($request['url']) && is_string($request['url'])) {
            $clean['url'] = strtok($request['url'], '?#') ?: '';
        }
        $headers = [];
        foreach ((array) ($request['headers'] ?? []) as $name => $value) {
            if (in_array(strtolower((string) $name), self::KEEP_HEADERS, true)) {
                $headers[$name] = $value;
            }
        }
        if ($headers) {
            $clean['headers'] = $headers;
        }

        return $clean;
    }

    /** The signed-in account, as { id, kind } only, or null. */
    private static function user(): ?UserDataBag
    {
        if (! app()->bound('request')) {
            return null;
        }
        $account = request()->user();
        $kind = match (true) {
            $account instanceof Customer => 'customer',
            $account instanceof Admin => 'admin',
            default => null,
        };
        if ($kind === null) {
            return null;
        }
        $user = new UserDataBag((string) $account->getKey());
        $user->setMetadata('kind', $kind);

        return $user;
    }

    private static function breadcrumb($crumb)
    {
        if (! $crumb instanceof Breadcrumb) {
            return $crumb;
        }
        $message = $crumb->getMessage();

        return new Breadcrumb($crumb->getLevel(), $crumb->getType(), $crumb->getCategory(),
            $message === null ? null : self::text($message), self::deep($crumb->getMetadata()), $crumb->getTimestamp());
    }

    private static function deep(array $values): array
    {
        foreach ($values as $key => $value) {
            if (is_string($value)) {
                $values[$key] = self::text($value);
            } elseif (is_array($value)) {
                $values[$key] = self::deep($value);
            }
        }

        return $values;
    }
}
