import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { LuBadgeCheck, LuImageOff, LuMessageSquareText, LuTrash2 } from 'react-icons/lu'
import { useTranslation } from 'react-i18next'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import ErrorMessage from '../components/ui/ErrorMessage'
import Modal from '../components/ui/Modal'
import RatingStars from '../components/product/RatingStars'
import ReviewPhotoViewer from '../components/product/ReviewPhotoViewer'
import ReviewStatusBadge from '../components/product/ReviewStatusBadge'
import { useAuth } from '../hooks/useAuth'
import { customerKeys, myReviewsQuery } from '../queries/customerQueries'
import { productKeys } from '../queries/productQueries'
import { deleteMyReview, deleteMyReviewPhoto } from '../services/accountService'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import { cn } from '../utils/classNames'
import { formatDate } from '../utils/formatters'
import './MyReviewsPage.css'

const TITLE_ID = 'my-reviews-title'
const headingId = (reviewId) => `my-review-${reviewId}`
const MAX_RATING = 5

/** Every page loaded so far, as one list (a review can't appear twice, even if pages shifted after a delete). */
function flatten(data) {
  const seen = new Set()
  return (data?.pages ?? []).flatMap((page) => page.reviews ?? []).filter((review) => !seen.has(review.id) && seen.add(review.id))
}

/** The cached pages with one review changed (`update` returns the new review, or null to drop it). */
const changeReview = (reviewId, update) => (data) =>
  data && {
    ...data,
    pages: data.pages.map((page) => {
      const had = page.reviews.some((review) => review.id === reviewId)
      const reviews = page.reviews.flatMap((review) => (review.id === reviewId ? [update(review)].filter(Boolean) : [review]))
      return { ...page, reviews, total: had && reviews.length < page.reviews.length ? Math.max(0, page.total - 1) : page.total }
    }),
  }

/** The loading placeholder: three grey cards shaped like the real ones (no motion when reduced motion is asked for). */
function ReviewsSkeleton({ label }) {
  return (
    <div className="my-reviews__skeleton" aria-busy="true">
      <p className="visually-hidden" role="status">
        {label}
      </p>
      {[0, 1, 2].map((index) => (
        <div key={index} className="my-reviews__skeleton-card" aria-hidden="true">
          <span className="my-reviews__bone my-reviews__bone--thumb" />
          <span className="my-reviews__skeleton-lines">
            <span className="my-reviews__bone my-reviews__bone--title" />
            <span className="my-reviews__bone my-reviews__bone--line" />
            <span className="my-reviews__bone my-reviews__bone--short" />
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * /account/reviews (REAL_SHOP, phase 23): every review the customer wrote, in
 * every status ("Waiting for approval", "Published", "Not published"), with
 * their photos, including any the shop hid (labelled "Hidden by the shop").
 * Photos come from the author-only address (/api/shop/me/reviews/:id/photos/:photoId,
 * never cached). A photo or the whole review can be deleted after a
 * confirmation dialog; the result is announced, and the focus moves to the
 * next review's heading (or the page heading when none is left), so keyboard
 * and screen reader users don't lose their place.
 */
function MyReviewsPage() {
  const { t } = useTranslation('account')
  const { user, authorizedRequest } = useAuth()
  const queryClient = useQueryClient()
  const list = useInfiniteQuery(myReviewsQuery(user.id, authorizedRequest))
  const listKey = customerKeys.reviewList(user.id)
  const [message, setMessage] = useState('')
  const [confirm, setConfirm] = useState(null) // { kind: 'review' | 'photo', review, photo?, number?, opener }
  const [viewer, setViewer] = useState(null) // { reviewId, index, opener }
  const [failedPhotos, setFailedPhotos] = useState(() => new Set())
  // Where the focus goes next, once no dialog is open: { id } (an element id), { element }, or { index } (the first
  // review of a page that is still loading). A ref, not state: moving the focus changes nothing on screen.
  const focusNext = useRef(null)

  const reviews = flatten(list.data)

  // Runs after every render: the focus moves only once the dialogs are closed (closing one would take it back).
  useEffect(() => {
    const request = focusNext.current
    if (!request || confirm || viewer) return
    if (request.index !== undefined) {
      if (reviews.length <= request.index) return // that page isn't on screen yet
      request.id = headingId(reviews[request.index].id)
    }
    const element = request.element ?? document.getElementById(request.id)
    // An id not on the page yet waits; a button that is gone (its photo failed to load meanwhile) is dropped.
    if (!element && request.id) return
    focusNext.current = null
    if (element?.isConnected) element.focus()
  })

  // The same text twice in a row is still announced (a no-break space makes it a change).
  const announce = (text) => setMessage((current) => (current === text ? `${text}\u00a0` : text))

  function afterChange(review) {
    queryClient.invalidateQueries({ queryKey: customerKeys.reviews(user.id) })
    if (review.product) queryClient.invalidateQueries({ queryKey: productKeys.detail(review.product.id) })
  }

  const removeReview = useMutation({
    mutationFn: (review) => authorizedRequest(() => deleteMyReview(review.id)),
    onSuccess: (_, review) => {
      const current = flatten(queryClient.getQueryData(listKey))
      const index = current.findIndex((entry) => entry.id === review.id)
      const next = current[index + 1] ?? current[index - 1]
      queryClient.setQueryData(listKey, changeReview(review.id, () => null))
      afterChange(review)
      focusNext.current = { id: next ? headingId(next.id) : TITLE_ID }
      setConfirm(null)
      announce(t('myReviews.reviewDeleted'))
    },
  })

  const removePhoto = useMutation({
    mutationFn: ({ review, photo }) => authorizedRequest(() => deleteMyReviewPhoto(review.id, photo.id)),
    onSuccess: (answer, { review, photo }) => {
      const updated = answer?.review?.id === review.id ? answer.review : { ...review, photos: review.photos.filter((entry) => entry.id !== photo.id) }
      queryClient.setQueryData(listKey, changeReview(review.id, () => updated))
      afterChange(review)
      focusNext.current = { id: headingId(review.id) }
      setConfirm(null)
      announce(t('myReviews.photoDeleted'))
    },
  })

  const deleting = removeReview.isPending || removePhoto.isPending
  const deleteError = confirm?.kind === 'review' ? removeReview.error : confirm?.kind === 'photo' ? removePhoto.error : null

  function askToDelete(event, details) {
    removeReview.reset()
    removePhoto.reset()
    setConfirm({ ...details, opener: event.currentTarget })
  }

  // "Keep it", Escape, ×, or a click on the backdrop: nothing changes, and the focus goes back to the button.
  function closeConfirm() {
    if (deleting || !confirm) return
    focusNext.current = { element: confirm.opener }
    setConfirm(null)
    removeReview.reset()
    removePhoto.reset()
  }

  function confirmDelete() {
    if (!confirm) return
    if (confirm.kind === 'review') removeReview.mutate(confirm.review)
    else removePhoto.mutate({ review: confirm.review, photo: confirm.photo })
  }

  // The focus goes to the first review of the page that was added (the button may be gone after the last page).
  function showMore() {
    focusNext.current = { index: reviews.length }
    list.fetchNextPage().then((result) => {
      if (result.isError || flatten(result.data).length <= reviews.length) focusNext.current = null
    })
  }

  const productName = (review) => review.product?.name || t('myReviews.removedProduct')
  const openablePhotos = (review) => review.photos.filter((photo) => !failedPhotos.has(photo.url))
  const viewed = viewer && reviews.find((review) => review.id === viewer.reviewId)
  const viewedPhotos = viewed ? openablePhotos(viewed) : []

  function photoFailed(url) {
    setFailedPhotos((current) => new Set(current).add(url))
    if (viewer && viewedPhotos.some((photo) => photo.url === url)) {
      const left = viewedPhotos.length - 1
      if (left === 0) closeViewer()
      else setViewer({ ...viewer, index: Math.min(viewer.index, left - 1) })
    }
  }

  function openPhoto(event, review, photo) {
    setViewer({ reviewId: review.id, index: openablePhotos(review).findIndex((entry) => entry.url === photo.url), opener: event.currentTarget })
  }

  function closeViewer() {
    if (viewer?.opener) focusNext.current = { element: viewer.opener }
    setViewer(null)
  }

  let content
  if (list.isPending) content = <ReviewsSkeleton label={t('myReviews.loading')} />
  else if (list.isError) content = <ErrorMessage title={t('myReviews.failed')} titleAs="h3" message={list.error.message} onRetry={() => list.refetch()} />
  else if (reviews.length === 0) {
    content = (
      <EmptyState icon={LuMessageSquareText} titleAs="h3" title={t('myReviews.empty')} message={t('myReviews.emptyMessage')}>
        <Button to={ROUTES.products}>{t('myReviews.browse')}</Button>
      </EmptyState>
    )
  } else {
    content = (
      <>
        <ul className="my-reviews__list">
          {reviews.map((review) => {
            const name = productName(review)
            const linked = review.product?.available === true
            const photos = review.photos
            return (
              <li key={review.id}>
                <article className="my-reviews__card" aria-labelledby={headingId(review.id)}>
                  <div className="my-reviews__product">
                    {review.product?.thumbnail ? (
                      <img className="my-reviews__thumb" src={review.product.thumbnail} alt="" width="56" height="56" loading="lazy" decoding="async" />
                    ) : (
                      <span className="my-reviews__thumb my-reviews__thumb--empty" aria-hidden="true" />
                    )}
                    <div className="my-reviews__product-text">
                      <h3 id={headingId(review.id)} className="my-reviews__name" tabIndex={-1}>
                        {linked ? <Link to={ROUTES.productDetails(review.product.id)}>{name}</Link> : name}
                      </h3>
                      {!linked && <p className="my-reviews__unavailable">{t('myReviews.unavailable')}</p>}
                    </div>
                    <ReviewStatusBadge status={review.status} className="my-reviews__badge" />
                  </div>

                  <div className="my-reviews__meta">
                    {Number.isInteger(review.rating) && (
                      <RatingStars rating={review.rating} showValue={false} label={t('myReviews.stars', { rating: review.rating, max: MAX_RATING })} />
                    )}
                    {review.date && <time dateTime={review.date}>{t('myReviews.written', { date: formatDate(review.date) })}</time>}
                    {review.verifiedPurchase && (
                      <span className="my-reviews__verified">
                        <LuBadgeCheck aria-hidden="true" /> {t('myReviews.verified')}
                      </span>
                    )}
                  </div>

                  {review.title && <p className="my-reviews__title">{review.title}</p>}
                  {review.comment && <p className="my-reviews__comment">{review.comment}</p>}

                  {photos.length > 0 && (
                    <ul className="my-reviews__photos" aria-label={t('myReviews.photos', { product: name })}>
                      {photos.map((photo, index) => {
                        const number = index + 1
                        const hiddenId = `${headingId(review.id)}-photo-${photo.id}-hidden`
                        return (
                          <li key={photo.id} className={cn('my-reviews__photo', photo.hidden && 'my-reviews__photo--hidden')}>
                            {failedPhotos.has(photo.url) ? (
                              <span className="my-reviews__photo-box my-reviews__photo-box--failed">
                                <LuImageOff aria-hidden="true" />
                                <span className="visually-hidden">{t('myReviews.photoFailed', { number })}</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="my-reviews__photo-box"
                                onClick={(event) => openPhoto(event, review, photo)}
                                aria-label={t('myReviews.openPhoto', { number, total: photos.length, product: name })}
                                aria-describedby={photo.hidden ? hiddenId : undefined}
                              >
                                <img src={photo.url} alt="" width="72" height="72" loading="lazy" decoding="async" onError={() => photoFailed(photo.url)} />
                              </button>
                            )}
                            {photo.hidden && (
                              <span id={hiddenId} className="my-reviews__hidden">
                                {t('myReviews.hiddenPhoto')}
                              </span>
                            )}
                            <button
                              type="button"
                              className="my-reviews__delete-photo"
                              onClick={(event) => askToDelete(event, { kind: 'photo', review, photo, number })}
                              aria-label={t('myReviews.deletePhotoLabel', { number, product: name })}
                            >
                              {t('myReviews.deletePhoto', { number })}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  <div className="my-reviews__actions">
                    <Button variant="outline" size="sm" className="my-reviews__delete" onClick={(event) => askToDelete(event, { kind: 'review', review })} aria-label={t('myReviews.deleteReviewLabel', { product: name })}>
                      <LuTrash2 aria-hidden="true" /> {t('myReviews.deleteReview')}
                    </Button>
                  </div>
                </article>
              </li>
            )
          })}
        </ul>

        {list.isFetchNextPageError && (
          <p className="my-reviews__error" role="alert">
            {t('myReviews.moreFailed', { reason: list.error?.message ?? '' })}
          </p>
        )}
        {list.hasNextPage && (
          <div className="my-reviews__more">
            <Button variant="outline" onClick={showMore} disabled={list.isFetchingNextPage}>
              {t(list.isFetchingNextPage ? 'myReviews.loadingMore' : 'myReviews.showMore')}
            </Button>
          </div>
        )}
      </>
    )
  }

  const confirmName = confirm ? productName(confirm.review) : ''
  return (
    <section className="orders my-reviews" aria-labelledby={TITLE_ID}>
      <title>{`${t('myReviews.title')} | ${SITE.name}`}</title>
      <h2 id={TITLE_ID} className="orders__title" tabIndex={-1}>
        {t('myReviews.title')}
      </h2>
      <p className="my-reviews__note">{t('myReviews.note')}</p>
      <p className="my-reviews__status" role="status">
        {message}
      </p>

      {content}

      <Modal
        isOpen={confirm !== null}
        onClose={closeConfirm}
        title={confirm?.kind === 'photo' ? t('myReviews.confirmPhotoTitle') : t('myReviews.confirmReviewTitle')}
        footer={
          <div className="my-reviews__dialog-actions">
            <Button variant="ghost" onClick={closeConfirm} disabled={deleting}>
              {t('myReviews.keep')}
            </Button>
            <Button className="my-reviews__confirm" onClick={confirmDelete} disabled={deleting}>
              {deleting ? t('myReviews.deleting') : confirm?.kind === 'photo' ? t('myReviews.confirmPhoto') : t('myReviews.confirmReview')}
            </Button>
          </div>
        }
      >
        {confirm && (
          <div className="my-reviews__dialog-body">
            <p>{confirm.kind === 'photo' ? t('myReviews.confirmPhotoText', { number: confirm.number, product: confirmName }) : t('myReviews.confirmReviewText', { product: confirmName })}</p>
            {deleteError && (
              <p className="my-reviews__error" role="alert">
                {deleteError.message}
              </p>
            )}
          </div>
        )}
      </Modal>

      {viewed && viewedPhotos.length > 0 && (
        <ReviewPhotoViewer
          photos={viewedPhotos}
          index={Math.max(0, Math.min(viewer.index, viewedPhotos.length - 1))}
          name={productName(viewed)}
          title={t('myReviews.photos', { product: productName(viewed) })}
          photoAlt={(number, total) => t('myReviews.photoAlt', { number, total, product: productName(viewed) })}
          onIndexChange={(index) => setViewer((current) => current && { ...current, index })}
          onClose={closeViewer}
          onPhotoError={photoFailed}
        />
      )}
    </section>
  )
}

export default MyReviewsPage
