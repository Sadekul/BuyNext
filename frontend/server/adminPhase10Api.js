import { json, laravelPdf, multipartType, readBody, readLimitedBody } from './http.js'
import { failed } from './shop/adminSystem.js'
import { SHIPPING_METHODS, laravelPhase10Data } from './shop/adminPhase10.js'
// Phase 14 §3: a row for one delivery zone, with the delivery time in days.
import { checkZoneRate } from './adminPhase14Api.js'

/*
 * Phase 10 admin routes (docs/backend/PHASE10_CONTRACT.md §2, §4, §5 and the
 * implementation notes), BuyNest's Laravel API only. Matched by adminApi.js
 * before its own routes, so the admin session check there runs first; the
 * API then checks the role's permission (orders.view, settings.view/edit,
 * gift_cards.view/manage) and answers 403 { code: "permission_denied",
 * permission }, passed on unchanged.
 *
 * PDF DOCUMENTS (orders.view):
 *   GET    /api/admin/invoices/:number/pdf        (INV-…) → the API's PDF, streamed, with its
 *   GET    /api/admin/credit-memos/:number/pdf    (CM-…)    Content-Type and attachment name
 *
 * SHIPPING TABLE RATES (read settings.view, change settings.edit):
 *   GET    /api/admin/shipping-rates               → { rates: [Rate], defaultWeightGrams, methods: [{ id, label, flatPrice, rows }] }
 *            Rate = { id, method, country ("*" or a name), minWeightGrams, maxWeightGrams|null,
 *                     minSubtotal, maxSubtotal|null, price, position }
 *   POST   /api/admin/shipping-rates               { method, country, minWeightGrams, maxWeightGrams, minSubtotal, maxSubtotal, price } → 201 { rate }
 *   PATCH  /api/admin/shipping-rates/:id           (the same, all optional) → { rate }
 *   DELETE /api/admin/shipping-rates/:id           → { deleted: true }
 *   POST   /api/admin/shipping-rates/reorder       { method, ids } → { rates } (that method's rows)
 *   GET    /api/admin/shipping-rates/export.csv    → the CSV file
 *   POST   /api/admin/shipping-rates/import        multipart file (CSV ≤ 2 MB) + mode (replace | append) → { imported, replaced };
 *                                                  a bad row → 422 errors { "rows.3.price": [...] }, nothing saved
 *   POST   /api/admin/shipping-rates/check         { country?, weightGrams, subtotal } → { methods: [{ method, label, available,
 *                                                  price|null, source: table | flat, rateId|null }], country, weightGrams, subtotal }
 *
 * GIFT CARDS (read gift_cards.view, change gift_cards.manage):
 *   GET    /api/admin/gift-cards?q&status&limit&skip → { giftCards: [GiftCard], total, limit, skip }
 *            GiftCard = { id, last4, initialBalance, balance, currency, status (active | disabled | expired), expiresAt,
 *                         recipientName, recipientEmail, message, orderNumber, createdByAdmin, createdAt, updatedAt }
 *   GET    /api/admin/gift-cards/:id              → GiftCard + transactions: [{ id, amount, balanceAfter, note, orderNumber,
 *                                                  creditMemoNumber, adminName, createdAt }]
 *   POST   /api/admin/gift-cards                  { amount, recipientName?, recipientEmail?, message?, expiresAt?, sendEmail }
 *                                                  → 201 { giftCard, code } (the full code, in this answer only)
 *   POST   /api/admin/gift-cards/:id/adjust       { amount (signed), note } → { giftCard }
 *   POST   /api/admin/gift-cards/:id/disable      → { giftCard } (cards are never deleted)
 */

const realData = () => process.env.VITE_API_PROVIDER === 'laravel' && process.env.VITE_ACCOUNTS_BACKEND === 'laravel'
const LIVE_ONLY = 'This needs the BuyNest backend; the demo data has no PDFs, table rates, or gift cards.'
const live = (handler) => (ctx) => (realData() ? handler(ctx) : json({ message: LIVE_ONLY }, 404))
const fromLaravel = (result, status) => (result.ok ? json(result.data, status ?? result.status) : json(result.body, result.status))
const invalid = (errors) => json({ message: 'Please check the highlighted fields.', errors }, 422)

const isId = (value) => /^\d{1,9}$/.test(value ?? '')
export const isInvoiceNumber = (value) => /^INV-\d{1,12}$/.test(value ?? '')
export const isCreditMemoNumber = (value) => /^CM-\d{1,12}$/.test(value ?? '')
const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
const isMoney = (value, { min = 0, max = 1_000_000 } = {}) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && hasCents(value)
const isGrams = (value) => Number.isInteger(value) && value >= 0 && value <= 1_000_000
const MAX_CSV_BYTES = 2 * 1024 * 1024 + 64 * 1024 // 2 MB of CSV, plus the multipart framing
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ---- §2 PDF documents ----

/** "attachment; filename=\"INV-100001.pdf\"" → INV-100001.pdf when it is a plain name with that extension, else the fallback. */
export function fileName(disposition, extension, fallback) {
  const name = /filename="?([A-Za-z0-9._-]{1,100})"?/.exec(disposition ?? '')?.[1]
  return name && !name.startsWith('.') && name.toLowerCase().endsWith(extension) ? name : fallback
}

/** The API's PDF, streamed through (never held here), with a safe attachment name. */
async function pdfFile(ctx, path, fallbackName) {
  const file = await laravelPdf(path, { token: ctx.token, request: ctx.request })
  if (!file.stream) return json(failed(file).body, file.status)
  const length = file.contentLength
  return new Response(file.stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName(file.disposition, '.pdf', fallbackName)}"`,
      ...(length && /^\d+$/.test(length) && { 'Content-Length': length }),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

// ---- §4 shipping table rates: shapes the browser sends ----

/** A table rate row (all fields on create; only the sent ones on update). Errors use the admin's field names. */
export function validateRate(body, { partial }) {
  const errors = {}
  const values = {}
  const has = (key) => body[key] !== undefined
  const need = (key) => !partial || has(key)

  if (need('method')) {
    if (SHIPPING_METHODS.includes(body.method)) values.method = body.method
    else errors.method = ['Choose a method.']
  }
  if (need('country')) {
    const country = typeof body.country === 'string' ? body.country.trim() : ''
    if (country && country.length <= 60) values.country = country
    else errors.country = ['Enter a country name, or * for any country.']
  }
  for (const key of ['minWeightGrams', 'minSubtotal']) {
    if (!has(key)) continue
    const ok = key === 'minWeightGrams' ? isGrams(body[key]) : isMoney(body[key])
    if (ok) values[key] = body[key]
    else errors[key] = [key === 'minWeightGrams' ? 'Enter a whole number of grams from 0 to 1,000,000.' : 'Enter an amount of 0 or more, with at most 2 decimals.']
  }
  for (const key of ['maxWeightGrams', 'maxSubtotal']) {
    if (!has(key)) continue
    const ok = body[key] === null || (key === 'maxWeightGrams' ? isGrams(body[key]) : isMoney(body[key]))
    if (ok) values[key] = body[key]
    else errors[key] = [key === 'maxWeightGrams' ? 'Enter a whole number of grams, or leave it empty for no limit.' : 'Enter an amount with at most 2 decimals, or leave it empty for no limit.']
  }
  if (need('price')) {
    if (isMoney(body.price)) values.price = body.price
    else errors.price = ['Enter a price of 0 or more, with at most 2 decimals.']
  }
  checkZoneRate(body, values, errors)
  if (Number.isInteger(values.maxWeightGrams) && Number.isInteger(values.minWeightGrams) && values.maxWeightGrams <= values.minWeightGrams) errors.maxWeightGrams = ['The maximum weight must be more than the minimum.']
  if (typeof values.maxSubtotal === 'number' && typeof values.minSubtotal === 'number' && values.maxSubtotal <= values.minSubtotal) errors.maxSubtotal = ['The maximum order value must be more than the minimum.']
  if (partial && Object.keys(values).length === 0 && Object.keys(errors).length === 0) errors.price = ['Change at least one field.']
  return Object.keys(errors).length > 0 ? { errors } : { values }
}

export function validateReorder(body) {
  if (!SHIPPING_METHODS.includes(body.method)) return { errors: { method: ['Choose a method.'] } }
  const ids = body.ids
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || !ids.every((id) => Number.isInteger(id) && id > 0) || new Set(ids).size !== ids.length) {
    return { errors: { ids: ['Send every row of this method once, in the new order.'] } }
  }
  return { values: { method: body.method, ids } }
}

export function validateCheck(body) {
  const errors = {}
  const country = typeof body.country === 'string' ? body.country.trim() : ''
  if (country.length > 60) errors.country = ['Enter a country name of up to 60 characters.']
  if (!isGrams(body.weightGrams)) errors.weightGrams = ['Enter the cart weight in whole grams.']
  if (!isMoney(body.subtotal)) errors.subtotal = ['Enter an amount of 0 or more, with at most 2 decimals.']
  return Object.keys(errors).length > 0 ? { errors } : { values: { country: country || null, weightGrams: body.weightGrams, subtotal: body.subtotal } }
}

// ---- §5 gift cards: shapes the browser sends ----

const optionalText = (value, max) => (value === undefined || value === null ? { value: null } : typeof value === 'string' && value.trim().length <= max ? { value: value.trim() || null } : { bad: true })

export function validateGiftCard(body) {
  const errors = {}
  if (!isMoney(body.amount, { min: 1, max: 10_000 })) errors.amount = ['Enter an amount from 1.00 to 10,000.00, with at most 2 decimals.']
  const name = optionalText(body.recipientName, 120)
  if (name.bad) errors.recipientName = ['Keep the name under 120 characters.']
  const email = optionalText(body.recipientEmail, 190)
  if (email.bad || (email.value && !EMAIL.test(email.value))) errors.recipientEmail = ['Enter a valid email address.']
  const message = optionalText(body.message, 500)
  if (message.bad) errors.message = ['Keep the message under 500 characters.']
  let expiresAt = null
  if (body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== '') {
    if (typeof body.expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.expiresAt) || Number.isNaN(Date.parse(`${body.expiresAt}T00:00:00Z`))) errors.expiresAt = ['Choose a date.']
    // The end of that day (UTC): a card "expiring on" a date still works that day.
    else expiresAt = `${body.expiresAt}T23:59:59Z`
  }
  const sendEmail = body.sendEmail !== false
  if (sendEmail && !email.value && !errors.recipientEmail) errors.recipientEmail = ['Enter the email to send the card to, or choose not to email it.']
  if (Object.keys(errors).length > 0) return { errors }
  return { values: { amount: body.amount, recipientName: name.value, recipientEmail: email.value, message: message.value, expiresAt, sendEmail } }
}

export function validateAdjustment(body) {
  const errors = {}
  if (!isMoney(body.amount, { min: -10_000, max: 10_000 }) || body.amount === 0) errors.amount = ['Enter an amount other than 0, with at most 2 decimals (negative takes money away).']
  const note = typeof body.note === 'string' ? body.note.trim() : ''
  if (note.length < 3 || note.length > 500) errors.note = ['Say why the balance changes (3 to 500 characters).']
  return Object.keys(errors).length > 0 ? { errors } : { values: { amount: body.amount, note } }
}

const GIFT_CARD_FILTERS = ['active', 'disabled', 'expired']
function listParams(url) {
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 100)
  const skip = Math.max(Number.parseInt(url.searchParams.get('skip') ?? '0', 10) || 0, 0)
  const status = url.searchParams.get('status')
  return { q: url.searchParams.get('q')?.trim().slice(0, 100) || undefined, status: GIFT_CARD_FILTERS.includes(status) ? status : undefined, limit, skip }
}

// ---- the routes ----

const PHASE10_ROUTES = {
  'GET invoices/:id/pdf': live((ctx) => pdfFile(ctx, `/api/admin/v1/invoices/${ctx.id}.pdf`, `${ctx.id}.pdf`)),
  'GET credit-memos/:id/pdf': live((ctx) => pdfFile(ctx, `/api/admin/v1/credit-memos/${ctx.id}.pdf`, `${ctx.id}.pdf`)),

  'GET shipping-rates': live(async (ctx) => fromLaravel(await laravelPhase10Data.listRates(ctx.token, ctx.request))),
  'POST shipping-rates': live(async (ctx) => {
    const { values, errors } = validateRate(await readBody(ctx.request), { partial: false })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelPhase10Data.createRate(ctx.token, values, ctx.request), 201)
  }),
  'PATCH shipping-rates/:id': live(async (ctx) => {
    const { values, errors } = validateRate(await readBody(ctx.request), { partial: true })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelPhase10Data.updateRate(ctx.token, ctx.id, values, ctx.request))
  }),
  'DELETE shipping-rates/:id': live(async (ctx) => fromLaravel(await laravelPhase10Data.deleteRate(ctx.token, ctx.id, ctx.request), 200)),
  'POST shipping-rates/reorder': live(async (ctx) => {
    const { values, errors } = validateReorder(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelPhase10Data.reorderRates(ctx.token, values, ctx.request))
  }),
  'GET shipping-rates/export.csv': live(async (ctx) => {
    const file = await laravelPhase10Data.exportRates(ctx.token, ctx.request)
    if (file.text === undefined) return json(failed(file).body, file.status)
    return new Response(file.text, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName(file.disposition, '.csv', 'shipping-rates.csv')}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }),
  'POST shipping-rates/import': live(async (ctx) => {
    const contentType = multipartType(ctx.request)
    if (!contentType) return invalid({ file: ['Send the file as a form upload (multipart/form-data).'] })
    const { bytes, tooLarge } = await readLimitedBody(ctx.request, MAX_CSV_BYTES)
    if (tooLarge) return json({ message: 'The file is too large (at most 2 MB).', errors: { file: ['The file is too large (at most 2 MB).'] } }, 413)
    if (bytes.byteLength === 0) return invalid({ file: ['Choose a CSV file.'] })
    return fromLaravel(await laravelPhase10Data.importRates(ctx.token, { contentType, bytes }, ctx.request))
  }),
  'POST shipping-rates/check': live(async (ctx) => {
    const { values, errors } = validateCheck(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelPhase10Data.checkRates(ctx.token, values, ctx.request))
  }),

  'GET gift-cards': live(async (ctx) => fromLaravel(await laravelPhase10Data.listGiftCards(ctx.token, listParams(ctx.url), ctx.request))),
  'GET gift-cards/:id': live(async (ctx) => fromLaravel(await laravelPhase10Data.getGiftCard(ctx.token, ctx.id, ctx.request))),
  'POST gift-cards': live(async (ctx) => {
    const { values, errors } = validateGiftCard(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelPhase10Data.createGiftCard(ctx.token, values, ctx.request), 201)
  }),
  'POST gift-cards/:id/adjust': live(async (ctx) => {
    const { values, errors } = validateAdjustment(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelPhase10Data.adjustGiftCard(ctx.token, ctx.id, values, ctx.request))
  }),
  'POST gift-cards/:id/disable': live(async (ctx) => fromLaravel(await laravelPhase10Data.disableGiftCard(ctx.token, ctx.id, ctx.request))),
}

const RATE_ACTIONS = ['reorder', 'export.csv', 'import', 'check']

/**
 * The phase 10 routes in adminApi.js's matcher: { route, id } for one of
 * them, null for a malformed address of theirs (404), undefined when not theirs.
 */
export function matchPhase10Route(method, segments) {
  const [first, second, third, ...rest] = segments
  if ((first === 'invoices' || first === 'credit-memos') && third === 'pdf') {
    const valid = first === 'invoices' ? isInvoiceNumber(second) : isCreditMemoNumber(second)
    return valid && rest.length === 0 ? { route: PHASE10_ROUTES[`${method} ${first}/:id/pdf`], id: second } : null
  }
  if (first === 'shipping-rates') {
    if (third !== undefined || rest.length > 0) return null
    if (second === undefined) return { route: PHASE10_ROUTES[`${method} shipping-rates`] }
    if (RATE_ACTIONS.includes(second)) return { route: PHASE10_ROUTES[`${method} shipping-rates/${second}`] }
    return isId(second) ? { route: PHASE10_ROUTES[`${method} shipping-rates/:id`], id: second } : null
  }
  if (first === 'gift-cards') {
    if (rest.length > 0) return null
    if (second === undefined) return { route: PHASE10_ROUTES[`${method} gift-cards`] }
    if (!isId(second)) return null
    if (third === undefined) return { route: PHASE10_ROUTES[`${method} gift-cards/:id`], id: second }
    return ['adjust', 'disable'].includes(third) ? { route: PHASE10_ROUTES[`${method} gift-cards/:id/${third}`], id: second } : null
  }
  return undefined
}
