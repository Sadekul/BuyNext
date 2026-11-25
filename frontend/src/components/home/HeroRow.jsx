import { useTranslation } from 'react-i18next'
import PromoBanner from './PromoBanner'
import './HeroRow.css'

/**
 * Phase 17 (PHASE17_CONTRACT.md §4.1): the hero row of the marketplace-style
 * home page. The hero (single banner or slider, unchanged) with a column of
 * up to two compact promo banners beside it on desktop (below it on tablets
 * and phones): the first active banners, in the admin's order. Without
 * banners the hero is shown on its own, full width, as before.
 *
 *   div.home-hero-row
 *     div.home-hero-row__main        the hero (h1 inside)
 *     section "Top offers"           compact banners, each an h2
 */
function HeroRow({ hero, banners = [] }) {
  const { t } = useTranslation('marketing')
  if (banners.length === 0) return hero

  return (
    <div className="home-hero-row">
      <div className="container home-hero-row__grid">
        <div className="home-hero-row__main">{hero}</div>
        <section className={`home-hero-row__side home-hero-row__side--${banners.length}`} aria-label={t('home.offerColumn')}>
          {banners.map((banner) => (
            <PromoBanner key={banner.id} banner={banner} compact headingLevel={2} />
          ))}
        </section>
      </div>
    </div>
  )
}

export default HeroRow
