import { useEffect, useRef, useState } from 'react'
import { LuBadgeCheck, LuImage } from 'react-icons/lu'
import RatingStars from './RatingStars'
import ReviewPhotoViewer from './ReviewPhotoViewer'
import { formatDate } from '../../utils/formatters'
import { cn } from '../../utils/classNames'
import './ProductReviews.css'
import { useTranslation } from 'react-i18next'

const reviewKey = (review) => review.id ?? `${review.reviewerName}-${review.date}-${review.comment}`

/**
 * Customer reviews from the API (with BuyNest's API: approved reviews only).
 * DummyJSON reviews have no ID, so the key falls back to name, date, and comment.
 * "Verified purchase": the reviewer has an order with this product.
 *
 * Phase 22: a review's photos show as small thumbnails (buttons that open
 * ReviewPhotoViewer). A photo that can't be loaded (hidden by staff after the
 * page loaded) is left out quietly, never shown as a broken image. While the
 * product has review photos (`reviewPhotoCount`), "With photos (n)" shows only
 * the reviews with photos; n counts reviews, not photos.
 */
function ProductReviews({ reviews, reviewPhotoCount = 0 }) {
  const { t } = useTranslation('catalog')
  const [onlyWithPhotos, setOnlyWithPhotos] = useState(false)
  const [failed, setFailed] = useState(() => new Set())
  const [viewer, setViewer] = useState(null) // { key, index } of the open review photo
  const opener = useRef(null)

  // Back to the thumbnail that opened the viewer, once the viewer is gone.
  useEffect(() => {
    if (viewer === null && opener.current) {
      opener.current.focus()
      opener.current = null
    }
  }, [viewer])

  if (reviews.length === 0) {
    return <p className="product-reviews__empty">{t('reviews.empty')}</p>
  }

  const photosOf = (review) => (review.photos ?? []).filter((photo) => !failed.has(photo.url))
  const nameOf = (review) => review.reviewerName || t('reviews.anonymous')
  const withPhotos = reviews.filter((review) => photosOf(review).length > 0)
  const showFilter = reviewPhotoCount > 0 && withPhotos.length > 0
  const shown = showFilter && onlyWithPhotos ? withPhotos : reviews
  const viewed = viewer && reviews.find((review) => reviewKey(review) === viewer.key)
  const viewedPhotos = viewed ? photosOf(viewed) : []

  function photoFailed(url) {
    setFailed((current) => new Set(current).add(url))
    // The open viewer moves on (or closes when that was the review's last photo).
    if (viewer && viewedPhotos.some((photo) => photo.url === url)) {
      const left = viewedPhotos.length - 1
      setViewer(left === 0 ? null : { ...viewer, index: Math.min(viewer.index, left - 1) })
    }
  }

  function openPhoto(event, review, index) {
    opener.current = event.currentTarget
    setViewer({ key: reviewKey(review), index })
  }

  return (
    <>
      {showFilter && (
        <div className="product-reviews__tools">
          <button type="button" className={cn('product-reviews__filter', onlyWithPhotos && 'product-reviews__filter--on')} aria-pressed={onlyWithPhotos} onClick={() => setOnlyWithPhotos((on) => !on)}>
            <LuImage aria-hidden="true" />
            {t('reviews.withPhotos', { count: withPhotos.length })}
          </button>
        </div>
      )}
      <ul className="product-reviews">
        {shown.map((review) => {
          const photos = photosOf(review)
          const name = nameOf(review)
          return (
            <li key={reviewKey(review)} className="product-reviews__item">
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
              {photos.length > 0 && (
                <ul className="product-reviews__photos" aria-label={t('reviews.photosOf', { name })}>
                  {photos.map((photo, index) => (
                    <li key={photo.url}>
                      <button
                        type="button"
                        className="product-reviews__photo"
                        onClick={(event) => openPhoto(event, review, index)}
                        aria-label={t('reviews.openPhoto', { number: index + 1, total: photos.length, name })}
                      >
                        <img src={photo.url} alt="" width={photo.width ?? 72} height={photo.height ?? 72} loading="lazy" decoding="async" onError={() => photoFailed(photo.url)} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      {viewed && viewedPhotos.length > 0 && (
        <ReviewPhotoViewer
          photos={viewedPhotos}
          index={Math.min(viewer.index, viewedPhotos.length - 1)}
          name={nameOf(viewed)}
          onIndexChange={(index) => setViewer((current) => current && { ...current, index })}
          onClose={() => setViewer(null)}
          onPhotoError={photoFailed}
        />
      )}
    </>
  )
}

export default ProductReviews
