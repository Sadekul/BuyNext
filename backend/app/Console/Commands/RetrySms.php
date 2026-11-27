<?php

namespace App\Console\Commands;

use App\Models\SmsMessage;
use App\Services\Sms\Sms;
use Illuminate\Console\Command;

/**
 * Phase 20: sends failed texts again (scheduled every 10 minutes while SMS is
 * on): failed rows of the last 24 hours with fewer than 5 attempts, oldest
 * first, at most --limit (100) per run. Older ones are left for staff
 * (SMS log → Retry): a "your order shipped" text a day late helps no one.
 */
class RetrySms extends Command
{
    protected $signature = 'buynest:sms:retry {--dry-run : List the texts that would be retried, send nothing} {--limit=100 : At most this many texts}';

    protected $description = 'Send failed SMS texts of the last 24 hours again';

    public function handle(Sms $sms): int
    {
        $messages = SmsMessage::where('status', 'failed')
            ->where('created_at', '>=', now()->subDay())
            ->where('attempts', '<', (int) config('buynest.sms.max_attempts', 5))
            ->orderBy('id')
            ->limit(max(1, min(500, (int) $this->option('limit'))))
            ->get();

        if ($messages->isEmpty()) {
            $this->info('No failed texts to retry.');

            return self::SUCCESS;
        }
        if ($this->option('dry-run')) {
            foreach ($messages as $message) {
                $this->line("#{$message->id}: ".($message->event ?? 'test').' to '.Sms::masked($message->to)." ({$message->attempts} attempts)");
            }
            $this->info("Would retry {$messages->count()} texts.");

            return self::SUCCESS;
        }

        $sent = 0;
        foreach ($messages as $message) {
            $sent += $sms->retry($message)->status === 'sent' ? 1 : 0;
        }
        $this->info("Retried {$messages->count()} texts: {$sent} sent, ".($messages->count() - $sent).' still failing.');

        return self::SUCCESS;
    }
}
