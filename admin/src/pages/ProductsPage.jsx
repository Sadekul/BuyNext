import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuPencil, LuPlus, LuSearch, LuTrash2 } from 'react-icons/lu'
import { adminKeys, deleteProduct, getCategories, getProducts } from '../api/admin'
import ConfirmDialog from '../components/ConfirmDialog'
import DemoNotice from '../components/DemoNotice'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount, formatMoney, formatSlug } from '../utils/format'
import { PRODUCT_STATUSES, productStatus } from '../utils/orders'
import { LIVE_DATA } from '../api/mode'
import { useAdminAuth } from '../auth/useAdminAuth'

const LIMIT = 20

/**
 * Product list: search, category (and, with real data, status) filters,
 * sorting, pages. Filters live in the URL.
 */
function ProductsPage() {
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { can } = useAdminAuth()
  const q = params.get('q') ?? ''
  const category = params.get('category') ?? ''
  const status = LIVE_DATA ? (params.get('status') ?? '') : ''
  const sortBy = params.get('sortBy') ?? ''
  const order = params.get('order') ?? 'asc'
  const skip = Number(params.get('skip')) || 0
  const [draft, setDraft] = useState(q)
  const [toDelete, setToDelete] = useState(null)
  const [notice, setNotice] = useState(null)

  const query = { q, category, status, sortBy, order, skip, limit: LIMIT }
  const products = useQuery({
    queryKey: adminKeys.products(query),
    queryFn: ({ signal }) => getProducts(query, { signal }),
    placeholderData: keepPreviousData, // keep the table while the next page loads
  })
  const categories = useQuery({ queryKey: adminKeys.categories, queryFn: ({ signal }) => getCategories({ signal }), staleTime: Infinity })

  const remove = useMutation({
    mutationFn: (product) => deleteProduct(product.id),
    onSuccess: (result, product) => {
      setToDelete(null)
      if (result?.simulated) {
        setNotice(`"${product.title}" deleted (demo): DummyJSON doesn't save deletions, so it still appears in the list.`)
        return
      }
      // Past orders keep their own copy of the product (name, price), so they don't change.
      setNotice(`"${product.title}" deleted. It is no longer in the store; past orders still show it.`)
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: adminKeys.overview })
    },
    onError: (error) => {
      setToDelete(null)
      setNotice(`Couldn't delete: ${error.message}`)
    },
  })

  function update(changes) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === '' || value === null || value === 0) next.delete(key)
      else next.set(key, String(value))
    }
    setParams(next)
  }

  function handleSearch(event) {
    event.preventDefault()
    // Search and category can't be combined in DummyJSON; there a search clears the category.
    update({ q: draft.trim(), ...(!LIVE_DATA && { category: '' }), skip: 0 })
  }

  return (
    <>
      <title>Products | BuyNest Admin</title>
      <PageHeader
        title="Products"
        description={products.data ? `${formatCount(products.data.total)} products` : undefined}
        actions={
          can('products.edit') && (
            <Link to="/products/new" className="btn btn--primary">
              <LuPlus aria-hidden="true" /> Add product
            </Link>
          )
        }
      />
      {!LIVE_DATA && <DemoNotice />}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      <div className="toolbar">
        <form role="search" className="toolbar__search" onSubmit={handleSearch}>
          <label htmlFor="product-search" className="visually-hidden">
            Search products
          </label>
          <input id="product-search" type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Search by name or brand" />
          <button type="submit" className="btn btn--outline">
            <LuSearch aria-hidden="true" /> Search
          </button>
        </form>
        <label className="toolbar__select">
          <span>Category</span>
          <select
            value={category}
            onChange={(event) => {
              if (LIVE_DATA) return update({ category: event.target.value, skip: 0 })
              setDraft('')
              update({ category: event.target.value, q: '', skip: 0 })
            }}
          >
            <option value="">All categories</option>
            {categories.data?.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {LIVE_DATA && (
          <label className="toolbar__select">
            <span>Status</span>
            <select value={status} onChange={(event) => update({ status: event.target.value, skip: 0 })}>
              <option value="">All statuses</option>
              {Object.entries(PRODUCT_STATUSES).map(([value, { label }]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="toolbar__select">
          <span>Sort</span>
          <select
            value={sortBy ? `${sortBy}:${order}` : ''}
            onChange={(event) => {
              const [field = '', direction = 'asc'] = event.target.value.split(':')
              update({ sortBy: field, order: field ? direction : '', skip: 0 })
            }}
          >
            <option value="">Default</option>
            <option value="title:asc">Name A–Z</option>
            <option value="price:asc">Price, low to high</option>
            <option value="price:desc">Price, high to low</option>
            <option value="stock:asc">Stock, lowest first</option>
            <option value="rating:desc">Rating, highest first</option>
            {LIVE_DATA && <option value="newest:desc">Newest first</option>}
          </select>
        </label>
      </div>

      {products.isPending && <Loading label="Loading products…" />}
      {products.error && <ErrorState error={products.error} onRetry={products.refetch} />}
      {products.data && products.data.products.length === 0 && <Empty>No products match.</Empty>}
      {products.data && products.data.products.length > 0 && (
        <div className="table-wrap" aria-busy={products.isFetching}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Category</th>
                <th scope="col" className="num">
                  Price
                </th>
                <th scope="col">Stock</th>
                {LIVE_DATA && <th scope="col">Status</th>}
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {products.data.products.map((product) => (
                <tr key={product.id}>
                  <td>
                    <Link to={`/products/${product.id}`} className="table__product">
                      <img src={product.thumbnail} alt="" width="36" height="36" loading="lazy" />
                      <span>
                        {product.title}
                        {product.brand && <small>{product.brand}</small>}
                      </span>
                    </Link>
                  </td>
                  <td>{formatSlug(product.category)}</td>
                  <td className="num">{formatMoney(product.price)}</td>
                  <td>
                    <StatusBadge stock={product.stock} /> <span className="muted">{formatCount(product.stock)}</span>
                  </td>
                  {LIVE_DATA && (
                    <td>
                      <StatusBadge {...productStatus(product.status)} />
                    </td>
                  )}
                  <td className="table__actions">
                    {can('products.edit') && (
                      <Link to={`/products/${product.id}`} className="icon-button" aria-label={`Edit ${product.title}`}>
                        <LuPencil aria-hidden="true" />
                      </Link>
                    )}
                    {can('products.delete') && (
                      <button type="button" className="icon-button icon-button--danger" aria-label={`Delete ${product.title}`} onClick={() => setToDelete(product)}>
                        <LuTrash2 aria-hidden="true" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={products.data.total} limit={LIMIT} skip={skip} onChange={(nextSkip) => update({ skip: nextSkip })} />
        </div>
      )}

      <ConfirmDialog
        isOpen={toDelete !== null}
        title="Delete this product?"
        message={toDelete ? `"${toDelete.title}" will be removed from the store.${LIVE_DATA ? ' Past orders keep their copy of it.' : ''}` : ''}
        confirmLabel="Delete product"
        busy={remove.isPending}
        onConfirm={() => remove.mutate(toDelete)}
        onCancel={() => setToDelete(null)}
      />
    </>
  )
}

export default ProductsPage
