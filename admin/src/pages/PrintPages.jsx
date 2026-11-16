import { Link, useSearchParams } from 'react-router'
import { useQueries } from '@tanstack/react-query'
import { LuArrowLeft, LuPrinter } from 'react-icons/lu'
import { adminKeys, getInvoice, getOrder, getPackingSlip } from '../api/admin'
import { Address } from '../components/Address'
import { ErrorState, Loading } from '../components/States'
import { formatCount, formatDate, formatMoney } from '../utils/format'

/*
 * Print pages for one or more orders (?orders=BN-100001,BN-100002), opened
 * from the order grid's mass actions, an order, or a shipment. Each document
 * starts on a new sheet; the admin's sidebar and buttons don't print
 * (admin.css @media print). Built from the existing data: the packing slip
 * endpoint, and each order's invoices.
 */

const MAX_ORDERS = 100
function useOrderNumbers() {
  const [params] = useSearchParams()
  return [...new Set((params.get('orders') ?? '').split(',').map((number) => number.trim().toUpperCase()))].filter((number) => /^BN-\d{1,12}$/.test(number)).slice(0, MAX_ORDERS)
}

function PrintBar({ title, count, ready, back }) {
  return (
    <div className="print-bar no-print">
      <Link to={back} className="back-link">
        <LuArrowLeft aria-hidden="true" /> Back
      </Link>
      <h1>{title}</h1>
      <p className="muted">{ready ? `${formatCount(count)} ${count === 1 ? 'document' : 'documents'} ready to print.` : 'Getting the documents ready…'}</p>
      <button type="button" className="btn btn--primary" disabled={!ready || count === 0} onClick={() => window.print()}>
        <LuPrinter aria-hidden="true" /> Print
      </button>
    </div>
  )
}

const backTo = (numbers) => (numbers.length === 1 ? `/orders/${numbers[0]}` : '/orders')

/** Packing slips: what is in the parcel and where it goes. No prices. */
export function PackingSlipsPrintPage() {
  const numbers = useOrderNumbers()
  const slips = useQueries({ queries: numbers.map((number) => ({ queryKey: adminKeys.packingSlip(number), queryFn: ({ signal }) => getPackingSlip(number, { signal }) })) })
  const ready = slips.every((slip) => !slip.isPending)
  const loaded = slips.filter((slip) => slip.data)
  const failed = slips.map((slip, index) => ({ slip, number: numbers[index] })).filter(({ slip }) => slip.error)
  return (
    <>
      <title>Packing slips | BuyNest Admin</title>
      <PrintBar title={numbers.length === 1 ? `Packing slip for ${numbers[0]}` : 'Packing slips'} count={loaded.length} ready={ready} back={backTo(numbers)} />
      {numbers.length === 0 && <p className="state">Choose orders to print from the order grid.</p>}
      {!ready && <Loading label="Loading the packing slips…" />}
      {failed.map(({ slip, number }) => (
        <div key={number} className="no-print">
          <p className="muted">{number}:</p>
          <ErrorState error={slip.error} onRetry={slip.refetch} />
        </div>
      ))}
      {loaded.map(({ data }) => (
        <article key={data.orderNumber} className="print-doc" aria-labelledby={`slip-${data.orderNumber}`}>
          <header className="print-doc__header">
            <div>
              <p className="print-doc__store">{data.storeName ?? 'BuyNest'}</p>
              {data.storeAddress && <p className="muted">{data.storeAddress}</p>}
            </div>
            <div>
              <h2 id={`slip-${data.orderNumber}`}>Packing slip</h2>
              <p>
                Order <strong>{data.orderNumber}</strong>
                <br />
                Placed {formatDate(data.placedAt)}
                {data.shippingMethod && (
                  <>
                    <br />
                    {data.shippingMethod}
                  </>
                )}
              </p>
            </div>
          </header>
          <div className="print-doc__section">
            <h3>Ship to</h3>
            <Address address={data.shippingAddress} />
            {data.phone && <p className="muted">{data.phone}</p>}
          </div>
          <table className="table print-doc__table">
            <caption className="visually-hidden">Items in order {data.orderNumber}</caption>
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
          {data.shipments?.length > 0 && (
            <p className="muted">
              Shipments: {data.shipments.map((shipment) => [shipment.number, shipment.carrierLabel, shipment.trackingNumber].filter(Boolean).join(' · ')).join('; ')}
            </p>
          )}
        </article>
      ))}
    </>
  )
}

/** Invoices of the selected orders (orders not invoiced yet are listed, not printed). */
export function InvoicesPrintPage() {
  const numbers = useOrderNumbers()
  const orders = useQueries({ queries: numbers.map((number) => ({ queryKey: adminKeys.order(number), queryFn: ({ signal }) => getOrder(number, { signal }) })) })
  const invoiceNumbers = orders.flatMap((order) => (order.data?.invoices ?? []).map((invoice) => invoice.number))
  const invoices = useQueries({ queries: invoiceNumbers.map((number) => ({ queryKey: adminKeys.invoice(number), queryFn: ({ signal }) => getInvoice(number, { signal }) })) })
  const ready = orders.every((order) => !order.isPending) && invoices.every((invoice) => !invoice.isPending)
  const notInvoiced = orders.filter((order) => order.data && (order.data.invoices ?? []).length === 0).map((order) => order.data.number)
  const loaded = invoices.filter((invoice) => invoice.data)
  const failed = [...orders, ...invoices].filter((query) => query.error)
  return (
    <>
      <title>Invoices | BuyNest Admin</title>
      <PrintBar title={numbers.length === 1 ? `Invoices for ${numbers[0]}` : 'Invoices'} count={loaded.length} ready={ready} back={backTo(numbers)} />
      {numbers.length === 0 && <p className="state">Choose orders to print from the order grid.</p>}
      {!ready && <Loading label="Loading the invoices…" />}
      {ready && notInvoiced.length > 0 && <p className="notice no-print">Not invoiced yet, so not printed: {notInvoiced.join(', ')}.</p>}
      {failed.map((query, index) => (
        <div key={index} className="no-print">
          <ErrorState error={query.error} onRetry={query.refetch} />
        </div>
      ))}
      {loaded.map(({ data }) => (
        <article key={data.number} className="print-doc" aria-labelledby={`invoice-${data.number}`}>
          <header className="print-doc__header">
            <p className="print-doc__store">BuyNest</p>
            <div>
              <h2 id={`invoice-${data.number}`}>Invoice {data.number}</h2>
              <p>
                Order <strong>{data.orderNumber}</strong>
                <br />
                {formatDate(data.createdAt)}
              </p>
            </div>
          </header>
          {data.billingAddress && (
            <div className="print-doc__section">
              <h3>Bill to</h3>
              <Address address={data.billingAddress} />
            </div>
          )}
          <table className="table print-doc__table">
            <caption className="visually-hidden">Items on invoice {data.number}</caption>
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
                    {item.title}
                    {item.variantLabel && <small className="muted"> · {item.variantLabel}</small>}
                    <small className="muted"> · {item.sku}</small>
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
                    Total paid
                  </th>
                  <td className="num">
                    <strong>{formatMoney(data.amount)}</strong>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </article>
      ))}
    </>
  )
}
