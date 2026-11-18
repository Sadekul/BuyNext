import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuScale } from 'react-icons/lu'
import { adjustCustomerRewards, getCustomerRewards, getCustomerWishlist, phase11Keys } from '../api/phase11'
import { useAdminAuth } from '../auth/useAdminAuth'
import Field from './Field'
import FormDialog from './FormDialog'
import Pagination from './Pagination'
import StatTile from './StatTile'
import StatusBadge from './StatusBadge'
import { Empty, ErrorState, Loading } from './States'
import { formatDate, formatDateTime, formatMoney, fullName } from '../utils/format'
import { formatPoints, pointsAdjustmentErrors, rewardTypeLabel, signedPoints } from '../utils/rewards'

/*
 * Phase 11 tabs of the customer page: the saved wishlist (§1) and the reward
 * points balance with its history (§4). Both need customers.view; adjusting
 * the balance needs rewards.manage (the API refuses the same, and audits it).
 */

/** The customer's wishlist, newest first: product, variant, note, when it was added. */
export function WishlistTab({ customer }) {
  const wishlist = useQuery({ queryKey: phase11Keys.wishlist(customer.id), queryFn: ({ signal }) => getCustomerWishlist(customer.id, { signal }) })
  if (wishlist.isPending) return <Loading label="Loading the wishlist…" />
  if (wishlist.error) return <ErrorState error={wishlist.error} onRetry={wishlist.refetch} />
  const items = wishlist.data.items ?? []
  if (items.length === 0) return <Empty>Nothing saved to the wishlist yet.</Empty>
  return (
    <section aria-label="Wishlist">
      <p className="muted page-note">
        {items.length === 1 ? '1 product' : `${items.length} products`} saved. The customer sees only products that are for sale; the others stay on the list.
        {wishlist.data.shared ? ` Shared by link since ${formatDate(wishlist.data.sharedAt)}.` : ' Not shared.'}
      </p>
      {/* Focusable, so keyboard users can scroll it sideways on a phone. */}
      <div className="table-wrap" role="region" aria-label={`${fullName(customer)}'s wishlist`} tabIndex={0}>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Variant</th>
              <th scope="col">Note</th>
              <th scope="col">Added</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <th scope="row">
                  <span className="table__product">
                    {item.product.image ? <img src={item.product.image} alt="" width="32" height="32" loading="lazy" /> : null}
                    <span>
                      {item.product.id && !item.product.deleted ? <Link to={`/products/${item.product.id}`}>{item.product.name}</Link> : item.product.name}
                      <small>{item.product.sku && `SKU ${item.product.sku}`}</small>
                    </span>
                  </span>
                  {item.product.deleted ? (
                    <StatusBadge tone="neutral" label="Deleted product" />
                  ) : (
                    item.product.status &&
                    item.product.status !== 'active' && <StatusBadge tone="warning" label={`${item.product.status[0].toUpperCase()}${item.product.status.slice(1)}: not in the store`} />
                  )}
                </th>
                <td>{item.variant?.label || <span className="muted">—</span>}</td>
                <td>{item.note || <span className="muted">—</span>}</td>
                <td>{formatDate(item.addedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

const HISTORY_PAGE = 20

/** The points balance, its money value, the history, and "Adjust balance" (rewards.manage). */
export function RewardsTab({ customer, onChanged }) {
  const { can } = useAdminAuth()
  const queryClient = useQueryClient()
  const [skip, setSkip] = useState(0)
  const [adjusting, setAdjusting] = useState(false)
  const openerRef = useRef(null)
  const params = { limit: HISTORY_PAGE, skip }
  const rewards = useQuery({
    queryKey: phase11Keys.rewards(customer.id, params),
    queryFn: ({ signal }) => getCustomerRewards(customer.id, params, { signal }),
    placeholderData: keepPreviousData,
  })
  if (rewards.isPending) return <Loading label="Loading reward points…" />
  if (rewards.error) return <ErrorState error={rewards.error} onRetry={rewards.refetch} />
  const data = rewards.data
  const transactions = data.transactions ?? []

  function done(text) {
    setAdjusting(false)
    setSkip(0)
    queryClient.invalidateQueries({ queryKey: ['customer-rewards', String(customer.id)] })
    queryClient.invalidateQueries({ queryKey: ['customers'] })
    onChanged(text)
  }

  return (
    <section aria-label="Reward points" aria-busy={rewards.isFetching}>
      {!data.enabled && <p className="notice">Reward points are off (Settings → Reward points): nothing is earned or spent now. The balance is kept and can still be adjusted.</p>}
      <div className="rewards-summary">
        <dl className="stats stats--compact">
          <StatTile label="Balance" value={formatPoints(data.balance)} note={`Worth ${formatMoney(data.value)} at checkout`} />
        </dl>
        {can('rewards.manage') && (
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={(event) => {
              openerRef.current = event.currentTarget
              setAdjusting(true)
            }}
          >
            <LuScale aria-hidden="true" /> Adjust balance
          </button>
        )}
      </div>
      {transactions.length === 0 ? (
        <Empty>No points earned or spent yet.</Empty>
      ) : (
        <div className="table-wrap" role="region" aria-label="Reward points history" tabIndex={0}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col" className="num">
                  Change
                </th>
                <th scope="col" className="num">
                  Balance after
                </th>
                <th scope="col">What</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                  </td>
                  <td className="num">{signedPoints(entry.points)}</td>
                  <td className="num">{entry.balanceAfter === null ? '—' : formatPoints(entry.balanceAfter)}</td>
                  <td>
                    {rewardTypeLabel(entry.type)}
                    {entry.orderNumber && (
                      <>
                        {' · '}
                        <Link to={`/orders/${entry.orderNumber}`}>Order {entry.orderNumber}</Link>
                      </>
                    )}
                    {entry.creditMemoNumber && (
                      <>
                        {' · '}
                        <Link to={`/credit-memos/${entry.creditMemoNumber}`}>Credit memo {entry.creditMemoNumber}</Link>
                      </>
                    )}
                    {entry.note && <span className="rewards-note">“{entry.note}”</span>}
                    {entry.adminName && <span className="muted"> · by {entry.adminName}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={data.total ?? transactions.length} limit={HISTORY_PAGE} skip={skip} onChange={setSkip} />
        </div>
      )}
      {adjusting && (
        <AdjustPointsDialog
          customer={customer}
          balance={data.balance}
          onDone={done}
          onCancel={() => {
            setAdjusting(false)
            openerRef.current?.focus()
          }}
        />
      )}
    </section>
  )
}

/** Add or take away points, with the reason (kept in the history and the audit log). */
function AdjustPointsDialog({ customer, balance, onDone, onCancel }) {
  const [points, setPoints] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState({})
  const name = fullName(customer) || customer.email
  const adjust = useMutation({
    mutationFn: (values) => adjustCustomerRewards(customer.id, values),
    onSuccess: (data, sent) => {
      const after = Number.isInteger(data?.balance) ? data.balance : balance + sent.points
      onDone(`${sent.points < 0 ? 'Took away' : 'Added'} ${formatPoints(Math.abs(sent.points))}. ${name} now has ${formatPoints(after)}.`)
    },
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  })
  function submit() {
    const found = pointsAdjustmentErrors({ points, note }, balance)
    setErrors(found)
    if (Object.keys(found).length === 0) adjust.mutate({ points: Number(points), note: note.trim() })
  }
  const value = Number(points)
  const preview = /^[-+]?\d+$/.test(points.trim()) && value !== 0 ? balance + value : null
  const other = adjust.error && (adjust.error.fieldErrors ? Object.entries(adjust.error.fieldErrors).find(([field]) => !['points', 'note'].includes(field))?.[1]?.[0] : adjust.error.message)
  return (
    <FormDialog
      isOpen
      title={`Adjust ${name}'s reward points`}
      description={`Now ${formatPoints(balance)}. A positive number adds points, a negative one takes them away. The change and its reason are kept in the history and the audit log.`}
      submitLabel="Save adjustment"
      busy={adjust.isPending}
      error={other}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <Field label="Points" error={errors.points?.[0]} hint="A whole number, for example 500 or -200.">
        {(a11y) => <input {...a11y} type="text" inputMode="numeric" autoComplete="off" value={points} onChange={(event) => setPoints(event.target.value)} />}
      </Field>
      <Field label="Reason" error={errors.note?.[0]} hint="Required. The customer doesn't see it.">
        {(a11y) => <textarea {...a11y} rows={2} maxLength={255} value={note} onChange={(event) => setNote(event.target.value)} />}
      </Field>
      <p className="field__hint" aria-live="polite">
        {preview !== null && preview >= 0 ? `New balance: ${formatPoints(preview)}` : ''}
      </p>
    </FormDialog>
  )
}
