import { useId, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LuStar } from 'react-icons/lu'
import FormField from '../forms/FormField'
import Button from '../ui/Button'
import { useAuth } from '../../hooks/useAuth'
import { submitReview } from '../../services/shopService'
import { productKeys } from '../../queries/productQueries'
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
 */
function ReviewForm({ productId, productTitle }) {
  const { t } = useTranslation('catalog')
  const { isAuthenticated, authorizedRequest } = useAuth()
  const location = useLocation()
  const queryClient = useQueryClient()
  const id = useId()
  const [values, setValues] = useState({ rating: 0, title: '', comment: '' })
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const [result, setResult] = useState(null) // the success message, once sent

  const mutation = useMutation({
    mutationFn: (input) => authorizedRequest(() => submitReview(productId, input)),
    onSuccess: (review) => {
      setResult(review?.status === 'approved' ? 'published' : 'pending')
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
        {t(result === 'published' ? 'reviewForm.published' : 'reviewForm.pending')}
      </p>
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
  else if (mutation.error && !['rating', 'title', 'comment'].some((field) => mutation.error.fieldErrors?.[field])) formError = mutation.error.message

  function handleSubmit(event) {
    event.preventDefault()
    setHasSubmitted(true)
    if (errors.rating || errors.title || errors.comment) return
    mutation.mutate({ rating: values.rating, title: values.title.trim(), comment: values.comment.trim() })
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

      {formError && (
        <p className="review-form__error" role="alert">
          {formError}
        </p>
      )}

      <div>
        <Button type="submit" disabled={mutation.isPending || isAlreadyReviewed(mutation.error)}>
          {t(mutation.isPending ? 'reviewForm.sending' : 'reviewForm.submit')}
        </Button>
      </div>
    </form>
  )
}

export default ReviewForm
