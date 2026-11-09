import { useParams, useSearchParams } from 'react-router'
import { LuSearchX } from 'react-icons/lu'
import CategoryNav from '../components/product/CategoryNav'
import ProductGrid from '../components/product/ProductGrid'
import ProductGridSkeleton from '../components/product/ProductGridSkeleton'
import SortSelect from '../components/product/SortSelect'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import ErrorMessage from '../components/ui/ErrorMessage'
import Toast from '../components/ui/Toast'
import { useCategories } from '../hooks/useCategories'
import { useProductList } from '../hooks/useProductList'
import { useToast } from '../hooks/useToast'
import { ROUTES } from '../constants/routes'
import { getSortOption } from '../constants/catalog'
import './ProductListingPage.css'

/**
 * Product listing for three routes:
 *   /products?q=…          → all products, or server-side search results
 *   /categories/:slug      → one category
 *   /deals                 → all products, biggest discount first
 * Search text and sort order live in the URL, so results can be bookmarked and shared.
 * Filters (price, rating, brand) and grid/list views arrive in Phase 4.
 */
function ProductListingPage({ title = 'All products', defaultSort = 'featured' }) {
  const { categorySlug } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const searchQuery = searchParams.get('q')?.trim() ?? ''
  const sortOption = getSortOption(searchParams.get('sort'), defaultSort)

  const categoriesRequest = useCategories()
  const productList = useProductList({ searchQuery, categorySlug, sortOption })
  const toast = useToast()

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

  function handleAddToCart(product) {
    toast.show(`"${product.title}" will go into your cart once the cart is built in Phase 6.`)
  }

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
        <>
          <div className="listing__toolbar">
            <p className="listing__count" role="status">
              {!productList.isLoading && !productList.error && `${productList.total} products`}
            </p>
            <SortSelect value={sortOption.value} onChange={handleSortChange} />
          </div>

          <ProductResults productList={productList} searchQuery={searchQuery} onAddToCart={handleAddToCart} />
        </>
      )}

      <Toast message={toast.message} onDismiss={toast.dismiss} />
    </div>
  )
}

/** Loading → error → empty → results, plus the "load more" footer. */
function ProductResults({ productList, searchQuery, onAddToCart }) {
  const { products, total, isLoading, error, retry, hasMore, loadNextPage, isLoadingMore, loadMoreError } =
    productList

  if (isLoading) return <ProductGridSkeleton count={8} />

  if (error) {
    return <ErrorMessage title="We couldn't load products" message={error.message} onRetry={retry} />
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
    <>
      <ProductGrid products={products} onAddToCart={onAddToCart} />
      <div className="listing__footer">
        <p>
          Showing {products.length} of {total} products
        </p>
        {loadMoreError && (
          <p className="listing__load-error" role="alert">
            {loadMoreError.message}
          </p>
        )}
        {hasMore && (
          <Button variant="outline" onClick={loadNextPage} disabled={isLoadingMore}>
            {isLoadingMore ? 'Loading…' : loadMoreError ? 'Try again' : 'Load more products'}
          </Button>
        )}
      </div>
    </>
  )
}

export default ProductListingPage
