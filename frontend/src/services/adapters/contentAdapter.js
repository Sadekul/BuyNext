import { normalizeProduct } from './laravelAdapter'
import { ALL_PAYMENT_METHODS, SHIPPING_RULES } from '../../constants/store'
import { DEFAULT_STORE_CURRENCY, sanitizeStoreCurrency } from '../../utils/displayCurrency'

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
    // Phase 13: the language the page actually came in ("en" when it isn't translated yet).
    ...((data.locale === 'en' || data.locale === 'bn') && { locale: data.locale }),
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
  // Phase 10/12: "paypal" (approved on PayPal's site), "manual", or "unavailable" (PayPal doesn't take the store currency).
  const paypalPayments = ['paypal', 'unavailable'].includes(data.paypal_payments) ? data.paypal_payments : 'manual'
  // Phase 12: "sslcommerz" (paid on SSLCommerz's page), "manual", or "unavailable" (the store currency isn't BDT).
  const sslcommerzPayments = ['sslcommerz', 'unavailable'].includes(data.sslcommerz_payments) ? data.sslcommerz_payments : 'manual'
  const unavailable = new Set([...(paypalPayments === 'unavailable' ? ['paypal'] : []), ...(sslcommerzPayments === 'unavailable' ? ['sslcommerz'] : [])])
  const currency = normalizeStoreCurrency(data.currency, data.currencies?.base)
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
    // Phase 12: a method its provider can't take in the store currency is never offered.
    paymentMethods: (data.payment_methods ?? [])
      .filter((id) => !unavailable.has(id))
      .map((id) => ALL_PAYMENT_METHODS.find((method) => method.id === id) ?? { id, label: id, description: '' }),
    guestCheckout: data.guest_checkout !== false,
    taxEnabled: data.tax_enabled === true,
    // Phase 8: "stripe" when card orders are paid on Stripe's page right away, "manual" otherwise.
    cardPayments: data.card_payments === 'stripe' ? 'stripe' : 'manual',
    // Phase 10: "paypal" when PayPal orders are approved on PayPal's site right away, "manual" otherwise
    // (phase 12: "unavailable" when PayPal doesn't take the store currency, e.g. BDT).
    paypalPayments,
    // Phase 12: SSLCommerz (bKash, Nagad, cards) the same way.
    sslcommerzPayments,
    // Phase 12: the currency the store charges in ({ code, symbol, decimals }); USD when not given.
    currency,
    // Phase 10: the store's Google Analytics 4 measurement id (null = no statistics, no consent banner).
    ga4MeasurementId: measurementId(data.analytics?.ga4_measurement_id ?? data.ga4_measurement_id),
    // Phase 11: the currencies shoppers may SEE prices in (enabled, with a rate); orders are charged in `base`.
    currencies: normalizeCurrencies(data.currencies, currency.code),
    // Phase 11: reward points, when the store has them on (null = off: nothing about points is shown).
    rewards: normalizeRewardSettings(data.rewards),
    // Phase 13: the store's languages, the language for first visits, and Bangla digits (০–৯) in Bangla.
    locales: Array.isArray(data.locales) && data.locales.length > 0 ? data.locales.filter((code) => code === 'en' || code === 'bn') : ['en', 'bn'],
    defaultLocale: data.default_locale === 'bn' ? 'bn' : 'en',
    banglaDigits: data.bangla_digits !== false,
    // Phase 14: the country new addresses start with, Bangladesh's Division → District → Area
    // address form, and the store's cash on delivery rules (null: none sent).
    ...normalizeBangladeshSettings(data, countriesOf(data)),
  }
}

const countriesOf = (data) => (data.allowed_countries ?? []).map((country) => (typeof country === 'string' ? country : country?.name)).filter(Boolean)

const moneyOrNull = (value) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value))

/**
 * Phase 14: GET /store `default_country` ("Bangladesh", "BD", another
 * country name, or null) → the store's name for it, when the store ships
 * there; the Bangladesh address form (Division → District → Area), on when
 * the store's default country is Bangladesh, exactly when the API applies its
 * Bangladesh address rules (`bd_addresses` can say so explicitly); and `cod`.
 */
export function normalizeBangladeshSettings(data, countries) {
  const raw = typeof data.default_country === 'string' ? data.default_country.trim() : ''
  const name = /^bd$/i.test(raw) ? 'Bangladesh' : raw
  const defaultCountry = countries.find((country) => country.toLowerCase() === name.toLowerCase()) ?? null
  const bangladeshAddresses = typeof data.bd_addresses === 'boolean' ? data.bd_addresses : defaultCountry !== null && /^(bangladesh|bd)$/i.test(defaultCountry)
  const cod = data.cod && typeof data.cod === 'object'
    ? {
        maxOrderTotal: moneyOrNull(data.cod.max_order_total),
        fee: moneyOrNull(data.cod.fee) ?? 0,
        advance: data.cod.advance === 'delivery_charge' ? 'delivery_charge' : 'none',
        zones: Array.isArray(data.cod.zones) ? data.cod.zones.filter((zone) => typeof zone === 'string') : [],
        requireConfirmation: data.cod.require_confirmation === true,
      }
    : null
  return { defaultCountry, bangladeshAddresses, cod }
}

/** Phase 12: GET /store `currency: { code, symbol, decimals }` (or phase 11's `currencies.base` alone) → the store currency. */
export function normalizeStoreCurrency(raw, base) {
  return sanitizeStoreCurrency(raw) ?? sanitizeStoreCurrency(base) ?? DEFAULT_STORE_CURRENCY
}

/**
 * `currencies: { base: "USD", display: [{ code, symbol, rate, decimals }] }` → numbers, bad entries dropped.
 * Phase 12: `storeCode` (the store currency) is the base when the answer names none.
 */
export function normalizeCurrencies(raw, storeCode = 'USD') {
  const base = typeof raw?.base === 'string' && /^[A-Z]{3}$/.test(raw.base) ? raw.base : storeCode
  const display = (Array.isArray(raw?.display) ? raw.display : [])
    .map((currency) => ({
      code: typeof currency?.code === 'string' ? currency.code.toUpperCase() : '',
      symbol: typeof currency?.symbol === 'string' ? currency.symbol : '',
      rate: Number(currency?.rate),
      decimals: Number.isInteger(Number(currency?.decimals)) ? Number(currency.decimals) : 2,
    }))
    .filter((currency) => /^[A-Z]{3}$/.test(currency.code) && currency.code !== base && Number.isFinite(currency.rate) && currency.rate > 0)
  return { base, display }
}

/** The store's public reward settings (`rewards: { enabled, earn_rate, point_value, min_redeem }`), or null when off. */
export function normalizeRewardSettings(raw) {
  if (!raw || typeof raw !== 'object' || raw.enabled !== true) return null
  const earnRate = Number(raw.earn_rate)
  const pointValue = Number(raw.point_value)
  return {
    enabled: true,
    earnRate: Number.isFinite(earnRate) && earnRate >= 0 ? earnRate : 0,
    pointValue: Number.isFinite(pointValue) && pointValue >= 0 ? pointValue : 0,
    minRedeem: Number.isInteger(Number(raw.min_redeem)) ? Number(raw.min_redeem) : 0,
  }
}

/** "G-ABC123XYZ9" or null: only a well-formed GA4 id ever reaches a script address. */
export const measurementId = (value) => (typeof value === 'string' && /^G-[A-Z0-9]{4,20}$/.test(value.trim()) ? value.trim() : null)
