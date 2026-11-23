import { useTranslation } from 'react-i18next'
import { chooseLanguage } from './languageChoice'
import { cn } from '../../utils/classNames'
import './LanguageSwitch.css'

const OPTIONS = [
  { code: 'bn', name: 'বাংলা' },
  { code: 'en', name: 'English' },
]

/**
 * Phase 13 §1: "বাংলা" / "English", each written in its own language (with
 * its own `lang`, so screen readers pronounce it right). In the header and the
 * footer. The choice goes to the `buynest_lang` cookie and, when signed in,
 * to the account (languageChoice.js → LanguageSync).
 */
function LanguageSwitch({ className }) {
  const { t, i18n } = useTranslation('common')
  const current = i18n.language === 'bn' ? 'bn' : 'en'

  return (
    <div className={cn('language-switch', className)} role="group" aria-label={t('language.label')}>
      {OPTIONS.map((option) => (
        <button
          key={option.code}
          type="button"
          lang={option.code}
          className={cn('language-switch__option', current === option.code && 'language-switch__option--active')}
          aria-pressed={current === option.code}
          onClick={() => {
            if (current !== option.code) chooseLanguage(option.code)
          }}
        >
          {option.name}
        </button>
      ))}
    </div>
  )
}

export default LanguageSwitch
