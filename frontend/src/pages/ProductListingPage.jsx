import { useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { LuFilterX, LuSearchX, LuSlidersHorizontal } from 'react-icons/lu'
import CategoryNav from '../components/product/CategoryNav'
import CatalogFilters from '../components/product/CatalogFilters'
import ProductGrid from '../components/product/ProductGrid'
import ProductGridSkeleton from '../components/product/ProductGridSkeleton'
import QuickViewModal from '../components/product/QuickViewModal'
import SortSelect from '../components/product/SortSelect'
import ViewToggle from '../components/product/ViewToggle'
import Pagination from '../components/common/Pagination'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import ErrorMessage from '../components/ui/ErrorMessage'
import Toast from '../components/ui/Toast'
import { useCatalogProducts } from '../hooks/useCatalogProducts'
import { useCategories } from '../hooks/useCategories'
import { useToast } from '../hooks/useToast'
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
import { cn } from '../utils/classNames'
import './ProductListingPage.css'

/**
 * Product catalog for three routes:
 *   /products?q=…&sort=…   → all products, or search results
 *   /categories/:slug      → one category
 *   /deals                 → all products, biggest discount first
 *
 * SERVER-SIDE: search (?q) and category (:slug) choose which products are fetched.
 * CLIENT-SIDE: price, rating, brand, and stock filters, sorting, and pagination
 * (DummyJSON has no API parameters for those — see utils/catalog.js).
 */
function ProductListingPage({ title = 'All products', defaultSort = 'featured' }) {
  const { categorySlug } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
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

  function handleSortChange(value) {
    setSearchParams((currentParams) => {
      const nextParams = new URLSearchParams(currentParams)
      if (value === defaultSort) nextParams.delete('sort')
      else nextParams.set('sort', value)
      return nextParams
    })
  }

  // A new scope (search or category) = a new `key`, so React throws away the
  // old Catalog and its state (filters, page, layout) and mounts a fresh one.
  const scopeKey = searchQuery ? `search:${searchQuery}` : `category:${categorySlug ?? 'all'}`

  return (
    <div className="listing section container">
      <header className="listing__header">
        <h1 className="listing__title">{heading}</h1>
        {categories.length > 0 && <CategoryNav categories={categories} />}
      </header>

      {isUnknownCategory ? (
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
          sortOption={sortOption}
          onSortChange={handleSortChange}
        />
      )}
    </div>
  )
}

/** Fetches one scope, then filters, sorts, and paginates it on the client. */
function Catalog({ searchQuery, categorySlug, sortOption, onSortChange }) {
  const request = useCatalogProducts({ searchQuery, categorySlug })
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [layout, setLayout] = useState('grid')
  const [areFiltersOpen, setAreFiltersOpen] = useState(false)
  const [quickViewProduct, setQuickViewProduct] = useState(null)
  const toast = useToast()
  const toolbarRef = useRef(null) // scroll target when changing page

  // Derived state: computed from state + props on every render, never stored.
  const products = request.data ?? []
  const brandOptions = getBrandOptions(products)
  // An impossible price range (min > max) is ignored rather than showing zero results.
  const effectiveFilters = hasInvalidPriceRange(filters) ? { ...filters, minPrice: '', maxPrice: '' } : filters
  const visibleProducts = sortProducts(filterProducts(products, effectiveFilters), sortOption.value)
  const pagination = paginate(visibleProducts, page, PRODUCTS_PER_PAGE)
  const activeFilterCount = countActiveFilters(filters)

  // Any change to what's shown sends the shopper back to page 1.
  function handleFiltersChange(nextFilters) {
    setFilters(nextFilters)
    setPage(1)
  }

  function handleClearFilters() {
    handleFiltersChange(EMPTY_FILTERS)
  }

  function handleSortChange(value) {
    onSortChange(value)
    setPage(1)
  }

  function handlePageChange(nextPage) {
    setPage(nextPage)
    toolbarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function handleAddToCart(product) {
    toast.show(`"${product.title}" will go into your cart once the cart is built in Phase 6.`)
  }

  function handleToggleWishlist(product) {
    toast.show(`"${product.title}" will be saved once the wishlist is built in Phase 7.`)
  }

  if (request.isLoading) return <ProductGridSkeleton count={8} />

  if (request.error) {
    return <ErrorMessage title="We couldn't load products" message={request.error.message} onRetry={request.retry} />
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

  return (
    <div className="listing__body">
      <aside
        id="catalog-filters"
        className={cn('listing__filters', areFiltersOpen && 'listing__filters--open')}
        aria-label="Product filters"
      >
        <CatalogFilters
          filters={filters}
          brandOptions={brandOptions}
          onChange={handleFiltersChange}
          onClear={handleClearFilters}
          activeCount={activeFilterCount}
        />
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
              onClick={() => setAreFiltersOpen((isOpen) => !isOpen)}
              aria-expanded={areFiltersOpen}
              aria-controls="catalog-filters"
            >
              <LuSlidersHorizontal aria-hidden="true" />
              Filters{activeFilterCount > 0 && ` (${activeFilterCount})`}
            </button>
            <SortSelect value={sortOption.value} onChange={handleSortChange} />
            <ViewToggle value={layout} onChange={setLayout} />
          </div>
        </div>

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
              onToggleWishlist={handleToggleWishlist}
              onQuickView={setQuickViewProduct}
            />
            <Pagination currentPage={pagination.currentPage} pageCount={pagination.pageCount} onPageChange={handlePageChange} />
          </>
        )}
      </div>

      <QuickViewModal product={quickViewProduct} onClose={() => setQuickViewProduct(null)} onAddToCart={handleAddToCart} />
      <Toast message={toast.message} onDismiss={toast.dismiss} />
    </div>
  )
}

export default ProductListingPage
