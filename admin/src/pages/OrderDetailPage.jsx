import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { LuArrowLeft } from 'react-icons/lu'
import { adminKeys, getOrder } from '../api/admin'
import PageHeader from '../components/PageHeader'
import { ErrorState, Loading } from '../components/States'
import { formatCount, formatMoney, fullName } from '../utils/format'

function OrderDetailPage() {
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

export default OrderDetailPage
