<?php

namespace App\Services;

use App\Services\Payments\SslCommerzGateway;
use App\Support\Currency;
use App\Support\Locale;

/**
 * Phase 14: cash on delivery the Bangladeshi way (Settings → Payment methods →
 * Cash on delivery): where it is offered (delivery zones), up to which total,
 * its fee, the delivery charge paid online first (advance, through
 * SSLCommerz), and phone confirmation of new COD orders.
 * With the defaults (no limit, fee 0, no advance, everywhere, no
 * confirmation) COD works exactly as before.
 */
class CashOnDelivery
{
    public const ADVANCE_MODES = ['none', 'delivery_charge'];

    public function __construct(private Settings $settings) {}

    public function feeCents(): int
    {
        return Pricing::toCents((string) ($this->settings->get('cod_fee') ?? '0'));
    }

    public function maxTotalCents(): ?int
    {
        $max = $this->settings->get('cod_max_order_total');

        return $max === null || $max === '' ? null : Pricing::toCents((string) $max);
    }

    /** @return list<string> zone codes where COD is offered ([] = everywhere) */
    public function zones(): array
    {
        return array_values((array) ($this->settings->get('cod_zones') ?? []));
    }

    public function advanceMode(): string
    {
        $mode = $this->settings->get('cod_advance', 'none');

        return in_array($mode, self::ADVANCE_MODES, true) ? $mode : 'none';
    }

    /** Is the advance delivery charge on, and can it be paid (SSLCommerz enabled)? */
    public function takesAdvance(): bool
    {
        return $this->advanceMode() === 'delivery_charge' && app(SslCommerzGateway::class)->enabled();
    }

    public function requiresConfirmation(): bool
    {
        return (bool) $this->settings->get('cod_require_confirmation', false);
    }

    /**
     * Why COD can't be used for this cart: null when it can, else [reason, message].
     * $zone: the address's delivery zone code (null: no structured Bangladesh address yet).
     * $totalCents: the total with the COD fee.
     * $zonesApply: false for an address outside Bangladesh, which has no delivery zone (cod.zones are
     * Bangladesh zones; other countries follow the payment methods, as before phase 14).
     */
    public function problem(?string $zone, int $totalCents, bool $zonesApply = true): ?array
    {
        $zones = $zonesApply ? $this->zones() : [];
        if ($zones !== [] && $zone === null) {
            return ['area_required', __('Choose your area to see if cash on delivery is available.')];
        }
        if ($zones !== [] && ! in_array($zone, $zones, true)) {
            return ['zone', __('Cash on delivery isn\'t available in your area.')];
        }
        $max = $this->maxTotalCents();
        if ($max !== null && $totalCents > $max) {
            return ['limit', __('Cash on delivery is available for orders up to :amount.', ['amount' => Currency::formatCents($max, null, Locale::current())])];
        }

        return null;
    }

    /** The advance (delivery charge + COD fee) a COD order pays online first, in cents; 0 without one. */
    public function advanceCents(int $shippingCents, int $feeCents, int $dueCents): int
    {
        return $this->takesAdvance() ? min($dueCents, max(0, $shippingCents + $feeCents)) : 0;
    }

    /** The settings as GET /api/v1/store and the cart show them. */
    public function publicSettings(): array
    {
        $max = $this->maxTotalCents();

        return [
            'fee' => Pricing::format($this->feeCents()),
            'max_order_total' => $max === null ? null : Pricing::format($max),
            'advance' => $this->advanceMode(),
            'zones' => $this->zones(),
            'require_confirmation' => $this->requiresConfirmation(),
        ];
    }
}
