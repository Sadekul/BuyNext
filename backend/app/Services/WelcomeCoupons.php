<?php

namespace App\Services;

use App\Mail\WelcomeCouponMail;
use App\Models\Coupon;
use App\Models\Customer;
use App\Models\WelcomeCouponGrant;
use App\Support\Currency;
use App\Support\Locale;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Phase 19: the welcome coupon. While it is switched on, a confirmed email
 * address (a verified sign-up, a confirmed newsletter subscription, or the
 * account's newsletter switch) gets a personal one-time code by email.
 *
 * One code per email address, ever: welcome_coupon_grants.email is unique
 * and its row is written before the coupon, so a second grant for the same
 * address (another trigger, a re-subscription, a re-created account) finds
 * it and does nothing. The code itself is an ordinary Coupon (source
 * "welcome", issued_to_email, usage limit 1), so the cart, checkout and
 * Coupon::problemFor() treat it like any other code.
 *
 * Settings only shape the codes issued after them; codes already sent keep
 * their own type, value, minimum and end date.
 */
class WelcomeCoupons
{
    /** Code characters: no 0/O, 1/I (easy to read and to type). */
    private const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    public const PREFIX = 'WELCOME-';

    /** The settings keys (stored in Settings, edited on Marketing → Welcome coupon). */
    public const KEYS = ['welcome_coupon_enabled', 'welcome_coupon_triggers', 'welcome_coupon_type', 'welcome_coupon_value',
        'welcome_coupon_min_subtotal', 'welcome_coupon_valid_days', 'welcome_coupon_first_order_only'];

    public const STATUSES = ['active', 'used', 'expired'];

    public function __construct(private Settings $settings, private Audit $audit) {}

    /** The current settings, normalized (key => value). */
    public function settings(): array
    {
        $raw = array_combine(self::KEYS, array_map(fn ($key) => $this->settings->get($key), self::KEYS));

        return [
            'welcome_coupon_enabled' => (bool) $raw['welcome_coupon_enabled'],
            'welcome_coupon_triggers' => array_values(array_intersect(WelcomeCouponGrant::TRIGGERS, (array) $raw['welcome_coupon_triggers'])),
            'welcome_coupon_type' => $raw['welcome_coupon_type'] === 'fixed' ? 'fixed' : 'percent',
            'welcome_coupon_value' => Pricing::format(Pricing::toCents((string) $raw['welcome_coupon_value'])),
            'welcome_coupon_min_subtotal' => $raw['welcome_coupon_min_subtotal'] === null ? null
                : Pricing::format(Pricing::toCents((string) $raw['welcome_coupon_min_subtotal'])),
            'welcome_coupon_valid_days' => (int) $raw['welcome_coupon_valid_days'],
            'welcome_coupon_first_order_only' => (bool) $raw['welcome_coupon_first_order_only'],
        ];
    }

    public function enabled(): bool
    {
        return $this->settings()['welcome_coupon_enabled'];
    }

    /** What shoppers are promised (GET /api/v1/store `welcome_offer`), or null while it is off. */
    public function offer(): ?array
    {
        return $this->enabled() ? $this->preview() : null;
    }

    /** The offer as it would be shown, even while off (the admin preview). */
    public function preview(): array
    {
        $s = $this->settings();

        return [
            'type' => $s['welcome_coupon_type'],
            'value' => $s['welcome_coupon_value'],
            'label' => self::label($s['welcome_coupon_type'], $s['welcome_coupon_value']),
            'min_subtotal' => $s['welcome_coupon_min_subtotal'] === null ? null : self::amount($s['welcome_coupon_min_subtotal']),
            'valid_days' => $s['welcome_coupon_valid_days'],
            'first_order_only' => $s['welcome_coupon_first_order_only'],
            'triggers' => $s['welcome_coupon_triggers'],
        ];
    }

    /** "10% off" / "৳100 off" (store currency), in $locale (the current one by default; Bangla digits per setting). */
    public static function label(string $type, string|int|float $value, ?string $locale = null): string
    {
        $cents = Pricing::toCents((string) $value);
        $amount = $type === 'percent' ? Locale::digits(rtrim(rtrim(Pricing::format($cents), '0'), '.').'%', $locale) : self::amount($value, $locale);

        return __(':amount off', ['amount' => $amount], $locale);
    }

    /** An amount in the store currency without needless ".00" ("৳500", "$12.50"), in $locale. */
    public static function amount(string|int|float $value, ?string $locale = null): string
    {
        $cents = Pricing::toCents((string) $value);
        $number = $cents % 100 === 0 ? number_format(intdiv($cents, 100)) : number_format($cents / 100, 2);

        return Locale::digits(Currency::symbol().$number, $locale);
    }

    /**
     * Gives $email its welcome code, or null: off, the trigger isn't on, the
     * address (or this customer) already got one. The grant row is inserted
     * first; its unique email turns a second attempt into a quiet null. The
     * email goes after the commit; a failed email is reported, never thrown.
     */
    public function grant(string $email, string $trigger, ?Customer $customer = null, ?string $locale = null): ?Coupon
    {
        $email = mb_strtolower(trim($email));
        $settings = $this->settings();
        if ($email === '' || ! $settings['welcome_coupon_enabled'] || ! in_array($trigger, $settings['welcome_coupon_triggers'], true)) {
            return null;
        }
        // Cheap checks first (the unique index still decides a race). A customer who changed their email gets no second code.
        if (WelcomeCouponGrant::where('email', $email)->exists()
            || ($customer && WelcomeCouponGrant::where('customer_id', $customer->id)->exists())) {
            return null;
        }

        $coupon = DB::transaction(function () use ($email, $trigger, $customer, $settings) {
            try {
                $grant = WelcomeCouponGrant::create(['email' => $email, 'trigger' => $trigger, 'customer_id' => $customer?->id]);
            } catch (UniqueConstraintViolationException) {
                return null; // granted a moment ago by another request
            }
            $coupon = $this->createCoupon($email, $settings);
            $grant->forceFill(['coupon_id' => $coupon->id])->save();
            $this->audit->record('coupon.welcome_issued', "Welcome code {$coupon->code} issued to {$email} ({$trigger}).", 'coupon', $coupon->id,
                anonymous: true);

            return $coupon;
        });
        if (! $coupon) {
            return null;
        }

        $locale = Locale::normalize($locale) ?? Locale::forCustomer($customer) ?? Locale::current();
        $name = $customer?->first_name;
        DB::afterCommit(function () use ($coupon, $email, $name, $locale) {
            try {
                Mail::to($email)->send(new WelcomeCouponMail($coupon, $name, $locale));
            } catch (Throwable $e) {
                report($e);
            }
        });

        return $coupon;
    }

    /** grant() for the hooks (sign-up, newsletter): any failure is reported, and the caller's action still succeeds. */
    public function tryGrant(string $email, string $trigger, ?Customer $customer = null, ?string $locale = null): ?Coupon
    {
        try {
            return $this->grant($email, $trigger, $customer, $locale);
        } catch (Throwable $e) {
            report($e);

            return null;
        }
    }

    private function createCoupon(string $email, array $settings): Coupon
    {
        do {
            $code = self::PREFIX.collect(range(1, 6))->map(fn () => self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)])->implode('');
        } while (Coupon::where('code', $code)->exists());

        $coupon = new Coupon([
            'code' => $code,
            'description' => mb_substr("Welcome offer for {$email}", 0, 160),
            'type' => $settings['welcome_coupon_type'],
            'value' => $settings['welcome_coupon_value'],
            'min_subtotal' => $settings['welcome_coupon_min_subtotal'],
            'starts_at' => now(),
            // The end of that day in the store's timezone (stored as UTC, like every coupon date).
            'ends_at' => now(config('app.timezone'))->addDays($settings['welcome_coupon_valid_days'])->endOfDay()->utc(),
            'usage_limit' => 1,
            'usage_limit_per_customer' => 1,
            'is_active' => true,
            'applies_to' => 'all',
            'auto_apply' => false,
            'free_shipping' => false,
            'source' => 'welcome',
            'issued_to_email' => $email,
            'first_order_only' => $settings['welcome_coupon_first_order_only'],
        ]);
        $coupon->save();

        return $coupon;
    }

    /** The welcome code of $email for its owner (account page), or null. */
    public function forEmail(string $email): ?array
    {
        $grant = WelcomeCouponGrant::where('email', mb_strtolower(trim($email)))->with('coupon')->first();
        $coupon = $grant?->coupon;
        if (! $coupon) {
            return null;
        }

        return [
            'code' => $coupon->code,
            'label' => self::label($coupon->type, (string) $coupon->value),
            'min_subtotal' => $coupon->min_subtotal === null ? null : self::amount((string) $coupon->min_subtotal),
            'first_order_only' => (bool) $coupon->first_order_only,
            'expires_at' => $coupon->ends_at?->toIso8601ZuluString(),
            'status' => self::status($coupon),
        ];
    }

    /** used (redeemed), expired (past its end, or switched off by staff), or active. */
    public static function status(Coupon $coupon): string
    {
        return match (true) {
            $coupon->times_used > 0 => 'used',
            ! $coupon->is_active || ($coupon->ends_at && $coupon->ends_at->isPast()) => 'expired',
            default => 'active',
        };
    }

    /** The same rules as status(), in SQL. */
    private static function whereStatus(Builder $query, string $status): void
    {
        $now = now();
        $unusable = fn ($q) => $q->where('is_active', false)->orWhere(fn ($q) => $q->whereNotNull('ends_at')->where('ends_at', '<', $now));
        match ($status) {
            'used' => $query->where('times_used', '>', 0),
            'expired' => $query->where('times_used', 0)->where($unusable),
            default => $query->where('times_used', 0)->whereNot($unusable),
        };
    }

    /** { issued, used, expired, active } over every welcome code still in the coupon list. */
    public function stats(): array
    {
        $count = function (?string $status) {
            $query = Coupon::where('source', 'welcome');
            if ($status) {
                self::whereStatus($query, $status);
            }

            return $query->count();
        };

        return ['issued' => $count(null), 'used' => $count('used'), 'expired' => $count('expired'), 'active' => $count('active')];
    }

    /** The admin list of issued codes, newest first. */
    public function codes(?string $status, ?string $search, int $perPage = 20): LengthAwarePaginator
    {
        $query = Coupon::where('source', 'welcome')
            ->with(['redemptions' => fn ($q) => $q->orderBy('id'), 'redemptions.order:id,number'])
            ->when($status, fn ($q, $status) => self::whereStatus($q, $status))
            ->when($search, function ($q, $search) {
                $like = '%'.addcslashes($search, '%_\\').'%';
                $q->where(fn ($q) => $q->where('code', 'like', $like)->orWhere('issued_to_email', 'like', $like));
            })
            ->latest('id');
        $page = $query->paginate($perPage)->withQueryString();
        $grants = WelcomeCouponGrant::whereIn('coupon_id', $page->getCollection()->pluck('id'))->with('customer:id,first_name,last_name')
            ->get()->keyBy('coupon_id');

        return $page->through(function (Coupon $coupon) use ($grants) {
            $grant = $grants[$coupon->id] ?? null;
            $customer = $grant?->customer;

            return [
                'id' => $coupon->id,
                'code' => $coupon->code,
                'email' => $coupon->issued_to_email,
                'trigger' => $grant?->trigger,
                'customer' => $customer ? ['id' => $customer->id, 'name' => trim("{$customer->first_name} {$customer->last_name}")] : null,
                'issued_at' => $coupon->created_at?->toIso8601ZuluString(),
                'expires_at' => $coupon->ends_at?->toIso8601ZuluString(),
                'status' => self::status($coupon),
                'used_on_order' => $coupon->redemptions->first()?->order?->number,
            ];
        });
    }

    /**
     * Validates a partial update (PUT marketing/welcome-coupon) against the
     * settings it will be merged with, and returns the values to store.
     */
    public function validated(array $input): array
    {
        $validator = validator($input, [
            'welcome_coupon_enabled' => ['sometimes', 'boolean'],
            'welcome_coupon_triggers' => ['sometimes', 'array', 'min:1'],
            'welcome_coupon_triggers.*' => ['string', 'distinct', Rule::in(WelcomeCouponGrant::TRIGGERS)],
            'welcome_coupon_type' => ['sometimes', Rule::in(['percent', 'fixed'])],
            'welcome_coupon_value' => ['sometimes', 'numeric', 'decimal:0,2'],
            'welcome_coupon_min_subtotal' => ['sometimes', 'nullable', 'numeric', 'decimal:0,2', 'min:0', 'max:100000000'],
            'welcome_coupon_valid_days' => ['sometimes', 'integer', 'min:1', 'max:365'],
            'welcome_coupon_first_order_only' => ['sometimes', 'boolean'],
        ], [
            'welcome_coupon_triggers.required' => 'Choose at least one way to earn the code.',
            'welcome_coupon_triggers.array' => 'Choose at least one way to earn the code.',
            'welcome_coupon_triggers.min' => 'Choose at least one way to earn the code.',
            'welcome_coupon_triggers.*.in' => 'Choose when someone creates an account and/or confirms the newsletter.',
            'welcome_coupon_triggers.*.distinct' => 'Choose each way to earn the code once.',
            'welcome_coupon_type.in' => 'Choose a percentage or a fixed amount.',
            'welcome_coupon_value.numeric' => 'Enter the discount as a number with at most 2 decimals.',
            'welcome_coupon_value.decimal' => 'Enter the discount as a number with at most 2 decimals.',
            'welcome_coupon_min_subtotal.numeric' => 'Enter the minimum order as an amount, for example 50.00, or leave it empty.',
            'welcome_coupon_min_subtotal.decimal' => 'Enter the minimum order as an amount, for example 50.00, or leave it empty.',
            'welcome_coupon_min_subtotal.min' => 'The minimum order can’t be negative.',
            'welcome_coupon_min_subtotal.max' => 'The minimum order is too large.',
            'welcome_coupon_valid_days.*' => 'A code is valid for 1 to 365 days.',
            'welcome_coupon_enabled.boolean' => 'Switch the welcome coupon on or off.',
            'welcome_coupon_first_order_only.boolean' => 'Choose whether the code is for the first order only.',
        ]);
        $data = $validator->validate();

        if (array_key_exists('welcome_coupon_value', $data) || array_key_exists('welcome_coupon_type', $data)) {
            $current = $this->settings();
            $type = $data['welcome_coupon_type'] ?? $current['welcome_coupon_type'];
            $value = (float) ($data['welcome_coupon_value'] ?? $current['welcome_coupon_value']);
            if ($type === 'percent' && ($value < 1 || $value > 90)) {
                throw ValidationException::withMessages(['welcome_coupon_value' => 'A percentage discount is between 1 and 90.']);
            }
            if ($type === 'fixed' && ($value <= 0 || $value > 100000)) {
                throw ValidationException::withMessages(['welcome_coupon_value' => 'A fixed discount is more than 0 and at most 100,000.']);
            }
        }

        $normalize = [
            'welcome_coupon_enabled' => fn ($v) => filter_var($v, FILTER_VALIDATE_BOOLEAN),
            'welcome_coupon_triggers' => fn ($v) => array_values(array_intersect(WelcomeCouponGrant::TRIGGERS, $v)),
            'welcome_coupon_type' => fn ($v) => $v,
            'welcome_coupon_value' => fn ($v) => Pricing::format(Pricing::toCents((string) $v)),
            'welcome_coupon_min_subtotal' => fn ($v) => $v === null || $v === '' ? null : Pricing::format(Pricing::toCents((string) $v)),
            'welcome_coupon_valid_days' => fn ($v) => (int) $v,
            'welcome_coupon_first_order_only' => fn ($v) => filter_var($v, FILTER_VALIDATE_BOOLEAN),
        ];
        $values = [];
        foreach ($normalize as $key => $fn) {
            if (array_key_exists($key, $data)) {
                $values[$key] = $fn($data[$key]);
            }
        }

        return $values;
    }

    /** Saves validated settings (audit settings.welcome_coupon_updated when something changed). Issued codes are not touched. */
    public function update(array $values): void
    {
        DB::transaction(function () use ($values) {
            $before = $this->settings();
            $this->settings->put($values);
            if ($diff = Audit::diff(array_intersect_key($before, $values), array_intersect_key($this->settings(), $values))) {
                $this->audit->record('settings.welcome_coupon_updated', 'Welcome coupon settings changed: '.implode(', ', array_keys($diff['after'])).'.',
                    'settings', null, $diff);
            }
        });
    }

    /** GET/PUT marketing/welcome-coupon: { settings, offer (preview, also while off), stats }. */
    public function adminPayload(): array
    {
        return ['settings' => $this->settings(), 'offer' => $this->preview(), 'stats' => $this->stats()];
    }
}
