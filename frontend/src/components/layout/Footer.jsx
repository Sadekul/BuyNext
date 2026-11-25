import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import LanguageSwitch from './LanguageSwitch'
import { FaFacebookF, FaInstagram, FaXTwitter, FaYoutube } from 'react-icons/fa6'
import { LuMail, LuMapPin, LuPhone } from 'react-icons/lu'
import Logo from '../common/Logo'
import PaymentBadges from './PaymentBadges'
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
        {/* Restyle: brand, short text and the social icons first; link columns; then the store's details. */}
        <div className="site-footer__brand">
          <Logo tone="light" showTagline />
          <p className="site-footer__about">{t('footer.about')}</p>
          <SocialLinks />
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

        <div className="site-footer__store">
          <h2 className="site-footer__heading">{t('footer.storeInfo')}</h2>
          <ul className="site-footer__contact">
            {/* Phase 17: the store's postal address, when the API sends one. */}
            {settings.storeAddress && (
              <li>
                <LuMapPin aria-hidden="true" />
                <span className="site-footer__address">{settings.storeAddress}</span>
              </li>
            )}
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
      </div>

      {/* Bottom row: copyright, language and cookie settings on the left; the ways to pay on the right
          (phase 17: own text badges, no brand logos). */}
      <div className="site-footer__bottom">
        <div className="site-footer__bottom-inner container">
          <div className="site-footer__legal">
            <p>{t('footer.rights', { year: formatYear(currentYear), store: storeName })}</p>
            {/* Phase 13: বাংলা / English, also here. */}
            <LanguageSwitch className="language-switch--footer" />
            {/* Phase 10: change the statistics choice at any time (only when the store uses statistics). */}
            {analyticsAvailable(settings) && (
              <button type="button" className="site-footer__cookie-settings" onClick={openCookieSettings}>
                {t('footer.cookieSettings')}
              </button>
            )}
          </div>
          <div className="site-footer__payments">
            <PaymentBadges paymentMethods={settings.paymentMethods} />
          </div>
        </div>
      </div>
    </footer>
  )
}

/** Round social icons under the brand text. */
function SocialLinks() {
  const { t } = useTranslation('common')
  return (
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
  )
}

export default Footer
