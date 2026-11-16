import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuMail, LuSearch } from 'react-icons/lu'
import { getAbandonedCarts, marketingKeys, remindAbandonedCart } from '../api/marketing'
import { useAdminAuth } from '../auth/useAdminAuth'
import Notice from '../components/Notice'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount, formatDate, formatDateTime, formatMoney } from '../utils/format'
import { formatAge, useNotice } from '../utils/marketing'

/*
 * Reports → Abandoned carts (phase 7): signed-in customers' carts that
 * weren't ordered, untouched for at least an hour. reports.view to read;
 * newsletter.send to email a reminder (at most once per 72 hours per cart,
 * only to active, verified customers; the server enforces both).
 */

const LIMIT = 20
const AGES = { 1: '1 hour', 24: '1 day', 72: '3 days', 168: '1 week' }
const SORTS = { newest: 'Most recent first', oldest: 'Oldest first', subtotal: 'Highest subtotal first' }

/** Why the Remind button is off, in words. */
function remindBlockedReason(cart) {
  if (!cart.customer.isActive) return 'The account is blocked or not verified.'
  if (cart.remindAvailableAt) return `Reminded recently; possible again ${formatDateTime(cart.remindAvailableAt)}.`
  return 'Reminded in the last 72 hours.'
}

function AbandonedCartsPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const minAgeHours = params.get('minAgeHours') ?? ''
  const minSubtotal = params.get('minSubtotal') ?? ''
  const sort = params.get('sort') ?? ''
  const skip = Number(params.get('skip')) || 0
  const [draft, setDraft] = useState(q)
  const [subtotalDraft, setSubtotalDraft] = useState(minSubtotal)
  const { notice, setNotice, ref } = useNotice()
  const queryClient = useQueryClient()
  const { can } = useAdminAuth()
  const query = { q, minAgeHours, minSubtotal, sort, skip, limit: LIMIT }
  const carts = useQuery({ queryKey: marketingKeys.abandonedCarts(query), queryFn: ({ signal }) => getAbandonedCarts(query, { signal }), placeholderData: keepPreviousData })

  const remind = useMutation({
    mutationFn: (cart) => remindAbandonedCart(cart.customerId),
    onSuccess: (result, cart) => {
      queryClient.invalidateQueries({ queryKey: ['abandoned-carts'] })
      setNotice({ tone: 'success', text: result.message ?? `Reminder sent to ${cart.customer.email}.` })
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ['abandoned-carts'] })
      const field = error.fieldErrors && Object.values(error.fieldErrors)[0]?.[0]
      setNotice({ tone: 'error', text: field ?? error.message })
    },
  })

  function update(changes) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === '' || value === 0) next.delete(key)
      else next.set(key, String(value))
    }
    setParams(next)
  }

  const filtered = Boolean(q || minAgeHours || minSubtotal)
  const subtotalValid = subtotalDraft === '' || (/^\d{1,7}(\.\d{1,2})?$/.test(subtotalDraft.trim()))
  return (
    <>
      <title>Abandoned carts | BuyNest Admin</title>
      <PageHeader
        title="Abandoned carts"
        description={carts.data ? `${formatCount(carts.data.total)} ${filtered ? 'matching carts' : 'carts'} · signed-in customers who didn’t order` : 'Carts signed-in customers left behind'}
      />
      <Notice notice={notice} noticeRef={ref} />

      <form
        className="toolbar"
        role="search"
        aria-label="Filter abandoned carts"
        onSubmit={(event) => {
          event.preventDefault()
          if (!subtotalValid) return
          update({ q: draft.trim(), minSubtotal: subtotalDraft.trim(), skip: 0 })
        }}
      >
        <label className="toolbar__search">
          <span className="visually-hidden">Search by customer name or email</span>
          <input type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Customer name or email" />
        </label>
        <label className="toolbar__select">
          <span>Minimum subtotal (USD)</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={subtotalDraft}
            onChange={(event) => setSubtotalDraft(event.target.value)}
            aria-invalid={subtotalValid ? undefined : true}
            aria-describedby={subtotalValid ? undefined : 'cart-subtotal-error'}
          />
        </label>
        <button type="submit" className="btn btn--outline">
          <LuSearch aria-hidden="true" /> Apply
        </button>
        <label className="toolbar__select">
          <span>Untouched for at least</span>
          <select value={minAgeHours} onChange={(event) => update({ minAgeHours: event.target.value, skip: 0 })}>
            <option value="">1 hour</option>
            {Object.entries(AGES)
              .filter(([hours]) => hours !== '1')
              .map(([hours, label]) => (
                <option key={hours} value={hours}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <label className="toolbar__select">
          <span>Sort</span>
          <select value={sort} onChange={(event) => update({ sort: event.target.value, skip: 0 })}>
            {Object.entries(SORTS).map(([value, label]) => (
              <option key={value} value={value === 'newest' ? '' : value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </form>
      {!subtotalValid && (
        <p id="cart-subtotal-error" className="field__error" role="alert">
          Enter a minimum subtotal like 25 or 25.50.
        </p>
      )}

      {carts.isPending && <Loading label="Loading abandoned carts…" />}
      {carts.error && <ErrorState error={carts.error} onRetry={carts.refetch} />}
      {carts.data && carts.data.carts.length === 0 && <Empty>{filtered ? 'No carts match.' : 'No abandoned carts right now.'}</Empty>}
      {carts.data && carts.data.carts.length > 0 && (
        <div className="table-wrap" aria-busy={carts.isFetching}>
          <table className="table">
            <caption className="visually-hidden">Abandoned carts</caption>
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Items</th>
                <th scope="col" className="num">
                  Subtotal
                </th>
                <th scope="col">Untouched for</th>
                <th scope="col">Reminder</th>
              </tr>
            </thead>
            <tbody>
              {carts.data.carts.map((cart) => (
                <tr key={cart.customerId}>
                  <th scope="row">
                    {can('customers.view') ? <Link to={`/customers/${cart.customerId}`}>{cart.customer.name || `Customer #${cart.customerId}`}</Link> : cart.customer.name}
                    <br />
                    <small className="muted">{cart.customer.email}</small>
                  </th>
                  <td>
                    <ul className="cart-items">
                      {cart.items.map((item) => (
                        <li key={`${item.productId}-${item.variantId ?? ''}`}>
                          {item.quantity} × {item.name}
                          {item.variantLabel && <small className="muted"> ({item.variantLabel})</small>}
                          {!item.available && <small className="muted"> — no longer available</small>}
                        </li>
                      ))}
                    </ul>
                    <small className="muted">{formatCount(cart.itemCount)} {cart.itemCount === 1 ? 'unit' : 'units'}</small>
                  </td>
                  <td className="num">{formatMoney(cart.subtotal)}</td>
                  <td>
                    {formatAge(cart.ageMinutes)}
                    <br />
                    <small className="muted">since {formatDate(cart.updatedAt)}</small>
                  </td>
                  <td>
                    {cart.remindedAt && (
                      <small className="muted">
                        Reminded {formatDate(cart.remindedAt)}
                        <br />
                      </small>
                    )}
                    {can('newsletter.send') &&
                      (cart.canRemind ? (
                        <button
                          type="button"
                          className="btn btn--outline btn--sm"
                          disabled={remind.isPending && remind.variables?.customerId === cart.customerId}
                          onClick={() => remind.mutate(cart)}
                          aria-label={`Remind ${cart.customer.name || cart.customer.email}`}
                        >
                          <LuMail aria-hidden="true" /> {remind.isPending && remind.variables?.customerId === cart.customerId ? 'Sending…' : 'Remind'}
                        </button>
                      ) : (
                        <small className="muted">{remindBlockedReason(cart)}</small>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={carts.data.total} limit={LIMIT} skip={skip} onChange={(next) => update({ skip: next })} />
        </div>
      )}
    </>
  )
}

export default AbandonedCartsPage
