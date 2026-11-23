import { formatNumber } from '../../utils/formatters'
import { FaRegStar, FaStar, FaStarHalfStroke } from 'react-icons/fa6'
import './RatingStars.css'
import { useTranslation } from 'react-i18next'

const MAX_RATING = 5
// "4.5" (one decimal), in Bangla digits in Bangla.
const formatRating = (rating) => formatNumber(rating, { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/**
 * Shows a 0–5 rating as stars, rounded to the nearest half star.
 * Screen readers get the exact value from `aria-label`; the icons are decorative.
 */
function RatingStars({ rating, showValue = true }) {
  const { t } = useTranslation('catalog')
  const roundedRating = Math.round(rating * 2) / 2

  // Build an array like ['full', 'full', 'full', 'half', 'empty'].
  const stars = Array.from({ length: MAX_RATING }, (_, index) => {
    const starNumber = index + 1
    if (roundedRating >= starNumber) return 'full'
    if (roundedRating >= starNumber - 0.5) return 'half'
    return 'empty'
  })

  return (
    <div className="rating-stars" role="img" aria-label={t('rating.label', { rating: formatRating(rating), max: formatNumber(MAX_RATING) })}>
      {/* Index keys are safe here: the list is fixed-length and never reordered. */}
      {stars.map((type, index) => {
        if (type === 'full') return <FaStar key={index} aria-hidden="true" />
        if (type === 'half') return <FaStarHalfStroke key={index} aria-hidden="true" />
        return <FaRegStar key={index} aria-hidden="true" />
      })}
      {showValue && (
        <span className="rating-stars__value" aria-hidden="true">
          {formatRating(rating)}
        </span>
      )}
    </div>
  )
}

export default RatingStars
