import { setLanguage } from '../../i18n'

/**
 * The shopper picked a language (the switch or the "বাংলায় দেখুন" hint): save
 * it in the cookie and tell LanguageSync, which saves it in the account too.
 * A failed Bangla download (offline) leaves the store as it was.
 */
export function chooseLanguage(language) {
  return setLanguage(language, { chosen: true }).catch(() => null)
}

/** The browser lists Bangla before English (Accept-Language as the page sees it). */
export function browserPrefersBangla(languages = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language])) {
  const first = (languages ?? []).map((value) => String(value).toLowerCase().split('-')[0]).find((code) => code === 'bn' || code === 'en')
  return first === 'bn'
}
