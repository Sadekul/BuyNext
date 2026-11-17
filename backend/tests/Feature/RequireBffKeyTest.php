<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** Production lock: only the storefront's sign-in service (with the shared key) may call /api. */
class RequireBffKeyTest extends TestCase
{
    use RefreshDatabase;

    public function test_off_by_default_so_local_tools_can_call_the_api(): void
    {
        $this->getJson('/api/v1/store')->assertOk();
    }

    public function test_when_on_only_requests_with_the_shared_key_get_through(): void
    {
        config(['buynest.require_bff_key' => true, 'buynest.bff_key' => 'the-shared-key']);

        $this->getJson('/api/v1/store')->assertForbidden()->assertJsonPath('code', 'store_only');
        $this->getJson('/api/v1/store', ['X-BuyNest-Bff' => 'a-guess'])->assertForbidden();
        $this->postJson('/api/admin/v1/auth/login', ['email' => 'a@b.c', 'password' => 'x'])->assertForbidden();
        $this->postJson('/api/v1/payments/stripe/webhook', [])->assertForbidden();

        $this->getJson('/api/v1/store', ['X-BuyNest-Bff' => 'the-shared-key'])->assertOk();
        $this->get('/up')->assertOk(); // the health check isn't an API route
    }

    public function test_when_on_without_a_configured_key_everything_is_refused(): void
    {
        config(['buynest.require_bff_key' => true, 'buynest.bff_key' => '']);

        $this->getJson('/api/v1/store', ['X-BuyNest-Bff' => ''])->assertForbidden();
    }
}
