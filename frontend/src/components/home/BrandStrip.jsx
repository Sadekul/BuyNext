import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import SectionHeading from '../common/SectionHeading'
import './BrandStrip.css'

/**
 * Brands: the store's brands with the most products (utils/homeSections.js
 * pickBrands), as chips linking to the catalog's brand filter
 * (/products?brand=Apple). The API has no brand logos, so the chips show the
 * name and the number of products ("Apple, 12 products" for screen readers).
 */
function BrandStrip({ brands }) {
  const { t } = useTranslation('marketing')
  if (brands.length === 0) return null

  return (
    <section className="section home-section brand-strip" aria-labelledby="brand-strip-title">
      <div className="container">
        <SectionHeading id="brand-strip-title" eyebrow={t('home.brands.eyebrow')} title={t('home.brands.title')} />
        <ul className="brand-strip__list">
          {brands.map((brand) => (
            <li key={brand.name}>
              <Link to={brand.to} className="brand-chip" aria-label={t('home.brands.link', { brand: brand.name, count: brand.count })}>
                <span className="brand-chip__initial" aria-hidden="true">
                  {brand.name.charAt(0)}
                </span>
                <span className="brand-chip__name">{brand.name}</span>
                <span className="brand-chip__count" aria-hidden="true">
                  {t('home.brands.count', { count: brand.count })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export default BrandStrip
