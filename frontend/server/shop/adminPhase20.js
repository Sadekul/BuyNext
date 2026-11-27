import { laravel } from '../http.js'
import { failed } from './adminSystem.js'
import { camelPath } from './laravel.js'

/*
 * Phase 20 admin data from BuyNest's Laravel API (docs/backend/PHASE20_CONTRACT.md
 * §1 "Admin API"): SMS notifications for orders. The settings (on/off, the
 * provider, which texts go out, their English and Bangla templates, the
 * one-tap confirmation link), the providers (only whether each is set up,
 * never a key), the stats, the template defaults, a test send, the SMS log,
 * a retry, and the texts of one order. Only listed fields go either way;
 * snake_case becomes camelCase.
 * Every call resolves to { ok: true, status, data } or { ok: false, status, body }.
 */

export const SMS_PROVIDERS = ['log', 'ssl_wireless', 'bulksmsbd']
export const SMS_EVENTS = ['order_placed', 'cod_confirm_request', 'order_confirmed', 'order_shipped', 'order_delivered', 'order_cancelled']
export const SMS_STATUSES = ['queued', 'sent', 'failed']
export const SMS_LOCALES = ['en', 'bn']
const ENCODINGS = ['gsm', 'unicode']
export const MAX_TEMPLATE = 480

const str = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)
const short = (value, max) => str(value)?.slice(0, max) ?? null
const int = (value) => (Number.isInteger(value) ? value : typeof value === 'string' && /^\d{1,12}$/.test(value) ? Number(value) : null)
const count = (value) => int(value) ?? 0
const objectOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null)
const listOf = (data) => (Array.isArray(data?.data) ? data.data : [])
// The settings' keys, with or without the Settings service's "sms_" prefix.
const setting = (raw, key) => (raw[`sms_${key}`] !== undefined ? raw[`sms_${key}`] : raw[key])
// A template's text as typed (line breaks kept), at most 480 characters; empty = the default.
const templateText = (value) => (typeof value === 'string' ? value.slice(0, MAX_TEMPLATE) : '')

// ---- 422 field names: the API's → the admin's ----

const FIELD_NAMES = {
  sms_enabled: 'enabled',
  sms_provider: 'provider',
  sms_events: 'events',
  sms_templates: 'templates',
  sms_confirm_link: 'confirmLink',
}
/** "sms_templates.order_placed.bn" → "templates.order_placed.bn"; "sms_events.0" → "events". */
export function fieldName(field) {
  if (FIELD_NAMES[field]) return FIELD_NAMES[field]
  if (/^(sms_)?events\.\d+$/.test(field)) return 'events'
  const template = /^(?:sms_)?templates\.([a-z_]+)(?:\.(en|bn))?$/.exec(field)
  if (template) return template[2] ? `templates.${template[1]}.${template[2]}` : `templates.${template[1]}`
  return camelPath(field)
}
const fail = (result) => failed(result, fieldName)
const answer = (result, okStatuses, map) => (okStatuses.includes(result.status) ? { ok: true, status: result.status, data: map(result.data) } : fail(result))
const call = (path, token, request, options = {}) => laravel(`/api/admin/v1${path}`, { token, request, ...options })

// ---- settings ----

/** { event: { en, bn } } for every event (missing ones empty: the default). */
export function smsTemplates(raw) {
  const data = objectOf(raw) ?? {}
  return Object.fromEntries(
    SMS_EVENTS.map((event) => {
      const entry = objectOf(data[event]) ?? {}
      return [event, { en: templateText(entry.en), bn: templateText(entry.bn) }]
    }),
  )
}

/** The saved settings (the Settings service's sms group). Off, the log driver, every text, the link on: the defaults. */
export function smsSettings(raw) {
  const data = objectOf(raw) ?? {}
  const provider = setting(data, 'provider')
  const events = setting(data, 'events')
  return {
    enabled: setting(data, 'enabled') === true,
    provider: SMS_PROVIDERS.includes(provider) ? provider : 'log',
    events: Array.isArray(events) ? SMS_EVENTS.filter((event) => events.includes(event)) : [...SMS_EVENTS],
    templates: smsTemplates(setting(data, 'templates')),
    confirmLink: setting(data, 'confirm_link') !== false,
  }
}

/** A provider as the admin sees it: only whether it is set up, never a key. */
export function smsProvider(raw = {}) {
  return { key: SMS_PROVIDERS.includes(raw.key) ? raw.key : null, label: short(raw.label, 60) ?? str(raw.key) ?? '', configured: raw.configured === true }
}

export function smsStats(raw) {
  const data = objectOf(raw) ?? {}
  return { sentToday: count(data.sent_today), failedToday: count(data.failed_today), sent30d: count(data.sent_30d) }
}

/** GET sms / PUT sms/settings → { settings, providers, stats, defaults: { templates } }. */
export function smsOverview(raw) {
  const data = objectOf(raw) ?? {}
  return {
    settings: smsSettings(data.settings),
    providers: (Array.isArray(data.providers) ? data.providers : []).map(smsProvider).filter((provider) => provider.key),
    stats: smsStats(data.stats),
    defaults: {
      templates: smsTemplates(objectOf(data.defaults)?.templates),
      // The variable names a template can use ("store", "order"…), for the editor's insert list.
      variables: (Array.isArray(objectOf(data.defaults)?.variables) ? data.defaults.variables : []).filter((name) => typeof name === 'string' && /^[a-z_]{1,40}$/.test(name)).slice(0, 50),
    },
  }
}

// Admin field → the Settings service's key.
const SETTING_KEYS = { enabled: 'sms_enabled', provider: 'sms_provider', events: 'sms_events', templates: 'sms_templates', confirmLink: 'sms_confirm_link' }

/** The admin's settings (already checked) → the API's body, under the Settings service's keys. */
export function toSmsBody(values) {
  const body = {}
  for (const [field, value] of Object.entries(values)) if (SETTING_KEYS[field]) body[SETTING_KEYS[field]] = value
  return body
}

// ---- messages ----

/** One text (SmsMessageResource): the SMS log's row, a test send's result, a retry's result. */
export function smsMessage(raw = {}) {
  const order = objectOf(raw.order)
  return {
    id: int(raw.id),
    order: order && str(order.number) ? { number: str(order.number) } : null,
    // null for a test send.
    event: SMS_EVENTS.includes(raw.event) ? raw.event : null,
    to: short(raw.to, 20),
    body: typeof raw.body === 'string' ? raw.body.slice(0, 2000) : '',
    locale: SMS_LOCALES.includes(raw.locale) ? raw.locale : 'en',
    segments: int(raw.segments) ?? 1,
    encoding: ENCODINGS.includes(raw.encoding) ? raw.encoding : 'gsm',
    provider: short(raw.provider, 20),
    status: SMS_STATUSES.includes(raw.status) ? raw.status : 'queued',
    error: short(raw.error, 300),
    attempts: count(raw.attempts),
    sentAt: str(raw.sent_at),
    createdAt: str(raw.created_at),
  }
}

/**
 * An order's phase 20 field: the texts sent for it, newest as the API sends
 * them. Old answers (before phase 20): nothing, so the order page has no SMS panel.
 * The id (when the API sends one) lets the order page retry a failed text.
 */
export function orderPhase20(raw) {
  if (!Array.isArray(raw?.sms)) return {}
  return {
    sms: raw.sms.slice(0, 100).map((entry) => ({
      id: int(entry?.id),
      event: SMS_EVENTS.includes(entry?.event) ? entry.event : null,
      status: SMS_STATUSES.includes(entry?.status) ? entry.status : 'queued',
      to: short(entry?.to, 20),
      sentAt: str(entry?.sent_at),
      createdAt: str(entry?.created_at),
      error: short(entry?.error, 300),
    })),
  }
}

/** ?page&per_page from the admin's limit/skip, plus any filters that have a value. */
function listParams({ limit = 20, skip = 0, ...filters }) {
  const params = new URLSearchParams({ page: String(Math.floor(skip / limit) + 1), per_page: String(limit) })
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  return params
}

// ---- the calls ----

export const laravelPhase20Data = {
  async sms(token, request) {
    return answer(await call('/sms', token, request), [200], (data) => ({ ...smsOverview(data?.data ?? data), live: true }))
  },
  async updateSettings(token, values, request) {
    const result = await call('/sms/settings', token, request, { method: 'PUT', body: toSmsBody(values) })
    return answer(result, [200], (data) => ({ ...smsOverview(data?.data ?? data), live: true }))
  },
  /** { to, body? } → { message }. */
  async test(token, values, request) {
    const result = await call('/sms/test', token, request, { method: 'POST', body: values })
    return answer(result, [200, 201], (data) => ({ message: smsMessage(data?.data ?? {}), live: true }))
  },
  /** filters: { q, status, event, limit, skip } → { messages, total, limit, skip }. */
  async messages(token, { q, limit, skip, ...filters }, request) {
    const result = await call(`/sms/messages?${listParams({ ...filters, search: q, limit, skip })}`, token, request)
    return answer(result, [200], (data) => ({
      messages: listOf(data).map(smsMessage).filter((entry) => entry.id !== null),
      total: int(data?.meta?.total) ?? listOf(data).length,
      limit,
      skip,
      live: true,
    }))
  },
  async retry(token, id, request) {
    const result = await call(`/sms/messages/${id}/retry`, token, request, { method: 'POST', body: {} })
    return answer(result, [200, 201], (data) => ({ message: smsMessage(data?.data ?? {}), live: true }))
  },
}
