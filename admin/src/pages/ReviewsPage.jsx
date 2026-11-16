import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuBadgeCheck, LuCheck, LuCircleCheck, LuCircleX, LuClock, LuSearch, LuStar, LuTrash2, LuX } from 'react-icons/lu'
import { adminKeys, bulkReviews, deleteReview, getReviews, updateReview } from '../api/admin'
import { useAdminAuth } from '../auth/useAdminAuth'
import ConfirmDialog from '../components/ConfirmDialog'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount, formatDate } from '../utils/format'
import { actionErrorMessage } from '../utils/permissions'

const LIMIT = 20
const REVIEW_STATUSES = {
  pending: { label: 'Pending', tone: 'warning', icon: LuClock },
  approved: { label: 'Approved', tone: 'success', icon: LuCircleCheck },
  rejected: { label: 'Rejected', tone: 'neutral', icon: LuCircleX },
}
const reviewStatus = (status) => REVIEW_STATUSES[status] ?? { label: status, tone: 'neutral', icon: LuClock }
const DONE = { approved: 'approved', rejected: 'rejected', pending: 'set back to pending' }

/**
 * Catalog → Reviews (Magento's Marketing → Reviews): shoppers' reviews,
 * filtered by status, rating, product, or text. Approve, reject, or delete
 * one, or approve/reject the ticked ones. Only approved reviews are shown in
 * the store, and the product's rating counts only those. Needs reviews.view;
 * changes reviews.moderate.
 */
function ReviewsPage() {
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { can } = useAdminAuth()
  const moderate = can('reviews.moderate')
  const status = params.get('status') ?? ''
  const rating = params.get('rating') ?? ''
  const productId = params.get('productId') ?? ''
  const q = params.get('q') ?? ''
  const skip = Number(params.get('skip')) || 0
  const [draft, setDraft] = useState(q)
  const [notice, setNotice] = useState(null)
  const [toDelete, setToDelete] = useState(null)
  const noticeRef = useRef(null)

  const query = { status, rating, productId, q, skip, limit: LIMIT }
  const pageKey = JSON.stringify(query)
  const [selection, setSelection] = useState({ pageKey, ids: [] })
  const selectedIds = selection.pageKey === pageKey ? selection.ids : []
  const select = (ids) => setSelection({ pageKey, ids })

  const reviews = useQuery({ queryKey: adminKeys.reviews(query), queryFn: ({ signal }) => getReviews(query, { signal }), placeholderData: keepPreviousData })
  const rows = reviews.data?.reviews ?? []
  const allSelected = rows.length > 0 && rows.every((review) => selectedIds.includes(review.id))

  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  function finished(text, tone = 'success') {
    setNotice({ text, tone })
    queryClient.invalidateQueries({ queryKey: ['reviews'] })
  }

  const setOne = useMutation({
    mutationFn: ({ review, next }) => updateReview(review.id, next),
    onSuccess: (_, { review, next }) => finished(`The review by ${review.authorName || 'a shopper'} was ${DONE[next]}.`),
    onError: (error) => finished(actionErrorMessage(error), 'error'),
  })
  const setMany = useMutation({
    mutationFn: (next) => bulkReviews(selectedIds, next),
    onSuccess: (result, next) => {
      const count = result.updated ?? selectedIds.length
      select([])
      const skipped = result.skipped?.length ? ` ${formatCount(result.skipped.length)} skipped.` : ''
      finished(`${formatCount(count)} ${count === 1 ? 'review' : 'reviews'} ${DONE[next]}.${skipped}`)
    },
    onError: (error) => finished(actionErrorMessage(error), 'error'),
  })
  const remove = useMutation({
    mutationFn: (review) => deleteReview(review.id),
    onSuccess: (_, review) => {
      setToDelete(null)
      finished(`The review by ${review.authorName || 'a shopper'} was deleted.`)
    },
    onError: (error) => {
      setToDelete(null)
      finished(actionErrorMessage(error), 'error')
    },
  })
  const busy = setOne.isPending || setMany.isPending

  function update(changes) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === '' || value === 0) next.delete(key)
      else next.set(key, String(value))
    }
    setParams(next)
  }

  const filtered = Boolean(status || rating || productId || q)
  return (
    <>
      <title>Reviews | BuyNest Admin</title>
      <PageHeader title="Reviews" description={reviews.data ? `${formatCount(reviews.data.total)} ${filtered ? 'matching reviews' : 'reviews'}` : 'What shoppers say about the products'} />
      <div role={notice?.tone === 'error' ? 'alert' : 'status'}>
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className={notice.tone === 'success' ? 'notice notice--success' : 'form-error'}>
            {notice.text}
          </p>
        )}
      </div>

      <div className="toolbar">
        <form
          role="search"
          className="toolbar__search"
          onSubmit={(event) => {
            event.preventDefault()
            update({ q: draft.trim(), skip: 0 })
          }}
        >
          <label htmlFor="review-search" className="visually-hidden">
            Search reviews
          </label>
          <input id="review-search" type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Text, shopper, or product" />
          <button type="submit" className="btn btn--outline">
            <LuSearch aria-hidden="true" /> Search
          </button>
        </form>
        <label className="toolbar__select">
          <span>Status</span>
          <select value={status} onChange={(event) => update({ status: event.target.value, skip: 0 })}>
            <option value="">All reviews</option>
            {Object.entries(REVIEW_STATUSES).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
                {reviews.data?.counts ? ` (${formatCount(reviews.data.counts[value] ?? 0)})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar__select">
          <span>Rating</span>
          <select value={rating} onChange={(event) => update({ rating: event.target.value, skip: 0 })}>
            <option value="">Any rating</option>
            {[5, 4, 3, 2, 1].map((stars) => (
              <option key={stars} value={stars}>
                {stars} {stars === 1 ? 'star' : 'stars'}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar__select">
          <span>Product ID</span>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            defaultValue={productId}
            key={productId}
            className="toolbar__narrow"
            onBlur={(event) => update({ productId: /^\d{1,9}$/.test(event.target.value) ? event.target.value : '', skip: 0 })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
        </label>
      </div>

      {moderate && selectedIds.length > 0 && (
        <div className="bulk-bar" role="group" aria-label="Bulk actions for the selected reviews">
          <p className="bulk-bar__count">
            <strong>{formatCount(selectedIds.length)}</strong> selected
          </p>
          <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => setMany.mutate('approved')}>
            <LuCheck aria-hidden="true" /> Approve selected
          </button>
          <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={() => setMany.mutate('rejected')}>
            <LuX aria-hidden="true" /> Reject selected
          </button>
          <button type="button" className="btn btn--outline btn--sm" onClick={() => select([])}>
            Clear selection
          </button>
        </div>
      )}

      {reviews.isPending && <Loading label="Loading reviews…" />}
      {reviews.error && <ErrorState error={reviews.error} onRetry={reviews.refetch} />}
      {reviews.data && rows.length === 0 && <Empty>{filtered ? 'No reviews match.' : 'No reviews yet.'}</Empty>}
      {reviews.data && rows.length > 0 && (
        <div className="table-wrap" aria-busy={reviews.isFetching}>
          <table className="table reviews-table">
            <thead>
              <tr>
                {moderate && (
                  <th scope="col" className="table__check">
                    <input
                      type="checkbox"
                      aria-label="Select all reviews on this page"
                      checked={allSelected}
                      ref={(node) => {
                        if (node) node.indeterminate = selectedIds.length > 0 && !allSelected
                      }}
                      onChange={(event) => select(event.target.checked ? rows.map((review) => review.id) : [])}
                    />
                  </th>
                )}
                <th scope="col">Review</th>
                <th scope="col">Product</th>
                <th scope="col">Rating</th>
                <th scope="col">Status</th>
                <th scope="col">Date</th>
                {moderate && (
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((review) => {
                const who = review.authorName || 'a shopper'
                return (
                  <tr key={review.id} className={selectedIds.includes(review.id) ? 'is-selected' : undefined}>
                    {moderate && (
                      <td className="table__check">
                        <input
                          type="checkbox"
                          aria-label={`Select the review by ${who}`}
                          checked={selectedIds.includes(review.id)}
                          onChange={(event) => select(event.target.checked ? [...selectedIds, review.id] : selectedIds.filter((id) => id !== review.id))}
                        />
                      </td>
                    )}
                    <td className="review-cell">
                      {review.title && <strong>{review.title}</strong>}
                      <p>{review.comment}</p>
                      <small className="muted">
                        {review.authorName || 'Shopper'}
                        {review.authorEmail && ` · ${review.authorEmail}`}
                      </small>
                      {review.verifiedPurchase && (
                        <>
                          {' '}
                          <StatusBadge tone="info" label="Verified purchase" icon={LuBadgeCheck} />
                        </>
                      )}
                    </td>
                    <td>
                      {review.productId ? <Link to={`/products/${review.productId}`}>{review.productName || `Product #${review.productId}`}</Link> : review.productName}
                    </td>
                    <td>
                      <span className="rating" aria-hidden="true">
                        <LuStar /> {review.rating}/5
                      </span>
                      <span className="visually-hidden">{review.rating} of 5 stars</span>
                    </td>
                    <td>
                      <StatusBadge {...reviewStatus(review.status)} />
                    </td>
                    <td>{formatDate(review.createdAt)}</td>
                    {moderate && (
                      <td className="table__actions">
                        {review.status !== 'approved' && (
                          <button type="button" className="btn btn--outline btn--sm" disabled={busy} aria-label={`Approve the review by ${who}`} onClick={() => setOne.mutate({ review, next: 'approved' })}>
                            Approve
                          </button>
                        )}
                        {review.status !== 'rejected' && (
                          <button type="button" className="btn btn--outline btn--sm" disabled={busy} aria-label={`Reject the review by ${who}`} onClick={() => setOne.mutate({ review, next: 'rejected' })}>
                            Reject
                          </button>
                        )}
                        <button type="button" className="icon-button icon-button--danger" aria-label={`Delete the review by ${who}`} onClick={() => setToDelete(review)}>
                          <LuTrash2 aria-hidden="true" />
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
          <Pagination total={reviews.data.total} limit={LIMIT} skip={skip} onChange={(next) => update({ skip: next })} />
        </div>
      )}

      <ConfirmDialog
        isOpen={toDelete !== null}
        title="Delete this review?"
        message={`The review by ${toDelete?.authorName || 'a shopper'} is removed for good, and the product's rating is recounted.`}
        confirmLabel="Delete review"
        busy={remove.isPending}
        onConfirm={() => remove.mutate(toDelete)}
        onCancel={() => setToDelete(null)}
      />
    </>
  )
}

export default ReviewsPage
