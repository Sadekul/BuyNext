import { Link } from 'react-router'
import { ROUTES } from '../../constants/routes'
import './CategoryCard.css'

/** Circular image tile linking to a category page. */
function CategoryCard({ category }) {
  const { slug, name, image } = category

  return (
    <Link to={ROUTES.category(slug)} className="category-card">
      <span className="category-card__image">
        <img src={image} alt="" loading="lazy" width="160" height="160" />
      </span>
      <span className="category-card__name">{name}</span>
    </Link>
  )
}

export default CategoryCard
