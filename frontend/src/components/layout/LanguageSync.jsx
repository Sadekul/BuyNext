import { useEffect, useEffectEvent, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import i18n, { applyBanglaDigits, currentLanguage, onLanguageChosen, readLanguageCookie, setLanguage } from '../../i18n'
import { normalizeLanguage } from '../../i18n/intl'
import { REAL_ACCOUNTS } from '../../constants/accounts'
import { useAuth } from '../../hooks/useAuth'
import { useStoreSettings } from '../../hooks/useStoreSettings'
import { updateProfile } from '../../services/authService'

/**
 * Phase 13 §1: keeps the store's language in step with everything around it
 * (renders nothing; App puts it inside the providers):
 *  - the store settings: `bangla_digits`, and `default_locale` for a first
 *    visit (no `buynest_lang` cookie yet; the browser's language is NOT used);
 *  - the signed-in customer's account (`customers.locale` via PATCH /me through
 *    the sign-in service): the account's language wins after sign-in, a choice
 *    made with the switch is saved to the account, and an account without one
 *    takes the language the shopper is already using;
 *  - server data: after a change every query is refetched, so products,
 *    categories and messages come back in the new language (the cookie tells
 *    the sign-in service which `Accept-Language` to send).
 */
function LanguageSync() {
  const queryClient = useQueryClient()
  const { settings } = useStoreSettings()
  const { user, isAuthenticated, authorizedRequest, updateUser } = useAuth()

  // Store settings: digits, and the store's default language for a shopper who never chose.
  useEffect(() => {
    applyBanglaDigits(settings.banglaDigits)
  }, [settings.banglaDigits])

  useEffect(() => {
    if (readLanguageCookie() || isAuthenticated) return
    const language = normalizeLanguage(settings.defaultLocale) ?? 'en'
    if (language !== currentLanguage()) setLanguage(language, { persist: false }).catch(() => {})
  }, [settings.defaultLocale, isAuthenticated])

  // Saves a language to the account (BuyNest accounts only; the demo accounts can't keep it).
  const saveToAccount = useEffectEvent((language) => {
    if (!REAL_ACCOUNTS || !isAuthenticated) return
    authorizedRequest(() => updateProfile({ locale: language }))
      .then((profile) => updateUser({ ...user, ...profile, locale: language }))
      .catch(() => {})
  })

  useEffect(() => onLanguageChosen((language) => saveToAccount(language)), [])

  // After sign-in: the account's language wins; an account without one gets the current choice.
  const appliedRef = useRef(null)
  const accountLocale = isAuthenticated ? (normalizeLanguage(user?.locale) ?? (user?.locale === null ? 'none' : null)) : null
  const accountKey = isAuthenticated && user?.id !== undefined ? `${user.id}:${accountLocale}` : null
  const applyAccount = useEffectEvent(() => {
    if (accountLocale === 'none') {
      if (readLanguageCookie()) saveToAccount(currentLanguage())
      return
    }
    if (accountLocale && accountLocale !== currentLanguage()) setLanguage(accountLocale).catch(() => {})
  })
  useEffect(() => {
    if (!accountKey || appliedRef.current === accountKey) return
    appliedRef.current = accountKey
    applyAccount()
  }, [accountKey])

  // A new language: refetch server data in it.
  useEffect(() => {
    let last = currentLanguage()
    function handleChange(language) {
      const next = normalizeLanguage(language) ?? 'en'
      if (next === last) return
      last = next
      queryClient.invalidateQueries()
    }
    i18n.on('languageChanged', handleChange)
    return () => i18n.off('languageChanged', handleChange)
  }, [queryClient])

  return null
}

export default LanguageSync
