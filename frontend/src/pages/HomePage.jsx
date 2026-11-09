import HeroBanner from '../components/home/HeroBanner'
import FeaturedCategories from '../components/home/FeaturedCategories'
import ProductSection from '../components/home/ProductSection'
import PromoBanner from '../components/home/PromoBanner'
import BenefitsSection from '../components/home/BenefitsSection'
import Newsletter from '../components/forms/Newsletter'
import ErrorMessage from '../components/ui/ErrorMessage'
import Toast from '../components/ui/Toast'
import { useFetch } from '../hooks/useFetch'
import { useCategories } from '../hooks/useCategories'
import { useToast } from '../hooks/useToast'
import { ROUTES } from '../constants/routes'
import { customerBenefits, featuredCategories, heroContent, homeCollectionIds, promoBanners } from '../data/homeContent'
import { ALL_PRODUCTS, getProducts } from '../services/productService'
import { buildHomeCollections } from '../utils/productCollections'

const EMPTY_COLLECTIONS = { featured: [], newArrivals: [], bestSellers: [], specialOffers: [] }

/**
 * One request for every product (card fields only, ~53 KB), then the
 * collections are picked client-side. DummyJSON can't fetch a list of
 * specific IDs, and 24 single-product requests would be far slower.
 */
async function fetchHomeCollections(signal) {
  const { items } = await getProducts({ limit: ALL_PRODUCTS, signal })
  return buildHomeCollections(items, homeCollectionIds)
}

/**
 * The storefront homepage: composes section components and feeds them
 * live API data. Loading, error, and retry states come from custom hooks.
 */
function HomePage() {
  const collectionsRequest = useFetch('home-collections', fetchHomeCollections)
  const categoriesRequest = useCategories()
  const toast = useToast()

  const collections = collectionsRequest.data ?? EMPTY_COLLECTIONS
  const isLoadingProducts = collectionsRequest.isLoading

  // Merge configured images with live category names; only show categories the API confirms exist.
  const categories = featuredCategories
    .map((featured) => ({
      ...featured,
      name: categoriesRequest.data?.find((category) => category.slug === featured.slug)?.name,
    }))
    .filter((category) => category.name)

  // Passed down as a function prop. The real cart replaces this in Phase 6.
  function handleAddToCart(product) {
    toast.show(`"${product.title}" will go into your cart once the cart is built in Phase 6.`)
  }

  const productsUnavailable = collectionsRequest.error && (
    <section className="section section--muted" aria-label="Products">
      <div className="container">
        <ErrorMessage
          title="We couldn't load products"
          message={collectionsRequest.error.message}
          onRetry={collectionsRequest.retry}
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
        isLoading={categoriesRequest.isLoading}
        error={categoriesRequest.error}
        onRetry={categoriesRequest.retry}
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
      <Toast message={toast.message} onDismiss={toast.dismiss} />
    </>
  )
}

export default HomePage
