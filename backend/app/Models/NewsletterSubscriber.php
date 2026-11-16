<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Phase 7: one email address on the newsletter list. "pending" until the
 * confirmation link is clicked (double opt-in); signed-in customers who tick
 * the box in Account are "subscribed" at once (their email is verified).
 */
#[Fillable(['email', 'customer_id', 'status', 'confirm_token_hash', 'confirm_sent_at', 'confirmed_at', 'unsubscribed_at', 'source'])]
class NewsletterSubscriber extends Model
{
    public const STATUSES = ['pending', 'subscribed', 'unsubscribed'];

    public const SOURCES = ['footer', 'account', 'checkout', 'admin'];

    protected $hidden = ['confirm_token_hash'];

    protected function casts(): array
    {
        return [
            'customer_id' => 'integer',
            'confirm_sent_at' => 'datetime',
            'confirmed_at' => 'datetime',
            'unsubscribed_at' => 'datetime',
        ];
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    /**
     * The token in every newsletter's unsubscribe link: "{id}.{HMAC}" signed
     * with the app key, so it needs no table and can't be guessed or forged.
     */
    public function unsubscribeToken(): string
    {
        return $this->id.'.'.self::signature($this->id, $this->email);
    }

    public function unsubscribeUrl(): string
    {
        return config('buynest.storefront_url').'/newsletter/unsubscribe?token='.urlencode($this->unsubscribeToken());
    }

    /** The subscriber a signed unsubscribe token belongs to, or null when it isn't valid. */
    public static function fromUnsubscribeToken(string $token): ?self
    {
        if (! preg_match('/^(\d{1,18})\.([a-f0-9]{64})$/', $token, $match)) {
            return null;
        }
        $subscriber = self::find((int) $match[1]);

        return $subscriber && hash_equals(self::signature($subscriber->id, $subscriber->email), $match[2]) ? $subscriber : null;
    }

    private static function signature(int $id, string $email): string
    {
        return hash_hmac('sha256', "newsletter-unsubscribe|{$id}|".mb_strtolower($email), (string) config('app.key'));
    }
}
