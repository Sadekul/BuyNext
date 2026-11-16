<?php

namespace App\Jobs;

use App\Mail\NewsletterMail;
use App\Models\NewsletterCampaign;
use App\Models\NewsletterSubscriber;
use App\Services\AdminNotifications;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * Phase 7: sends one campaign to up to 100 subscribers (a queued job, so a
 * big list doesn't hold up the admin's request). Safe on a real queue:
 * it only carries ids, re-checks each subscriber is still subscribed, and
 * counts with atomic UPDATEs, so batches may run in any order or in
 * parallel. The batch that finishes last marks the campaign "sent".
 * With QUEUE_CONNECTION=sync (development) it runs at once.
 */
class SendNewsletterBatch implements ShouldQueue
{
    use Queueable;

    public const SIZE = 100;

    public int $tries = 1;

    /** @param list<int> $subscriberIds */
    public function __construct(public int $campaignId, public array $subscriberIds) {}

    public function handle(AdminNotifications $notifications): void
    {
        $campaign = NewsletterCampaign::find($this->campaignId);
        if (! $campaign || $campaign->status !== 'sending') {
            return;
        }

        $sent = 0;
        $failed = 0;
        $subscribers = NewsletterSubscriber::whereIn('id', $this->subscriberIds)->where('status', 'subscribed')->get();
        foreach ($subscribers as $subscriber) {
            try {
                Mail::to($subscriber->email)->send(new NewsletterMail($campaign, $subscriber->unsubscribeUrl()));
                $sent++;
            } catch (Throwable $e) {
                $failed++;
                Log::warning("Newsletter {$campaign->id} to subscriber {$subscriber->id} failed: {$e->getMessage()}");
            }
        }

        $this->finish($sent, $failed, $notifications);
    }

    /** A crash outside the per-email try (e.g. the database went away): count the batch as failed. */
    public function failed(?Throwable $exception): void
    {
        $this->finish(0, count($this->subscriberIds), app(AdminNotifications::class));
    }

    private function finish(int $sent, int $failed, AdminNotifications $notifications): void
    {
        NewsletterCampaign::whereKey($this->campaignId)->update([
            'sent_count' => DB::raw('sent_count + '.$sent),
            'failed_count' => DB::raw('failed_count + '.$failed),
            'batches_done' => DB::raw('batches_done + 1'),
        ]);
        NewsletterCampaign::whereKey($this->campaignId)->where('status', 'sending')
            ->whereColumn('batches_done', '>=', 'batches_total')
            ->update(['status' => 'sent', 'sent_at' => now()]);

        if ($failed > 0) {
            $campaign = NewsletterCampaign::find($this->campaignId);
            $notifications->notify('newsletter_failed', "campaign:{$this->campaignId}",
                "Newsletter emails failed: \"{$campaign?->subject}\"",
                "{$failed} of the emails in a batch could not be sent. Check the mail settings and the log.",
                "/newsletter/campaigns/{$this->campaignId}");
        }
    }
}
