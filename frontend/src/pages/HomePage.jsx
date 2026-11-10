import { useCallback } from 'react'
import HeroBanner from '../components/home/HeroBanner'
import FeaturedCategories from '../components/home/FeaturedCategories'
import ProductSection from '../components/home/ProductSection'
import PromoBanner from '../components/home/PromoBanner'
import BenefitsSection from '../components/home/BenefitsSection'
import Newsletter from '../components/forms/Newsletter'
import ErrorMessage from '../components/ui/ErrorMessage'
import Loader from '../components/ui/Loader'
import { useQuery } from '@tanstack/react-query'
import { useCategories } from '../hooks/useCategories'
import { useCart } from '../hooks/useCart'
import { ROUTES } from '../constants/routes'
import { REAL_SHOP } from '../constants/shop'
import { SITE } from '../constants/site'
import { customerBenefits, featuredCategories, heroContent, homeCollectionIds, promoBanners } from '../data/homeContent'
import { allProductsQuery } from '../queries/productQueries'
import { homeContentQuery } from '../queries/contentQueries'
import { buildHomeCollections } from '../utils/productCollections'

const EMPTY_COLLECTIONS = { featured: [], newArrivals: [], bestSellers: [], specialOffers: [] }

/**
 * REAL_SHOP: the hero from the admin's CMS. While it loads (or if it can't
 * be loaded) the page keeps its h1 and the sections below still render.
 */
function CmsHero({ request }) {
  if (request.data) return <HeroBanner content={request.data.hero} />
  return (
    <section className="hero section" aria-labelledby="hero-title">
      <div className="container">
        {request.error ? (
          <ErrorMessage titleAs="h1" title="We couldn't load this page's highlights" message={request.error.message} onRetry={request.refetch} />
        ) : (
          <>
            <h1 id="hero-title" className="visually-hidden">
              {SITE.name}
            </h1>
            <Loader label="Loading…" />
          </>
        )}
      </div>
    </section>
  )
}

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
  // REAL_SHOP: hero, promo banners, and featured products come from the admin's CMS.
  const homeRequest = useQuery({ ...homeContentQuery(), enabled: REAL_SHOP })
  const cmsFeatured = homeRequest.data?.featuredProducts ?? []
  const banners = REAL_SHOP ? (homeRequest.data?.banners ?? []) : promoBanners
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
      {REAL_SHOP ? <CmsHero request={homeRequest} /> : <HeroBanner content={heroContent} />}
      <BenefitsSection benefits={customerBenefits} />
      <FeaturedCategories
        categories={categories}
        isLoading={categoriesRequest.isPending}
        error={categoriesRequest.error}
        onRetry={categoriesRequest.refetch}
      />

      {REAL_SHOP && (homeRequest.isPending || cmsFeatured.length > 0) && (
        <ProductSection
          eyebrow="Handpicked"
          title="Featured products"
          products={cmsFeatured}
          isLoading={homeRequest.isPending}
          viewAllTo={ROUTES.products}
          onAddToCart={handleAddToCart}
          muted
        />
      )}

      {productsUnavailable || (!REAL_SHOP && (
        <ProductSection
          eyebrow="Handpicked"
          title="Featured products"
          products={collections.featured}
          isLoading={isLoadingProducts}
          viewAllTo={ROUTES.products}
          onAddToCart={handleAddToCart}
          muted
        />
      ))}

      {banners.length > 0 && (
        <section className="section" aria-label="Promotions">
          <div className="container promo-section">
            {banners.map((banner) => (
              <PromoBanner key={banner.id} banner={banner} />
            ))}
          </div>
        </section>
      )}

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
