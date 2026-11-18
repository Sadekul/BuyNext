import { useId, useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { LuGitCompareArrows, LuShoppingBag, LuTrash2 } from 'react-icons/lu'
import PageMeta from '../components/common/PageMeta'
import RatingStars from '../components/product/RatingStars'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import ErrorMessage from '../components/ui/ErrorMessage'
import Loader from '../components/ui/Loader'
import { useCompare } from '../hooks/useCompare'
import { useCart } from '../hooks/useCart'
import { compareProductsQuery } from '../queries/productQueries'
import { ROUTES } from '../constants/routes'
import { cn } from '../utils/classNames'
import { formatPrice } from '../utils/formatters'
import { getProductPricing } from '../utils/pricing'
import { getPurchaseLimits } from '../utils/inventory'
import { isGiftCardProduct } from '../utils/giftCards'
import { MISSING, compareRows, valuesDiffer } from '../utils/compare'
import './ComparePage.css'

/**
 * /compare (phase 11 §2): the picked products side by side. A real table:
 * one column per product (its name is the column header), one row per
 * attribute (row headers), then the union of the products' specifications.
 * On phones the table scrolls sideways inside a focusable region, so
 * keyboard users can scroll it too. "Highlight differences" marks the rows
 * whose values aren't all the same.
 */
function ComparePage() {
  const compare = useCompare()
  const ids = compare?.items.map((item) => item.id) ?? []
  const request = useQuery({ ...compareProductsQuery(ids), enabled: ids.length >= 2 })

  if (ids.length < 2) {
    return (
      <div className="section container">
        <PageMeta title="Compare products" noindex />
        <EmptyState
          icon={LuGitCompareArrows}
          title={ids.length === 0 ? 'Nothing to compare yet' : 'Add one more product to compare'}
          titleAs="h1"
          message={
            ids.length === 0
              ? 'Choose "Compare" on up to 4 products to see them side by side.'
              : `${compare.items[0].title} is in your compare list. Choose "Compare" on another product to see them side by side.`
          }
        >
          <Button to={ROUTES.products}>Browse products</Button>
          {ids.length === 1 && (
            <Button variant="outline" onClick={compare.clear}>
              Clear compare list
            </Button>
          )}
        </EmptyState>
      </div>
    )
  }

  if (request.isPending) {
    return (
      <div className="section container">
        <Loader label="Loading products…" />
      </div>
    )
  }

  if (request.error && !request.data) {
    return (
      <div className="section container">
        <ErrorMessage title="We couldn't load these products" titleAs="h1" message={request.error.message} onRetry={() => request.refetch()} />
      </div>
    )
  }

  // Only the products still in the list, in its order (a removed column disappears at once).
  const products = ids.map((id) => request.data.find((product) => product.id === id)).filter(Boolean)
  return <CompareTable products={products} missingCount={ids.length - products.length} onRemove={compare.removeItem} onClear={compare.clear} />
}

function CompareTable({ products, missingCount, onRemove, onClear }) {
  const { addItem } = useCart()
  const [highlight, setHighlight] = useState(false)
  const [message, setMessage] = useState('')
  const captionId = useId()
  const toggleId = useId()
  const rows = compareRows(products)
  const prices = products.map((product) => getProductPricing(product))
  const priceDiffers = valuesDiffer(prices.map((price) => price.salePrice))
  const ratingDiffers = valuesDiffer(products.map((product) => product.rating ?? MISSING))

  function handleAdd(product) {
    addItem(product)
    setMessage(`${product.title} was added to your cart.`)
  }

  function handleRemove(product) {
    onRemove(product.id)
    setMessage(`${product.title} was removed from the comparison.`)
  }

  const rowClass = (differs) => cn(highlight && differs && 'compare-table__row--differs')
  const differsNote = (differs) => highlight && differs && <span className="compare-table__differs"> (differs)</span>

  return (
    <div className="compare-page section container">
      <PageMeta title="Compare products" noindex />
      <header className="compare-page__header">
        <h1>Compare products</h1>
        <div className="compare-page__tools">
          <label htmlFor={toggleId} className="compare-page__toggle">
            <input id={toggleId} type="checkbox" checked={highlight} onChange={(event) => setHighlight(event.target.checked)} />
            Highlight differences
          </label>
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear all
          </Button>
        </div>
      </header>
      {missingCount > 0 && (
        <p className="compare-page__note">
          {missingCount === 1 ? 'One product is' : `${missingCount} products are`} no longer available and {missingCount === 1 ? 'was' : 'were'} left out.
        </p>
      )}
      <p className="visually-hidden" role="status">
        {message}
      </p>

      {/* tabIndex: the region scrolls sideways on small screens, so keyboard users must be able to reach it. */}
      <div className="compare-table__scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
        <table className="compare-table">
          <caption id={captionId} className="compare-table__caption">
            Comparing {products.length} products
          </caption>
          <thead>
            <tr>
              <td className="compare-table__corner" />
              {products.map((product) => (
                <th key={product.id} scope="col" className="compare-table__product">
                  <Link to={ROUTES.productDetails(product.id)}>{product.title}</Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Image</th>
              {products.map((product) => (
                <td key={product.id}>
                  {product.thumbnail ? <img className="compare-table__image" src={product.thumbnail} alt={product.title} width="160" height="160" loading="lazy" /> : MISSING}
                </td>
              ))}
            </tr>
            <tr className={rowClass(priceDiffers)}>
              <th scope="row">Price{differsNote(priceDiffers)}</th>
              {products.map((product, index) => (
                <td key={product.id}>
                  <strong>{formatPrice(prices[index].salePrice)}</strong>
                  {prices[index].hasDiscount && (
                    <>
                      {' '}
                      <s className="compare-table__muted">
                        <span className="visually-hidden">Original price: </span>
                        {formatPrice(prices[index].originalPrice)}
                      </s>
                    </>
                  )}
                </td>
              ))}
            </tr>
            <tr className={rowClass(ratingDiffers)}>
              <th scope="row">Rating{differsNote(ratingDiffers)}</th>
              {products.map((product) => (
                <td key={product.id}>
                  {typeof product.rating === 'number' ? (
                    <>
                      <RatingStars rating={product.rating} />
                      {typeof product.reviewCount === 'number' && <span className="compare-table__muted">{product.reviewCount} reviews</span>}
                    </>
                  ) : (
                    MISSING
                  )}
                </td>
              ))}
            </tr>
            {rows.map((row) => {
              const differs = valuesDiffer(row.values)
              return (
                <tr key={row.key} className={rowClass(differs)}>
                  <th scope="row">
                    {row.label}
                    {differsNote(differs)}
                  </th>
                  {row.values.map((value, index) => (
                    <td key={products[index].id}>{value}</td>
                  ))}
                </tr>
              )
            })}
            <tr>
              <th scope="row">
                <span className="visually-hidden">Actions</span>
              </th>
              {products.map((product) => (
                <td key={product.id}>
                  <div className="compare-table__actions">
                    <AddButton product={product} onAdd={handleAdd} />
                    <Button variant="ghost" size="sm" onClick={() => handleRemove(product)} aria-label={`Remove ${product.title} from comparison`}>
                      <LuTrash2 aria-hidden="true" />
                      Remove
                    </Button>
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** "Add to cart"; products with options (and gift cards) are bought on their page. */
function AddButton({ product, onAdd }) {
  if (product.hasVariants || isGiftCardProduct(product)) {
    return (
      <Button size="sm" to={ROUTES.productDetails(product.id)} aria-label={`Choose options for ${product.title}`}>
        Choose options
      </Button>
    )
  }
  const { canBuy } = getPurchaseLimits(product)
  return (
    <Button size="sm" onClick={() => onAdd(product)} disabled={!canBuy} aria-label={`Add ${product.title} to cart`}>
      <LuShoppingBag aria-hidden="true" />
      {canBuy ? 'Add to cart' : 'Unavailable'}
    </Button>
  )
}

export default ComparePage
