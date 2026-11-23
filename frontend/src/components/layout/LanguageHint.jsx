import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { readLanguageCookie } from '../../i18n'
import { STORAGE_KEYS } from '../../constants/storageKeys'
import { readJson, writeJson } from '../../utils/storage'
import { browserPrefersBangla, chooseLanguage } from './languageChoice'
import './LanguageSwitch.css'

/**
 * Phase 13 §1: the store never switches language on its own, but a shopper
 * whose browser prefers Bangla (on an English store, with no choice made yet)
 * gets ONE small, dismissible offer: "বাংলায় দেখুন". Either button ends it for good.
 */
function LanguageHint() {
  const { t, i18n } = useTranslation('common')
  const [hidden, setHidden] = useState(() => readJson(STORAGE_KEYS.languageHint, false) === true)

  if (hidden || i18n.language === 'bn' || readLanguageCookie() || !browserPrefersBangla()) return null

  function close() {
    writeJson(STORAGE_KEYS.languageHint, true)
    setHidden(true)
  }

  return (
    <aside className="language-hint" aria-label={t('language.label')}>
      <p>{t('language.hint')}</p>
      <button
        type="button"
        lang="bn"
        onClick={() => {
          close()
          chooseLanguage('bn')
        }}
      >
        বাংলায় দেখুন
      </button>
      <button type="button" onClick={close}>
        {t('language.hintDismiss')}
      </button>
    </aside>
  )
}

export default LanguageHint
