import { Fragment } from 'react'
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
import { formatDate, formatNumber, moneyFormatter } from '../utils/formatters'
import { translate } from '../i18n'
import './InvoicePage.css'
import { addressPlaceLines } from '../utils/bangladesh'
import { useAddressPlaces } from '../hooks/useAddressPlaces'
import { useTranslation } from 'react-i18next'

function Address({ address }) {
  // Phase 14: a Bangladesh address's places in the reader's language.
  const withPlaces = useAddressPlaces(address ? [address] : [])
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
      {/* Phase 14: a Bangladesh address shows its area, district and division in the reader's language. */}
      {addressPlaceLines(withPlaces(address)).map((line) => (
        <Fragment key={line}>
          <br />
          {line}
        </Fragment>
      ))}
      <br />
      {translate(`common:countries.${address.country}`, { defaultValue: address.country })}
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
  const { t } = useTranslation('orders')
  const { orderId, invoiceNumber } = useParams()
  const { user, authorizedRequest } = useAuth()
  const request = useQuery(invoiceQuery(user.id, orderId, invoiceNumber, authorizedRequest))
  const backLink = (
    <Link to={ROUTES.orderDetails(orderId)} className="invoice-page__back">
      <LuArrowLeft aria-hidden="true" /> {t('list.order', { number: orderId })}
    </Link>
  )

  if (request.isPending) {
    return (
      <div className="section container">
        <Loader label={t('invoice.loading')} />
      </div>
    )
  }
  if (request.error?.status === 404) {
    return (
      <div className="section container">
        <EmptyState icon={LuFileX} title={t('invoice.notFound')} message={t('invoice.notFoundMessage')}>
          <Button to={ROUTES.orders}>{t('invoice.back')}</Button>
        </EmptyState>
      </div>
    )
  }
  if (request.error) {
    return (
      <div className="section container">
        <ErrorMessage title={t('invoice.failed')} message={request.error.message} onRetry={() => request.refetch()} />
      </div>
    )
  }

  const invoice = request.data
  const { totals } = invoice
  // Phase 12: the invoice in its order's currency (older orders: USD), not today's store currency.
  const formatBasePrice = moneyFormatter(invoice.currency)
  return (
    <div className="invoice-page section container">
      <title>{`${t('view.invoiceNumber', { number: invoice.number })} | ${SITE.name}`}</title>
      <div className="invoice-page__actions">
        {backLink}
        <div className="invoice-page__buttons">
          {/* Phase 10: the store's own PDF, made by the server. */}
          <InvoicePdfButton orderNumber={orderId} invoiceNumber={invoice.number} />
          <Button onClick={() => window.print()} variant="outline">
            <LuPrinter aria-hidden="true" /> {t('invoice.print')}
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
            <h1 id="invoice-title">{t('view.invoiceNumber', { number: invoice.number })}</h1>
            <dl>
              <div>
                <dt>{t('invoice.date')}</dt>
                <dd>{formatDate(invoice.createdAt)}</dd>
              </div>
              <div>
                <dt>{t('invoice.order')}</dt>
                <dd>{invoice.orderNumber}</dd>
              </div>
            </dl>
          </div>
        </header>

        <section aria-labelledby="invoice-bill-to">
          <h2 id="invoice-bill-to" className="invoice__subheading">
            {t('invoice.billTo')}
          </h2>
          <Address address={invoice.billingAddress} />
        </section>

        <table className="invoice__table">
          <caption className="visually-hidden">{t('invoice.caption', { number: invoice.number })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('invoice.item')}</th>
              <th scope="col" className="invoice__num">
                {t('invoice.qty')}
              </th>
              <th scope="col" className="invoice__num">
                {t('invoice.unitPrice')}
              </th>
              <th scope="col" className="invoice__num">
                {t('invoice.amount')}
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
                <td className="invoice__num">{formatNumber(item.quantity)}</td>
                <td className="invoice__num">{formatBasePrice(item.salePrice)}</td>
                <td className="invoice__num">{formatBasePrice(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>
                {t('invoice.subtotal')}
              </th>
              <td className="invoice__num">{formatBasePrice(totals.subtotal)}</td>
            </tr>
            {totals.discount > 0 && (
              <tr>
                <th scope="row" colSpan={3}>
                  {t('invoice.discount')}
                </th>
                <td className="invoice__num">−{formatBasePrice(totals.discount)}</td>
              </tr>
            )}
            <tr>
              <th scope="row" colSpan={3}>
                {t('invoice.shipping')}
              </th>
              <td className="invoice__num">{totals.shipping === 0 ? t('invoice.free') : formatBasePrice(totals.shipping)}</td>
            </tr>
            <tr>
              <th scope="row" colSpan={3}>
                {t('invoice.tax')}
              </th>
              <td className="invoice__num">{formatBasePrice(totals.tax)}</td>
            </tr>
            <tr className="invoice__total">
              <th scope="row" colSpan={3}>
                {t('invoice.total')}
              </th>
              <td className="invoice__num">{formatBasePrice(totals.total)}</td>
            </tr>
            <tr>
              <th scope="row" colSpan={3}>
                {t('invoice.paid')}
              </th>
              <td className="invoice__num">{formatBasePrice(invoice.amount)}</td>
            </tr>
          </tfoot>
        </table>

        <p className="invoice__muted">{t('invoice.thanks', { store: SITE.name, email: SITE.supportEmail })}</p>
      </article>
    </div>
  )
}

export default InvoicePage
