import { setLanguage } from '../i18n'
import { setBanglaDigits } from '../i18n/intl'

/*
 * Phase 13 test helpers (docs/I18N.md).
 *
 *   await switchToBangla()                 // the store in Bangla (loads the bn catalogs)
 *   renderWithProviders(<CartPage />)
 *   expectNoEnglish(document.body, { allow: ['Essence', 'Mascara'] })
 *
 * setup.js switches back to English after every test.
 */

/** Switches the app to Bangla (Bangla digits unless `digits: false`), like the header switch without the cookie. */
export async function switchToBangla({ digits = true } = {}) {
  setBanglaDigits(digits)
  await setLanguage('bn', { persist: false })
}

/**
 * Words that may stay in Latin letters on a Bangla page: brand and payment
 * names, codes and formats. Product names and other data from fixtures are
 * passed per test (`allow`).
 */
export const ALWAYS_ALLOWED = [
  'BuyNest',
  'Nest', // the logo writes Buy<span>Nest</span>
  'bKash',
  'Nagad',
  'Rocket',
  'SSLCommerz',
  'Stripe',
  'PayPal',
  'Visa',
  'Mastercard',
  'Facebook',
  'Instagram',
  'YouTube',
  'English', // the language switch names English in English (lang="en")
  'example', // name@example.com placeholders
  'buynest',
  'Google',
  'Analytics',
]

/** Visible text plus the accessible texts (aria-label, title, placeholder, alt) under `root`. */
export function shopperText(root = document.body) {
  const texts = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement
    if (parent?.closest('script, style, [lang="en"], [data-i18n-ignore]')) continue
    texts.push(node.textContent)
  }
  for (const element of root.querySelectorAll('[aria-label], [title], [placeholder], [alt], [aria-description]')) {
    if (element.closest('[lang="en"], [data-i18n-ignore]')) continue
    for (const attribute of ['aria-label', 'title', 'placeholder', 'alt', 'aria-description']) {
      const value = element.getAttribute(attribute)
      if (value) texts.push(value)
    }
  }
  if (root === document.body && document.title) texts.push(document.title)
  return texts.join('\n')
}

/**
 * English words (4+ Latin letters) left on the page, minus the allowed ones
 * (whole words, case-sensitive) and email addresses / URLs.
 */
export function englishWords(root = document.body, { allow = [] } = {}) {
  const allowed = new Set([...ALWAYS_ALLOWED, ...allow].flatMap((item) => String(item).split(/[^A-Za-z]+/)).filter(Boolean))
  const text = shopperText(root)
    .replace(/\S+@\S+/g, ' ') // emails
    .replace(/https?:\/\/\S+/g, ' ') // links
  const words = text.match(/[A-Za-z]{4,}/g) ?? []
  return [...new Set(words.filter((word) => !allowed.has(word)))]
}

/** Fails with the list of English words still on the page (a practical "nothing hard-coded" check). */
export function expectNoEnglish(root = document.body, options) {
  const words = englishWords(root, options)
  if (words.length > 0) {
    const text = shopperText(root)
    const context = words.map((word) => text.split('\n').find((line) => line.includes(word))?.trim().slice(0, 120)).join(' | ')
    throw new Error(`English left on a Bangla page: ${words.join(', ')} (in: ${context})`)
  }
}
