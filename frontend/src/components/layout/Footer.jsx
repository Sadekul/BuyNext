import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import LanguageSwitch from './LanguageSwitch'
import { FaFacebookF, FaInstagram, FaXTwitter, FaYoutube } from 'react-icons/fa6'
import { LuMail, LuPhone } from 'react-icons/lu'
import Logo from '../common/Logo'
import { FOOTER_LINK_GROUPS, SITE, SOCIAL_LINKS } from '../../constants/site'
import { useStoreSettings } from '../../hooks/useStoreSettings'
import { analyticsAvailable, openCookieSettings } from '../../utils/analytics'
import { formatNumber } from '../../utils/formatters'
import './Footer.css'

// "2026" (no thousands separator), in Bangla digits in Bangla.
const formatYear = (year) => formatNumber(year, { useGrouping: false })

// Maps the data-friendly icon keys in SOCIAL_LINKS to icon components.
const SOCIAL_ICONS = {
  facebook: FaFacebookF,
  instagram: FaInstagram,
  x: FaXTwitter,
  youtube: FaYoutube,
}

function Footer() {
  const { t } = useTranslation('common')
  const currentYear = new Date().getFullYear()
  // REAL_SHOP: the support details the admin set (store settings); the demo's otherwise.
  const { settings } = useStoreSettings()
  const supportEmail = settings.supportEmail ?? SITE.supportEmail
  const supportPhone = settings.supportPhone ?? SITE.supportPhone
  const storeName = settings.storeName ?? SITE.name

  return (
    <footer className="site-footer">
      <div className="site-footer__main container">
        <div className="site-footer__brand">
          <Logo tone="light" showTagline />
          <p className="site-footer__about">{t('footer.about')}</p>
          <ul className="site-footer__contact">
            <li>
              <LuMail aria-hidden="true" />
              <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
            </li>
            <li>
              <LuPhone aria-hidden="true" />
              <a href={`tel:${supportPhone.replace(/[^\d+]/g, '')}`}>{supportPhone}</a>
            </li>
          </ul>
        </div>

        {FOOTER_LINK_GROUPS.map((group) => (
          <nav key={group.title} className="site-footer__group" aria-label={group.titleKey ? t(group.titleKey) : group.title}>
            <h2 className="site-footer__heading">{group.titleKey ? t(group.titleKey) : group.title}</h2>
            <ul className="site-footer__links">
              {group.links.map((link) => (
                <li key={link.to}>
                  <Link to={link.to}>{link.labelKey ? t(link.labelKey) : link.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="site-footer__bottom">
        <div className="site-footer__bottom-inner container">
          <p>{t('footer.rights', { year: formatYear(currentYear), store: storeName })}</p>
          {/* Phase 13: বাংলা / English, also here. */}
          <LanguageSwitch className="language-switch--footer" />
          {/* Phase 10: change the statistics choice at any time (only when the store uses statistics). */}
          {analyticsAvailable(settings) && (
            <button type="button" className="site-footer__cookie-settings" onClick={openCookieSettings}>
              {t('footer.cookieSettings')}
            </button>
          )}
          <ul className="site-footer__social" aria-label={t('footer.social')}>
            {SOCIAL_LINKS.map((social) => {
              const Icon = SOCIAL_ICONS[social.icon]
              return (
                <li key={social.label}>
                  <a href={social.href} target="_blank" rel="noopener noreferrer" aria-label={t('footer.socialLink', { site: SITE.name, network: social.label })}>
                    <Icon aria-hidden="true" />
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </footer>
  )
}

export default Footer
