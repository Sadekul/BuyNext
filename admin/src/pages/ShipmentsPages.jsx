import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { LuArrowLeft, LuExternalLink, LuPrinter, LuSearch } from 'react-icons/lu'
import { adminKeys, getShipment, getShipments } from '../api/admin'
import { Address } from '../components/Address'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount, formatDate, formatDateTime } from '../utils/format'
import { CARRIERS, orderStatus } from '../utils/orders'

/*
 * Sales → Shipments (docs/backend/PHASE6_CONTRACT.md §5): every parcel sent,
 * searchable by shipment, tracking, or order number, with carrier and date
 * filters in the URL. Shipments are created from an order (Ship) or the
 * order grid's mass action. Needs orders.view.
 */

const LIMIT = 20

function Tracking({ shipment }) {
  if (!shipment.trackingNumber) return <span className="muted">No tracking number</span>
  if (!shipment.trackingUrl) return shipment.trackingNumber
  return (
    <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="external-link">
      {shipment.trackingNumber} <LuExternalLink aria-hidden="true" />
      <span className="visually-hidden"> (track with {shipment.carrierLabel}, opens in a new tab)</span>
    </a>
  )
}

export function ShipmentsPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const carrier = params.get('carrier') ?? ''
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const skip = Number(params.get('skip')) || 0
  const [draft, setDraft] = useState(q)
  const query = { q, carrier, from, to, skip, limit: LIMIT }
  const list = useQuery({ queryKey: adminKeys.shipments(query), queryFn: ({ signal }) => getShipments(query, { signal }), placeholderData: keepPreviousData })

  function update(changes) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === '' || value === 0) next.delete(key)
      else next.set(key, String(value))
    }
    setParams(next)
  }

  const filtered = Boolean(q || carrier || from || to)
  return (
    <>
      <title>Shipments | BuyNest Admin</title>
      <PageHeader title="Shipments" description={list.data ? `${formatCount(list.data.total)} ${filtered ? 'matching shipments' : 'shipments'}` : 'Parcels sent to customers'} />
      <div className="toolbar">
        <form
          role="search"
          className="toolbar__search"
          onSubmit={(event) => {
            event.preventDefault()
            update({ q: draft.trim(), skip: 0 })
          }}
        >
          <label htmlFor="shipment-search" className="visually-hidden">
            Search shipments
          </label>
          <input id="shipment-search" type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Shipment, tracking, or order number" />
          <button type="submit" className="btn btn--outline">
            <LuSearch aria-hidden="true" /> Search
          </button>
        </form>
        <label className="toolbar__select">
          <span>Carrier</span>
          <select value={carrier} onChange={(event) => update({ carrier: event.target.value, skip: 0 })}>
            <option value="">All carriers</option>
            {Object.entries(CARRIERS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar__select">
          <span>Shipped from</span>
          <input type="date" value={from} max={to || undefined} onChange={(event) => update({ from: event.target.value, skip: 0 })} />
        </label>
        <label className="toolbar__select">
          <span>Shipped to</span>
          <input type="date" value={to} min={from || undefined} onChange={(event) => update({ to: event.target.value, skip: 0 })} />
        </label>
      </div>
      {list.isPending && <Loading label="Loading shipments…" />}
      {list.error && <ErrorState error={list.error} onRetry={list.refetch} />}
      {list.data && list.data.shipments.length === 0 && <Empty>{filtered ? 'No shipments match.' : 'No shipments yet. Ship an order from its page or the order grid.'}</Empty>}
      {list.data && list.data.shipments.length > 0 && (
        <div className="table-wrap" aria-busy={list.isFetching}>
          <table className="table">
            <caption className="visually-hidden">Shipments</caption>
            <thead>
              <tr>
                <th scope="col">Shipment</th>
                <th scope="col">Order</th>
                <th scope="col">Customer</th>
                <th scope="col">Date</th>
                <th scope="col">Carrier</th>
                <th scope="col">Tracking</th>
                <th scope="col" className="num">
                  Items
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.shipments.map((shipment) => (
                <tr key={shipment.number}>
                  <td>
                    <Link to={`/shipments/${shipment.number}`}>{shipment.number}</Link>
                  </td>
                  <td>{shipment.orderNumber && <Link to={`/orders/${shipment.orderNumber}`}>{shipment.orderNumber}</Link>}</td>
                  <td>
                    {shipment.order?.customerName || shipment.order?.email || '—'}
                    {shipment.order?.shipTo && <small className="muted"> · {shipment.order.shipTo}</small>}
                  </td>
                  <td>{formatDate(shipment.createdAt)}</td>
                  <td>{shipment.carrierLabel}</td>
                  <td>
                    <Tracking shipment={shipment} />
                  </td>
                  <td className="num">{shipment.itemCount === null ? '—' : formatCount(shipment.itemCount)}</td>
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

export function ShipmentDetailPage() {
  const { number } = useParams()
  const shipment = useQuery({ queryKey: adminKeys.shipment(number), queryFn: ({ signal }) => getShipment(number, { signal }) })
  if (shipment.isPending) return <Loading label="Loading the shipment…" />
  if (shipment.error) return <ErrorState error={shipment.error} onRetry={shipment.refetch} />
  const data = shipment.data
  return (
    <>
      <title>{`Shipment ${data.number} | BuyNest Admin`}</title>
      <Link to="/shipments" className="back-link">
        <LuArrowLeft aria-hidden="true" /> Shipments
      </Link>
      <PageHeader
        title={`Shipment ${data.number}`}
        description={`${data.carrierLabel} · ${formatDateTime(data.createdAt)}${data.adminName ? ` · by ${data.adminName}` : ''}`}
        actions={
          data.orderNumber && (
            <>
              <Link to={`/print/packing-slips?orders=${data.orderNumber}`} className="btn btn--outline">
                <LuPrinter aria-hidden="true" /> Packing slip
              </Link>
              <Link to={`/orders/${data.orderNumber}`} className="btn btn--outline">
                Order {data.orderNumber}
              </Link>
            </>
          )
        }
      />
      <div className="panels">
        <section className="panel panel--wide" aria-labelledby="shipment-items">
          <h2 id="shipment-items" className="panel__title">
            Items in this parcel
          </h2>
          {data.items?.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">SKU</th>
                  <th scope="col" className="num">
                    Qty
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item, index) => (
                  <tr key={`${item.sku}-${index}`}>
                    <td>
                      {item.name}
                      {item.variantLabel && <small className="muted"> · {item.variantLabel}</small>}
                    </td>
                    <td>{item.sku}</td>
                    <td className="num">{formatCount(item.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted documents">Every item of the order.</p>
          )}
        </section>
        <section className="panel" aria-labelledby="shipment-tracking">
          <h2 id="shipment-tracking" className="panel__title">
            Tracking
          </h2>
          <dl className="details">
            <dt>Carrier</dt>
            <dd>{data.carrierLabel}</dd>
            <dt>Tracking number</dt>
            <dd>
              <Tracking shipment={data} />
            </dd>
            {data.note && (
              <>
                <dt>Note</dt>
                <dd>{data.note}</dd>
              </>
            )}
          </dl>
        </section>
        {data.order && (
          <section className="panel" aria-labelledby="shipment-order">
            <h2 id="shipment-order" className="panel__title">
              Order
            </h2>
            <dl className="details">
              <dt>Order</dt>
              <dd>
                <Link to={`/orders/${data.order.number}`}>{data.order.number}</Link> {data.order.status && <StatusBadge {...orderStatus(data.order.status)} />}
              </dd>
              {data.order.customerName && (
                <>
                  <dt>Customer</dt>
                  <dd>
                    {data.order.customerName}
                    {data.order.email && <span className="muted"> · {data.order.email}</span>}
                  </dd>
                </>
              )}
              {data.order.shippingAddress && (
                <>
                  <dt>Ship to</dt>
                  <dd>
                    <Address address={data.order.shippingAddress} />
                  </dd>
                </>
              )}
              {data.order.shippingMethod && (
                <>
                  <dt>Method</dt>
                  <dd>{data.order.shippingMethod}</dd>
                </>
              )}
            </dl>
          </section>
        )}
      </div>
    </>
  )
}
