<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\V1\ClientErrorController;
use App\Models\Customer;
use App\Support\SentryScrubber;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Sentry\Breadcrumb;
use Sentry\Event;
use Sentry\SentrySdk;
use Tests\TestCase;

/** Phase 9 (part B): server errors to Sentry (only with a DSN, no personal data) and browser error reports. */
class ErrorReportingTest extends TestCase
{
    use RefreshDatabase;

    private const KEY = 'test-bff-key-0123456789';

    protected function setUp(): void
    {
        parent::setUp();
        config(['buynest.bff_key' => self::KEY]);
    }

    private function report(array $body, array $headers = ['X-BuyNest-Bff' => self::KEY])
    {
        return $this->postJson('/api/v1/client-errors', $body, $headers);
    }

    private function body(array $overrides = []): array
    {
        return [
            'message' => 'TypeError: x is undefined',
            'stack' => "at render (https://shop.example/assets/app.js:1:200)\nat main",
            'url' => 'https://shop.example/products/12?email=ann@example.com#reviews',
            'app' => 'store',
            'release' => '2026.11.17',
            ...$overrides,
        ];
    }

    public function test_sentry_sends_nothing_without_a_dsn(): void
    {
        $this->assertNull(config('sentry.dsn'));
        $this->assertNull(SentrySdk::getCurrentHub()->getClient()?->getOptions()->getDsn());
        $this->assertFalse(config('sentry.send_default_pii'));
        $this->assertSame('none', config('sentry.max_request_body_size'));
        $this->assertSame([SentryScrubber::class, 'beforeSend'], config('sentry.before_send'));
        $this->assertFalse(config('sentry.breadcrumbs.sql_bindings'));
    }

    public function test_the_scrubber_removes_bodies_cookies_auth_headers_and_query_strings(): void
    {
        $event = Event::createEvent();
        $event->setRequest([
            'method' => 'POST',
            'url' => 'https://api.example/api/v1/auth/login?token=abc123',
            'query_string' => 'token=abc123',
            'data' => ['email' => 'ann@example.com', 'password' => 'Secret123'],
            'cookies' => ['buynest_session' => 'xyz'],
            'headers' => ['Authorization' => ['Bearer 1|secret'], 'Cookie' => ['a=b'], 'X-BuyNest-Bff' => ['key'], 'User-Agent' => ['Firefox'], 'X-Forwarded-For' => ['1.2.3.4']],
            'env' => ['REMOTE_ADDR' => '1.2.3.4'],
        ]);
        $event->setTags(['note' => 'mail ann@example.com']);
        $event->setExtra(['link' => 'https://shop.example/x?code=123456&page=2', 'nested' => ['who' => 'bob@example.com']]);
        $event->setBreadcrumb([new Breadcrumb('info', 'default', 'log', 'sent to ann@example.com', ['url' => '/a?signature=deadbeef'])]);
        $event->setMessage('Reset for ann@example.com with password=hunter2');

        $clean = SentryScrubber::beforeSend($event);

        $this->assertSame(['method' => 'POST', 'url' => 'https://api.example/api/v1/auth/login', 'headers' => ['User-Agent' => ['Firefox']]], $clean->getRequest());
        $this->assertSame(['note' => 'mail [scrubbed]'], $clean->getTags());
        $this->assertSame(['link' => 'https://shop.example/x?code=[scrubbed]&page=2', 'nested' => ['who' => '[scrubbed]']], $clean->getExtra());
        $crumb = $clean->getBreadcrumbs()[0];
        $this->assertSame('sent to [scrubbed]', $crumb->getMessage());
        $this->assertSame(['url' => '/a?signature=[scrubbed]'], $crumb->getMetadata());
        $this->assertSame('Reset for [scrubbed] with password=[scrubbed]', $clean->getMessage());
        $this->assertNull($clean->getUser()); // nobody signed in
    }

    public function test_the_user_is_only_an_id_and_a_kind(): void
    {
        $customer = Customer::factory()->create();
        $this->app['request']->setUserResolver(fn () => $customer);

        $user = SentryScrubber::beforeSend(Event::createEvent())->getUser();
        $this->assertSame((string) $customer->id, $user->getId());
        $this->assertSame(['kind' => 'customer'], $user->getMetadata());
        $this->assertNull($user->getEmail());
        $this->assertNull($user->getIpAddress());
        $this->assertNull($user->getUsername());
    }

    public function test_client_errors_need_the_shared_key_even_in_development(): void
    {
        $this->assertFalse(config('buynest.require_bff_key'));
        $this->report($this->body(), [])->assertForbidden()->assertJsonPath('code', 'store_only');
        $this->report($this->body(), ['X-BuyNest-Bff' => 'wrong'])->assertForbidden();

        config(['buynest.bff_key' => null]); // no key configured: always refused
        $this->report($this->body(), ['X-BuyNest-Bff' => ''])->assertForbidden();
    }

    public function test_a_client_error_is_scrubbed_logged_and_deduplicated(): void
    {
        Log::spy();

        $this->report($this->body([
            'message' => 'Failed for ann@example.com',
            'stack' => "at x (https://shop.example/app.js?token=abc:1:2)\n".str_repeat('a', 100),
        ]))->assertStatus(202)->assertExactJson(['data' => ['received' => true, 'duplicate' => false]]);

        Log::shouldHaveReceived('warning')->once()->withArgs(function (string $message, array $context) {
            return $message === 'Browser error (store) on /products/12: Failed for [scrubbed]'
                && str_contains($context['stack'], 'token=[scrubbed]') && ! str_contains($context['stack'], 'abc')
                && $context['release'] === '2026.11.17';
        });

        // The same error again within 10 minutes: same 202, not reported again.
        $this->report($this->body(['message' => 'Failed for ann@example.com', 'stack' => "at x (https://shop.example/app.js?token=abc:1:2)\nother"]))
            ->assertStatus(202)->assertJsonPath('data.duplicate', true);
        // Another app's error is reported.
        $this->report($this->body(['app' => 'admin', 'message' => 'Failed for ann@example.com', 'stack' => 'at x (https://shop.example/app.js?token=abc:1:2)']))
            ->assertJsonPath('data.duplicate', false);
        Log::shouldHaveReceived('warning')->twice();
    }

    public function test_client_error_validation_and_rate_limit(): void
    {
        $this->report($this->body(['app' => 'other']))->assertJsonValidationErrors('app');
        $this->report($this->body(['message' => '']))->assertJsonValidationErrors('message');
        $this->report($this->body(['stack' => str_repeat('a', 8193)]))->assertJsonValidationErrors('stack');
        $this->report($this->body(['release' => str_repeat('a', 65)]))->assertJsonValidationErrors('release');

        foreach (range(1, 6) as $n) {
            $this->report($this->body(['message' => "Error {$n}"]))->assertStatus(202);
        }
        $this->report($this->body(['message' => 'One too many']))->assertTooManyRequests();
    }

    public function test_only_the_path_of_the_page_is_kept(): void
    {
        $this->assertSame('/products/12', ClientErrorController::path('https://shop.example/products/12?q=x#top'));
        $this->assertSame('/admin/orders', ClientErrorController::path('/admin/orders?page=2'));
        $this->assertNull(ClientErrorController::path('javascript:alert(1)'));
        $this->assertNull(ClientErrorController::path(null));
    }
}
