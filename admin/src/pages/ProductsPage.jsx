import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuDownload, LuPencil, LuPlus, LuSearch, LuTrash2 } from 'react-icons/lu'
import { adminKeys, deleteProduct, getCategories, getProducts, productsCsvUrl } from '../api/admin'
import ConfirmDialog from '../components/ConfirmDialog'
import ProductBulkActions from '../components/ProductBulkActions'
import DemoNotice from '../components/DemoNotice'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount, formatMoney, formatSlug } from '../utils/format'
import { PRODUCT_STATUSES, productStatus } from '../utils/orders'
import { LIVE_DATA } from '../api/mode'
import { useAdminAuth } from '../auth/useAdminAuth'
import { withPaths } from '../utils/categories'
// Phase 7: column chooser, rows per page, saved filters; the redirect offer after a delete.
import GridPreferences from '../components/GridPreferences'
import RedirectOffer from '../components/RedirectOffer'
import { useGridPreferences } from '../utils/useGridPreferences'
import { storePaths } from '../utils/redirects'
// Phase 13: the optional "Bangla" column and filter (complete / missing).
import { BANGLA_STATUSES } from '../utils/bangla'

const COLUMNS = [
  { id: 'product', label: 'Product', required: true },
  { id: 'category', label: 'Category' },
  { id: 'price', label: 'Price' },
  { id: 'stock', label: 'Stock' },
  { id: 'status', label: 'Status' },
  // Phase 13: hidden until chosen under Columns.
  { id: 'bangla', label: 'Bangla', optional: true },
]

/**
 * Product list: search, category (and, with real data, status) filters,
 * sorting, pages. Filters live in the URL. With real data, products can be
 * ticked (or all on this page) for a mass action (Magento's mass actions).
 */
function ProductsPage() {
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { can } = useAdminAuth()
  const q = params.get('q') ?? ''
  const category = params.get('category') ?? ''
  const status = LIVE_DATA ? (params.get('status') ?? '') : ''
  const bangla = LIVE_DATA && ['complete', 'missing'].includes(params.get('bangla')) ? params.get('bangla') : ''
  const sortBy = params.get('sortBy') ?? ''
  const order = params.get('order') ?? 'asc'
  const skip = Number(params.get('skip')) || 0
  const grid = useGridPreferences('products_grid', COLUMNS)
  const limit = grid.pageSize
  const [draft, setDraft] = useState(q)
  const [toDelete, setToDelete] = useState(null)
  const [deleted, setDeleted] = useState(null) // a product just deleted: offer a redirect from its address
  const [notice, setNotice] = useState(null)
  const [summary, setSummary] = useState(null) // the last mass action's result
  const summaryRef = useRef(null)

  const query = { q, category, status, bangla, sortBy, order, skip, limit }
  // The ticked products, for this page and these filters only (a new page starts empty).
  const pageKey = JSON.stringify(query)
  const [selection, setSelection] = useState({ pageKey, ids: [] })
  const selectedIds = selection.pageKey === pageKey ? selection.ids : []
  const bulkAllowed = LIVE_DATA && (can('products.edit') || can('products.delete'))
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
      setDeleted(product)
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: adminKeys.overview })
    },
    onError: (error) => {
      setToDelete(null)
      setNotice(`Couldn't delete: ${error.message}`)
    },
  })

  useEffect(() => {
    if (summary) summaryRef.current?.focus()
  }, [summary])

  const pageProducts = products.data?.products ?? []
  const selected = pageProducts.filter((product) => selectedIds.includes(product.id))
  const allSelected = pageProducts.length > 0 && selected.length === pageProducts.length
  const select = (ids) => setSelection({ pageKey, ids })
  const toggleOne = (id, checked) => select(checked ? [...selectedIds, id] : selectedIds.filter((item) => item !== id))

  function bulkDone(result) {
    select([])
    setNotice(null)
    setSummary(result)
    queryClient.invalidateQueries({ queryKey: ['products'] })
    queryClient.invalidateQueries({ queryKey: ['product'] })
    queryClient.invalidateQueries({ queryKey: adminKeys.categories })
    queryClient.invalidateQueries({ queryKey: adminKeys.overview })
  }
  const nameOf = (id) => pageProducts.find((product) => product.id === id)?.title

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
          <>
            {LIVE_DATA && can('products.import') && (
              <a href={productsCsvUrl({ q, category, status })} className="btn btn--outline" download>
                <LuDownload aria-hidden="true" /> Export CSV
              </a>
            )}
            {can('products.edit') && (
              <Link to="/products/new" className="btn btn--primary">
                <LuPlus aria-hidden="true" /> Add product
              </Link>
            )}
          </>
        }
      />
      {!LIVE_DATA && <DemoNotice />}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {deleted && <RedirectOffer key={deleted.id} fromPath={storePaths.product(deleted)} suggestedTo={deleted.category ? `/categories/${deleted.category}` : '/products'} what={`the deleted product "${deleted.title}"`} onClose={() => setDeleted(null)} />}
      <div role="status">
        {summary && (
          <div ref={summaryRef} tabIndex={-1} className="notice notice--success bulk-summary">
            <p>
              {summary.updated === 1 ? '1 product' : `${formatCount(summary.updated)} products`} {summary.verb}.
              {summary.skipped.length > 0 && ` ${formatCount(summary.skipped.length)} skipped:`}
            </p>
            {summary.skipped.length > 0 && (
              <ul>
                {summary.skipped.map((item) => (
                  <li key={item.id}>
                    {item.name ?? nameOf(item.id) ?? `Product #${item.id}`}: {item.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

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
            {withPaths(categories.data).map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.path}
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
        {LIVE_DATA && (
          <label className="toolbar__select">
            <span>Bangla</span>
            <select value={bangla} onChange={(event) => update({ bangla: event.target.value, skip: 0 })}>
              <option value="">Any</option>
              <option value="complete">Complete</option>
              <option value="missing">Missing</option>
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
      <GridPreferences
        prefs={grid}
        noun="products"
        onPageSize={() => update({ skip: 0 })}
        current={{ q, category, status, bangla, sortBy, order: sortBy ? order : '' }}
        onApply={(saved) => {
          setDraft(saved.q ?? '')
          setParams(new URLSearchParams(Object.entries(saved).filter(([, value]) => value !== '' && value !== null)))
        }}
      />

      {products.isPending && <Loading label="Loading products…" />}
      {products.error && <ErrorState error={products.error} onRetry={products.refetch} />}
      {products.data && products.data.products.length === 0 && <Empty>No products match.</Empty>}
      {bulkAllowed && selected.length > 0 && (
        <ProductBulkActions selected={selected} categories={categories.data ?? []} onDone={bulkDone} onClear={() => select([])} />
      )}
      {products.data && products.data.products.length > 0 && (
        <div className="table-wrap" aria-busy={products.isFetching}>
          <table className="table">
            <thead>
              <tr>
                {bulkAllowed && (
                  <th scope="col" className="table__check">
                    <input
                      type="checkbox"
                      aria-label="Select all products on this page"
                      checked={allSelected}
                      ref={(node) => {
                        if (node) node.indeterminate = selected.length > 0 && !allSelected
                      }}
                      onChange={(event) => select(event.target.checked ? pageProducts.map((product) => product.id) : [])}
                    />
                  </th>
                )}
                <th scope="col">Product</th>
                {grid.isVisible('category') && <th scope="col">Category</th>}
                {grid.isVisible('price') && (
                  <th scope="col" className="num">
                    Price
                  </th>
                )}
                {grid.isVisible('stock') && <th scope="col">Stock</th>}
                {LIVE_DATA && grid.isVisible('status') && <th scope="col">Status</th>}
                {LIVE_DATA && grid.isVisible('bangla') && <th scope="col">Bangla</th>}
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {products.data.products.map((product) => (
                <tr key={product.id} className={selectedIds.includes(product.id) ? 'is-selected' : undefined}>
                  {bulkAllowed && (
                    <td className="table__check">
                      <input type="checkbox" aria-label={`Select ${product.title}`} checked={selectedIds.includes(product.id)} onChange={(event) => toggleOne(product.id, event.target.checked)} />
                    </td>
                  )}
                  <td>
                    <Link to={`/products/${product.id}`} className="table__product">
                      <img src={product.thumbnail} alt="" width="36" height="36" loading="lazy" />
                      <span>
                        {product.title}
                        {product.brand && <small>{product.brand}</small>}
                      </span>
                    </Link>
                  </td>
                  {grid.isVisible('category') && <td>{formatSlug(product.category)}</td>}
                  {grid.isVisible('price') && <td className="num">{formatMoney(product.price)}</td>}
                  {grid.isVisible('stock') && (
                    <td>
                      <StatusBadge stock={product.stock} /> <span className="muted">{formatCount(product.stock)}</span>
                    </td>
                  )}
                  {LIVE_DATA && grid.isVisible('status') && (
                    <td>
                      <StatusBadge {...productStatus(product.status)} />
                    </td>
                  )}
                  {LIVE_DATA && grid.isVisible('bangla') && <td>{product.banglaStatus ? <StatusBadge {...BANGLA_STATUSES[product.banglaStatus]} /> : '—'}</td>}
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
          <Pagination total={products.data.total} limit={limit} skip={skip} onChange={(nextSkip) => update({ skip: nextSkip })} />
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
