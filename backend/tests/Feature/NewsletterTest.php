<?php

namespace Tests\Feature;

use App\Mail\NewsletterConfirmationMail;
use App\Mail\NewsletterMail;
use App\Models\Admin;
use App\Models\AdminNotification;
use App\Models\Customer;
use App\Models\NewsletterCampaign;
use App\Models\NewsletterSubscriber;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 7: double opt-in newsletter, signed unsubscribe links, campaigns sent in batches. */
class NewsletterTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private array $headers;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->headers = $this->adminHeaders();
    }

    private function confirmToken(string $email): string
    {
        $mail = Mail::sent(NewsletterConfirmationMail::class, fn ($m) => $m->hasTo($email))->last();
        $this->assertNotNull($mail, "No confirmation email to {$email}");

        return $mail->token;
    }

    public function test_subscribing_answers_the_same_for_known_and_unknown_emails(): void
    {
        NewsletterSubscriber::create(['email' => 'known@example.com', 'status' => 'subscribed', 'source' => 'footer']);

        $known = $this->postJson('/api/v1/newsletter', ['email' => 'known@example.com'])->assertStatus(202)->json();
        $unknown = $this->postJson('/api/v1/newsletter', ['email' => 'New@Example.com'])->assertStatus(202)->json();

        $this->assertSame($known, $unknown);
        Mail::assertNotSent(NewsletterConfirmationMail::class, fn ($m) => $m->hasTo('known@example.com'));
        Mail::assertSent(NewsletterConfirmationMail::class, fn ($m) => $m->hasTo('new@example.com'));
        $this->assertSame('pending', NewsletterSubscriber::where('email', 'new@example.com')->value('status'));
        $this->postJson('/api/v1/newsletter', ['email' => 'not-an-email'])->assertUnprocessable()->assertJsonValidationErrors('email');
    }

    public function test_the_confirmation_link_subscribes_once_and_expires(): void
    {
        $this->postJson('/api/v1/newsletter', ['email' => 'ava@example.com'])->assertStatus(202);
        $token = $this->confirmToken('ava@example.com');

        $this->assertStringContainsString(urlencode($token), Mail::sent(NewsletterConfirmationMail::class)->last()->render());
        $this->postJson('/api/v1/newsletter/confirm', ['token' => 'wrong'])->assertUnprocessable()->assertJsonValidationErrors('token');
        $this->postJson('/api/v1/newsletter/confirm', ['token' => $token])->assertOk()
            ->assertJsonPath('data', ['email' => 'ava@example.com', 'status' => 'subscribed']);
        $this->postJson('/api/v1/newsletter/confirm', ['token' => $token])->assertOk(); // clicked twice

        $this->postJson('/api/v1/newsletter', ['email' => 'late@example.com']);
        $late = $this->confirmToken('late@example.com');
        $this->travel(8)->days();
        $this->postJson('/api/v1/newsletter/confirm', ['token' => $late])->assertUnprocessable();
    }

    public function test_the_signed_unsubscribe_token(): void
    {
        $subscriber = NewsletterSubscriber::create(['email' => 'ava@example.com', 'status' => 'subscribed', 'source' => 'footer']);
        $other = NewsletterSubscriber::create(['email' => 'bo@example.com', 'status' => 'subscribed', 'source' => 'footer']);
        $forged = $other->id.'.'.explode('.', $subscriber->unsubscribeToken())[1];

        $this->postJson('/api/v1/newsletter/unsubscribe', ['token' => $forged])->assertUnprocessable()->assertJsonValidationErrors('token');
        $this->postJson('/api/v1/newsletter/unsubscribe', ['token' => $subscriber->unsubscribeToken()])->assertOk()
            ->assertJsonPath('data.status', 'unsubscribed');
        $this->assertSame('unsubscribed', $subscriber->fresh()->status);
        $this->assertSame('subscribed', $other->fresh()->status);
    }

    public function test_subscribing_is_rate_limited_per_email(): void
    {
        foreach (range(1, 3) as $i) {
            $this->postJson('/api/v1/newsletter', ['email' => 'spam@example.com'])->assertStatus(202);
        }
        $this->postJson('/api/v1/newsletter', ['email' => 'spam@example.com'])->assertStatus(429);
    }

    public function test_a_customer_toggles_the_newsletter_in_their_account(): void
    {
        $customer = Customer::factory()->create(['email' => 'cust@example.com']);
        $this->app['auth']->forgetGuards();
        $headers = ['Authorization' => 'Bearer '.$this->postJson('/api/v1/auth/login', ['email' => 'cust@example.com', 'password' => 'Password123'])
            ->json('data.tokens.access_token')];

        $this->getJson('/api/v1/me', $headers)->assertJsonPath('data.newsletter', false);
        $this->patchJson('/api/v1/me', ['newsletter' => true], $headers)->assertOk()->assertJsonPath('data.newsletter', true);
        $this->assertDatabaseHas('newsletter_subscribers', ['email' => 'cust@example.com', 'status' => 'subscribed', 'source' => 'account', 'customer_id' => $customer->id]);
        Mail::assertNotSent(NewsletterConfirmationMail::class);
        $this->patchJson('/api/v1/me', ['newsletter' => false], $headers)->assertOk()->assertJsonPath('data.newsletter', false);
    }

    public function test_campaigns_are_sanitized_and_only_drafts_change(): void
    {
        $id = $this->asAdmin($this->headers, 'POST', '/api/admin/v1/newsletter/campaigns', [
            'subject' => 'Autumn sale', 'preheader' => 'Up to 30% off', 'body' => '<p onclick="x()">Hello<script>alert(1)</script></p>',
        ])->assertCreated()->assertJsonPath('data.body', '<p>Hello</p>')->assertJsonPath('data.status', 'draft')->json('data.id');

        $this->asAdmin($this->headers, 'PATCH', "/api/admin/v1/newsletter/campaigns/{$id}", ['subject' => 'Autumn sale!'])
            ->assertOk()->assertJsonPath('data.subject', 'Autumn sale!');
        NewsletterCampaign::whereKey($id)->update(['status' => 'sent']);
        $this->asAdmin($this->headers, 'PATCH', "/api/admin/v1/newsletter/campaigns/{$id}", ['subject' => 'x'])
            ->assertUnprocessable()->assertJsonValidationErrors('campaign');
        $this->asAdmin($this->headers, 'DELETE', "/api/admin/v1/newsletter/campaigns/{$id}")->assertUnprocessable();
        $this->assertDatabaseHas('audit_log', ['action' => 'newsletter.campaign_created', 'subject_id' => $id]);
    }

    public function test_a_campaign_goes_out_in_batches_of_100_with_an_unsubscribe_header(): void
    {
        $rows = [];
        foreach (range(1, 205) as $i) {
            $rows[] = ['email' => "s{$i}@example.com", 'status' => 'subscribed', 'source' => 'footer', 'created_at' => now(), 'updated_at' => now()];
        }
        $rows[] = ['email' => 'gone@example.com', 'status' => 'unsubscribed', 'source' => 'footer', 'created_at' => now(), 'updated_at' => now()];
        $rows[] = ['email' => 'waiting@example.com', 'status' => 'pending', 'source' => 'footer', 'created_at' => now(), 'updated_at' => now()];
        NewsletterSubscriber::insert($rows);
        $campaign = NewsletterCampaign::create(['subject' => 'News', 'body' => '<p>Hi</p>', 'status' => 'draft']);

        $this->asAdmin($this->headers, 'POST', "/api/admin/v1/newsletter/campaigns/{$campaign->id}/send")->assertStatus(202)
            ->assertJsonPath('data.status', 'sent')->assertJsonPath('data.recipient_count', 205)->assertJsonPath('data.sent_count', 205);

        $this->assertSame(3, $campaign->fresh()->batches_total);
        Mail::assertSent(NewsletterMail::class, 205);
        Mail::assertNotSent(NewsletterMail::class, fn ($m) => $m->hasTo('gone@example.com') || $m->hasTo('waiting@example.com'));
        $subscriber = NewsletterSubscriber::where('email', 's7@example.com')->first();
        Mail::assertSent(NewsletterMail::class, function ($mail) use ($subscriber) {
            if (! $mail->hasTo('s7@example.com')) {
                return false;
            }
            $header = $mail->headers()->text['List-Unsubscribe'];

            return $header === '<'.$subscriber->unsubscribeUrl().'>' && str_contains($mail->render(), e($subscriber->unsubscribeUrl()));
        });
        // Sent once only.
        $this->asAdmin($this->headers, 'POST', "/api/admin/v1/newsletter/campaigns/{$campaign->id}/send")->assertUnprocessable();
    }

    public function test_sending_needs_subscribers_and_a_test_goes_to_the_admin_only(): void
    {
        $admin = Admin::factory()->create(['email' => 'boss@example.com']);
        $headers = $this->signInAdmin($admin);
        $campaign = NewsletterCampaign::create(['subject' => 'News', 'body' => '<p>Hi</p>', 'status' => 'draft']);

        $this->asAdmin($headers, 'POST', "/api/admin/v1/newsletter/campaigns/{$campaign->id}/send")
            ->assertUnprocessable()->assertJsonValidationErrors('campaign');
        $this->asAdmin($headers, 'POST', "/api/admin/v1/newsletter/campaigns/{$campaign->id}/test")->assertOk()
            ->assertJsonPath('data.email', 'boss@example.com');
        Mail::assertSent(NewsletterMail::class, fn ($m) => $m->hasTo('boss@example.com') && $m->envelope()->subject === '[Test] News');
        $this->assertSame('draft', $campaign->fresh()->status);
    }

    public function test_a_failed_batch_notifies_admins(): void
    {
        NewsletterSubscriber::create(['email' => 'a@example.com', 'status' => 'subscribed', 'source' => 'footer']);
        $campaign = NewsletterCampaign::create(['subject' => 'News', 'body' => '<p>Hi</p>', 'status' => 'draft']);
        Mail::shouldReceive('to')->andThrow(new \RuntimeException('SMTP down'));

        $this->asAdmin($this->headers, 'POST', "/api/admin/v1/newsletter/campaigns/{$campaign->id}/send")->assertStatus(202);

        $this->assertSame([1, 0, 'sent'], [$campaign->fresh()->failed_count, $campaign->fresh()->sent_count, $campaign->fresh()->status]);
        $this->assertSame(1, AdminNotification::where('type', 'newsletter_failed')->where('permission', 'newsletter.send')->count());
    }

    public function test_the_subscriber_list_counts_export_and_unsubscribe(): void
    {
        NewsletterSubscriber::create(['email' => 'a@example.com', 'status' => 'subscribed', 'source' => 'footer']);
        $b = NewsletterSubscriber::create(['email' => '=b@example.com', 'status' => 'pending', 'source' => 'checkout']);

        $this->asAdmin($this->headers, 'GET', '/api/admin/v1/newsletter/subscribers?status=pending')->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.email', '=b@example.com')
            ->assertJsonPath('meta.counts', ['pending' => 1, 'subscribed' => 1, 'unsubscribed' => 0]);
        $csv = $this->asAdmin($this->headers, 'GET', '/api/admin/v1/newsletter/subscribers/export.csv')->assertOk()->getContent();
        $this->assertStringContainsString("'=b@example.com", $csv);
        $this->asAdmin($this->headers, 'POST', "/api/admin/v1/newsletter/subscribers/{$b->id}/unsubscribe")->assertOk()
            ->assertJsonPath('data.status', 'unsubscribed');
    }

    public function test_permissions(): void
    {
        $viewer = $this->signInAdmin(Admin::factory()->role('Viewer')->create());
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/newsletter/campaigns')->assertOk();
        $this->asAdmin($viewer, 'POST', '/api/admin/v1/newsletter/campaigns', ['subject' => 'x', 'body' => '<p>x</p>'])->assertForbidden()
            ->assertJsonPath('permission', 'newsletter.send');
        $marketing = $this->signInAdmin(Admin::factory()->role('Marketing')->create());
        $this->asAdmin($marketing, 'POST', '/api/admin/v1/newsletter/campaigns', ['subject' => 'x', 'body' => '<p>x</p>'])->assertCreated();
        $this->asAdmin($marketing, 'GET', '/api/admin/v1/email-templates')->assertForbidden(); // Owner-only by default
    }
}
