import { createElement } from 'react'
import { Link } from 'react-router'
import SectionHeading from '../common/SectionHeading'
import ErrorMessage from '../ui/ErrorMessage'
import Loader from '../ui/Loader'
import { ROUTES } from '../../constants/routes'
import { categoryIcon } from '../layout/categoryIcons'
import './FeaturedCategories.css'
import { useTranslation } from 'react-i18next'

/**
 * "Shop by category" (phase 17, PHASE17_CONTRACT.md §4.2): a compact row of
 * round category tiles, replacing the larger photo tiles. Each circle shows
 * the category's photo when one is known (utils/homeSections.js
 * pickCategoryIcons) and its icon otherwise, so every top-level category gets
 * a tile. The row scrolls sideways on phones (inside the section; the page
 * never does) and wraps into a grid from tablets up. Each tile is one link
 * named by the category; the photo and icon are decorative.
 */
function FeaturedCategories({ categories, isLoading, error, onRetry }) {
  const { t } = useTranslation('marketing')
  if (!isLoading && !error && categories.length === 0) return null

  return (
    <section className="section home-section category-row" aria-labelledby="featured-categories-title">
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
          <ul className="category-icons">
            {categories.map((category) => (
              <li key={category.slug} className="category-icons__item">
                <Link to={ROUTES.category(category.slug)} className="category-icon">
                  <span className="category-icon__disc">
                    {category.image ? (
                      <img src={category.image} alt="" loading="lazy" width="96" height="96" />
                    ) : (
                      createElement(categoryIcon(category.slug), { 'aria-hidden': true, className: 'category-icon__glyph' })
                    )}
                  </span>
                  <span className="category-icon__name">{category.name}</span>
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
