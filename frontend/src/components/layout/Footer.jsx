import { Link } from 'react-router'
import { FaFacebookF, FaInstagram, FaXTwitter, FaYoutube } from 'react-icons/fa6'
import { LuMail, LuPhone } from 'react-icons/lu'
import Logo from '../common/Logo'
import { FOOTER_LINK_GROUPS, SITE, SOCIAL_LINKS } from '../../constants/site'
import './Footer.css'

// Maps the data-friendly icon keys in SOCIAL_LINKS to icon components.
const SOCIAL_ICONS = {
  facebook: FaFacebookF,
  instagram: FaInstagram,
  x: FaXTwitter,
  youtube: FaYoutube,
}

function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="site-footer">
      <div className="site-footer__main container">
        <div className="site-footer__brand">
          <Logo tone="light" showTagline />
          <p className="site-footer__about">
            Quality products, honest prices, and a shopping experience built around you.
          </p>
          <ul className="site-footer__contact">
            <li>
              <LuMail aria-hidden="true" />
              <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>
            </li>
            <li>
              <LuPhone aria-hidden="true" />
              <a href={`tel:${SITE.supportPhone.replace(/[^\d+]/g, '')}`}>{SITE.supportPhone}</a>
            </li>
          </ul>
        </div>

        {FOOTER_LINK_GROUPS.map((group) => (
          <nav key={group.title} className="site-footer__group" aria-label={group.title}>
            <h2 className="site-footer__heading">{group.title}</h2>
            <ul className="site-footer__links">
              {group.links.map((link) => (
                <li key={link.to}>
                  <Link to={link.to}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="site-footer__bottom">
        <div className="site-footer__bottom-inner container">
          <p>
            © {currentYear} {SITE.name}. All rights reserved.
          </p>
          <ul className="site-footer__social" aria-label="Social media">
            {SOCIAL_LINKS.map((social) => {
              const Icon = SOCIAL_ICONS[social.icon]
              return (
                <li key={social.label}>
                  <a href={social.href} target="_blank" rel="noopener noreferrer" aria-label={`${SITE.name} on ${social.label}`}>
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
