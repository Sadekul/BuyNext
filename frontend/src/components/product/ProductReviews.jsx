import { LuBadgeCheck } from 'react-icons/lu'
import RatingStars from './RatingStars'
import { formatDate } from '../../utils/formatters'
import './ProductReviews.css'
import { useTranslation } from 'react-i18next'

/**
 * Customer reviews from the API (with BuyNest's API: approved reviews only).
 * DummyJSON reviews have no ID, so the key falls back to name, date, and comment.
 * "Verified purchase": the reviewer has an order with this product.
 */
function ProductReviews({ reviews }) {
  const { t } = useTranslation('catalog')
  if (reviews.length === 0) {
    return <p className="product-reviews__empty">{t('reviews.empty')}</p>
  }

  return (
    <ul className="product-reviews">
      {reviews.map((review) => (
        <li key={review.id ?? `${review.reviewerName}-${review.date}-${review.comment}`} className="product-reviews__item">
          <div className="product-reviews__header">
            <p className="product-reviews__name">{review.reviewerName}</p>
            <time dateTime={review.date}>{formatDate(review.date)}</time>
          </div>
          <RatingStars rating={review.rating} showValue={false} />
          {review.verifiedPurchase && (
            <p className="product-reviews__verified">
              <LuBadgeCheck aria-hidden="true" /> {t('reviews.verified')}
            </p>
          )}
          {review.title && <h3 className="product-reviews__title">{review.title}</h3>}
          <p>{review.comment}</p>
        </li>
      ))}
    </ul>
  )
}

export default ProductReviews
