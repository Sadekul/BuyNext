import SectionHeading from '../common/SectionHeading'
import CategoryCard from '../product/CategoryCard'
import { ROUTES } from '../../constants/routes'
import './FeaturedCategories.css'

function FeaturedCategories({ categories }) {
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
        <ul className="featured-categories">
          {categories.map((category) => (
            <li key={category.slug}>
              <CategoryCard category={category} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export default FeaturedCategories
