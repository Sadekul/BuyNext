<?php

namespace App\Services;

use App\Jobs\SendNewsletterBatch;
use App\Mail\NewsletterConfirmationMail;
use App\Models\Customer;
use App\Models\NewsletterCampaign;
use App\Models\NewsletterSubscriber;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

/**
 * Phase 7: the newsletter list (double opt-in) and sending campaigns.
 *
 * Subscribing never tells the visitor whether an address is already on the
 * list: the controller always answers the same 202, whatever happened here.
 */
class Newsletter
{
    public const CONFIRM_DAYS = 7;

    /**
     * A visitor subscribes: unless the address is already subscribed, a new
     * confirmation link replaces any earlier one and is emailed.
     */
    public function subscribe(string $email, string $source = 'footer'): void
    {
        $email = mb_strtolower(trim($email));
        $token = null;

        try {
            $this->saveRequest($email, $source, $token);
        } catch (UniqueConstraintViolationException) {
            // Two sign-ups for a new address at the same moment: the other one created it; send this one's link.
            $this->saveRequest($email, $source, $token);
        }

        if ($token) {
            Mail::to($email)->send(new NewsletterConfirmationMail($token));
        }
    }

    private function saveRequest(string $email, string $source, ?string &$token): void
    {
        $token = null;
        DB::transaction(function () use ($email, $source, &$token) {
            $subscriber = NewsletterSubscriber::where('email', $email)->lockForUpdate()->first();
            if ($subscriber?->status === 'subscribed') {
                return; // nothing to do, and nothing to reveal
            }
            $token = Str::random(48);
            $subscriber ??= new NewsletterSubscriber(['email' => $email, 'source' => $source]);
            $subscriber->fill([
                'status' => 'pending',
                'confirm_token_hash' => hash('sha256', $token),
                'confirm_sent_at' => now(),
                'customer_id' => $subscriber->customer_id ?? Customer::where('email', $email)->value('id'),
            ]);
            if ($subscriber->exists && $subscriber->getOriginal('status') === 'unsubscribed') {
                $subscriber->source = $source;
            }
            $subscriber->save();
        });
    }

    /** The confirmation link was clicked: the subscriber, now subscribed, or null for a bad/expired token. */
    public function confirm(string $token): ?NewsletterSubscriber
    {
        return DB::transaction(function () use ($token) {
            $subscriber = NewsletterSubscriber::where('confirm_token_hash', hash('sha256', $token))->lockForUpdate()->first();
            if (! $subscriber || ! $subscriber->confirm_sent_at || $subscriber->confirm_sent_at->lt(now()->subDays(self::CONFIRM_DAYS))) {
                return null;
            }
            if ($subscriber->status !== 'subscribed') {
                $subscriber->forceFill(['status' => 'subscribed', 'confirmed_at' => now(), 'unsubscribed_at' => null])->save();
            }

            return $subscriber;
        });
    }

    public function unsubscribe(NewsletterSubscriber $subscriber): NewsletterSubscriber
    {
        if ($subscriber->status !== 'unsubscribed') {
            // The old confirmation link stops working too.
            $subscriber->forceFill(['status' => 'unsubscribed', 'unsubscribed_at' => now(), 'confirm_token_hash' => null])->save();
        }

        return $subscriber;
    }

    public function isSubscribed(Customer $customer): bool
    {
        return NewsletterSubscriber::where('email', mb_strtolower($customer->email))->where('status', 'subscribed')->exists();
    }

    /** Account → newsletter toggle: the email is verified, so no confirmation is needed. */
    public function setForCustomer(Customer $customer, bool $subscribed): void
    {
        $email = mb_strtolower($customer->email);
        $subscriber = NewsletterSubscriber::firstOrNew(['email' => $email], ['source' => 'account']);
        $subscriber->customer_id = $customer->id;
        if ($subscribed && $subscriber->status !== 'subscribed') {
            $subscriber->forceFill(['status' => 'subscribed', 'confirmed_at' => now(), 'unsubscribed_at' => null, 'confirm_token_hash' => null]);
            if ($subscriber->exists) {
                $subscriber->source = 'account';
            }
        } elseif (! $subscribed && $subscriber->exists && $subscriber->status !== 'unsubscribed') {
            $subscriber->forceFill(['status' => 'unsubscribed', 'unsubscribed_at' => now(), 'confirm_token_hash' => null]);
        }
        if ($subscriber->exists || $subscribed) {
            $subscriber->save();
        }
    }

    /**
     * Starts sending a draft campaign: it becomes "sending" with the number of
     * recipients right now, then one queued job per 100 subscribers. Returns
     * false when nobody is subscribed. The jobs are dispatched after the
     * transaction commits, so a worker never sees a campaign that isn't saved.
     */
    public function send(NewsletterCampaign $campaign): bool
    {
        $ids = NewsletterSubscriber::where('status', 'subscribed')->orderBy('id')->pluck('id');
        if ($ids->isEmpty()) {
            return false;
        }
        $batches = $ids->chunk(SendNewsletterBatch::SIZE);

        DB::transaction(function () use ($campaign, $ids, $batches) {
            $campaign->forceFill([
                'status' => 'sending',
                'recipient_count' => $ids->count(),
                'sent_count' => 0,
                'failed_count' => 0,
                'batches_total' => $batches->count(),
                'batches_done' => 0,
            ])->save();
        });

        foreach ($batches as $batch) {
            SendNewsletterBatch::dispatch($campaign->id, $batch->values()->all())->afterCommit();
        }

        return true;
    }
}
