import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LuArrowLeft, LuExternalLink, LuPrinter } from 'react-icons/lu'
import { adminKeys, getOrder } from '../api/admin'
import { LIVE_DATA } from '../api/mode'
import { CreateReturnDialog, InvoiceDialog, RefundDialog, ShipDialog, StatusDialog } from '../components/OrderActionDialogs'
import OrderPayment from '../components/OrderPayment'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { ErrorState, Loading } from '../components/States'
import { formatCount, formatDate, formatDateTime, formatMoney, fullName } from '../utils/format'
import { PAYMENT_METHODS, orderActions, orderSource, orderStatus, paymentStatus, providerName, returnStatus } from '../utils/orders'
// Phase 10 §2 and §5: PDFs of the documents, gift card lines.
import { creditMemoPdfUrl, invoicePdfUrl } from '../api/phase10'
import { PdfLink } from './SalesDocumentsPages'
import { useAdminAuth } from '../auth/useAdminAuth'

/** Demo: a DummyJSON cart shown as an order. */
function DemoOrderDetailPage() {
  const { orderId } = useParams()
  const order = useQuery({ queryKey: adminKeys.order(orderId), queryFn: ({ signal }) => getOrder(orderId, { signal }) })

  if (order.isPending) return <Loading label="Loading the order…" />
  if (order.error) return <ErrorState error={order.error} onRetry={order.refetch} />

  const { customer, lines, subtotal, total, items } = order.data
  return (
    <>
      <title>{`Order #${orderId} | BuyNest Admin`}</title>
      <Link to="/orders" className="back-link">
        <LuArrowLeft aria-hidden="true" /> Orders
      </Link>
      <PageHeader title={`Order #${orderId}`} description={`${formatCount(items)} items`} />

      <div className="panels">
        <section className="panel panel--wide" aria-labelledby="lines-title">
          <h2 id="lines-title" className="panel__title">
            Items
          </h2>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Product</th>
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
              {lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    <Link to={`/products/${line.id}`} className="table__product">
                      <img src={line.thumbnail} alt="" width="36" height="36" loading="lazy" />
                      <span>{line.title}</span>
                    </Link>
                  </td>
                  <td className="num">{formatMoney(line.price)}</td>
                  <td className="num">{formatCount(line.quantity)}</td>
                  <td className="num">{formatMoney(line.discountedTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>
                  Subtotal
                </th>
                <td className="num">{formatMoney(subtotal)}</td>
              </tr>
              <tr>
                <th scope="row" colSpan={3}>
                  Total after discounts
                </th>
                <td className="num">
                  <strong>{formatMoney(total)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </section>

        <section className="panel" aria-labelledby="customer-title">
          <h2 id="customer-title" className="panel__title">
            Customer
          </h2>
          <dl className="details">
            <dt>Name</dt>
            <dd>{fullName(customer) || `Customer #${customer.id}`}</dd>
            {customer.email && (
              <>
                <dt>Email</dt>
                <dd>
                  <a href={`mailto:${customer.email}`}>{customer.email}</a>
                </dd>
              </>
            )}
            {customer.phone && (
              <>
                <dt>Phone</dt>
                <dd>{customer.phone}</dd>
              </>
            )}
            {customer.city && (
              <>
                <dt>Location</dt>
                <dd>{[customer.city, customer.country].filter(Boolean).join(', ')}</dd>
              </>
            )}
          </dl>
        </section>
      </div>
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

/** The order's invoices, shipments, and credit memos. */
function Documents({ order }) {
  const { invoices = [], shipments = [], creditMemos = [], returns = [] } = order
  if (invoices.length + shipments.length + creditMemos.length + returns.length === 0) return <p className="muted documents">No invoices, shipments, returns, or refunds yet.</p>
  return (
    <div className="documents">
      {invoices.length > 0 && (
        <section aria-labelledby="doc-invoices">
          <h3 id="doc-invoices">Invoices</h3>
          <ul>
            {invoices.map((invoice) => (
              <li key={invoice.number}>
                <Link to={`/invoices/${invoice.number}`}>{invoice.number}</Link> · {formatMoney(invoice.amount)} · {formatDate(invoice.createdAt)}
                {/* Phase 8: an invoice no admin created was recorded by Stripe's webhook (phase 10: or PayPal's capture). */}
                <span className="muted"> · by {invoice.adminName ?? (['stripe', 'paypal', 'gift_card'].includes(order.payment?.provider) ? providerName(order.payment.provider) : 'System')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {shipments.length > 0 && (
        <section aria-labelledby="doc-shipments">
          <h3 id="doc-shipments">Shipments</h3>
          <ul>
            {shipments.map((shipment) => (
              <li key={shipment.number}>
                <Link to={`/shipments/${shipment.number}`}>{shipment.number}</Link> · {shipment.carrierLabel} · {formatDate(shipment.createdAt)}
                {shipment.trackingNumber && (
                  <>
                    {' · '}
                    {shipment.trackingUrl ? (
                      <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="external-link">
                        {shipment.trackingNumber} <LuExternalLink aria-hidden="true" />
                        <span className="visually-hidden"> (track with {shipment.carrierLabel}, opens in a new tab)</span>
                      </a>
                    ) : (
                      shipment.trackingNumber
                    )}
                  </>
                )}
                {shipment.note && <p className="muted">{shipment.note}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {returns.length > 0 && (
        <section aria-labelledby="doc-returns">
          <h3 id="doc-returns">Returns</h3>
          <ul>
            {returns.map((item) => (
              <li key={item.number}>
                <Link to={`/returns/${item.number}`}>{item.number}</Link> · {returnStatus(item.status).label} · {formatDate(item.createdAt)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {creditMemos.length > 0 && (
        <section aria-labelledby="doc-memos">
          <h3 id="doc-memos">Credit memos (refunds)</h3>
          <ul>
            {creditMemos.map((memo) => (
              <li key={memo.number}>
                <Link to={`/credit-memos/${memo.number}`}>{memo.number}</Link> · {formatMoney(memo.total)} · {formatDate(memo.createdAt)} ·{' '}
                {/* Phase 10 §2. */}
                <a href={creditMemoPdfUrl(memo.number)} download>
                  PDF <span className="visually-hidden">of credit memo {memo.number}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** Phase 10 §5: the cards the order issued for this line's recipient (the API lists them per order). */
const cardsFor = (order, giftCard) =>
  (order.giftCardsIssued ?? []).filter((card) => card.recipientEmail && card.recipientEmail.toLowerCase() === giftCard.recipientEmail?.toLowerCase())

/**
 * Phase 10 §5: a gift card line's recipient and message, and the cards made
 * from it once the order was paid (linked to Marketing → Gift cards).
 */
function GiftCardLine({ giftCard, cards, canView }) {
  return (
    <div className="gift-card-line">
      <p>
        For {giftCard.recipientName || 'the recipient'}
        {giftCard.recipientEmail && (
          <>
            {' '}
            &lt;<a href={`mailto:${giftCard.recipientEmail}`}>{giftCard.recipientEmail}</a>&gt;
          </>
        )}
      </p>
      {giftCard.message && <p className="muted">“{giftCard.message}”</p>}
      {cards.length > 0 ? (
        <p className="muted">
          {cards.length === 1 ? 'Card ' : 'Cards '}
          {cards.map((card, index) => (
            <span key={card.id ?? index}>
              {index > 0 && ', '}
              {canView && card.id ? <Link to={`/gift-cards/${card.id}`}>ending {card.last4}</Link> : `ending ${card.last4}`}
            </span>
          ))}{' '}
          sent to the recipient.
        </p>
      ) : (
        <p className="muted">The card is made and emailed when the order is paid.</p>
      )}
    </div>
  )
}

// Phase 8: history entries written by Stripe's webhook (payment recorded, payment page expired) have no admin.
// Phase 10: PayPal's capture and webhooks write the same kind of entries.
const byProvider = (entry) => {
  if (/through PayPal|PayPal/i.test(entry.note ?? '')) return 'PayPal'
  return /through Stripe|secure payment page expired/i.test(entry.note ?? '') ? 'Stripe' : null
}

const DIALOGS = { invoice: InvoiceDialog, ship: ShipDialog, refund: RefundDialog, return: CreateReturnDialog }

/**
 * A real order (BuyNest's API): items, customer, delivery, payment, its
 * documents, history, and the actions an admin may take (utils/orders.js
 * orderActions): Invoice records the payment, Ship the parcel, Refund a
 * credit memo; delivered and cancelled are plain status changes. Each opens
 * a dialog; afterwards the result is announced and focused.
 */
function LiveOrderDetailPage() {
  const { orderId } = useParams()
  const { can } = useAdminAuth()
  const queryClient = useQueryClient()
  const location = useLocation()
  const order = useQuery({ queryKey: adminKeys.order(orderId), queryFn: ({ signal }) => getOrder(orderId, { signal }) })
  const [dialog, setDialog] = useState(null) // 'invoice' | 'ship' | 'refund' | 'return' | 'delivered' | 'cancelled'
  // An order just created (Create order) arrives with what happened.
  const [notice, setNotice] = useState(location.state?.notice ?? null)
  const noticeRef = useRef(null)
  const openerRef = useRef(null)

  // Move focus to the result, so keyboard and screen reader users hear it and continue from there.
  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  if (order.isPending) return <Loading label="Loading the order…" />
  if (order.error) return <ErrorState error={order.error} onRetry={order.refetch} />

  const data = order.data
  // What the order allows, then what the role allows (each action has its own permission).
  const possible = orderActions(data)
  const actions = {
    invoice: possible.invoice && can('invoices.create'),
    ship: possible.ship && can('shipments.create'),
    deliver: possible.deliver && can('orders.edit'),
    refund: possible.refund && can('credit_memos.create'),
    cancel: possible.cancel && can('orders.edit'),
    // Phase 6: a return for the customer, once something was shipped.
    return: possible.return && can('returns.manage'),
  }
  const nothingToDo = !Object.values(possible).some(Boolean)
  const nothingAllowed = !nothingToDo && !Object.values(actions).some(Boolean)

  function open(name, event) {
    openerRef.current = event.currentTarget
    setNotice(null)
    setDialog(name)
  }
  function cancel() {
    setDialog(null)
    openerRef.current?.focus()
  }
  function done(message) {
    setDialog(null)
    // Everything that shows this order, its documents, stock, or totals.
    for (const key of [adminKeys.order(orderId), ['orders'], adminKeys.overview, ['invoices'], ['credit-memos'], ['shipments'], ['returns'], adminKeys.refundable(orderId), ['products'], ['product']]) {
      queryClient.invalidateQueries({ queryKey: key })
    }
    setNotice(message)
  }

  const Dialog = DIALOGS[dialog]
  return (
    <>
      <title>{`Order ${data.number} | BuyNest Admin`}</title>
      <Link to="/orders" className="back-link">
        <LuArrowLeft aria-hidden="true" /> Orders
      </Link>
      <PageHeader
        title={`Order ${data.number}`}
        description={`Placed ${formatDate(data.placedAt)} · ${formatCount(data.items)} items`}
        actions={
          <>
            <StatusBadge {...orderSource(data.source)} />
            <StatusBadge {...orderStatus(data.status)} />
            <StatusBadge {...paymentStatus(data.paymentStatus)} />
          </>
        }
      />
      {/* Always rendered, so the announcement is heard. */}
      <div role="status">
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className="notice notice--success">
            {notice}
          </p>
        )}
      </div>

      <div className="panels">
        <section className="panel panel--wide" aria-labelledby="lines-title">
          <h2 id="lines-title" className="panel__title">
            Items
          </h2>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Product</th>
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
              {data.lines.map((line, index) => (
                // Two variants of one product are two lines with the same product id: the key needs the SKU and position too.
                <tr key={`${line.id ?? 'deleted'}-${line.sku}-${index}`}>
                  <td>
                    {/* The order keeps a copy of each product; a deleted product has no page any more. */}
                    {line.id ? (
                      <Link to={`/products/${line.id}`} className="table__product">
                        <img src={line.thumbnail} alt="" width="36" height="36" loading="lazy" />
                        <span>
                          {line.title}
                          <small>{line.variantLabel ? `${line.variantLabel} · ${line.sku}` : line.sku}</small>
                        </span>
                      </Link>
                    ) : (
                      <span className="table__product">
                        <span>
                          {line.title}
                          <small>{line.variantLabel ? `${line.variantLabel} · ` : ''}{line.sku} · no longer in the catalog</small>
                        </span>
                      </span>
                    )}
                    {/* Phase 10 §5: a gift card bought for someone: who receives it, and the cards made once paid. */}
                    {line.giftCard && <GiftCardLine giftCard={line.giftCard} cards={cardsFor(data, line.giftCard)} canView={can('gift_cards.view')} />}
                  </td>
                  <td className="num">{formatMoney(line.price)}</td>
                  <td className="num">{formatCount(line.quantity)}</td>
                  <td className="num">{formatMoney(line.discountedTotal)}</td>
                </tr>
              ))}
            </tbody>
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
                    Discount{data.couponCode && ` (${data.couponCode})`}
                  </th>
                  <td className="num">−{formatMoney(data.totals.discount)}</td>
                </tr>
              )}
              <tr>
                <th scope="row" colSpan={3}>
                  Shipping{data.shippingMethod && ` (${data.shippingMethod.label})`}
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
                  Total
                </th>
                <td className="num">
                  <strong>{formatMoney(data.totals.total)}</strong>
                </td>
              </tr>
              {/* Phase 10 §5: the part a gift card paid; the rest was paid by the order's payment method. */}
              {data.giftCardPayment?.amount > 0 && (
                <>
                  <tr>
                    <th scope="row" colSpan={3}>
                      Paid by gift card{data.giftCardPayment.last4 && ` (ending ${data.giftCardPayment.last4})`}
                    </th>
                    <td className="num">−{formatMoney(data.giftCardPayment.amount)}</td>
                  </tr>
                  <tr>
                    <th scope="row" colSpan={3}>
                      {data.paymentMethod === 'gift_card' ? 'Left to pay' : `Paid by ${PAYMENT_METHODS[data.paymentMethod] ?? data.paymentMethod}`}
                    </th>
                    <td className="num">{formatMoney(Math.max(Math.round((data.totals.total - data.giftCardPayment.amount) * 100), 0) / 100)}</td>
                  </tr>
                </>
              )}
              {data.totals.paid !== undefined && (
                <tr>
                  <th scope="row" colSpan={3}>
                    Paid (invoiced)
                  </th>
                  <td className="num">{formatMoney(data.totals.paid)}</td>
                </tr>
              )}
              {data.totals.refunded > 0 && (
                <tr>
                  <th scope="row" colSpan={3}>
                    Refunded
                  </th>
                  <td className="num">−{formatMoney(data.totals.refunded)}</td>
                </tr>
              )}
            </tfoot>
          </table>
        </section>

        <section className="panel" aria-labelledby="manage-title">
          <h2 id="manage-title" className="panel__title">
            Manage order
          </h2>
          <div className="order-actions">
            {nothingToDo ? (
              <p className="muted">Nothing left to do: this order is {orderStatus(data.status).label.toLowerCase()}.</p>
            ) : nothingAllowed ? (
              <p className="muted">Your role can view this order but not change it.</p>
            ) : (
              <>
                <div className="order-actions__buttons">
                  {actions.invoice && (
                    <button type="button" className="btn btn--primary" onClick={(event) => open('invoice', event)}>
                      Invoice
                    </button>
                  )}
                  {actions.ship && (
                    <button type="button" className="btn btn--primary" onClick={(event) => open('ship', event)}>
                      Ship
                    </button>
                  )}
                  {actions.deliver && (
                    <button type="button" className="btn btn--primary" onClick={(event) => open('delivered', event)}>
                      Mark as delivered
                    </button>
                  )}
                  {actions.refund && (
                    <button type="button" className="btn btn--outline" onClick={(event) => open('refund', event)}>
                      Refund
                    </button>
                  )}
                  {actions.return && (
                    <button type="button" className="btn btn--outline" onClick={(event) => open('return', event)}>
                      Create return
                    </button>
                  )}
                  {actions.cancel && (
                    <button type="button" className="btn btn--danger" onClick={(event) => open('cancelled', event)}>
                      Cancel order
                    </button>
                  )}
                </div>
                {data.status === 'pending_payment' &&
                  (data.payment?.canPay && data.payment.provider === 'paypal' ? (
                    <p className="field__hint">
                      The customer pays on PayPal's page: the order moves to Processing by itself once PayPal confirms the payment. Send them the payment link under
                      Delivery and payment if they need it.
                    </p>
                  ) : data.payment?.canPay ? (
                    <p className="field__hint">
                      The customer pays by card on Stripe's page: the order moves to Processing by itself once Stripe confirms the payment. Send them the payment link
                      under Delivery and payment if they need it.
                    </p>
                  ) : (
                    <p className="field__hint">No payment provider is connected yet: invoice the order once the money has arrived. It then moves to Processing and can be shipped.</p>
                  ))}
                {actions.refund && !actions.cancel && ['pending_payment', 'processing'].includes(data.status) && (
                  <p className="field__hint">This order is paid, so it can't be cancelled: refund it instead.</p>
                )}
              </>
            )}
          </div>
        </section>

        <section className="panel" aria-labelledby="documents-title">
          <h2 id="documents-title" className="panel__title">
            Documents
          </h2>
          <Documents order={data} />
          <p className="documents print-links">
            <Link to={`/print/packing-slips?orders=${data.number}`} className="btn btn--outline btn--sm">
              <LuPrinter aria-hidden="true" /> Packing slip
            </Link>
            {data.invoices?.length > 0 && (
              <Link to={`/print/invoices?orders=${data.number}`} className="btn btn--outline btn--sm">
                <LuPrinter aria-hidden="true" /> Print invoice
              </Link>
            )}
            {/* Phase 10 §2: each invoice's PDF (an order usually has one). */}
            {data.invoices?.map((invoice) => (
              <PdfLink key={invoice.number} small href={invoicePdfUrl(invoice.number)} name={`invoice ${invoice.number}`} />
            ))}
          </p>
        </section>

        <section className="panel" aria-labelledby="customer-title">
          <h2 id="customer-title" className="panel__title">
            Customer
          </h2>
          <dl className="details">
            <dt>Name</dt>
            <dd>
              {data.customer.id && can('customers.view') ? <Link to={`/customers/${data.customer.id}`}>{fullName(data.customer) || '—'}</Link> : fullName(data.customer) || '—'}{' '}
              <span className="muted">· {data.customer.guest ? 'Guest' : 'Account'}</span>
            </dd>
            {data.customerGroup && (
              <>
                <dt>Group</dt>
                <dd>{data.customerGroup}</dd>
              </>
            )}
            {data.source === 'admin' && (
              <>
                <dt>Created by</dt>
                <dd>{data.createdByAdmin ? `${data.createdByAdmin} (admin)` : 'An admin'}</dd>
              </>
            )}
            <dt>Email</dt>
            <dd>
              <a href={`mailto:${data.email}`}>{data.email}</a>
            </dd>
            {data.phone && (
              <>
                <dt>Phone</dt>
                <dd>{data.phone}</dd>
              </>
            )}
          </dl>
        </section>

        <section className="panel" aria-labelledby="delivery-title">
          <h2 id="delivery-title" className="panel__title">
            Delivery and payment
          </h2>
          <dl className="details">
            <dt>Ship to</dt>
            <dd>
              <Address address={data.shippingAddress} />
            </dd>
            <dt>Method</dt>
            <dd>
              {data.shippingMethod?.label} <span className="muted">· {data.shippingMethod?.eta}</span>
            </dd>
            <dt>Payment</dt>
            <dd>{PAYMENT_METHODS[data.paymentMethod] ?? data.paymentMethod}</dd>
            {/* Phase 8: Stripe provider, reference, paid at, and the payment link of an unpaid card order. */}
            <OrderPayment order={data} canEdit={can('orders.edit')} />
            <dt>Bill to</dt>
            <dd>
              <Address address={data.billingAddress} />
            </dd>
          </dl>
        </section>

        <section className="panel" aria-labelledby="history-title">
          <h2 id="history-title" className="panel__title">
            History
          </h2>
          <ol className="history" aria-labelledby="history-title">
            {data.history.map((entry, index) => (
              <li key={`${entry.createdAt}-${index}`}>
                <div className="history__head">
                  <StatusBadge {...orderStatus(entry.status)} />
                  {entry.paymentStatus && <StatusBadge {...paymentStatus(entry.paymentStatus)} />}
                </div>
                <p className="muted">
                  <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                  {entry.adminName ? ` · by ${entry.adminName}` : byProvider(entry) ? ` · by ${byProvider(entry)}` : ''}
                  {entry.customerNotified && ' · customer emailed'}
                </p>
                {entry.note && <p>{entry.note}</p>}
              </li>
            ))}
          </ol>
        </section>
      </div>

      {Dialog && <Dialog order={data} onDone={done} onCancel={cancel} />}
      {(dialog === 'delivered' || dialog === 'cancelled') && <StatusDialog order={data} status={dialog} onDone={done} onCancel={cancel} />}
    </>
  )
}

const OrderDetailPage = LIVE_DATA ? LiveOrderDetailPage : DemoOrderDetailPage

export default OrderDetailPage
