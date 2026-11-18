import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { LuArrowLeft, LuFileX, LuPrinter } from 'react-icons/lu'
import Button from '../components/ui/Button'
import InvoicePdfButton from '../components/orders/InvoicePdfButton'
import EmptyState from '../components/ui/EmptyState'
import ErrorMessage from '../components/ui/ErrorMessage'
import Loader from '../components/ui/Loader'
import { useAuth } from '../hooks/useAuth'
import { invoiceQuery } from '../queries/orderQueries'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import { formatDate, formatBasePrice } from '../utils/formatters'
import './InvoicePage.css'

function Address({ address }) {
  if (!address) return null
  return (
    <address className="invoice__address">
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

/**
 * /account/orders/:orderId/invoices/:invoiceNumber (BuyNest's API, the
 * customer's own orders only). A plain page the browser prints, or saves as
 * PDF from its print dialog: the print stylesheet (InvoicePage.css) hides
 * the site header, footer, and buttons. No PDF library needed.
 */
function InvoicePage() {
  const { orderId, invoiceNumber } = useParams()
  const { user, authorizedRequest } = useAuth()
  const request = useQuery(invoiceQuery(user.id, orderId, invoiceNumber, authorizedRequest))
  const backLink = (
    <Link to={ROUTES.orderDetails(orderId)} className="invoice-page__back">
      <LuArrowLeft aria-hidden="true" /> Order {orderId}
    </Link>
  )

  if (request.isPending) {
    return (
      <div className="section container">
        <Loader label="Loading the invoice…" />
      </div>
    )
  }
  if (request.error?.status === 404) {
    return (
      <div className="section container">
        <EmptyState icon={LuFileX} title="Invoice not found" message="This invoice doesn't exist or belongs to another account.">
          <Button to={ROUTES.orders}>Back to orders</Button>
        </EmptyState>
      </div>
    )
  }
  if (request.error) {
    return (
      <div className="section container">
        <ErrorMessage title="We couldn't load this invoice" message={request.error.message} onRetry={() => request.refetch()} />
      </div>
    )
  }

  const invoice = request.data
  const { totals } = invoice
  return (
    <div className="invoice-page section container">
      <title>{`Invoice ${invoice.number} | ${SITE.name}`}</title>
      <div className="invoice-page__actions">
        {backLink}
        <div className="invoice-page__buttons">
          {/* Phase 10: the store's own PDF, made by the server. */}
          <InvoicePdfButton orderNumber={orderId} invoiceNumber={invoice.number} />
          <Button onClick={() => window.print()} variant="outline">
            <LuPrinter aria-hidden="true" /> Print
          </Button>
        </div>
      </div>

      <article className="invoice" aria-labelledby="invoice-title">
        <header className="invoice__header">
          <div>
            <p className="invoice__brand">{SITE.name}</p>
            <p className="invoice__muted">
              {SITE.supportEmail}
              <br />
              {SITE.supportPhone}
            </p>
          </div>
          <div className="invoice__meta">
            <h1 id="invoice-title">Invoice {invoice.number}</h1>
            <dl>
              <div>
                <dt>Date</dt>
                <dd>{formatDate(invoice.createdAt)}</dd>
              </div>
              <div>
                <dt>Order</dt>
                <dd>{invoice.orderNumber}</dd>
              </div>
            </dl>
          </div>
        </header>

        <section aria-labelledby="invoice-bill-to">
          <h2 id="invoice-bill-to" className="invoice__subheading">
            Bill to
          </h2>
          <Address address={invoice.billingAddress} />
        </section>

        <table className="invoice__table">
          <caption className="visually-hidden">Items on invoice {invoice.number}</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col" className="invoice__num">
                Qty
              </th>
              <th scope="col" className="invoice__num">
                Unit price
              </th>
              <th scope="col" className="invoice__num">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item, index) => (
              <tr key={`${item.sku}-${index}`}>
                <td>
                  {item.title}
                  {item.variantLabel && <span className="invoice__muted"> ({item.variantLabel})</span>}
                  {item.sku && <span className="invoice__muted"> · {item.sku}</span>}
                </td>
                <td className="invoice__num">{item.quantity}</td>
                <td className="invoice__num">{formatBasePrice(item.salePrice)}</td>
                <td className="invoice__num">{formatBasePrice(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>
                Subtotal
              </th>
              <td className="invoice__num">{formatBasePrice(totals.subtotal)}</td>
            </tr>
            {totals.discount > 0 && (
              <tr>
                <th scope="row" colSpan={3}>
                  Discount
                </th>
                <td className="invoice__num">−{formatBasePrice(totals.discount)}</td>
              </tr>
            )}
            <tr>
              <th scope="row" colSpan={3}>
                Shipping
              </th>
              <td className="invoice__num">{totals.shipping === 0 ? 'Free' : formatBasePrice(totals.shipping)}</td>
            </tr>
            <tr>
              <th scope="row" colSpan={3}>
                Tax
              </th>
              <td className="invoice__num">{formatBasePrice(totals.tax)}</td>
            </tr>
            <tr className="invoice__total">
              <th scope="row" colSpan={3}>
                Total
              </th>
              <td className="invoice__num">{formatBasePrice(totals.total)}</td>
            </tr>
            <tr>
              <th scope="row" colSpan={3}>
                Amount paid
              </th>
              <td className="invoice__num">{formatBasePrice(invoice.amount)}</td>
            </tr>
          </tfoot>
        </table>

        <p className="invoice__muted">Thank you for shopping with {SITE.name}. Questions about this invoice? Write to {SITE.supportEmail}.</p>
      </article>
    </div>
  )
}

export default InvoicePage
