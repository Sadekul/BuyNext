import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { SITE } from '../../constants/site'
import { ROUTES } from '../../constants/routes'
import { cn } from '../../utils/classNames'
import './Logo.css'

/** Brand mark + wordmark linking to the homepage. `tone="light"` for dark backgrounds. */
function Logo({ tone = 'dark', showTagline = false }) {
  const { t } = useTranslation('common')
  return (
    // No aria-label: the visible wordmark (and tagline) is the link's accessible name,
    // so voice-control users can activate it by saying what they see.
    <Link to={ROUTES.home} className={cn('logo', `logo--${tone}`)}>
      <svg className="logo__mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" />
        <path d="M8 13.5 16 7l8 6.5V24a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z" />
        <path d="M12.5 17.5a3.5 3.5 0 0 0 7 0" />
      </svg>
      <span className="logo__text">
        <span className="logo__name">
          Buy<span className="logo__accent">Nest</span>
        </span>
        {showTagline && <span className="logo__tagline">{t('site.tagline', { defaultValue: SITE.tagline })}</span>}
      </span>
    </Link>
  )
}

export default Logo
