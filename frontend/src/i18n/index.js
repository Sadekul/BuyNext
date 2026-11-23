import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en/index.js'
import { DEFAULT_LANGUAGE, formatCount, getBanglaDigits, normalizeLanguage, setBanglaDigits, setIntlLanguage } from './intl'

/*
 * Phase 13: the store in English and Bangla (docs/I18N.md).
 *
 * - i18next + react-i18next. Translations live in src/locales/{en,bn}/<namespace>.json;
 *   keys are stable ids ("checkout:placeOrder"), never English sentences.
 * - English is bundled with the app (and is the fallback for any missing key);
 *   Bangla is loaded on demand (`import()` → its own chunk) the first time it's needed.
 * - The choice lives in the `buynest_lang` cookie (1 year, SameSite=Lax): the
 *   sign-in service (server/) reads it to send `Accept-Language` to the API, so
 *   server messages and product content come back in the same language.
 *   Signed-in customers also keep it in their account (components/layout/LanguageSync.jsx).
 * - Numbers, money and dates follow the language through i18n/intl.js.
 */

export const NAMESPACES = Object.keys(en)
export const LANGUAGE_COOKIE = 'buynest_lang'
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60

/** The `buynest_lang` cookie ('en' | 'bn'), or null when the shopper never chose. */
export function readLanguageCookie() {
  if (typeof document === 'undefined') return null
  const entry = document.cookie.split('; ').find((item) => item.startsWith(`${LANGUAGE_COOKIE}=`))
  return normalizeLanguage(entry?.slice(LANGUAGE_COOKIE.length + 1))
}

function writeLanguageCookie(language) {
  if (typeof document === 'undefined') return
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${LANGUAGE_COOKIE}=${language}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`
}

i18n.use(initReactI18next).init({
  resources: { en },
  // Bangla bundles are added later (loadBangla); other English namespaces are all here.
  partialBundledLanguages: true,
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: ['en', 'bn'],
  ns: NAMESPACES,
  defaultNS: 'common',
  initAsync: false, // English is in memory: t() works on the first render (and in tests)
  interpolation: { escapeValue: false }, // React escapes
  returnNull: false,
  react: { useSuspense: false },
})

// {{count, number}}: digits in the active language (Bangla digits unless the store turned them off).
i18n.services.formatter?.add('number', (value) => formatCount(value))

// Keep Intl and <html lang> in step with every change, whoever made it.
i18n.on('languageChanged', (language) => {
  const next = normalizeLanguage(language) ?? DEFAULT_LANGUAGE
  setIntlLanguage(next)
  if (typeof document !== 'undefined') document.documentElement.lang = next
})

let banglaLoading = null

/** Loads the Bangla translations (a separate chunk) once. */
export function loadBangla() {
  banglaLoading ??= import('../locales/bn/index.js').then(({ default: bn }) => {
    for (const [namespace, resources] of Object.entries(bn)) i18n.addResourceBundle('bn', namespace, resources, true, true)
  })
  return banglaLoading
}

const languageListeners = new Set()

/** Called after the SHOPPER chose a language (not after a sync from the account or the store default). */
export function onLanguageChosen(listener) {
  languageListeners.add(listener)
  return () => languageListeners.delete(listener)
}

/**
 * Switches the store's language. `persist` (default) writes the cookie;
 * `chosen` tells listeners (the account sync) that the shopper picked it.
 */
export async function setLanguage(value, { persist = true, chosen = false } = {}) {
  const language = normalizeLanguage(value) ?? DEFAULT_LANGUAGE
  if (language === 'bn') await loadBangla()
  if (persist) writeLanguageCookie(language)
  setIntlLanguage(language)
  if (i18n.language !== language) await i18n.changeLanguage(language)
  if (chosen) for (const listener of languageListeners) listener(language)
  return language
}

/** The active language: 'en' | 'bn'. */
export const currentLanguage = () => normalizeLanguage(i18n.language) ?? DEFAULT_LANGUAGE

/** Store setting `bangla_digits` changed: re-render everything that writes numbers. */
export function applyBanglaDigits(value) {
  const next = value !== false
  if (next === getBanglaDigits()) return
  setBanglaDigits(next)
  i18n.emit('languageChanged', i18n.language)
}

/**
 * Start-up: the cookie's language, loaded before the first render so a Bangla
 * shopper never sees an English flash. (The store default is applied later,
 * once the store settings load, by LanguageSync.)
 */
export async function initLanguage() {
  const saved = readLanguageCookie()
  if (saved && saved !== DEFAULT_LANGUAGE) {
    try {
      await setLanguage(saved, { persist: false })
    } catch {
      // The Bangla chunk failed to load (offline): English it is.
    }
  } else if (typeof document !== 'undefined') {
    document.documentElement.lang = currentLanguage()
  }
}

/** Translate outside React (services, reducers, schemas): `translate('checkout:placeOrder')`. */
export const translate = (key, options) => i18n.t(key, options)

export default i18n
