import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuPencil, LuPlus, LuSearch, LuTrash2 } from 'react-icons/lu'
import { adminKeys, deleteCoupon, getCoupons, updateCoupon } from '../api/admin'
import ConfirmDialog from '../components/ConfirmDialog'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount, formatDate, formatMoney } from '../utils/format'
import { COUPON_FILTERS, couponStatus } from '../utils/orders'
import { describeCouponValue } from '../utils/couponSchema'

const LIMIT = 20

/** "Spend $50.00+ · until Dec 31, 2026" */
function conditions(coupon) {
  const parts = []
  if (coupon.minSubtotal) parts.push(`Spend ${formatMoney(coupon.minSubtotal)}+`)
  if (coupon.startsAt) parts.push(`from ${formatDate(coupon.startsAt)}`)
  if (coupon.endsAt) parts.push(`until ${formatDate(coupon.endsAt)}`)
  if (coupon.usageLimitPerCustomer) parts.push(`${coupon.usageLimitPerCustomer} per customer`)
  return parts.join(' · ') || 'None'
}

/**
 * Marketing → Coupons (real data only): codes shoppers type in the cart.
 * Search by code, filter by status; edit, disable, or delete. A code that was
 * already used is only disabled by the server (past orders keep it).
 */
function CouponsPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const status = params.get('status') ?? ''
  const skip = Number(params.get('skip')) || 0
  const [draft, setDraft] = useState(q)
  const [pending, setPending] = useState(null) // { coupon, action: 'disable' | 'delete' }
  const [notice, setNotice] = useState(null)
  const noticeRef = useRef(null)
  const queryClient = useQueryClient()
  const query = { q, status, skip, limit: LIMIT }
  const coupons = useQuery({ queryKey: adminKeys.coupons(query), queryFn: ({ signal }) => getCoupons(query, { signal }), placeholderData: keepPreviousData })

  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  const act = useMutation({
    mutationFn: ({ coupon, action }) => (action === 'delete' ? deleteCoupon(coupon.id) : updateCoupon(coupon.id, { isActive: false })),
    onSuccess: (result, { coupon, action }) => {
      setPending(null)
      queryClient.invalidateQueries({ queryKey: ['coupons'] })
      queryClient.invalidateQueries({ queryKey: ['coupon'] })
      if (action === 'disable') setNotice({ tone: 'success', text: `${coupon.code} is disabled. Shoppers can no longer use it.` })
      else if (result.disabled) setNotice({ tone: 'success', text: `${coupon.code} has been used, so it was disabled instead of deleted. Past orders keep it.` })
      else setNotice({ tone: 'success', text: `${coupon.code} deleted.` })
    },
    onError: (error) => {
      setPending(null)
      setNotice({ tone: 'error', text: error.message })
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

  const filtered = Boolean(q || status)
  return (
    <>
      <title>Coupons | BuyNest Admin</title>
      <PageHeader
        title="Coupons"
        description={coupons.data ? `${formatCount(coupons.data.total)} ${filtered ? 'matching codes' : 'codes'}` : 'Discount codes for the cart'}
        actions={
          <Link to="/coupons/new" className="btn btn--primary">
            <LuPlus aria-hidden="true" /> Add coupon
          </Link>
        }
      />
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
          <label htmlFor="coupon-search" className="visually-hidden">
            Search coupons
          </label>
          <input id="coupon-search" type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Code or description" />
          <button type="submit" className="btn btn--outline">
            <LuSearch aria-hidden="true" /> Search
          </button>
        </form>
        <label className="toolbar__select">
          <span>Status</span>
          <select value={status} onChange={(event) => update({ status: event.target.value, skip: 0 })}>
            <option value="">All codes</option>
            {Object.entries(COUPON_FILTERS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {coupons.isPending && <Loading label="Loading coupons…" />}
      {coupons.error && <ErrorState error={coupons.error} onRetry={coupons.refetch} />}
      {coupons.data && coupons.data.coupons.length === 0 && <Empty>{filtered ? 'No codes match.' : 'No coupons yet.'}</Empty>}
      {coupons.data && coupons.data.coupons.length > 0 && (
        <div className="table-wrap" aria-busy={coupons.isFetching}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Discount</th>
                <th scope="col">Conditions</th>
                <th scope="col" className="num">
                  Used
                </th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {coupons.data.coupons.map((coupon) => (
                <tr key={coupon.id}>
                  <td>
                    <Link to={`/coupons/${coupon.id}`}>
                      <strong>{coupon.code}</strong>
                    </Link>
                    <br />
                    <small className="muted">{coupon.description}</small>
                  </td>
                  <td>{describeCouponValue(coupon, formatMoney)}</td>
                  <td className="muted">{conditions(coupon)}</td>
                  <td className="num">
                    {formatCount(coupon.timesUsed)}
                    {coupon.usageLimit ? ` of ${formatCount(coupon.usageLimit)}` : ''}
                  </td>
                  <td>
                    <StatusBadge {...couponStatus(coupon.status)} />
                  </td>
                  <td className="table__actions">
                      <Link to={`/coupons/${coupon.id}`} className="icon-button" aria-label={`Edit ${coupon.code}`}>
                        <LuPencil aria-hidden="true" />
                      </Link>
                      {coupon.isActive && (
                        <button type="button" className="btn btn--outline btn--sm" onClick={() => setPending({ coupon, action: 'disable' })} aria-label={`Disable ${coupon.code}`}>
                          Disable
                        </button>
                      )}
                      <button type="button" className="icon-button icon-button--danger" onClick={() => setPending({ coupon, action: 'delete' })} aria-label={`Delete ${coupon.code}`}>
                        <LuTrash2 aria-hidden="true" />
                      </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={coupons.data.total} limit={LIMIT} skip={skip} onChange={(next) => update({ skip: next })} />
        </div>
      )}

      <ConfirmDialog
        isOpen={pending !== null}
        title={pending?.action === 'delete' ? `Delete ${pending?.coupon.code}?` : `Disable ${pending?.coupon.code}?`}
        message={
          pending?.action === 'delete'
            ? 'Shoppers can no longer use it. If it was already used on orders, it is disabled instead, so those orders keep it.'
            : 'Shoppers can no longer use it. You can turn it back on from its page.'
        }
        confirmLabel={pending?.action === 'delete' ? 'Delete' : 'Disable'}
        busy={act.isPending}
        onConfirm={() => act.mutate(pending)}
        onCancel={() => setPending(null)}
      />
    </>
  )
}

export default CouponsPage
