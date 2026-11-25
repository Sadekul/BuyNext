import { createElement } from 'react'
import { Link } from 'react-router'
import SectionHeading from '../common/SectionHeading'
import ErrorMessage from '../ui/ErrorMessage'
import Loader from '../ui/Loader'
import { ROUTES } from '../../constants/routes'
import { categoryIcon } from '../layout/categoryIcons'
import './FeaturedCategories.css'
import { useTranslation } from 'react-i18next'

// The generic icon categoryIcon() gives a slug it doesn't know.
const GENERIC_ICON = categoryIcon('')

/**
 * "Shop by category" (phase 17, PHASE17_CONTRACT.md §4.2; 2026-11-25 restyle):
 * a row of light grey square tiles, each with the category's line icon above
 * its name. A category without its own icon (one the store added later, which
 * would only get the generic tag) shows its photo instead when one is known
 * (utils/homeSections.js pickCategoryIcons), so every top-level category gets
 * a meaningful tile. The row scrolls sideways on phones (inside the section;
 * the page never does) and wraps into a grid from tablets up. Each tile is
 * one link named by the category; the photo and icon are decorative.
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
                  <span className="category-icon__media">
                    {categoryIcon(category.slug) === GENERIC_ICON && category.image ? (
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
