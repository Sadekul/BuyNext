import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { LuFilterX, LuSearchX, LuSlidersHorizontal } from 'react-icons/lu'
import CategoryNav from '../components/product/CategoryNav'
import Breadcrumb from '../components/common/Breadcrumb'
import PageMeta from '../components/common/PageMeta'
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
import { catalogQuery, suggestionsQuery } from '../queries/productQueries'
import { useCategories } from '../hooks/useCategories'
import { HAS_SEO } from '../services/seoService'
import { useCart } from '../hooks/useCart'
import { useStoreRedirect } from '../hooks/useStoreRedirect'
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
import { formatBasePrice } from '../utils/formatters'
import { toDescription } from '../utils/pageMeta'
import { followRedirect } from '../utils/safeRedirect'
import { readCatalogParams, withFilters, withParam } from '../utils/catalogParams'
import { categoryAncestors, childCategories, topLevelCategories } from '../utils/categories'
import './ProductListingPage.css'
import { Trans, useTranslation } from 'react-i18next'

/**
 * Product catalog for three routes:
 *   /products?q=…&sort=…   → all products, or search results
 *   /categories/:slug      → one category
 *   /deals                 → all products, biggest discount first
 *
 * SERVER-SIDE: search (?q) and category (:slug) choose which products are fetched.
 * With BuyNest's category tree, a category's products include its
 * subcategories' (the API does that), and the page links to its subcategories.
 * CLIENT-SIDE: price, rating, brand, and availability filters, sorting, and
 * pagination (DummyJSON has no API parameters for those — see utils/catalog.js).
 *
 * All of it lives in the URL (see utils/catalogParams.js), so Back, refresh,
 * and shared links restore exactly the same results.
 */
function ProductListingPage({ title: titleProp, titleKey = 'listing.allProducts', defaultSort = 'featured' }) {
  const { t } = useTranslation('catalog')
  const title = titleProp ?? t(titleKey)
  const { categorySlug } = useParams()
  const [searchParams] = useSearchParams()
  const searchQuery = searchParams.get('q')?.trim() ?? ''
  // Phase 10: "Search instead for …" asks for the words exactly as typed (no typo correction).
  const exact = Boolean(searchQuery) && searchParams.get('exact') === '1'
  // Phase 17: a search within one category (the header's "Search in" select): /products?q=…&category=slug.
  const searchCategory = searchCategoryParam(searchParams, searchQuery, categorySlug)
  const sortOption = getSortOption(searchParams.get('sort'), defaultSort)
  // The same cache entry as the results below (no extra request): did the API correct a typo?
  const correctedQuery = useQuery({ ...catalogQuery({ searchQuery, categorySlug, exact, searchCategory, serverSort: sortOption.serverSort }), enabled: Boolean(searchQuery) }).data?.correctedQuery ?? null

  // Phase 7: an exact search term the store sends straight to a page (the
  // same small request the search box's suggestions make, so usually cached).
  const navigate = useNavigate()
  const searchRedirect = useQuery({ ...suggestionsQuery(searchQuery), enabled: HAS_SEO && searchQuery.length > 0 }).data?.redirectUrl ?? null
  useEffect(() => {
    if (searchRedirect) followRedirect(searchRedirect, navigate)
  }, [searchRedirect, navigate])

  const categoriesRequest = useCategories()
  const categories = categoriesRequest.data ?? []
  const currentCategory = categories.find((category) => category.slug === categorySlug)
  // DummyJSON answers unknown categories with an empty list, not a 404, so we check ourselves.
  const isUnknownCategory = Boolean(categorySlug && categoriesRequest.data && !currentCategory)
  // The category tree (BuyNest's API; DummyJSON's categories are all top-level).
  const ancestors = currentCategory ? categoryAncestors(categories, currentCategory.slug) : []
  const subcategories = currentCategory ? childCategories(categories, currentCategory.slug) : []

  let heading = title
  const searchCategoryName = searchCategory ? (categories.find((category) => category.slug === searchCategory)?.name ?? searchCategory) : null
  if (searchQuery) {
    heading = searchCategory
      ? t('listing.resultsInCategory', { query: correctedQuery ?? searchQuery, category: searchCategoryName })
      : t('listing.resultsFor', { query: correctedQuery ?? searchQuery })
  }
  else if (categorySlug) heading = currentCategory?.name ?? t('listing.category')

  // A new scope (search or category) = a new `key`, so React throws away the
  // old Catalog's local state (open quick view, mobile filter panel).
  const scopeKey = searchQuery ? `search:${exact ? 'exact:' : ''}${searchCategory ? `in:${searchCategory}:` : ''}${searchQuery}` : `category:${categorySlug ?? 'all'}`

  // Search and link-preview tags: a category's own SEO fields (admin, phase 5) when set.
  // Search results are left out of search engines (noindex): they're endless and thin.
  const meta = currentCategory
    ? {
        title: currentCategory.metaTitle ?? currentCategory.name,
        description: toDescription(currentCategory.metaDescription ?? currentCategory.description ?? t('listing.shopCategory', { name: currentCategory.name })),
        image: currentCategory.image,
        canonicalPath: ROUTES.category(currentCategory.slug),
      }
    : { title: heading, noindex: Boolean(searchQuery) }

  return (
    <div className="listing section container">
      <PageMeta {...meta} />
      <header className="listing__header">
        {ancestors.length > 0 && (
          <Breadcrumb
            items={[
              { label: t('listing.allProducts'), to: ROUTES.products },
              ...ancestors.map((category) => ({ label: category.name, to: ROUTES.category(category.slug) })),
              { label: currentCategory.name },
            ]}
          />
        )}
        <h1 className="listing__title">{heading}</h1>
        {/* Phase 10: the API searched for a corrected spelling; the shopper can still have their own words. */}
        {correctedQuery && (
          <p className="listing__correction">
            <Trans t={t} i18nKey="listing.showingFor" values={{ corrected: correctedQuery }} components={{ strong: <strong /> }} />{' '}
            <Link to={`${ROUTES.products}?${new URLSearchParams({ q: searchQuery, exact: '1', ...(searchCategory && { category: searchCategory }) })}`}>
              <Trans t={t} i18nKey="listing.searchInstead" values={{ query: searchQuery }} components={{ em: <em /> }} />
            </Link>
          </p>
        )}
        {categories.length > 0 && (
          <CategoryNav categories={topLevelCategories(categories)} activeSlug={ancestors[0]?.slug ?? null} />
        )}
        {subcategories.length > 0 && (
          <nav className="listing__subcategories" aria-label={t('listing.subcategories', { name: currentCategory.name })}>
            <h2 className="listing__subcategories-title">{t('listing.shopBySubcategory')}</h2>
            <ul className="listing__subcategory-list">
              {subcategories.map((category) => (
                <li key={category.slug}>
                  <Link to={ROUTES.category(category.slug)} className="listing__subcategory-link">
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>

      {categorySlug && categoriesRequest.error ? (
        // Without the category list we can't tell a real category from a typo.
        <ErrorMessage
          title={t('listing.categoriesFailed')}
          message={categoriesRequest.error.message}
          onRetry={categoriesRequest.refetch}
        />
      ) : isUnknownCategory ? (
        <UnknownCategory slug={categorySlug} />
      ) : (
        <Catalog
          key={scopeKey}
          searchQuery={searchQuery}
          exact={exact}
          searchCategory={searchCategory}
          searchCategoryName={searchCategoryName}
          categorySlug={categorySlug}
          categoryName={currentCategory?.name}
          sortOption={sortOption}
          defaultSort={defaultSort}
        />
      )}
    </div>
  )
}

/** Phase 17: `?category=slug` next to a search on /products (a well-formed slug), else ''. */
function searchCategoryParam(searchParams, searchQuery, categorySlug) {
  const slug = searchParams.get('category') ?? ''
  return searchQuery && !categorySlug && /^[a-z0-9-]{1,80}$/.test(slug) ? slug : ''
}

/** A category that doesn't exist: an admin redirect (phase 7, e.g. a renamed category) wins, else "not found". */
function UnknownCategory({ slug }) {
  const { t } = useTranslation('catalog')
  const { checking } = useStoreRedirect()
  if (checking) return <ProductGridSkeleton />
  return (
    <EmptyState icon={LuSearchX} title={t('listing.categoryNotFound')} message={t('listing.noCategory', { slug })}>
      <Button to={ROUTES.products}>{t('listing.browseAll')}</Button>
    </EmptyState>
  )
}

/** Fetches one scope, then filters, sorts, and paginates it on the client. */
function Catalog({ searchQuery, exact, searchCategory = '', searchCategoryName = null, categorySlug, categoryName, sortOption, defaultSort }) {
  const { t } = useTranslation('catalog')
  // Search and category are fetched on the server; each scope is cached separately.
  const request = useQuery(catalogQuery({ searchQuery, categorySlug, exact, searchCategory, serverSort: sortOption.serverSort }))
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
  const products = request.data?.items
  const brandOptions = useMemo(() => getBrandOptions(products ?? []), [products])
  // An impossible price range (min > max) is ignored rather than showing zero
  // results. The list, the chips, and the filter count all use these filters,
  // so they never disagree (the filter panel explains the bad range).
  const effectiveFilters = useMemo(
    () => (hasInvalidPriceRange(filters) ? { ...filters, minPrice: '', maxPrice: '' } : filters),
    [filters],
  )
  const visibleProducts = useMemo(
    () => sortProducts(filterProducts(products ?? [], effectiveFilters), sortOption.value),
    [products, effectiveFilters, sortOption.value],
  )
  const pagination = paginate(visibleProducts, page, PRODUCTS_PER_PAGE)
  const activeFilterCount = countActiveFilters(effectiveFilters)

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

  // useCallback: a stable function so memoized ProductCards can skip re-rendering.
  const handleAddToCart = useCallback(
    (product) => {
      setQuickViewProduct(null) // close quick view first, so the cart drawer isn't stacked on it
      addItem(product)
    },
    [addItem],
  )

  // One removable chip per active filter, including search and category.
  // Removing search or category changes the result set, so it also returns to page 1.
  const chips = []
  if (searchQuery) {
    chips.push({
      id: 'q',
      label: t('listing.chipSearch', { query: searchQuery }),
      onRemove: () => setSearchParams(withParam(withParam(withParam(searchParams, 'q', null), 'exact', null), 'page', null)),
    })
  }
  if (searchCategory) {
    chips.push({
      id: 'search-category',
      label: t('listing.chipCategory', { name: searchCategoryName ?? searchCategory }),
      onRemove: () => setSearchParams(withParam(withParam(searchParams, 'category', null), 'page', null)),
    })
  }
  if (categorySlug) {
    chips.push({
      id: 'category',
      label: t('listing.chipCategory', { name: categoryName ?? categorySlug }),
      onRemove: () => navigate({ pathname: ROUTES.products, search: withParam(searchParams, 'page', null).toString() }),
    })
  }
  if (effectiveFilters.minPrice !== '') {
    chips.push({ id: 'min', label: t('listing.chipFrom', { amount: formatBasePrice(Number(filters.minPrice)) }), onRemove: () => handleFiltersChange({ ...filters, minPrice: '' }) })
  }
  if (effectiveFilters.maxPrice !== '') {
    chips.push({ id: 'max', label: t('listing.chipUpTo', { amount: formatBasePrice(Number(filters.maxPrice)) }), onRemove: () => handleFiltersChange({ ...filters, maxPrice: '' }) })
  }
  if (filters.minRating > 0) {
    chips.push({ id: 'rating', label: t('listing.chipRating', { rating: filters.minRating }), onRemove: () => handleFiltersChange({ ...filters, minRating: 0 }) })
  }
  filters.brands.forEach((brand) => {
    chips.push({
      id: `brand-${brand}`,
      label: brand,
      onRemove: () => handleFiltersChange({ ...filters, brands: filters.brands.filter((name) => name !== brand) }),
    })
  })
  if (filters.inStockOnly) {
    chips.push({ id: 'available', label: t('listing.chipAvailable'), onRemove: () => handleFiltersChange({ ...filters, inStockOnly: false }) })
  }

  function handleClearAllChips() {
    // Drop search, filters, and page but keep sort and view; leave a category page for all products.
    const next = withParam(withParam(withFilters(searchParams, EMPTY_FILTERS), 'q', null), 'exact', null)
    if (categorySlug) navigate({ pathname: ROUTES.products, search: next.toString() })
    else setSearchParams(next)
  }

  if (request.isPending) return <ProductGridSkeleton count={8} />

  if (request.error) {
    return <ErrorMessage title={t('listing.productsFailed')} message={request.error.message} onRetry={() => request.refetch()} />
  }

  if (products.length === 0) {
    return (
      <EmptyState
        icon={LuSearchX}
        title={searchQuery ? t('listing.noResults', { query: searchQuery }) : t('listing.noProducts')}
        message={t(searchQuery ? 'listing.checkSpelling' : 'listing.tryAnother')}
      >
        <Button to={ROUTES.products} variant="outline">
          {t('listing.browseAll')}
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
      <aside className="listing__filters" aria-label={t('listing.filtersLabel')}>
        {filterPanel(true)}
      </aside>

      <div className="listing__results">
        <div className="listing__toolbar" ref={toolbarRef}>
          <p className="listing__count" role="status">
            {visibleProducts.length === 0
              ? t('listing.zero', { n: 0 })
              : t('listing.showing', { start: pagination.start, end: pagination.end, total: visibleProducts.length })}
          </p>
          <div className="listing__controls">
            <button
              type="button"
              className="listing__filter-toggle"
              onClick={() => setAreFiltersOpen(true)}
              aria-haspopup="dialog"
            >
              <LuSlidersHorizontal aria-hidden="true" />
              {activeFilterCount > 0 ? t('listing.filtersCount', { count: activeFilterCount }) : t('listing.filters')}
            </button>
            {/* A search keeps the API's order by default: the most relevant first (BuyNest's API ranks results). */}
            <SortSelect value={sortOption.value} onChange={handleSortChange} labels={searchQuery ? { featured: t('listing.bestMatch') } : undefined} />
            <ViewToggle value={layout} onChange={handleLayoutChange} />
          </div>
        </div>

        <ActiveFilters chips={chips} onClearAll={handleClearAllChips} />

        {visibleProducts.length === 0 ? (
          <EmptyState icon={LuFilterX} title={t('listing.noMatchFilters')} message={t('listing.noMatchHint')}>
            <Button variant="outline" onClick={handleClearFilters}>
              {t('listing.clearFilters')}
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
        title={activeFilterCount > 0 ? t('listing.filtersCount', { count: activeFilterCount }) : t('listing.filters')}
        variant="drawer"
        footer={
          <Button fullWidth onClick={() => setAreFiltersOpen(false)}>
            {t('listing.showProducts', { count: visibleProducts.length })}
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
