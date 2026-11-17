import { normalizeProduct } from './laravelAdapter'
import { PAYMENT_METHODS, SHIPPING_RULES } from '../../constants/store'

/*
 * Adapter for the CMS and store settings of BuyNest's Laravel API
 * (docs/backend/PHASE4_CONTRACT.md, sections 3 and 5), reached through
 * /api/catalog unchanged: snake_case, money as decimal strings. These
 * functions turn them into the shapes the storefront's components already
 * use (homeContent.js, constants/store.js), so the components don't change.
 */

const TONES = ['navy', 'emerald', 'amber', 'rose']

/**
 * CTA links come from an admin form: only site paths ("/products") and
 * http(s) addresses become links; anything else (javascript:, "//evil")
 * hides the button instead of rendering it.
 */
export function safeLinkTarget(url) {
  if (typeof url !== 'string') return null
  const value = url.trim()
  if (/^\/(?![/\\])/.test(value) || /^https?:\/\/[^\s]+$/i.test(value)) return value
  return null
}

const toCta = (raw) => {
  const to = safeLinkTarget(raw?.url)
  return to && raw?.label ? { label: raw.label, to } : null
}

const toMoney = (value) => (value === null || value === undefined || value === '' ? null : Number(value))

/** home_content hero → the HeroBanner `content` prop. */
function normalizeHero(raw = {}) {
  return {
    eyebrow: raw.eyebrow ?? '',
    title: raw.title ?? '',
    description: raw.description ?? '',
    primaryCta: toCta(raw.primary_cta),
    secondaryCta: toCta(raw.secondary_cta),
    image: raw.image_url ?? null,
    // Decorative when the admin gave no description (empty alt, not a file name read aloud).
    imageAlt: raw.image_alt ?? '',
    highlights: (raw.highlights ?? []).filter(Boolean),
  }
}

/** Banner → the PromoBanner `banner` prop. Inactive banners are dropped; the rest keep the admin's order. */
function normalizeBanners(raw = []) {
  return raw
    .filter((banner) => banner.is_active !== false)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((banner) => ({
      id: banner.id,
      eyebrow: banner.eyebrow ?? '',
      title: banner.title ?? '',
      description: banner.description ?? '',
      cta: toCta(banner.cta),
      image: banner.image_url ?? null,
      imageAlt: banner.image_alt ?? '',
      tone: TONES.includes(banner.tone) ? banner.tone : 'navy',
    }))
}

/** GET /home `{ data: { hero, banners, featured_products } }` → `{ hero, banners, featuredProducts }`. */
export function normalizeHome(raw) {
  const data = raw?.data ?? {}
  return {
    hero: normalizeHero(data.hero),
    banners: normalizeBanners(data.banners),
    featuredProducts: (data.featured_products ?? []).map(normalizeProduct),
  }
}

/** GET /pages/{slug} `{ data }` → a CMS page. `body` is HTML the server already sanitized. */
export function normalizePage(raw) {
  const data = raw.data
  return {
    slug: data.slug,
    title: data.title,
    body: data.body ?? '',
    metaTitle: data.meta_title || null,
    metaDescription: data.meta_description || null,
    updatedAt: data.updated_at ?? null,
  }
}

/**
 * GET /store `{ data }` → the storefront's store settings (same shape as the
 * demo defaults in hooks/useStoreSettings.js). Standard delivery keeps
 * `price: null` like constants/store.js: its price follows the free-shipping
 * rule (standardShippingCost below the threshold, free above it).
 */
export function normalizeStoreSettings(raw) {
  const data = raw.data
  const methods = data.shipping_methods ?? []
  const standard = methods.find((method) => method.id === 'standard')
  return {
    storeName: data.store_name || null,
    supportEmail: data.support_email || null,
    supportPhone: data.support_phone || null,
    shippingMethods: methods.map((method) => ({
      id: method.id,
      label: method.label,
      eta: method.eta ?? '',
      price: method.id === 'standard' ? null : toMoney(method.price),
    })),
    standardShippingCost: toMoney(standard?.price) ?? SHIPPING_RULES.standardShippingCost,
    freeShippingThreshold: toMoney(data.free_shipping_threshold),
    // Country names, as the order's address stores them (objects tolerated: { name }).
    countries: (data.allowed_countries ?? []).map((country) => (typeof country === 'string' ? country : country?.name)).filter(Boolean),
    // The server sends ids; labels and the "never asks for card numbers" copy stay ours.
    paymentMethods: (data.payment_methods ?? []).map(
      (id) => PAYMENT_METHODS.find((method) => method.id === id) ?? { id, label: id, description: '' },
    ),
    guestCheckout: data.guest_checkout !== false,
    taxEnabled: data.tax_enabled === true,
    // Phase 8: "stripe" when card orders are paid on Stripe's page right away, "manual" otherwise.
    cardPayments: data.card_payments === 'stripe' ? 'stripe' : 'manual',
  }
}
