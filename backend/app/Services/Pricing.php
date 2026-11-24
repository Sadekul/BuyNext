<?php

namespace App\Services;

use App\Models\Customer;
use App\Models\CustomerGroup;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Support\CategoryTree;
use App\Support\Currency;
use App\Support\Locale;
use Illuminate\Support\Collection;

/**
 * The ONE place where money is calculated: cart/validate, checkout, and tests
 * all use it, so a shopper never sees one total in the cart and another at
 * checkout. Everything is in whole cents (ints): 0.1 + 0.2 is not 0.3 with
 * floats.
 *
 * The rounding copies the storefront's display math
 * (frontend/src/utils/pricing.js and cartTotals.js) step by step.
 */
class Pricing
{
    public function __construct(private Settings $settings, private CatalogRules $catalogRules, private CartRules $cartRules,
        private ShippingRates $shippingRates, private GiftCards $giftCards, private RewardPoints $rewardPoints,
        private CashOnDelivery $cod, private DeliveryZones $zones) {}

    /** "9.99" → 999. Decimal strings from the database have 2 places, so this is exact. */
    public static function toCents(string|int|float $amount): int
    {
        return (int) round((float) $amount * 100);
    }

    /** 999 → "9.99" (the API's money format: a string with 2 decimals). */
    public static function format(int $cents): string
    {
        $sign = $cents < 0 ? '-' : '';
        $cents = abs($cents);

        return $sign.intdiv($cents, 100).'.'.str_pad((string) ($cents % 100), 2, '0', STR_PAD_LEFT);
    }

    /**
     * The price the shopper pays for one unit, in cents:
     * round(price × (1 − discount / 100), 2). Like the storefront, a discount
     * that rounds to 0% (e.g. 0.04%) is ignored. Both sides do the same
     * float steps and round with Math.round (jsRound), so they always agree.
     */
    public static function salePriceCents(string|float $price, string|float $discountPercent): int
    {
        $price = (float) $price;
        $discount = (float) $discountPercent;

        if (self::jsRound($discount) < 1) {
            return self::toCents($price);
        }

        return self::jsRound($price * (1 - $discount / 100) * 100);
    }

    /**
     * JavaScript's Math.round: halves go up (2.5 → 3). PHP's round() differs
     * in edge cases, and floor($x + 0.5) can be off by one because the
     * addition itself rounds; $x - floor($x) is exact.
     */
    public static function jsRound(float $value): int
    {
        $floor = floor($value);

        return (int) ($value - $floor >= 0.5 ? $floor + 1 : $floor);
    }

    /**
     * Prices a cart. $items: [['product_id' => 1, 'variant_id' => null, 'quantity' => 2], ...].
     * With $lock (inside a DB transaction) the product rows are locked until
     * the transaction ends, so two checkouts can't sell the same last unit.
     */
    /**
     * $customerId / $email identify the shopper for per-customer coupon
     * limits (the customer's id when signed in, else the guest's email; both
     * null skips that check until checkout, where the email is required).
     * $country: the shipping country, for tax (null: tax 0, not estimated).
     * $group (phase 6): the shopper's customer group; null = General (guests).
     * Its discount comes off every line's sale price, after the product's own
     * discount and before coupons.
     * Phase 11: $rewardsCustomer (the signed-in shopper) may pay with
     * $rewardPoints, after tax and before a gift card.
     * Phase 14: $deliveryZone (the address's zone code) picks the zone's
     * table rates; $paymentMethod "cod" adds the COD fee to the total. The
     * quote's `cod` says whether cash on delivery may be used and why not.
     */
    public function quote(array $items, ?string $couponCode, ?string $shippingMethod, bool $lock = false, ?int $customerId = null,
        ?string $email = null, ?string $country = null, ?CustomerGroup $group = null, ?string $giftCardCode = null,
        ?Customer $rewardsCustomer = null, ?int $rewardPoints = null, ?string $deliveryZone = null, ?string $paymentMethod = null): CartQuote
    {
        $group ??= CustomerGroup::general();
        $groupBasisPoints = $group?->discountBasisPoints() ?? 0;
        // The same product (and variant) twice counts as one line (stock is checked on the sum).
        // The same product with two different variants is two lines.
        // Phase 10 (part B): each gift card item (with its amount and recipient) is a line of its own.
        $entries = [];
        foreach (array_values($items) as $index => $item) {
            $productId = (int) $item['product_id'];
            $variantId = (int) ($item['variant_id'] ?? 0);
            if (is_array($item['gift_card'] ?? null)) {
                $entries["{$productId}:{$variantId}:g{$index}"] = [$productId, $variantId, (int) $item['quantity'], $item['gift_card']];

                continue;
            }
            $key = "{$productId}:{$variantId}";
            $entries[$key] = [$productId, $variantId, ($entries[$key][2] ?? 0) + (int) $item['quantity'], null];
        }

        $productIds = array_values(array_unique(array_column($entries, 0)));
        $variantIds = array_values(array_filter(array_unique(array_column($entries, 1))));
        // Products first, then variants, each in id order: the same order everywhere, so checkouts can't deadlock.
        $products = $this->loadProducts($productIds, $lock);
        $variants = $this->loadVariants($variantIds, $lock);
        $tree = CategoryTree::load();
        $defaultWeight = (int) $this->settings->get('default_weight_grams', 500);

        $lines = [];
        $problems = [];
        foreach ($entries as [$productId, $variantId, $quantity, $giftCard]) {
            $product = $products->get($productId);
            $variant = $variantId ? $variants->get($variantId) : null;
            if ($product?->isGiftCard()) {
                $problem = $this->giftCardProblem($product, $variantId ?: null, $giftCard, $tree);
                $lines[] = $this->giftCardLine($productId, $product, $giftCard, $quantity, $problem['code'] ?? null);
            } else {
                $problem = $this->problemWith($product, $variantId ?: null, $variant, $quantity, $tree);
                $lines[] = $this->line($productId, $variantId ?: null, $product, $variant, $quantity, $problem['code'] ?? null, $groupBasisPoints, $group,
                    $defaultWeight);
            }
            if ($problem) {
                $problems[] = ['product_id' => $productId, 'variant_id' => $variantId ?: null, ...$problem];
            }
        }

        // Unavailable lines are shown but never charged.
        $charged = array_filter($lines, fn ($line) => $line['available']);
        $itemCount = array_sum(array_column($charged, 'quantity'));
        $subtotal = array_sum(array_column($charged, 'line_cents'));
        $groupDiscount = array_sum(array_map(fn ($line) => ($line['base_sale_cents'] - $line['sale_cents']) * $line['quantity'], $charged));
        // Phase 10 (part B): gift card lines get no discounts, no tax, no shipping, and don't count toward coupon
        // minimums or the free-shipping threshold; "merchandise" below is everything else.
        $shippable = array_filter($charged, fn ($line) => $line['requires_shipping']);
        $giftLines = $subtotal - array_sum(array_column($shippable, 'line_cents'));
        $merchandise = $subtotal - $giftLines;
        $weight = array_sum(array_map(fn ($line) => $line['weight_grams'] * $line['quantity'], $shippable));
        $shippingRequired = $itemCount === 0 || $shippable !== [];

        // Phase 10 (part B): table rates decide which methods are offered and their price (flat price without rows).
        $methods = $shippingRequired ? $this->shippingRates->options($this->settings->shippingMethods(), $country, $weight, $merchandise, $deliveryZone) : [];
        $default = $this->settings->defaultShippingMethod();
        $chosenId = match (true) {
            $shippingMethod !== null && isset($methods[$shippingMethod]) => $shippingMethod,
            isset($methods[$default]) => $default,
            default => array_key_first($methods),
        };
        $shippingError = null;
        if ($shippingRequired && $itemCount > 0 && $methods === []) {
            $shippingError = $country !== null
                ? __('We can\'t ship this order to :country with the available methods.', ['country' => $country])
                : __('We can\'t ship this order with the available methods. Please check the shipping address.');
        }

        // Phase 7: cart price rules (the best automatic rule + the typed code), each spread over its eligible lines.
        // The best automatic rule is chosen with the chosen method's normal price (what free shipping would save).
        $rules = $this->cartRules->apply($lines, $couponCode, $merchandise, $customerId, $email, $group,
            $chosenId !== null ? $methods[$chosenId]['price_cents'] : 0, $lock);
        foreach ($lines as $key => $line) {
            $lines[$key]['discount_cents'] = $line['available'] ? ($rules['line_discounts'][$key] ?? 0) : null;
        }
        $discount = $rules['discount_cents'];
        $afterDiscount = $subtotal - $discount;
        $freeStandard = $merchandise - $discount >= $this->settings->cents('free_shipping_threshold');
        // A free-shipping rule makes every method free (not just standard).
        $freeEverything = $rules['free_shipping'];

        // Only the methods switched on in the settings (and offered by their table rates), with their prices.
        $options = [];
        foreach ($methods as $id => $method) {
            $options[$id] = [
                'id' => $id,
                'label' => $method['label'],
                'eta' => $method['eta'],
                'price_cents' => $freeEverything || ($method['free_over_threshold'] && $freeStandard) ? 0 : $method['price_cents'],
                'source' => $method['source'],
                // Phase 14: the delivery zone of the matched table rate row, and its delivery time in days.
                'zone_code' => $method['zone_code'] ?? null,
                'eta_days_min' => $method['eta_days_min'] ?? null,
                'eta_days_max' => $method['eta_days_max'] ?? null,
            ];
        }
        $method = match (true) {
            ! $shippingRequired => self::NO_SHIPPING,
            default => $chosenId !== null ? $options[$chosenId] : null,
        };
        $shipping = $itemCount > 0 && $method ? $method['price_cents'] : 0;
        [$tax, $taxIncluded] = $itemCount > 0 ? $this->tax($merchandise - $discount + $shipping, $country) : [0, false];
        // Prices that already include tax: the tax is shown, but not added again.
        $total = $afterDiscount + $shipping + ($taxIncluded ? 0 : $tax);
        // Phase 14: the cash on delivery fee (no tax on it), when paying cash on delivery.
        $feeCents = $itemCount > 0 ? $this->cod->feeCents() : 0;
        $codFee = $paymentMethod === 'cod' ? $feeCents : 0;
        $total += $codFee;

        // Phase 11: reward points pay first (up to max_percent of the total, never for gift card lines), with the customer row locked at checkout.
        [$rewards, $points, $pointsCents, $pointsError] = $itemCount > 0
            ? $this->rewardPoints->quote($rewardsCustomer, $rewardPoints, $total, max(0, $total - $giftLines), max(0, $merchandise - $discount), $lock)
            : [null, 0, 0, null];

        // Phase 10 (part B): a gift card pays up to the total, but never for other gift cards. Phase 11: what points left.
        [$giftCard, $giftCardCents, $giftCardError] = $this->giftCard($giftCardCode, $lock, $total - $pointsCents, $giftLines);

        // Phase 14: may this cart be paid cash on delivery (zone, limit with the fee), and the advance it would pay online first.
        $zone = $this->zones->find($deliveryZone);
        $codTotal = $total - $codFee + $feeCents;
        // The zones are Bangladesh's: another country (none known yet: the cart page) isn't held to them.
        $codProblem = $this->cod->problem($zone?->code, $codTotal, $country === null || $country === '' || BdAddresses::isBangladesh($country));
        $codDue = max(0, $codTotal - $pointsCents - $giftCardCents);
        $cod = [
            'available' => $codProblem === null,
            'reason' => $codProblem[0] ?? null,
            'message' => $codProblem[1] ?? null,
            ...array_diff_key($this->cod->publicSettings(), ['zones' => true, 'require_confirmation' => true]),
            'advance_amount' => self::format($this->cod->advanceCents($shipping, $feeCents, $codDue)),
        ];

        return new CartQuote(
            lines: $lines,
            problems: $problems,
            coupon: $rules['coupon'],
            couponError: $rules['error'],
            shippingMethod: $method,
            shippingOptions: array_values($options),
            itemCount: $itemCount,
            subtotalCents: $subtotal,
            discountCents: $discount,
            shippingCents: $shipping,
            taxCents: $tax,
            totalCents: $total,
            couponId: collect($rules['applied'])->map(fn ($rule) => $rule['coupon'])->first(fn ($rule) => ! $rule->auto_apply)?->id,
            taxEstimated: ! $this->settings->get('tax_enabled') || $country !== null,
            group: $group,
            groupDiscountCents: $groupDiscount,
            appliedRules: $rules['applied'],
            shippingRequired: $shippingRequired,
            shippingError: $shippingError,
            requestedShippingAvailable: ! $shippingRequired || ($shippingMethod !== null && isset($options[$shippingMethod])),
            weightGrams: $weight,
            giftCard: $giftCard,
            giftCardCents: $giftCardCents,
            giftCardError: $giftCardError,
            rewards: $rewards,
            rewardPoints: $points,
            rewardPointsCents: $pointsCents,
            rewardPointsError: $pointsError,
            codFeeCents: $codFee,
            deliveryZone: $zone,
            cod: $cod,
        );
    }

    /** Phase 10 (part B): the method of a cart of only gift cards (stored on the order as "none"). */
    public const NO_SHIPPING = ['id' => 'none', 'label' => 'No shipping needed', 'eta' => '', 'price_cents' => 0, 'source' => null];

    /**
     * Phase 10 (part B): [card, cents it pays, error] for a typed gift card
     * code. It pays min(balance, total − gift card lines). With $lock the card
     * row stays locked until the order is written (after products, variants,
     * and cart rules: the same order everywhere).
     */
    private function giftCard(?string $code, bool $lock, int $totalCents, int $giftLinesCents): array
    {
        if (GiftCards::normalize($code) === '') {
            return [null, 0, null];
        }
        $card = $this->giftCards->usable($code, $lock);
        if (! $card) {
            return [null, 0, __(GiftCards::INVALID)];
        }
        // Phase 12: a card pays only for orders in its own currency.
        $cardCurrency = strtoupper((string) ($card->currency ?: 'USD'));
        if ($cardCurrency !== Currency::store()) {
            return [null, 0, __('This gift card is in :card_currency, so it can\'t pay for an order in :currency.', ['card_currency' => $cardCurrency, 'currency' => Currency::store()])];
        }
        $balance = self::toCents($card->balance);
        if ($balance <= 0) {
            return [null, 0, __('This gift card has no balance left.')];
        }
        $payable = max(0, $totalCents - $giftLinesCents);
        if ($payable === 0 && $giftLinesCents > 0) {
            return [null, 0, __('Gift cards can\'t be used to buy other gift cards.')];
        }

        return [$card, min($balance, $payable), null];
    }

    /**
     * [tax cents, included?]. Tax = the shipping country's rate × (merchandise
     * after the discount + shipping), rounded to the cent (halves up). With
     * prices_include_tax the amount already contains the tax, so the tax is
     * the part of it that is tax: amount × rate / (100 + rate).
     * Rates are kept in hundredths of a percent (19.00% → 1900), so this is
     * all integer math.
     */
    public function tax(int $amountCents, ?string $country): array
    {
        $rate = $this->settings->taxRateBasisPoints($country);
        if (! $rate || $amountCents <= 0) {
            return [0, false];
        }
        $included = (bool) $this->settings->get('prices_include_tax');
        $divisor = $included ? 10000 + $rate : 10000;

        return [intdiv($amountCents * $rate * 2 + $divisor, $divisor * 2), $included];
    }

    /**
     * Splits $total over $weights (key => cents) in proportion, in whole cents
     * that add up exactly: each share is floored, and the leftover cents go
     * to the biggest dropped fractions first (then the earlier key).
     * Used for cart rule discounts (eligible lines) and refunds.
     */
    public static function share(int $total, array $weights): array
    {
        $sum = array_sum($weights);
        $shares = [];
        $dropped = [];
        foreach ($weights as $key => $weight) {
            $exact = $sum > 0 ? $total * $weight : 0; // share × sum, kept in integers
            $shares[$key] = $sum > 0 ? intdiv($exact, $sum) : 0;
            $dropped[$key] = $sum > 0 ? $exact % $sum : 0;
        }
        $order = array_flip(array_keys($weights)); // the earlier key wins a tie
        $leftover = $total - array_sum($shares);
        uksort($dropped, fn ($a, $b) => [$dropped[$b], $order[$a]] <=> [$dropped[$a], $order[$b]]);
        foreach (array_keys($dropped) as $key) {
            if ($leftover-- <= 0) {
                break;
            }
            $shares[$key]++;
        }

        return $shares;
    }

    /** Products by id, including deleted ones (so the cart can say "no longer available"). */
    private function loadProducts(array $ids, bool $lock): Collection
    {
        if ($ids === []) {
            return collect();
        }
        sort($ids); // always lock rows in the same order, so two checkouts can't deadlock
        $query = Product::withTrashed()->with(['category', 'brand', 'options.values'])->whereIn('id', $ids)->orderBy('id');

        return ($lock ? $query->lockForUpdate() : $query)->get()->keyBy('id');
    }

    /** Variants by id; with $lock their rows stay locked too (stock is taken from the variant). */
    private function loadVariants(array $ids, bool $lock): Collection
    {
        if ($ids === []) {
            return collect();
        }
        sort($ids);
        $query = ProductVariant::whereIn('id', $ids)->orderBy('id');

        return ($lock ? $query->lockForUpdate() : $query)->get()->keyBy('id');
    }

    /** Problems that make a line unavailable (not charged); stock and minimum problems still price the line. */
    private const UNAVAILABLE = ['unavailable', 'variant_required', 'variant_unavailable',
        'gift_card_details_required', 'gift_card_amount_invalid']; // phase 10 (part B): the last two

    /**
     * A group discount on a sale price, in cents: round(cents × (1 − percent / 100)),
     * halves up. $basisPoints: hundredths of a percent (10.00% → 1000).
     */
    public static function groupPriceCents(int $saleCents, int $basisPoints): int
    {
        if ($basisPoints <= 0) {
            return $saleCents;
        }

        return intdiv($saleCents * (10000 - $basisPoints) * 2 + 10000, 20000);
    }

    private function line(int $productId, ?int $variantId, ?Product $product, ?ProductVariant $variant, int $quantity, ?string $problem,
        int $groupBasisPoints = 0, ?CustomerGroup $group = null, int $defaultWeight = 500): array
    {
        $available = $product !== null && ! in_array($problem, self::UNAVAILABLE, true);
        $sellsVariant = $available && $variant !== null;
        $priceCents = $available ? ($sellsVariant ? $variant->priceCents($product) : $product->priceCents()) : null;
        // Phase 7: the own sale price, or a catalog price rule's when lower (for everyone or the shopper's group).
        [$baseSaleCents, $rule] = $available ? $this->catalogRules->price($product, $sellsVariant ? $variant : null, $group) : [null, null];
        $saleCents = $available ? self::groupPriceCents($baseSaleCents, $groupBasisPoints) : null;

        return [
            'product_id' => $productId,
            'variant_id' => $variantId,
            'product' => $product,
            'variant' => $sellsVariant ? $variant : null,
            // Phase 13: what the shopper sees, in the request language (orders snapshot the English text, see Checkout).
            'name' => $product?->translated('name'),
            'variant_label' => $sellsVariant ? $variant->label($product->optionValueMap(Locale::current())) : null,
            'sku' => $sellsVariant ? $variant->sku : $product?->sku,
            'thumbnail_url' => $product?->thumbnail_url,
            'price_cents' => $priceCents,
            'discount_percent' => $available ? (float) $product->discount_percent : null,
            'group_discount_percent' => $available ? $groupBasisPoints / 100 : null,
            'base_sale_cents' => $baseSaleCents,
            'price_rule' => $rule ? ['id' => $rule['id'], 'name' => $rule['name']] : null,
            'price_label' => $rule['label'] ?? null,
            'sale_cents' => $saleCents,
            'quantity' => $quantity,
            'line_cents' => $available ? $saleCents * $quantity : 0,
            'stock_quantity' => $available ? ($sellsVariant ? $variant->stock_quantity : $product->stock_quantity) : 0,
            'min_order_quantity' => $product?->min_order_quantity ?? 1,
            'available' => $available,
            // Phase 10 (part B): gift card fields, and the unit weight for table rates (variant, else product, else the default).
            'type' => $product?->type ?? 'simple',
            'gift_card' => null,
            'requires_shipping' => true,
            'weight_grams' => $sellsVariant && $variant->weight !== null ? $variant->weight : ($product?->weight ?? $defaultWeight),
        ];
    }

    /**
     * Phase 10 (part B): a gift card line. It costs the chosen amount: no
     * product price, discount, price rule, or group discount; no stock, no
     * shipping. $details: { amount, recipient_name, recipient_email, message? }.
     */
    private function giftCardLine(int $productId, Product $product, ?array $details, int $quantity, ?string $problem): array
    {
        $available = ! in_array($problem, self::UNAVAILABLE, true);
        $cents = $available ? self::toCents((string) $details['amount']) : null;

        return [
            'product_id' => $productId,
            'variant_id' => null,
            'product' => $product,
            'variant' => null,
            'name' => $product->translated('name'), // phase 13
            'variant_label' => null,
            'sku' => $product->sku,
            'thumbnail_url' => $product->thumbnail_url,
            'price_cents' => $cents,
            'discount_percent' => $available ? 0.0 : null,
            'group_discount_percent' => $available ? 0.0 : null,
            'base_sale_cents' => $cents,
            'price_rule' => null,
            'price_label' => null,
            'sale_cents' => $cents,
            'quantity' => $quantity,
            'line_cents' => $available ? $cents * $quantity : 0,
            'stock_quantity' => $product->stock_quantity,
            'min_order_quantity' => 1,
            'available' => $available,
            'type' => 'gift_card',
            'gift_card' => is_array($details) ? [
                'amount' => isset($details['amount']) && is_numeric($details['amount']) ? self::format(self::toCents((string) $details['amount'])) : null,
                'recipient_name' => isset($details['recipient_name']) ? trim((string) $details['recipient_name']) : null,
                'recipient_email' => isset($details['recipient_email']) ? mb_strtolower(trim((string) $details['recipient_email'])) : null,
                'message' => filled($details['message'] ?? null) ? trim((string) $details['message']) : null,
            ] : null,
            'requires_shipping' => false,
            'weight_grams' => 0,
        ];
    }

    /** Phase 10 (part B): what stops a gift card line (null: none). */
    private function giftCardProblem(Product $product, ?int $variantId, ?array $details, CategoryTree $tree): ?array
    {
        if (! $product->isForSale($tree)) {
            return ['code' => 'unavailable', 'message' => __('This product is no longer available.')];
        }
        if ($variantId !== null) {
            return ['code' => 'variant_unavailable', 'message' => __('This option of :product is no longer available.', ['product' => $product->translated('name')])];
        }
        if (! is_array($details) || ! is_numeric($details['amount'] ?? null) || blank($details['recipient_name'] ?? null)
            || blank($details['recipient_email'] ?? null)) {
            return ['code' => 'gift_card_details_required', 'message' => __('Choose an amount and enter the recipient for :product.', ['product' => $product->translated('name')])];
        }
        if (! $product->allowsGiftCardAmount(self::toCents((string) $details['amount']))) {
            $options = $product->giftCardOptions();

            return ['code' => 'gift_card_amount_invalid', 'message' => $options['custom']
                ? __($options['amounts'] ? 'Choose an amount for :product between :min and :max, or one of the listed amounts.' : 'Choose an amount for :product between :min and :max.', [
                    'product' => $product->translated('name'),
                    'min' => Currency::format($options['custom']['min'], null, Locale::current()),
                    'max' => Currency::format($options['custom']['max'], null, Locale::current()),
                ])
                : __('Choose one of the amounts for :product.', ['product' => $product->translated('name')])];
        }

        return null;
    }

    private function problemWith(?Product $product, ?int $variantId, ?ProductVariant $variant, int $quantity, CategoryTree $tree): ?array
    {
        if (! $product || ! $product->isForSale($tree)) {
            return ['code' => 'unavailable', 'message' => __('This product is no longer available.')];
        }
        if ($product->has_variants && $variantId === null) {
            return ['code' => 'variant_required', 'message' => __('Choose the options for :product.', ['product' => $product->translated('name')])];
        }
        if ($variantId !== null && (! $product->has_variants || ! $variant || $variant->product_id !== $product->id
            || ! $variant->is_active || ! $this->isCurrentCombination($product, $variant))) {
            return ['code' => 'variant_unavailable', 'message' => __('This option of :product is no longer available.', ['product' => $product->translated('name')])];
        }
        $stock = $variant ? $variant->stock_quantity : $product->stock_quantity;
        $name = $product->translated('name'); // phase 13: messages in the request language
        $label = $variant ? "{$name} ({$variant->label($product->optionValueMap(Locale::current()))})" : $name;
        if ($quantity > $stock) {
            return ['code' => 'insufficient_stock', 'message' => $stock === 0
                ? __(':item is out of stock.', ['item' => $label])
                : __('Only :count of :item left in stock.', ['count' => Locale::digits($stock), 'item' => $label])];
        }
        if ($quantity < $product->min_order_quantity) {
            return ['code' => 'below_minimum', 'message' => __('The minimum order for :product is :count.', ['product' => $product->translated('name'), 'count' => Locale::digits($product->min_order_quantity)])];
        }

        return null;
    }

    /** One value of every current option (values removed since make it stale). */
    private function isCurrentCombination(Product $product, ProductVariant $variant): bool
    {
        $map = $product->optionValueMap();
        $ids = $variant->option_value_ids ?? [];

        return count($ids) === $product->options->count() && array_diff($ids, array_keys($map)) === [];
    }
}
