import { LuCircleCheck, LuCircleX, LuClock } from 'react-icons/lu'
import { smsCountText } from './smsText'

/*
 * Phase 20 (docs/backend/PHASE20_CONTRACT.md §2): SMS notifications for
 * orders. The texts (events) in plain words, the providers and the names of
 * their settings in backend/.env (never a value), the template variables,
 * a text's status (icon + words for StatusBadge), and the settings form's
 * helpers. The API is the judge; these only catch what can be seen before
 * sending. The SMS counter is utils/smsText.js.
 */

export const SMS_EVENTS = {
  order_placed: { label: 'Order placed', description: 'When an order is placed (for online payments, once it is paid).' },
  cod_confirm_request: {
    label: 'Please confirm (cash on delivery)',
    description: 'Sent instead of “Order placed” when a cash on delivery order needs confirming (Settings → Cash on delivery).',
  },
  order_confirmed: { label: 'Order confirmed', description: 'When the order is confirmed, by staff or by the customer from the link.' },
  order_shipped: { label: 'Order shipped', description: 'When a shipment is created with “Email the customer” ticked: the courier and the tracking link.' },
  order_delivered: { label: 'Order delivered', description: 'When the order is marked delivered with the customer notified.' },
  order_cancelled: { label: 'Order cancelled', description: 'When the order is cancelled with the customer notified.' },
}
export const SMS_EVENT_KEYS = Object.keys(SMS_EVENTS)
/** A text's event in words; a test send has none. */
export const smsEventLabel = (event) => SMS_EVENTS[event]?.label ?? (event ? event.replaceAll('_', ' ') : 'Test message')

export const SMS_PROVIDERS = {
  log: { label: 'Log (test mode)', note: 'Test mode: messages are only saved, not sent.', env: [] },
  ssl_wireless: {
    label: 'SSL Wireless',
    note: 'SSL Wireless SMS Plus (smsplus.sslwireless.com).',
    env: ['SMS_SSL_WIRELESS_API_TOKEN', 'SMS_SSL_WIRELESS_SID', 'SMS_SSL_WIRELESS_API_URL (optional; the default is https://smsplus.sslwireless.com)'],
  },
  bulksmsbd: {
    label: 'BulkSMSBD',
    note: 'BulkSMSBD (bulksmsbd.net).',
    env: ['SMS_BULKSMSBD_API_KEY', 'SMS_BULKSMSBD_SENDER_ID', 'SMS_BULKSMSBD_API_URL (optional; the default is http://bulksmsbd.net/api)'],
  },
}

export const SMS_STATUSES = {
  queued: { label: 'Waiting to send', tone: 'info', icon: LuClock },
  sent: { label: 'Sent', tone: 'success', icon: LuCircleCheck },
  failed: { label: 'Failed', tone: 'danger', icon: LuCircleX },
}
export const smsStatus = (status) => SMS_STATUSES[status] ?? { label: status ?? 'Unknown', tone: 'neutral' }

/** A refused retry in words: the API's 422 puts the reason in errors.message (not failed, or 5 attempts). */
export const retryErrorText = (error, fallback) => error?.fieldErrors?.message?.[0] ?? fallback(error)

/** After a retry: "Text sent again to +8801…" or why it failed again. */
export const retryResult = (message) =>
  message.status === 'failed'
    ? { tone: 'error', text: `The text to ${message.to} failed again: ${message.error ?? 'the provider refused it.'}` }
    : { tone: 'success', text: message.status === 'sent' ? `Text sent again to ${message.to}.` : `Text to ${message.to} is waiting to send.` }

/** The variables a template can use; anything else in {braces} is left out of the text. */
export const SMS_VARIABLES = {
  store: 'Store name',
  order: 'Order number',
  total: 'Order total',
  name: 'Customer’s name',
  courier: 'Courier (order shipped)',
  tracking: 'Tracking number (order shipped)',
  tracking_url: 'Tracking link (order shipped)',
  confirm_url: 'One-tap confirmation link (please confirm)',
  order_url: 'Link to the order',
}

/** The API's variable names (defaults.variables), or this list when it sent none. */
export const variableNames = (names) => (Array.isArray(names) && names.length > 0 ? names : Object.keys(SMS_VARIABLES))
/** A variable in words (a name the API added later: itself). */
export const variableDescription = (name) => SMS_VARIABLES[name] ?? name.replaceAll('_', ' ')

/** The {variables} of `text` that the store doesn't know, each once, in order. */
export function unknownVariables(text = '', names) {
  const known = variableNames(names)
  const found = []
  for (const [, name] of String(text).matchAll(/\{([^{}\s]*)\}/g)) if (!known.includes(name) && !found.includes(name)) found.push(name)
  return found
}

/**
 * A template's counter, counted as written: a known {variable} counts its
 * own characters (its braces aren't GSM-7's two-place extension characters,
 * since the variable is replaced before sending).
 */
export const templateCountText = (text = '', names) => {
  const known = variableNames(names)
  return smsCountText(String(text).replace(/\{([a-z_]+)\}/g, (whole, name) => (known.includes(name) ? `(${name})` : whole)))
}

/** `text` with `insert` put between `start` and `end` (the textarea's selection) → { text, caret }. */
export function insertAt(text, insert, start = text.length, end = start) {
  const from = Math.max(0, Math.min(start ?? text.length, text.length))
  const to = Math.max(from, Math.min(end ?? from, text.length))
  return { text: text.slice(0, from) + insert + text.slice(to), caret: from + insert.length }
}

export const MAX_TEMPLATE = 480
export const SMS_LANGUAGES = { en: 'English', bn: 'বাংলা' }

/** The saved settings → the form: each template as the text that will be sent (the default when none is saved). */
export function smsSettingsToForm(settings = {}, defaults = {}) {
  const templates = {}
  for (const event of SMS_EVENT_KEYS) {
    templates[event] = {}
    for (const locale of Object.keys(SMS_LANGUAGES)) templates[event][locale] = settings.templates?.[event]?.[locale] || defaults[event]?.[locale] || ''
  }
  return {
    enabled: settings.enabled === true,
    provider: settings.provider ?? 'log',
    events: Array.isArray(settings.events) ? SMS_EVENT_KEYS.filter((event) => settings.events.includes(event)) : [...SMS_EVENT_KEYS],
    confirmLink: settings.confirmLink !== false,
    templates,
  }
}

/** The form's problems, { field: [message] } (empty when it can be saved). */
export function smsErrors(form) {
  const errors = {}
  if (form.enabled && form.events.length === 0) errors.events = ['Choose at least one text to send.']
  for (const event of SMS_EVENT_KEYS)
    for (const locale of Object.keys(SMS_LANGUAGES)) if ((form.templates[event]?.[locale] ?? '').length > MAX_TEMPLATE) errors[`templates.${event}.${locale}`] = [`Keep the text to ${MAX_TEMPLATE} characters.`]
  return errors
}

/**
 * Only what changed since `initial` → the admin service's body (a provider
 * that lost its keys isn't sent back unchanged). Templates go whole; one
 * equal to the default (or empty) goes as "" (the default).
 */
export function toSmsPayload(form, initial, defaults = {}) {
  const body = {}
  for (const key of ['enabled', 'provider', 'confirmLink']) if (form[key] !== initial[key]) body[key] = form[key]
  if (JSON.stringify(form.events) !== JSON.stringify(initial.events)) body.events = SMS_EVENT_KEYS.filter((event) => form.events.includes(event))
  if (JSON.stringify(form.templates) !== JSON.stringify(initial.templates)) {
    body.templates = {}
    for (const event of SMS_EVENT_KEYS) {
      body.templates[event] = {}
      for (const locale of Object.keys(SMS_LANGUAGES)) {
        const text = form.templates[event]?.[locale] ?? ''
        body.templates[event][locale] = text.trim() === '' || text.trim() === (defaults[event]?.[locale] ?? '').trim() ? '' : text
      }
    }
  }
  return body
}
