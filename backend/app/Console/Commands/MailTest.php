<?php

namespace App\Console\Commands;

use App\Services\Settings;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Validator;
use Throwable;

/**
 * Phase 8: php artisan buynest:mail-test you@example.com - sends one test
 * email through the configured mailer (MAIL_MAILER: smtp for Brevo or
 * Mailgun), and prints whether it worked. Errors are printed without the
 * SMTP login or password.
 */
class MailTest extends Command
{
    protected $signature = 'buynest:mail-test {to : The address to send the test email to}';

    protected $description = 'Send a test email through the configured mailer';

    public function handle(): int
    {
        $to = trim((string) $this->argument('to'));
        if (Validator::make(['to' => $to], ['to' => ['required', 'email']])->fails()) {
            $this->error("\"{$to}\" is not an email address.");

            return self::FAILURE;
        }

        $mailer = (string) config('mail.default');
        $config = (array) config("mail.mailers.{$mailer}", []);
        $from = (string) config('mail.from.address');
        $via = ($config['transport'] ?? $mailer) === 'smtp'
            ? "SMTP {$config['host']}:{$config['port']}" : ($config['transport'] ?? $mailer);
        $this->line("Sending a test email to {$to} from {$from} through the \"{$mailer}\" mailer ({$via})...");

        try {
            Mail::mailer($mailer)->raw(
                "This is a test email from {$this->storeName()}.\n\nIf you can read this, email sending works (mailer: {$mailer}).",
                fn ($message) => $message->to($to)->subject("{$this->storeName()} test email"),
            );
        } catch (Throwable $e) {
            $this->error('Sending failed: '.$this->withoutSecrets($e->getMessage(), $config));

            return self::FAILURE;
        }

        $this->info("Sent. Check the inbox of {$to} (and its spam folder).");
        if (in_array($config['transport'] ?? $mailer, ['log', 'array'], true)) {
            $this->warn("Note: the \"{$mailer}\" mailer doesn't deliver real email. Set MAIL_MAILER=smtp to send through Brevo or Mailgun.");
        }

        return self::SUCCESS;
    }

    private function storeName(): string
    {
        try {
            return (string) app(Settings::class)->get('store_name') ?: 'BuyNest';
        } catch (Throwable) {
            return 'BuyNest';
        }
    }

    /** The error without the SMTP login or password (some servers echo them back). */
    private function withoutSecrets(string $message, array $config): string
    {
        foreach (['username', 'password'] as $key) {
            $secret = (string) ($config[$key] ?? '');
            if (strlen($secret) >= 3) {
                $message = str_replace([$secret, base64_encode($secret)], '[hidden]', $message);
            }
        }

        return $message;
    }
}
