import { useTranslation } from 'react-i18next'
import PromoBanner from './PromoBanner'

/**
 * The home page's promo banners (the admin's, or the demo's) as a bento grid:
 * the first one large, the next ones beside it. One banner fills the row.
 * Banner headings are h3 inside the "Promotions" region, in the admin's order.
 */
function PromoGrid({ banners }) {
  const { t } = useTranslation('marketing')
  if (banners.length === 0) return null

  return (
    <section className="section home-promos" aria-label={t('home.promotions')}>
      <div className={`container promo-grid promo-grid--${Math.min(banners.length, 3)}`}>
        {banners.map((banner, index) => (
          <PromoBanner key={banner.id} banner={banner} large={index === 0} />
        ))}
      </div>
    </section>
  )
}

export default PromoGrid
