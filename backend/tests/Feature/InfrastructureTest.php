<?php

namespace Tests\Feature;

use App\Http\Middleware\TrustBffClientIp;
use Illuminate\Http\Request;
use Tests\TestCase;

class InfrastructureTest extends TestCase
{
    private function ipSeenBy(array $headers): string
    {
        $request = Request::create('/api/v1/auth/login', 'POST', server: ['REMOTE_ADDR' => '10.0.0.1']);
        $request->headers->add($headers);

        return (new TrustBffClientIp)->handle($request, fn ($request) => response($request->ip()))->getContent();
    }

    public function test_the_visitor_ip_is_only_trusted_from_the_sign_in_service(): void
    {
        config(['buynest.bff_key' => 'secret-key']);

        $this->assertSame('203.0.113.9', $this->ipSeenBy(['X-BuyNest-Bff' => 'secret-key', 'X-Client-IP' => '203.0.113.9']));
        $this->assertSame('10.0.0.1', $this->ipSeenBy(['X-BuyNest-Bff' => 'wrong', 'X-Client-IP' => '203.0.113.9']));
        $this->assertSame('10.0.0.1', $this->ipSeenBy(['X-Client-IP' => '203.0.113.9']));
        $this->assertSame('10.0.0.1', $this->ipSeenBy(['X-BuyNest-Bff' => 'secret-key', 'X-Client-IP' => 'not-an-ip']));

        config(['buynest.bff_key' => '']);
        $this->assertSame('10.0.0.1', $this->ipSeenBy(['X-BuyNest-Bff' => '', 'X-Client-IP' => '203.0.113.9']));
    }

    public function test_the_test_inbox_does_not_exist_outside_local_development(): void
    {
        $this->get('/dev/mailbox')->assertNotFound();
    }

    public function test_api_errors_are_json_without_internals(): void
    {
        $this->getJson('/api/v1/nope')->assertNotFound()->assertJsonStructure(['message']);
        $this->getJson('/api/v1/me')->assertUnauthorized()->assertExactJson(['message' => 'Unauthenticated.']);
    }

    public function test_sign_in_attempts_are_rate_limited(): void
    {
        config(['buynest.auth_per_minute' => 1000]);
        for ($i = 0; $i < 10; $i++) {
            $this->postJson('/api/v1/auth/login', ['email' => 'ava@example.com', 'password' => 'wrong'])->assertUnprocessable();
        }
        $this->postJson('/api/v1/auth/login', ['email' => 'ava@example.com', 'password' => 'wrong'])->assertTooManyRequests();
    }
}
