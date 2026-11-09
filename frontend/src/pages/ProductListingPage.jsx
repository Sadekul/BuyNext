import { useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { LuFilterX, LuSearchX, LuSlidersHorizontal } from 'react-icons/lu'
import CategoryNav from '../components/product/CategoryNav'
import ActiveFilters from '../components/product/ActiveFilters'
import CatalogFilters from '../components/product/CatalogFilters'
import ProductGrid from '../components/product/ProductGrid'
import ProductGridSkeleton from '../components/product/ProductGridSkeleton'
import QuickViewModal from '../components/product/QuickViewModal'
import SortSelect from '../components/product/SortSelect'
import ViewToggle from '../components/product/ViewToggle'
import Pagination from '../components/common/Pagination'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/ui/EmptyState'
import ErrorMessage from '../components/ui/ErrorMessage'
import { useQuery } from '@tanstack/react-query'
import { catalogQuery } from '../queries/productQueries'
import { useCategories } from '../hooks/useCategories'
import { useCart } from '../hooks/useCart'
import { ROUTES } from '../constants/routes'
import { PRODUCTS_PER_PAGE, getSortOption } from '../constants/catalog'
import {
  EMPTY_FILTERS,
  countActiveFilters,
  filterProducts,
  getBrandOptions,
  hasInvalidPriceRange,
  paginate,
  sortProducts,
} from '../utils/catalog'
import { formatPrice } from '../utils/formatters'
import { readCatalogParams, withFilters, withParam } from '../utils/catalogParams'
import './ProductListingPage.css'

/**
 * Product catalog for three routes:
 *   /products?q=…&sort=…   → all products, or search results
 *   /categories/:slug      → one category
 *   /deals                 → all products, biggest discount first
 *
 * SERVER-SIDE: search (?q) and category (:slug) choose which products are fetched.
 * CLIENT-SIDE: price, rating, brand, and availability filters, sorting, and
 * pagination (DummyJSON has no API parameters for those — see utils/catalog.js).
 *
 * All of it lives in the URL (see utils/catalogParams.js), so Back, refresh,
 * and shared links restore exactly the same results.
 */
function ProductListingPage({ title = 'All products', defaultSort = 'featured' }) {
  const { categorySlug } = useParams()
  const [searchParams] = useSearchParams()
  const searchQuery = searchParams.get('q')?.trim() ?? ''
  const sortOption = getSortOption(searchParams.get('sort'), defaultSort)

  const categoriesRequest = useCategories()
  const categories = categoriesRequest.data ?? []
  const currentCategory = categories.find((category) => category.slug === categorySlug)
  // DummyJSON answers unknown categories with an empty list, not a 404, so we check ourselves.
  const isUnknownCategory = Boolean(categorySlug && categoriesRequest.data && !currentCategory)

  let heading = title
  if (searchQuery) heading = `Results for "${searchQuery}"`
  else if (categorySlug) heading = currentCategory?.name ?? 'Category'

  // A new scope (search or category) = a new `key`, so React throws away the
  // old Catalog's local state (open quick view, mobile filter panel).
  const scopeKey = searchQuery ? `search:${searchQuery}` : `category:${categorySlug ?? 'all'}`

  return (
    <div className="listing section container">
      <header className="listing__header">
        <h1 className="listing__title">{heading}</h1>
        {categories.length > 0 && <CategoryNav categories={categories} />}
      </header>

      {categorySlug && categoriesRequest.error ? (
        // Without the category list we can't tell a real category from a typo.
        <ErrorMessage
          title="We couldn't load categories"
          message={categoriesRequest.error.message}
          onRetry={categoriesRequest.refetch}
        />
      ) : isUnknownCategory ? (
        <EmptyState
          icon={LuSearchX}
          title="Category not found"
          message={`We don't have a category called "${categorySlug}".`}
        >
          <Button to={ROUTES.products}>Browse all products</Button>
        </EmptyState>
      ) : (
        <Catalog
          key={scopeKey}
          searchQuery={searchQuery}
          categorySlug={categorySlug}
          categoryName={currentCategory?.name}
          sortOption={sortOption}
          defaultSort={defaultSort}
        />
      )}
    </div>
  )
}

/** Fetches one scope, then filters, sorts, and paginates it on the client. */
function Catalog({ searchQuery, categorySlug, categoryName, sortOption, defaultSort }) {
  // Search and category are fetched on the server; each scope is cached separately.
  const request = useQuery(catalogQuery({ searchQuery, categorySlug }))
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [areFiltersOpen, setAreFiltersOpen] = useState(false)
  const [quickViewProduct, setQuickViewProduct] = useState(null)
  const { addItem } = useCart()
  const toolbarRef = useRef(null) // scroll target when changing page

  // The URL is the single source of truth for filters, page, and view.
  // useMemo: parse only when the query string changes, so `filters` keeps the
  // same object identity between unrelated re-renders.
  const { filters, page, layout } = useMemo(() => readCatalogParams(searchParams), [searchParams])

  // useMemo: filtering + sorting up to 194 products is cheap, but it would
  // otherwise re-run on every render (e.g. opening quick view or the drawer).
  const products = request.data
  const brandOptions = useMemo(() => getBrandOptions(products ?? []), [products])
  const visibleProducts = useMemo(() => {
    // An impossible price range (min > max) is ignored rather than showing zero results.
    const effectiveFilters = hasInvalidPriceRange(filters) ? { ...filters, minPrice: '', maxPrice: '' } : filters
    return sortProducts(filterProducts(products ?? [], effectiveFilters), sortOption.value)
  }, [products, filters, sortOption.value])
  const pagination = paginate(visibleProducts, page, PRODUCTS_PER_PAGE)
  const activeFilterCount = countActiveFilters(filters)

  // `replace: true` for filters and sort: refining results shouldn't fill the
  // Back history with one entry per keystroke. Page changes push a new entry.
  function handleFiltersChange(nextFilters) {
    setSearchParams(withFilters(searchParams, nextFilters), { replace: true })
  }

  function handleClearFilters() {
    handleFiltersChange(EMPTY_FILTERS)
  }

  function handleSortChange(value) {
    setSearchParams(withParam(withParam(searchParams, 'sort', value, defaultSort), 'page', null), { replace: true })
  }

  function handleLayoutChange(value) {
    setSearchParams(withParam(searchParams, 'view', value, 'grid'), { replace: true })
  }

  function handlePageChange(nextPage) {
    setSearchParams(withParam(searchParams, 'page', nextPage, 1))
    toolbarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function handleAddToCart(product) {
    setQuickViewProduct(null) // close quick view first, so the cart drawer isn't stacked on it
    addItem(product)
  }

  // One removable chip per active filter, including search and category.
  const chips = []
  if (searchQuery) {
    chips.push({ id: 'q', label: `Search: "${searchQuery}"`, onRemove: () => setSearchParams(withParam(searchParams, 'q', null)) })
  }
  if (categorySlug) {
    chips.push({
      id: 'category',
      label: `Category: ${categoryName ?? categorySlug}`,
      onRemove: () => navigate({ pathname: ROUTES.products, search: searchParams.toString() }),
    })
  }
  if (filters.minPrice !== '') {
    chips.push({ id: 'min', label: `From ${formatPrice(Number(filters.minPrice))}`, onRemove: () => handleFiltersChange({ ...filters, minPrice: '' }) })
  }
  if (filters.maxPrice !== '') {
    chips.push({ id: 'max', label: `Up to ${formatPrice(Number(filters.maxPrice))}`, onRemove: () => handleFiltersChange({ ...filters, maxPrice: '' }) })
  }
  if (filters.minRating > 0) {
    chips.push({ id: 'rating', label: `${filters.minRating}★ & up`, onRemove: () => handleFiltersChange({ ...filters, minRating: 0 }) })
  }
  filters.brands.forEach((brand) => {
    chips.push({
      id: `brand-${brand}`,
      label: brand,
      onRemove: () => handleFiltersChange({ ...filters, brands: filters.brands.filter((name) => name !== brand) }),
    })
  })
  if (filters.inStockOnly) {
    chips.push({ id: 'available', label: 'Available to order', onRemove: () => handleFiltersChange({ ...filters, inStockOnly: false }) })
  }

  function handleClearAllChips() {
    // Drop search, filters, and page but keep sort and view; leave a category page for all products.
    const next = withParam(withFilters(searchParams, EMPTY_FILTERS), 'q', null)
    if (categorySlug) navigate({ pathname: ROUTES.products, search: next.toString() })
    else setSearchParams(next)
  }

  if (request.isPending) return <ProductGridSkeleton count={8} />

  if (request.error) {
    return <ErrorMessage title="We couldn't load products" message={request.error.message} onRetry={() => request.refetch()} />
  }

  if (products.length === 0) {
    return (
      <EmptyState
        icon={LuSearchX}
        title={searchQuery ? `No results for "${searchQuery}"` : 'No products here yet'}
        message={searchQuery ? 'Check the spelling or try a more general term.' : 'Try another category.'}
      >
        <Button to={ROUTES.products} variant="outline">
          Browse all products
        </Button>
      </EmptyState>
    )
  }

  const filterPanel = (showTitle) => (
    <CatalogFilters
      filters={filters}
      brandOptions={brandOptions}
      onChange={handleFiltersChange}
      onClear={handleClearFilters}
      activeCount={activeFilterCount}
      showTitle={showTitle}
    />
  )

  return (
    <div className="listing__body">
      {/* Desktop: sticky sidebar. Hidden below 1024px, where the drawer is used instead. */}
      <aside className="listing__filters" aria-label="Product filters">
        {filterPanel(true)}
      </aside>

      <div className="listing__results">
        <div className="listing__toolbar" ref={toolbarRef}>
          <p className="listing__count" role="status">
            {visibleProducts.length === 0
              ? '0 products'
              : `Showing ${pagination.start}–${pagination.end} of ${visibleProducts.length} products`}
          </p>
          <div className="listing__controls">
            <button
              type="button"
              className="listing__filter-toggle"
              onClick={() => setAreFiltersOpen(true)}
              aria-haspopup="dialog"
            >
              <LuSlidersHorizontal aria-hidden="true" />
              Filters{activeFilterCount > 0 && ` (${activeFilterCount})`}
            </button>
            <SortSelect value={sortOption.value} onChange={handleSortChange} />
            <ViewToggle value={layout} onChange={handleLayoutChange} />
          </div>
        </div>

        <ActiveFilters chips={chips} onClearAll={handleClearAllChips} />

        {visibleProducts.length === 0 ? (
          <EmptyState icon={LuFilterX} title="No products match your filters" message="Try removing a filter or widening the price range.">
            <Button variant="outline" onClick={handleClearFilters}>
              Clear all filters
            </Button>
          </EmptyState>
        ) : (
          <>
            <ProductGrid
              products={pagination.items}
              layout={layout}
              onAddToCart={handleAddToCart}
              onQuickView={setQuickViewProduct}
            />
            <Pagination currentPage={pagination.currentPage} pageCount={pagination.pageCount} onPageChange={handlePageChange} />
          </>
        )}
      </div>

      {/* Mobile/tablet: the same filters in a drawer. Results update live behind it. */}
      <Modal
        isOpen={areFiltersOpen}
        onClose={() => setAreFiltersOpen(false)}
        title={activeFilterCount > 0 ? `Filters (${activeFilterCount})` : 'Filters'}
        variant="drawer"
        footer={
          <Button fullWidth onClick={() => setAreFiltersOpen(false)}>
            Show {visibleProducts.length} {visibleProducts.length === 1 ? 'product' : 'products'}
          </Button>
        }
      >
        {filterPanel(false)}
      </Modal>

      <QuickViewModal product={quickViewProduct} onClose={() => setQuickViewProduct(null)} onAddToCart={handleAddToCart} />
    </div>
  )
}

export default ProductListingPage
