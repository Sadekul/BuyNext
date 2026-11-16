<?php

namespace App\Services;

use App\Models\CatalogRule;
use App\Models\CustomerGroup;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Support\CategoryTree;
use Illuminate\Support\Facades\Cache;

/**
 * Catalog price rules (phase 7): which active rules match a product for a
 * shopper, and the price they make.
 *
 * Price = the lower of the product's own sale price and the matching rules
 * applied one after another (priority, then id) to the base price, stopping
 * after a rule with stop_further; never below 0.01. A tie keeps the own price.
 *
 * The active rules are cached in a compiled form (category ids already
 * expanded to their descendants) until the next start or end time of any
 * rule. Saving or deleting a rule or a category clears the cache; a read
 * after that time rebuilds it, so no scheduler is needed for correctness
 * (production also runs buynest:refresh-price-rules every minute).
 * One instance per request (a singleton) keeps the compiled rules in memory.
 */
class CatalogRules
{
    public const CACHE_KEY = 'catalog_rules.active';

    /** @var array{rules: list<array>, until: int|null}|null */
    private ?array $memo = null;

    public function flush(): void
    {
        Cache::forget(self::CACHE_KEY);
        $this->memo = null;
    }

    /** Rebuilds the cache when a rule's start or end time has passed. true when it did. */
    public function refreshIfStale(): bool
    {
        $payload = Cache::get(self::CACHE_KEY);
        if (is_array($payload) && ! $this->expired($payload)) {
            return false;
        }
        $this->memo = null;
        $this->active();

        return true;
    }

    /** The compiled active rules, in the order they apply. */
    public function active(): array
    {
        if ($this->memo !== null && ! $this->expired($this->memo)) {
            return $this->memo['rules'];
        }
        $payload = Cache::get(self::CACHE_KEY);
        if (! is_array($payload) || ! isset($payload['rules']) || $this->expired($payload)) {
            $payload = $this->build();
            Cache::forever(self::CACHE_KEY, $payload);
        }

        return ($this->memo = $payload)['rules'];
    }

    /**
     * One unit's price for a shopper, in cents, and the rule that made it
     * ([cents, ['id', 'name', 'label'] | null]). $group null with
     * $everyoneOnly: the storefront catalog (rules for everyone only).
     */
    public function price(Product $product, ?ProductVariant $variant, ?CustomerGroup $group, bool $everyoneOnly = false): array
    {
        $own = $variant ? $variant->salePriceCents($product) : $product->salePriceCents();
        $rules = $this->matching($product, $group?->id, $everyoneOnly);
        if ($rules === []) {
            return [$own, null];
        }
        $cents = self::apply($variant ? $variant->priceCents($product) : $product->priceCents(), $rules);
        if ($cents >= $own) {
            return [$own, null];
        }
        $first = $rules[0];
        // A price that a rule for some groups only took part in reads as that group's price ("VIP price"),
        // even after a rule for everyone ran first; rules after a stop_further rule don't count.
        $groupRule = $group !== null && array_filter(self::applied($rules), fn (array $rule) => $rule['groups'] !== null) !== [];

        return [$cents, [
            'id' => $first['id'],
            'name' => $first['name'],
            'label' => $groupRule ? "{$group->name} price" : $first['name'],
        ]];
    }

    /** The storefront price (rules for everyone): [cents, ['id', 'name'] | null]. */
    public function publicPrice(Product $product, ?ProductVariant $variant = null): array
    {
        [$cents, $rule] = $this->price($product, $variant, null, true);

        return [$cents, $rule ? ['id' => $rule['id'], 'name' => $rule['name']] : null];
    }

    /** The rules that match $product for a shopper in group $groupId. */
    public function matching(Product $product, ?int $groupId, bool $everyoneOnly = false): array
    {
        return array_values(array_filter($this->active(), fn (array $rule) => self::matches($rule, $product, $groupId, $everyoneOnly)));
    }

    public static function matches(array $rule, Product $product, ?int $groupId, bool $everyoneOnly = false): bool
    {
        if ($rule['groups'] !== null && ($everyoneOnly || $groupId === null || ! isset($rule['groups'][$groupId]))) {
            return false;
        }
        if ($rule['categories'] !== null && ! isset($rule['categories'][(int) $product->category_id])) {
            return false;
        }

        return $rule['products'] === null || isset($rule['products'][$product->id]);
    }

    /** The rules that take part, in order: up to and including the first stop_further rule. */
    public static function applied(array $rules): array
    {
        $taken = [];
        foreach ($rules as $rule) {
            $taken[] = $rule;
            if ($rule['stop_further']) {
                break;
            }
        }

        return $taken;
    }

    /** $cents after the rules, in order (stopping after a stop_further rule); never below 1 cent. */
    public static function apply(int $cents, array $rules): int
    {
        foreach ($rules as $rule) {
            $cents = $rule['action'] === 'percent'
                ? Pricing::groupPriceCents($cents, $rule['amount_bp']) // the same halves-up percent math
                : $cents - $rule['amount_cents'];
            $cents = max(1, $cents);
            if ($rule['stop_further']) {
                break;
            }
        }

        return max(1, $cents);
    }

    /** A rule in the form the matching uses: id lists as sets (null = no limit), categories with their descendants. */
    public static function compile(CatalogRule $rule, CategoryTree $tree): array
    {
        $categories = [];
        foreach ($rule->category_ids ?? [] as $id) {
            array_push($categories, ...$tree->descendantIds((int) $id));
        }
        $set = fn (array $ids) => $ids === [] ? null : array_fill_keys(array_map('intval', $ids), true);

        return [
            'id' => $rule->id,
            'name' => $rule->name,
            'action' => $rule->action,
            'amount_bp' => Pricing::toCents((string) $rule->amount), // percent in hundredths (10.00% → 1000)
            'amount_cents' => Pricing::toCents((string) $rule->amount),
            'stop_further' => $rule->stop_further,
            'groups' => $set($rule->customer_group_ids ?? []),
            'categories' => $set($categories),
            'products' => $set($rule->product_ids ?? []),
        ];
    }

    private function build(): array
    {
        $now = now();
        $until = null;
        $rules = [];
        $tree = null;
        foreach (CatalogRule::where('is_active', true)->orderBy('priority')->orderBy('id')->get() as $rule) {
            foreach ([$rule->starts_at, $rule->ends_at] as $edge) {
                if ($edge && $edge->gt($now)) {
                    $until = min($until ?? PHP_INT_MAX, $edge->getTimestamp());
                }
            }
            if (($rule->starts_at && $rule->starts_at->gt($now)) || ($rule->ends_at && $rule->ends_at->lte($now))) {
                continue;
            }
            $tree ??= CategoryTree::load();
            $rules[] = self::compile($rule, $tree);
        }

        return ['rules' => $rules, 'until' => $until];
    }

    private function expired(array $payload): bool
    {
        return isset($payload['until']) && now()->getTimestamp() >= $payload['until'];
    }
}
