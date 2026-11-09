import { useCallback, useState } from 'react'
import HeroBanner from '../components/home/HeroBanner'
import FeaturedCategories from '../components/home/FeaturedCategories'
import ProductSection from '../components/home/ProductSection'
import PromoBanner from '../components/home/PromoBanner'
import BenefitsSection from '../components/home/BenefitsSection'
import Newsletter from '../components/forms/Newsletter'
import Toast from '../components/ui/Toast'
import { ROUTES } from '../constants/routes'
import { customerBenefits, heroContent, promoBanners } from '../data/homeContent'
import { sampleCategories } from '../data/sampleCategories'
import { homeCollectionIds } from '../data/sampleProducts'
import { getSampleProductsByIds, getTopDiscountedProducts } from '../data/productHelpers'

// Computed once at module load: sample data never changes at runtime.
// In Phase 3 these become API requests.
const featuredProducts = getSampleProductsByIds(homeCollectionIds.featured)
const newArrivals = getSampleProductsByIds(homeCollectionIds.newArrivals)
const bestSellers = getSampleProductsByIds(homeCollectionIds.bestSellers)
const specialOffers = getTopDiscountedProducts(4)

/**
 * The storefront homepage: a page component that composes section
 * components and feeds them data. It holds no layout or styling of its own.
 */
function HomePage() {
  const [toastMessage, setToastMessage] = useState('')

  // Passed down as a function prop: ProductCard calls it, HomePage decides what happens.
  // The real cart (Context + useReducer) replaces this in Phase 6.
  function handleAddToCart(product) {
    setToastMessage(`"${product.title}" will go into your cart once the cart is built in Phase 6.`)
  }

  // useCallback keeps the same function between renders, so Toast's effect
  // (which lists onDismiss as a dependency) doesn't restart its timer needlessly.
  const dismissToast = useCallback(() => setToastMessage(''), [])

  return (
    <>
      <HeroBanner content={heroContent} />
      <BenefitsSection benefits={customerBenefits} />
      <FeaturedCategories categories={sampleCategories} />

      <ProductSection
        eyebrow="Handpicked"
        title="Featured products"
        products={featuredProducts}
        viewAllTo={ROUTES.products}
        onAddToCart={handleAddToCart}
        muted
      />

      <section className="section" aria-label="Promotions">
        <div className="container promo-section">
          {promoBanners.map((banner) => (
            <PromoBanner key={banner.id} banner={banner} />
          ))}
        </div>
      </section>

      <ProductSection
        eyebrow="Just landed"
        title="New arrivals"
        products={newArrivals}
        viewAllTo={ROUTES.products}
        onAddToCart={handleAddToCart}
      />

      <ProductSection
        eyebrow="Limited time"
        title="Special offers"
        description="Our biggest in-stock discounts right now."
        products={specialOffers}
        viewAllTo={ROUTES.deals}
        onAddToCart={handleAddToCart}
        muted
      />

      <ProductSection
        eyebrow="Customer favorites"
        title="Best sellers"
        products={bestSellers}
        viewAllTo={ROUTES.products}
        onAddToCart={handleAddToCart}
      />

      <Newsletter />
      <Toast message={toastMessage} onDismiss={dismissToast} />
    </>
  )
}

export default HomePage
