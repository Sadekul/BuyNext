import { useCallback } from 'react'
import HeroBanner from '../components/home/HeroBanner'
import FeaturedCategories from '../components/home/FeaturedCategories'
import ProductSection from '../components/home/ProductSection'
import PromoBanner from '../components/home/PromoBanner'
import BenefitsSection from '../components/home/BenefitsSection'
import Newsletter from '../components/forms/Newsletter'
import ErrorMessage from '../components/ui/ErrorMessage'
import { useQuery } from '@tanstack/react-query'
import { useCategories } from '../hooks/useCategories'
import { useCart } from '../hooks/useCart'
import { ROUTES } from '../constants/routes'
import { customerBenefits, featuredCategories, heroContent, homeCollectionIds, promoBanners } from '../data/homeContent'
import { allProductsQuery } from '../queries/productQueries'
import { buildHomeCollections } from '../utils/productCollections'

const EMPTY_COLLECTIONS = { featured: [], newArrivals: [], bestSellers: [], specialOffers: [] }

/**
 * One request for every product (card fields only, ~53 KB), then the
 * collections are picked client-side. DummyJSON can't fetch a list of
 * specific IDs, and 24 single-product requests would be far slower.
 * `select` derives the collections from the cached list (module-level, so
 * it's a stable function and only re-runs when the data changes).
 */
const selectHomeCollections = (items) => buildHomeCollections(items, homeCollectionIds)

/**
 * The storefront homepage: composes section components and feeds them
 * live API data. Loading, error, and retry states come from custom hooks.
 */
function HomePage() {
  const collectionsRequest = useQuery({ ...allProductsQuery(), select: selectHomeCollections })
  const categoriesRequest = useCategories()
  const { addItem } = useCart()

  const collections = collectionsRequest.data ?? EMPTY_COLLECTIONS
  const isLoadingProducts = collectionsRequest.isPending

  // Merge configured images with live category names; only show categories the API confirms exist.
  const categories = featuredCategories
    .map((featured) => ({
      ...featured,
      name: categoriesRequest.data?.find((category) => category.slug === featured.slug)?.name,
    }))
    .filter((category) => category.name)

  // Passed down as a function prop: ProductCard reports the click, the cart
  // handles it. useCallback keeps the same function between renders, so the
  // memoized ProductCards don't re-render just because HomePage did.
  const handleAddToCart = useCallback((product) => addItem(product), [addItem])

  const productsUnavailable = collectionsRequest.error && (
    <section className="section section--muted" aria-label="Products">
      <div className="container">
        <ErrorMessage
          title="We couldn't load products"
          message={collectionsRequest.error.message}
          onRetry={collectionsRequest.refetch}
        />
      </div>
    </section>
  )

  return (
    <>
      <HeroBanner content={heroContent} />
      <BenefitsSection benefits={customerBenefits} />
      <FeaturedCategories
        categories={categories}
        isLoading={categoriesRequest.isPending}
        error={categoriesRequest.error}
        onRetry={categoriesRequest.refetch}
      />

      {productsUnavailable || (
        <ProductSection
          eyebrow="Handpicked"
          title="Featured products"
          products={collections.featured}
          isLoading={isLoadingProducts}
          viewAllTo={ROUTES.products}
          onAddToCart={handleAddToCart}
          muted
        />
      )}

      <section className="section" aria-label="Promotions">
        <div className="container promo-section">
          {promoBanners.map((banner) => (
            <PromoBanner key={banner.id} banner={banner} />
          ))}
        </div>
      </section>

      {/* If products failed, the single error panel above covers every product section. */}
      {!collectionsRequest.error && (
        <>
          <ProductSection
            eyebrow="Just landed"
            title="New arrivals"
            products={collections.newArrivals}
            isLoading={isLoadingProducts}
            viewAllTo={ROUTES.products}
            onAddToCart={handleAddToCart}
          />
          <ProductSection
            eyebrow="Limited time"
            title="Special offers"
            description="Our biggest in-stock discounts right now."
            products={collections.specialOffers}
            isLoading={isLoadingProducts}
            skeletonCount={4}
            viewAllTo={ROUTES.deals}
            onAddToCart={handleAddToCart}
            muted
          />
          <ProductSection
            eyebrow="Customer favorites"
            title="Best sellers"
            products={collections.bestSellers}
            isLoading={isLoadingProducts}
            viewAllTo={ROUTES.products}
            onAddToCart={handleAddToCart}
          />
        </>
      )}

      <Newsletter />
    </>
  )
}

export default HomePage
