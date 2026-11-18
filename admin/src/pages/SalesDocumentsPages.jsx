import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { LuArrowLeft, LuFileDown, LuSearch } from 'react-icons/lu'
import { adminKeys, getCreditMemo, getCreditMemos, getInvoice, getInvoices } from '../api/admin'
// Phase 10 §2: the PDF of each document.
import { creditMemoPdfUrl, invoicePdfUrl } from '../api/phase10'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount, formatDate, formatDateTime, formatMoney } from '../utils/format'
// Phase 11 §4: points on credit memos.
import { formatPoints } from '../utils/rewards'

/*
 * Sales → Invoices and Credit memos (real orders only, docs/backend/PHASE3_CONTRACT.md).
 * Lists search by document or order number; the search and page live in the URL.
 */

const LIMIT = 20
// Phase 8: invoices no admin created were recorded by Stripe's webhook ("Paid by card through Stripe.").
/**
 * Phase 10 §2: "Download PDF", the document as the server renders it (a
 * plain download link: the browser sends the admin session cookie).
 */
export function PdfLink({ href, name, small = false }) {
  return (
    <a href={href} className={`btn btn--outline${small ? ' btn--sm' : ''}`} download>
      <LuFileDown aria-hidden="true" /> Download PDF <span className="visually-hidden">of {name}</span>
    </a>
  )
}

const invoiceAuthor = (invoice) => invoice.adminName ?? (/Stripe/.test(invoice.note ?? '') ? 'Stripe' : 'System')

function useListParams() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const skip = Number(params.get('skip')) || 0
  function update(changes) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === '' || value === 0) next.delete(key)
      else next.set(key, String(value))
    }
    setParams(next)
  }
  return { q, skip, update }
}

function SearchBar({ id, label, placeholder, q, onSearch }) {
  const [draft, setDraft] = useState(q)
  return (
    <div className="toolbar">
      <form
        role="search"
        className="toolbar__search"
        onSubmit={(event) => {
          event.preventDefault()
          onSearch(draft.trim())
        }}
      >
        <label htmlFor={id} className="visually-hidden">
          {label}
        </label>
        <input id={id} type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={placeholder} />
        <button type="submit" className="btn btn--outline">
          <LuSearch aria-hidden="true" /> Search
        </button>
      </form>
    </div>
  )
}

export function InvoicesPage() {
  const { q, skip, update } = useListParams()
  const query = { q, skip, limit: LIMIT }
  const list = useQuery({ queryKey: adminKeys.invoices(query), queryFn: ({ signal }) => getInvoices(query, { signal }), placeholderData: keepPreviousData })
  return (
    <>
      <title>Invoices | BuyNest Admin</title>
      <PageHeader title="Invoices" description={list.data ? `${formatCount(list.data.total)} ${q ? 'matching invoices' : 'invoices'}` : 'Payments recorded on orders'} />
      <SearchBar id="invoice-search" label="Search invoices" placeholder="Invoice or order number" q={q} onSearch={(value) => update({ q: value, skip: 0 })} />
      {list.isPending && <Loading label="Loading invoices…" />}
      {list.error && <ErrorState error={list.error} onRetry={list.refetch} />}
      {list.data && list.data.invoices.length === 0 && <Empty>{q ? 'No invoices match.' : 'No invoices yet. Invoice an order from its page.'}</Empty>}
      {list.data && list.data.invoices.length > 0 && (
        <div className="table-wrap" aria-busy={list.isFetching}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Invoice</th>
                <th scope="col">Order</th>
                <th scope="col">Date</th>
                <th scope="col">By</th>
                <th scope="col" className="num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.invoices.map((invoice) => (
                <tr key={invoice.number}>
                  <td>
                    <Link to={`/invoices/${invoice.number}`}>{invoice.number}</Link>
                  </td>
                  <td>{invoice.orderNumber && <Link to={`/orders/${invoice.orderNumber}`}>{invoice.orderNumber}</Link>}</td>
                  <td>{formatDate(invoice.createdAt)}</td>
                  <td className="muted">{invoiceAuthor(invoice)}</td>
                  <td className="num">{formatMoney(invoice.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={list.data.total} limit={LIMIT} skip={skip} onChange={(next) => update({ skip: next })} />
        </div>
      )}
    </>
  )
}

function Address({ address }) {
  if (!address) return null
  return (
    <address className="address">
      {address.firstName} {address.lastName}
      <br />
      {address.line1}
      {address.line2 && (
        <>
          <br />
          {address.line2}
        </>
      )}
      <br />
      {address.city}, {address.state} {address.postalCode}
      <br />
      {address.country}
    </address>
  )
}

export function InvoiceDetailPage() {
  const { number } = useParams()
  const invoice = useQuery({ queryKey: adminKeys.invoice(number), queryFn: ({ signal }) => getInvoice(number, { signal }) })
  if (invoice.isPending) return <Loading label="Loading the invoice…" />
  if (invoice.error) return <ErrorState error={invoice.error} onRetry={invoice.refetch} />
  const data = invoice.data
  return (
    <>
      <title>{`Invoice ${data.number} | BuyNest Admin`}</title>
      <Link to="/invoices" className="back-link">
        <LuArrowLeft aria-hidden="true" /> Invoices
      </Link>
      <PageHeader
        title={`Invoice ${data.number}`}
        description={`${formatMoney(data.amount)} · ${formatDateTime(data.createdAt)} · by ${invoiceAuthor(data)}`}
        actions={
          <>
            <PdfLink href={invoicePdfUrl(data.number)} name={`invoice ${data.number}`} />
            {data.orderNumber && (
              <Link to={`/orders/${data.orderNumber}`} className="btn btn--outline">
                Order {data.orderNumber}
              </Link>
            )}
          </>
        }
      />
      <div className="panels">
        <section className="panel panel--wide" aria-labelledby="invoice-lines">
          <h2 id="invoice-lines" className="panel__title">
            Items
          </h2>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="num">
                  Price
                </th>
                <th scope="col" className="num">
                  Qty
                </th>
                <th scope="col" className="num">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {(data.items ?? []).map((item, index) => (
                <tr key={`${item.sku}-${index}`}>
                  <td>
                    {item.title} {item.variantLabel && `(${item.variantLabel}) `}<small className="muted">· {item.sku}</small>
                  </td>
                  <td className="num">{formatMoney(item.salePrice)}</td>
                  <td className="num">{formatCount(item.quantity)}</td>
                  <td className="num">{formatMoney(item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
            {data.totals && (
              <tfoot>
                <tr>
                  <th scope="row" colSpan={3}>
                    Subtotal
                  </th>
                  <td className="num">{formatMoney(data.totals.subtotal)}</td>
                </tr>
                {data.totals.discount > 0 && (
                  <tr>
                    <th scope="row" colSpan={3}>
                      Discount
                    </th>
                    <td className="num">−{formatMoney(data.totals.discount)}</td>
                  </tr>
                )}
                <tr>
                  <th scope="row" colSpan={3}>
                    Shipping
                  </th>
                  <td className="num">{formatMoney(data.totals.shipping)}</td>
                </tr>
                <tr>
                  <th scope="row" colSpan={3}>
                    Tax
                  </th>
                  <td className="num">{formatMoney(data.totals.tax)}</td>
                </tr>
                <tr>
                  <th scope="row" colSpan={3}>
                    Invoiced
                  </th>
                  <td className="num">
                    <strong>{formatMoney(data.amount)}</strong>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </section>
        <section className="panel" aria-labelledby="invoice-bill-to">
          <h2 id="invoice-bill-to" className="panel__title">
            Bill to
          </h2>
          <dl className="details">
            <dt>Address</dt>
            <dd>
              <Address address={data.billingAddress} />
            </dd>
            {data.note && (
              <>
                <dt>Note</dt>
                <dd>{data.note}</dd>
              </>
            )}
          </dl>
        </section>
      </div>
    </>
  )
}

const restockBadge = (restocked) => (restocked ? { tone: 'info', label: 'Returned to stock' } : { tone: 'neutral', label: 'Not restocked' })

export function CreditMemosPage() {
  const { q, skip, update } = useListParams()
  const query = { q, skip, limit: LIMIT }
  const list = useQuery({ queryKey: adminKeys.creditMemos(query), queryFn: ({ signal }) => getCreditMemos(query, { signal }), placeholderData: keepPreviousData })
  return (
    <>
      <title>Credit memos | BuyNest Admin</title>
      <PageHeader title="Credit memos" description={list.data ? `${formatCount(list.data.total)} ${q ? 'matching refunds' : 'refunds'}` : 'Refunds recorded on orders'} />
      <p className="muted page-note">Payment providers aren't connected yet: each credit memo records money returned by the original payment method.</p>
      <SearchBar id="memo-search" label="Search credit memos" placeholder="Credit memo or order number" q={q} onSearch={(value) => update({ q: value, skip: 0 })} />
      {list.isPending && <Loading label="Loading credit memos…" />}
      {list.error && <ErrorState error={list.error} onRetry={list.refetch} />}
      {list.data && list.data.creditMemos.length === 0 && <Empty>{q ? 'No credit memos match.' : 'No refunds yet. Refund an order from its page.'}</Empty>}
      {list.data && list.data.creditMemos.length > 0 && (
        <div className="table-wrap" aria-busy={list.isFetching}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Credit memo</th>
                <th scope="col">Order</th>
                <th scope="col">Date</th>
                <th scope="col">Stock</th>
                <th scope="col" className="num">
                  Refunded
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.creditMemos.map((memo) => (
                <tr key={memo.number}>
                  <td>
                    <Link to={`/credit-memos/${memo.number}`}>{memo.number}</Link>
                  </td>
                  <td>{memo.orderNumber && <Link to={`/orders/${memo.orderNumber}`}>{memo.orderNumber}</Link>}</td>
                  <td>{formatDate(memo.createdAt)}</td>
                  <td>
                    <StatusBadge {...restockBadge(memo.restocked)} />
                  </td>
                  <td className="num">{formatMoney(memo.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={list.data.total} limit={LIMIT} skip={skip} onChange={(next) => update({ skip: next })} />
        </div>
      )}
    </>
  )
}

export function CreditMemoDetailPage() {
  const { number } = useParams()
  const memo = useQuery({ queryKey: adminKeys.creditMemo(number), queryFn: ({ signal }) => getCreditMemo(number, { signal }) })
  if (memo.isPending) return <Loading label="Loading the credit memo…" />
  if (memo.error) return <ErrorState error={memo.error} onRetry={memo.refetch} />
  const data = memo.data
  return (
    <>
      <title>{`Credit memo ${data.number} | BuyNest Admin`}</title>
      <Link to="/credit-memos" className="back-link">
        <LuArrowLeft aria-hidden="true" /> Credit memos
      </Link>
      <PageHeader
        title={`Credit memo ${data.number}`}
        description={`${formatMoney(data.total)} refunded · ${formatDateTime(data.createdAt)}${data.adminName ? ` · by ${data.adminName}` : ''}`}
        actions={
          <>
            <StatusBadge {...restockBadge(data.restocked)} />
            <PdfLink href={creditMemoPdfUrl(data.number)} name={`credit memo ${data.number}`} />
            {data.orderNumber && (
              <Link to={`/orders/${data.orderNumber}`} className="btn btn--outline">
                Order {data.orderNumber}
              </Link>
            )}
          </>
        }
      />
      <div className="panels">
        <section className="panel panel--wide" aria-labelledby="memo-lines">
          <h2 id="memo-lines" className="panel__title">
            Refunded
          </h2>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="num">
                  Qty
                </th>
                <th scope="col" className="num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    No items: shipping or an amount only.
                  </td>
                </tr>
              )}
              {data.items.map((item, index) => (
                <tr key={`${item.sku}-${index}`}>
                  <td>
                    {item.name} {item.variantLabel && `(${item.variantLabel}) `}{item.sku && <small className="muted">· {item.sku}</small>}
                  </td>
                  <td className="num">{formatCount(item.quantity)}</td>
                  <td className="num">{formatMoney(item.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>
                  Items
                </th>
                <td className="num">{formatMoney(data.subtotal ?? 0)}</td>
              </tr>
              <tr>
                <th scope="row" colSpan={2}>
                  Shipping refund
                </th>
                <td className="num">{formatMoney(data.shippingRefund)}</td>
              </tr>
              <tr>
                <th scope="row" colSpan={2}>
                  Adjustment
                </th>
                <td className="num">{data.adjustment < 0 ? `−${formatMoney(-data.adjustment)} (fee kept)` : formatMoney(data.adjustment)}</td>
              </tr>
              <tr>
                <th scope="row" colSpan={2}>
                  Total refunded
                </th>
                <td className="num">
                  <strong>{formatMoney(data.total)}</strong>
                </td>
              </tr>
              {/* Phase 11 §4: points went back first; earned points were taken back. */}
              {data.rewardPointsReturned > 0 && (
                <tr>
                  <th scope="row" colSpan={2}>
                    Returned as reward points ({formatPoints(data.rewardPointsReturned)})
                  </th>
                  <td className="num">{formatMoney(data.rewardPointsRefund ?? 0)}</td>
                </tr>
              )}
              {data.rewardPointsReversed > 0 && (
                <tr>
                  <th scope="row" colSpan={2}>
                    Earned points taken back
                  </th>
                  <td className="num">{formatPoints(data.rewardPointsReversed)}</td>
                </tr>
              )}
              {/* Phase 10 §5: the part that went back to a gift card first, and the rest. */}
              {data.giftCardRefund > 0 && (
                <tr>
                  <th scope="row" colSpan={2}>
                    Returned to gift card
                  </th>
                  <td className="num">{formatMoney(data.giftCardRefund)}</td>
                </tr>
              )}
              {(data.giftCardRefund > 0 || data.rewardPointsRefund > 0) && (
                <tr>
                  <th scope="row" colSpan={2}>
                    Refunded by the other payment method
                  </th>
                  <td className="num">{formatMoney(data.otherRefund ?? Math.round((data.total - (data.giftCardRefund ?? 0) - (data.rewardPointsRefund ?? 0)) * 100) / 100)}</td>
                </tr>
              )}
            </tfoot>
          </table>
          {data.note && <p className="muted page-note">Note: {data.note}</p>}
        </section>
      </div>
    </>
  )
}
