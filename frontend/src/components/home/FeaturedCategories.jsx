import SectionHeading from '../common/SectionHeading'
import CategoryCard from '../product/CategoryCard'
import ErrorMessage from '../ui/ErrorMessage'
import Loader from '../ui/Loader'
import { ROUTES } from '../../constants/routes'
import './FeaturedCategories.css'

/** Category tiles. `categories` arrive already merged (API name + configured image). */
function FeaturedCategories({ categories, isLoading, error, onRetry }) {
  return (
    <section className="section" aria-labelledby="featured-categories-title">
      <div className="container">
        <SectionHeading
          id="featured-categories-title"
          eyebrow="Browse"
          title="Shop by category"
          viewAllTo={ROUTES.products}
          viewAllLabel="All products"
        />
        {error && <ErrorMessage titleAs="h3" title="Categories unavailable" message={error.message} onRetry={onRetry} />}
        {isLoading && <Loader label="Loading categories…" />}
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
