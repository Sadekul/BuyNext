import { Link, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LuArrowLeft, LuPackageX } from 'react-icons/lu'
import OrderDetailsView from '../components/orders/OrderDetailsView'
import ReturnRequestForm from '../components/orders/ReturnRequestForm'
import PayNowButton from '../components/orders/PayNowButton'
import CancelOrderButton from '../components/orders/CancelOrderButton'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import ErrorMessage from '../components/ui/ErrorMessage'
import Loader from '../components/ui/Loader'
import { useAuth } from '../hooks/useAuth'
import { useOrders } from '../hooks/useOrders'
import { orderKeys, orderQuery } from '../queries/orderQueries'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { canPayOrder } from '../utils/payment'
import { REAL_SHOP } from '../constants/shop'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import './OrderPages.css'

function NotFound() {
  return (
    <EmptyState icon={LuPackageX} titleAs="h2" title="Order not found" message="This order doesn't exist or belongs to another account.">
      <Button to={ROUTES.orders}>Back to orders</Button>
    </EmptyState>
  )
}

function OrderSection({ order, invoiceLink, invoicePdf, payAction, actions = null, children }) {
  const id = order.number ?? order.id
  return (
    <section className="orders" aria-labelledby="order-details-title">
      <title>{`Order ${id} | ${SITE.name}`}</title>
      <Link to={ROUTES.orders} className="orders__back">
        <LuArrowLeft aria-hidden="true" /> All orders
      </Link>
      <h2 id="order-details-title" className="orders__title">
        Order {id}
      </h2>
      {actions}
      <OrderDetailsView order={order} invoiceLink={invoiceLink} invoicePdf={invoicePdf} payAction={payAction} />
      {children}
    </section>
  )
}

/** Demo: only finds orders on this device belonging to the signed-in customer. */
function DemoOrderDetailsPage() {
  const { orderId } = useParams()
  const order = useOrders().getOrder(orderId)
  return order ? <OrderSection order={order} /> : <NotFound />
}

/** BuyNest's API: the server only returns the customer's own orders (someone else's → 404). */
function ServerOrderDetailsPage() {
  const { orderId } = useParams()
  const { user, authorizedRequest } = useAuth()
  const request = useQuery(orderQuery(user.id, orderId, authorizedRequest))
  const { settings } = useStoreSettings({ enabled: false }) // cached only: the order says itself whether it can be paid (canPay)
  const queryClient = useQueryClient()

  // Phase 9: the cancelled order replaces this one; the list is fetched again when next shown.
  function handleCancelled(cancelled) {
    queryClient.setQueryData(orderKeys.detail(user.id, orderId), cancelled)
    queryClient.invalidateQueries({ queryKey: ['orders', user.id, 'list'] })
  }

  if (request.isPending) return <Loader label="Loading the order…" />
  if (request.error?.status === 404) return <NotFound />
  if (request.error) return <ErrorMessage title="We couldn't load this order" titleAs="h2" message={request.error.message} onRetry={() => request.refetch()} />
  // The customer's own order: its invoices open as printable pages, and items can be returned (phase 6).
  return (
    <OrderSection
      order={request.data}
      invoiceLink={(invoice) => ROUTES.invoice(request.data.number, invoice)}
      // Phase 8: an unpaid card order can be paid on Stripe's page (phase 10: a PayPal order on PayPal's).
      // Phase 10: each invoice can be downloaded as a PDF.
      invoicePdf={{ orderNumber: request.data.number }}
      payAction={canPayOrder(request.data, settings.cardPayments, settings.paypalPayments) ? <PayNowButton order={request.data} /> : null}
      // Phase 9: an unpaid order with nothing shipped can be cancelled here.
      actions={<CancelOrderButton order={request.data} onCancelled={handleCancelled} />}
    >
      <ReturnRequestForm order={request.data} />
    </OrderSection>
  )
}

/** /account/orders/:orderId */
const OrderDetailsPage = REAL_SHOP ? ServerOrderDetailsPage : DemoOrderDetailsPage

export default OrderDetailsPage
