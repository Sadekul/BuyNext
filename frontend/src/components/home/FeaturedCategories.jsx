import SectionHeading from '../common/SectionHeading'
import CategoryCard from '../product/CategoryCard'
import ErrorMessage from '../ui/ErrorMessage'
import Loader from '../ui/Loader'
import { ROUTES } from '../../constants/routes'
import './FeaturedCategories.css'
import { useTranslation } from 'react-i18next'

/** Category tiles. `categories` arrive already merged (API name + configured image). */
function FeaturedCategories({ categories, isLoading, error, onRetry }) {
  const { t } = useTranslation('marketing')
  return (
    <section className="section" aria-labelledby="featured-categories-title">
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
          <ul className="featured-categories">
            {categories.map((category) => (
              <li key={category.slug}>
                <CategoryCard category={category} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

export default FeaturedCategories
