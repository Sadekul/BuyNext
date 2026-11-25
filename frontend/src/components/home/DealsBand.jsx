import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import SectionHeading from '../common/SectionHeading'
import ProductGrid from '../product/ProductGrid'
import ProductGridSkeleton from '../product/ProductGridSkeleton'
import { ROUTES } from '../../constants/routes'
import './DealsBand.css'

/**
 * "Today's deals": the biggest real discounts on products in stock
 * (utils/homeSections.js pickDeals), on a warm coral → amber band.
 *
 * No countdown: the API doesn't say when a discount ends (a product's
 * `price_rule` is only { id, name }), and the plan forbids fake urgency.
 * Add one here only once a real end date comes with the products.
 */
function DealsBand({ deals, maxDiscount, isLoading = false, onAddToCart }) {
  const { t } = useTranslation('marketing')
  const headingId = useId()
  if (!isLoading && deals.length === 0) return null

  return (
    <section className="section deals-band home-section" aria-labelledby={headingId}>
      <div className="container">
        <div className="deals-band__panel">
          <div className="deals-band__head">
            <SectionHeading id={headingId} eyebrow={t('home.deals.eyebrow')} title={t('home.deals.title')} description={t('home.deals.description')} viewAllTo={ROUTES.deals} viewAllLabel={t('home.deals.all')} />
            {maxDiscount > 0 && (
              <p className="deals-band__badge">
                <span className="deals-band__badge-label">{t('home.deals.upTo')}</span>
                <span className="deals-band__badge-value">{t('home.deals.percent', { value: maxDiscount })}</span>
                <span className="deals-band__badge-label">{t('home.deals.off')}</span>
              </p>
            )}
          </div>
          {isLoading ? <ProductGridSkeleton count={4} /> : <ProductGrid products={deals} onAddToCart={onAddToCart} />}
        </div>
      </div>
    </section>
  )
}

export default DealsBand
