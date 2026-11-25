import { Link } from 'react-router'
import SectionHeading from '../common/SectionHeading'
import ErrorMessage from '../ui/ErrorMessage'
import Loader from '../ui/Loader'
import { ROUTES } from '../../constants/routes'
import './FeaturedCategories.css'
import { useTranslation } from 'react-i18next'

/**
 * "Shop by category": photo tiles (utils/homeSections.js pickCategoryTiles:
 * the category's image or its first product's photo). A row that scrolls
 * sideways on phones, a grid from tablets up. Each tile is one link named
 * by the category; the photo is decorative (alt="").
 */
function FeaturedCategories({ categories, isLoading, error, onRetry }) {
  const { t } = useTranslation('marketing')
  if (!isLoading && !error && categories.length === 0) return null

  return (
    <section className="section home-section" aria-labelledby="featured-categories-title">
      <div className="container">
        <SectionHeading
          id="featured-categories-title"
          eyebrow={t('categories.eyebrow')}
          title={t('categories.title')}
          viewAllTo={ROUTES.products}
          viewAllLabel={t('categories.all')}
        />
        {error && <ErrorMessage titleAs="h3" title={t('categories.unavailable')} message={error.message} onRetry={onRetry} />}
        {isLoading && <Loader label={t('categories.loading')} />}
        {!isLoading && !error && (
          <ul className="category-tiles">
            {categories.map((category) => (
              <li key={category.slug} className="category-tiles__item">
                <Link to={ROUTES.category(category.slug)} className="category-tile">
                  <span className="category-tile__media">
                    <img src={category.image} alt="" loading="lazy" width="240" height="240" />
                  </span>
                  <span className="category-tile__name">{category.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

export default FeaturedCategories
