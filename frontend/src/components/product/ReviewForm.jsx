import { useId, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuStar } from 'react-icons/lu'
import FormField from '../forms/FormField'
import Button from '../ui/Button'
import ReviewPhotoField from './ReviewPhotoField'
import ReviewStatusBadge from './ReviewStatusBadge'
import { useAuth } from '../../hooks/useAuth'
import { useStoreSettings } from '../../hooks/useStoreSettings'
import { useReviewPhotos } from '../../hooks/useReviewPhotos'
import { submitReview } from '../../services/shopService'
import { productKeys } from '../../queries/productQueries'
import { customerKeys, myReviewOfQuery } from '../../queries/customerQueries'
import { ROUTES } from '../../constants/routes'
import { cn } from '../../utils/classNames'
import './ReviewForm.css'
import { Trans, useTranslation } from 'react-i18next'

const RATINGS = [1, 2, 3, 4, 5]
const TITLE_MAX = 120
const COMMENT_MIN = 10
const COMMENT_MAX = 2000

export const REVIEW_PENDING = 'Thanks — your review will appear after approval.'
export const REVIEW_PUBLISHED = 'Thanks — your review is now published.'
// Phase 13: the English texts above are kept for tests; what's shown comes from the catalog namespace.
function validate({ rating, title, comment }, t) {
  const length = comment.trim().length
  return {
    rating: rating ? null : t('reviewForm.ratingRequired', { min: 1, max: 5 }),
    title: title.trim().length > TITLE_MAX ? t('reviewForm.titleTooLong', { max: TITLE_MAX }) : null,
    comment:
      length < COMMENT_MIN
        ? t('reviewForm.commentShort', { min: COMMENT_MIN })
        : length > COMMENT_MAX
          ? t('reviewForm.commentLong', { max: COMMENT_MAX })
          : null,
  }
}

// Phase 22: the server's photo errors (`photos`, `photos.0` … `photos.2`), numbered for the shopper.
const PHOTO_ERROR = /^photos(?:\.(\d+))?$/
function photoErrors(error, t) {
  return Object.entries(error?.fieldErrors ?? {}).flatMap(([field, messages]) => {
    const match = PHOTO_ERROR.exec(field)
    const message = Array.isArray(messages) ? messages[0] : messages
    if (!match || typeof message !== 'string') return []
    return [match[1] === undefined ? message : t('reviewForm.photoError', { number: Number(match[1]) + 1, message })]
  })
}

const isAlreadyReviewed = (error) =>
  error?.status === 422 &&
  (error.data?.code === 'already_reviewed' ||
    Object.values(error.fieldErrors ?? {}).flat().some((message) => /already/i.test(String(message))))

/**
 * "Write a review" (BuyNest's API only). Signed-in customers rate the product
 * (an accessible radio group), add an optional title, and write 10 to 2000
 * characters. New reviews wait for a moderator unless the store publishes
 * them straight away; the server says which (`status`). Signed-out visitors
 * get a link to sign in and come back.
 *
 * Phase 22: while the store allows it (GET /store `review_photos.enabled`),
 * up to 3 photos can be added (ReviewPhotoField). A review with photos is
 * sent as a form upload and always waits for a moderator.
 *
 * Phase 23: signed in, it first asks for the customer's own review of this
 * product (GET /api/shop/me/reviews?productId=…). When there is one, the form
 * is replaced by "You've already reviewed this product. See it in My reviews"
 * with the review's status. While that runs, or if it fails, the form shows
 * as before (the server still refuses a second review).
 */
function ReviewForm({ productId, productTitle }) {
  const { t } = useTranslation('catalog')
  const { isAuthenticated, user, authorizedRequest } = useAuth()
  const location = useLocation()
  const queryClient = useQueryClient()
  const id = useId()
  const [values, setValues] = useState({ rating: 0, title: '', comment: '' })
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const [result, setResult] = useState(null) // the success message, once sent
  const [sentPhotos, setSentPhotos] = useState(0)
  const { settings } = useStoreSettings()
  const photoSettings = settings.reviewPhotos ?? { enabled: false, max: 3, maxMegabytes: 5 }
  const photosEnabled = photoSettings.enabled === true
  const reviewPhotos = useReviewPhotos({ max: photoSettings.max, maxMegabytes: photoSettings.maxMegabytes })

  const signedIn = isAuthenticated && user?.id != null
  const mine = useQuery({ ...myReviewOfQuery(user?.id, productId, authorizedRequest), enabled: signedIn })

  const mutation = useMutation({
    mutationFn: (input) => authorizedRequest(() => submitReview(productId, input)),
    onSuccess: (review, input) => {
      setSentPhotos(input.photos?.length ?? 0)
      setResult(review?.status === 'approved' ? 'published' : 'pending')
      // My reviews (and this product's "already reviewed") now include it.
      queryClient.invalidateQueries({ queryKey: customerKeys.reviews(user?.id) })
      // A published review changes the product's reviews and rating.
      if (review?.status === 'approved') queryClient.invalidateQueries({ queryKey: productKeys.detail(productId) })
    },
  })

  if (!isAuthenticated) {
    return (
      <p className="review-form__signin">
        <Trans t={t} i18nKey="reviewForm.signIn" components={{ signin: <Link to={ROUTES.login} state={{ from: location }} /> }} />
      </p>
    )
  }

  if (result) {
    return (
      <p className="review-form__success" role="status">
        {result === 'published' ? t('reviewForm.published') : sentPhotos > 0 ? t('reviewForm.pendingPhotos', { count: sentPhotos }) : t('reviewForm.pending')}
      </p>
    )
  }

  // Phase 23: one review per product; the one already written is in My reviews.
  if (signedIn && mine.data) {
    return (
      <div className="review-form__already">
        <p>
          <Trans t={t} i18nKey="reviewForm.alreadyReviewed" components={{ page: <Link to={ROUTES.myReviews} /> }} />
        </p>
        <p className="review-form__already-status">
          <span>{t('reviewForm.yourReviewStatus')}</span> <ReviewStatusBadge status={mine.data.status} />
        </p>
      </div>
    )
  }

  const errors = validate(values, t)
  const shown = (field) => {
    const serverMessage = mutation.error?.fieldErrors?.[field]?.[0]
    return (hasSubmitted && errors[field]) || (!isAlreadyReviewed(mutation.error) && serverMessage) || undefined
  }

  let formError = null
  if (isAlreadyReviewed(mutation.error)) formError = t('reviewForm.already')
  // Errors without a field of this form (network, rate limit, an unknown field) are shown above the button.
  else if (mutation.error && !['rating', 'title', 'comment'].some((field) => mutation.error.fieldErrors?.[field]) && photoErrors(mutation.error, t).length === 0) formError = mutation.error.message
  const serverPhotoErrors = isAlreadyReviewed(mutation.error) ? [] : photoErrors(mutation.error, t)

  function handleSubmit(event) {
    event.preventDefault()
    setHasSubmitted(true)
    if (errors.rating || errors.title || errors.comment || reviewPhotos.preparing) return
    const photos = photosEnabled ? reviewPhotos.photos.map((photo) => photo.file) : []
    mutation.mutate({ rating: values.rating, title: values.title.trim(), comment: values.comment.trim(), photos })
  }

  // A new choice of photos replaces the server's answer about the old ones.
  function changePhotos(change) {
    if (serverPhotoErrors.length > 0) mutation.reset()
    change()
  }

  const change = (field) => (event) => setValues((current) => ({ ...current, [field]: event.target.value }))
  const ratingError = shown('rating')
  const commentError = shown('comment')
  const commentLength = values.comment.trim().length

  return (
    <form className="review-form" onSubmit={handleSubmit} noValidate aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="review-form__title">
        {t('reviewForm.title')}
      </h3>

      <fieldset className={cn('review-form__rating', ratingError && 'review-form__rating--invalid')} aria-describedby={ratingError ? `${id}-rating-error` : undefined}>
        <legend className="form-field__label">{t('reviewForm.yourRating')}</legend>
        <div className="review-form__stars">
          {RATINGS.map((rating) => (
            <span key={rating} className="review-form__star">
              <input
                type="radio"
                id={`${id}-rating-${rating}`}
                name={`${id}-rating`}
                value={rating}
                checked={values.rating === rating}
                onChange={() => setValues((current) => ({ ...current, rating }))}
                className="review-form__star-input"
              />
              <label htmlFor={`${id}-rating-${rating}`} className={cn('review-form__star-label', rating <= values.rating && 'review-form__star-label--on')}>
                <LuStar aria-hidden="true" />
                <span className="visually-hidden">{t('reviewForm.stars', { count: rating })}</span>
              </label>
            </span>
          ))}
        </div>
        {ratingError && (
          <p id={`${id}-rating-error`} className="form-field__error">
            {ratingError}
          </p>
        )}
      </fieldset>

      <FormField label={t('reviewForm.titleLabel')} name="title" value={values.title} onChange={change('title')} maxLength={TITLE_MAX} error={shown('title')} />

      <div className={cn('form-field', commentError && 'form-field--invalid')}>
        <label htmlFor={`${id}-comment`} className="form-field__label">
          {t('reviewForm.yourReview')}
        </label>
        <textarea
          id={`${id}-comment`}
          name="comment"
          className="form-field__input review-form__comment"
          rows={5}
          maxLength={COMMENT_MAX}
          value={values.comment}
          onChange={change('comment')}
          aria-invalid={commentError ? true : undefined}
          aria-describedby={[`${id}-comment-hint`, commentError && `${id}-comment-error`].filter(Boolean).join(' ')}
        />
        <p id={`${id}-comment-hint`} className="form-field__hint">
          {t('reviewForm.hint', { product: productTitle, min: COMMENT_MIN, max: COMMENT_MAX, length: commentLength })}
        </p>
        {commentError && (
          <p id={`${id}-comment-error`} className="form-field__error">
            {commentError}
          </p>
        )}
      </div>

      {photosEnabled && (
        <ReviewPhotoField
          id={id}
          photos={reviewPhotos.photos}
          onAdd={(files) => changePhotos(() => reviewPhotos.add(files))}
          onRemove={(key) => changePhotos(() => reviewPhotos.remove(key))}
          error={reviewPhotos.error}
          serverErrors={serverPhotoErrors}
          preparing={reviewPhotos.preparing}
          max={photoSettings.max}
          maxMegabytes={photoSettings.maxMegabytes}
        />
      )}

      {formError && (
        <p className="review-form__error" role="alert">
          {formError}
        </p>
      )}

      <div>
        <Button type="submit" disabled={mutation.isPending || reviewPhotos.preparing || isAlreadyReviewed(mutation.error)}>
          {t(mutation.isPending ? 'reviewForm.sending' : 'reviewForm.submit')}
        </Button>
      </div>
    </form>
  )
}

export default ReviewForm
