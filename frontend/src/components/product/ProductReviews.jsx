import RatingStars from './RatingStars'
import { formatDate } from '../../utils/formatters'
import './ProductReviews.css'

/** Customer reviews from the API. Reviews have no ID, so the key combines name, date, and comment. */
function ProductReviews({ reviews }) {
  if (reviews.length === 0) {
    return <p className="product-reviews__empty">No reviews yet.</p>
  }

  return (
    <ul className="product-reviews">
      {reviews.map((review) => (
        <li key={`${review.reviewerName}-${review.date}-${review.comment}`} className="product-reviews__item">
          <div className="product-reviews__header">
            <p className="product-reviews__name">{review.reviewerName}</p>
            <time dateTime={review.date}>{formatDate(review.date)}</time>
          </div>
          <RatingStars rating={review.rating} showValue={false} />
          <p>{review.comment}</p>
        </li>
      ))}
    </ul>
  )
}

export default ProductReviews
