<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\CurrencyRate;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 11: display currencies (Settings → Currencies) and the store payload. */
class CurrencyRateTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private array $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = $this->adminHeaders();
    }

    private function admin(string $method, string $uri, array $body = []): TestResponse
    {
        return $this->asAdmin($this->admin, $method, $uri, $body);
    }

    public function test_bdt_and_eur_are_seeded_switched_off_and_the_store_shows_only_enabled_rates(): void
    {
        $this->admin('GET', '/api/admin/v1/currencies')->assertOk()->assertJsonPath('meta.base', 'USD')
            ->assertJsonPath('data.0.code', 'BDT')->assertJsonPath('data.0.symbol', '৳')->assertJsonPath('data.0.enabled', false)
            ->assertJsonPath('data.0.rate', '0.00000000')->assertJsonPath('data.1.code', 'EUR')->assertJsonPath('data.0.stale', false);
        $this->getJson('/api/v1/store')->assertOk()->assertJsonPath('data.currencies', ['base' => 'USD', 'display' => []]);

        $bdt = CurrencyRate::where('code', 'BDT')->firstOrFail();
        $this->admin('PATCH', "/api/admin/v1/currencies/{$bdt->id}", ['enabled' => true])->assertStatus(422)->assertJsonValidationErrors('rate');
        $this->admin('PATCH', "/api/admin/v1/currencies/{$bdt->id}", ['enabled' => true, 'rate' => '122.5'])->assertOk()
            ->assertJsonPath('data.rate', '122.50000000')->assertJsonPath('data.enabled', true);
        // EUR has a rate but is off: not shown.
        $eur = CurrencyRate::where('code', 'EUR')->firstOrFail();
        $this->admin('PATCH', "/api/admin/v1/currencies/{$eur->id}", ['rate' => '0.92'])->assertOk();

        $this->getJson('/api/v1/store')->assertOk()->assertJsonPath('data.currencies.display', [
            ['code' => 'BDT', 'symbol' => '৳', 'rate' => '122.50000000', 'decimals' => 2],
        ]);
        $this->assertDatabaseHas('audit_log', ['action' => 'currency.updated', 'subject_id' => $bdt->id]);
    }

    public function test_staff_add_reorder_and_remove_currencies_with_validation_and_permissions(): void
    {
        $this->admin('POST', '/api/admin/v1/currencies', ['code' => 'usd', 'symbol' => '$', 'rate' => 1])->assertStatus(422)->assertJsonValidationErrors('code');
        $this->admin('POST', '/api/admin/v1/currencies', ['code' => 'BDT', 'symbol' => '৳', 'rate' => 1])->assertStatus(422)->assertJsonValidationErrors('code');
        $this->admin('POST', '/api/admin/v1/currencies', ['code' => 'GB', 'symbol' => '£', 'rate' => 1])->assertStatus(422)->assertJsonValidationErrors('code');
        $this->admin('POST', '/api/admin/v1/currencies', ['code' => 'GBP', 'symbol' => 'toolong', 'rate' => 1, 'decimals' => 4])
            ->assertStatus(422)->assertJsonValidationErrors(['symbol', 'decimals']);
        $this->admin('POST', '/api/admin/v1/currencies', ['code' => 'GBP', 'symbol' => '£', 'rate' => '-1'])->assertStatus(422)->assertJsonValidationErrors('rate');

        $id = $this->admin('POST', '/api/admin/v1/currencies', ['code' => 'gbp', 'symbol' => '£', 'rate' => '0.79', 'enabled' => true])->assertCreated()
            ->assertJsonPath('data.code', 'GBP')->assertJsonPath('data.decimals', 2)->assertJsonPath('data.position', 3)->json('data.id');
        $this->getJson('/api/v1/store')->assertJsonPath('data.currencies.display.0.code', 'GBP');

        $ids = CurrencyRate::orderBy('position')->pluck('id')->all();
        $this->admin('POST', '/api/admin/v1/currencies/reorder', ['ids' => [$id]])->assertStatus(422)->assertJsonValidationErrors('ids');
        $this->admin('POST', '/api/admin/v1/currencies/reorder', ['ids' => array_reverse($ids)])->assertOk()->assertJsonPath('data.0.code', 'GBP');

        // Old rates are flagged.
        CurrencyRate::whereKey($id)->update(['updated_at' => now()->subDays(31)]);
        $this->admin('GET', '/api/admin/v1/currencies')->assertJsonPath('data.0.stale', true);

        $viewer = $this->signInAdmin(Admin::factory()->role(['settings.view'])->create());
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/currencies')->assertOk();
        $this->asAdmin($viewer, 'PATCH', "/api/admin/v1/currencies/{$id}", ['rate' => 1])->assertForbidden();
        $this->asAdmin($viewer, 'DELETE', "/api/admin/v1/currencies/{$id}")->assertForbidden();

        $this->admin('DELETE', "/api/admin/v1/currencies/{$id}")->assertNoContent();
        $this->admin('DELETE', "/api/admin/v1/currencies/{$id}")->assertNotFound();
        $this->assertDatabaseHas('audit_log', ['action' => 'currency.deleted', 'subject_id' => $id]);
    }
}
