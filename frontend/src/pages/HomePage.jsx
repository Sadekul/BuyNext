import { useCallback } from 'react'
import HeroBanner from '../components/home/HeroBanner'
import HeroSlider from '../components/home/HeroSlider'
import FeaturedCategories from '../components/home/FeaturedCategories'
import DealsBand from '../components/home/DealsBand'
import PromoGrid from '../components/home/PromoGrid'
import ProductCarousel from '../components/home/ProductCarousel'
import BenefitsSection from '../components/home/BenefitsSection'
import BrandStrip from '../components/home/BrandStrip'
import HomeNewsletter from '../components/home/HomeNewsletter'
import RecentlyViewed from '../components/product/RecentlyViewed'
import { useRecentlyViewed } from '../utils/recentlyViewed'
import ErrorMessage from '../components/ui/ErrorMessage'
import Loader from '../components/ui/Loader'
import { useQuery } from '@tanstack/react-query'
import { useCategories } from '../hooks/useCategories'
import { useCart } from '../hooks/useCart'
import { ROUTES } from '../constants/routes'
import { REAL_SHOP } from '../constants/shop'
import { SITE, freeShippingAmount } from '../constants/site'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { formatBasePrice } from '../utils/formatters'
import { featuredCategories, homeCollectionIds, localizedBenefits, localizedHeroContent, localizedPromoBanners } from '../data/homeContent'
import { allProductsQuery, newestProductsQuery } from '../queries/productQueries'
import { homeContentQuery } from '../queries/contentQueries'
import { CAN_SORT_BY_NEWEST } from '../services/productService'
import { pickProductsByIds } from '../utils/productCollections'
import { pickBrands, pickCategoryTiles, pickDeals } from '../utils/homeSections'
import { useTranslation } from 'react-i18next'
import '../components/home/home.css'

const NO_PRODUCTS = []

/**
 * REAL_SHOP: the hero (single banner or slider) from the admin's CMS. While it loads (or if it can't
 * be loaded) the page keeps its h1 and the sections below still render.
 */
function CmsHero({ request, storeName }) {
  const { t } = useTranslation('marketing')
  // The admin's choice (HOME_SLIDER_CONTRACT.md): the slider when it has a slide, the single banner otherwise.
  if (request.data?.heroMode === 'slider' && request.data.slides?.length > 0) {
    return <HeroSlider slides={request.data.slides} settings={request.data.slider} heading={storeName || SITE.name} />
  }
  if (request.data) return <HeroBanner content={request.data.hero} />
  return (
    <section className="hero section" aria-labelledby="hero-title">
      <div className="container">
        {request.error ? (
          <ErrorMessage titleAs="h1" title={t('home.heroFailed')} message={request.error.message} onRetry={request.refetch} />
        ) : (
          <>
            <h1 id="hero-title" className="visually-hidden">
              {SITE.name}
            </h1>
            <Loader label={t('home.loading')} />
          </>
        )}
      </div>
    </section>
  )
}

/**
 * The storefront homepage (docs/STOREFRONT_REDESIGN.md, "Home page"), in this order, each section
 * only when it has real data:
 *   1. hero banner / slider          (the admin's CMS; the demo's static hero)
 *   2. Shop by category              (categories + a photo each)
 *   3. Today's deals                 (biggest real discounts in stock; no countdown: no end dates in the API)
 *   4. promo grid                    (the home banners as a bento grid)
 *   5. New arrivals carousel         (BuyNest's API: newest first) / Featured products (the CMS's picks;
 *                                     the demo's hand-picked ones)
 *   6. benefits, 7. brands, recently viewed (phase 11), 8. newsletter
 *
 * One request loads every product (card fields only); deals, brands and the category photos are
 * picked from it client-side. DummyJSON can't fetch a list of specific IDs.
 */
function HomePage() {
  const { t } = useTranslation('marketing')
  const productsRequest = useQuery(allProductsQuery())
  // REAL_SHOP: hero, promo banners, and featured products come from the admin's CMS.
  const homeRequest = useQuery({ ...homeContentQuery(), enabled: REAL_SHOP })
  const newestRequest = useQuery({ ...newestProductsQuery(12), enabled: CAN_SORT_BY_NEWEST })
  const banners = REAL_SHOP ? (homeRequest.data?.banners ?? NO_PRODUCTS) : localizedPromoBanners(t)
  const categoriesRequest = useCategories()
  const { addItem } = useCart()
  // The free-shipping line names the store's own threshold and currency ("৳৫,০০০"), never a fixed "$50".
  const { settings } = useStoreSettings()
  const freeShipping = freeShippingAmount(settings.freeShippingThreshold, formatBasePrice)

  const products = productsRequest.data ?? NO_PRODUCTS
  const isLoadingProducts = productsRequest.isPending

  const categories = pickCategoryTiles({ categories: categoriesRequest.data, products, configured: featuredCategories })
  const { deals, maxDiscount } = pickDeals(products)
  const brands = pickBrands(products)
  // Featured: the admin's picks (REAL_SHOP), or the demo's hand-picked list.
  const featured = REAL_SHOP ? (homeRequest.data?.featuredProducts ?? NO_PRODUCTS) : pickProductsByIds(products, homeCollectionIds.featured)
  const featuredLoading = REAL_SHOP ? homeRequest.isPending : isLoadingProducts

  // Passed down as a function prop: ProductCard reports the click, the cart
  // handles it. useCallback keeps the same function between renders, so the
  // memoized ProductCards don't re-render just because HomePage did.
  const handleAddToCart = useCallback((product) => addItem(product), [addItem])

  return (
    <>
      {REAL_SHOP ? <CmsHero request={homeRequest} storeName={settings.storeName} /> : <HeroBanner content={localizedHeroContent(t, freeShipping)} />}

      <FeaturedCategories
        categories={categories}
        isLoading={categoriesRequest.isPending}
        error={categoriesRequest.error}
        onRetry={categoriesRequest.refetch}
      />

      {productsRequest.error ? (
        <section className="section" aria-label={t('home.products')}>
          <div className="container">
            <ErrorMessage title={t('home.productsFailed')} message={productsRequest.error.message} onRetry={productsRequest.refetch} />
          </div>
        </section>
      ) : (
        <DealsBand deals={deals} maxDiscount={maxDiscount} isLoading={isLoadingProducts} onAddToCart={handleAddToCart} />
      )}

      <PromoGrid banners={banners} />

      {CAN_SORT_BY_NEWEST && !newestRequest.error && (
        <ProductCarousel
          eyebrow={t('home.justLanded')}
          title={t('home.newArrivals')}
          products={newestRequest.data ?? NO_PRODUCTS}
          isLoading={newestRequest.isPending}
          viewAllTo={ROUTES.products}
          onAddToCart={handleAddToCart}
          muted
        />
      )}

      {!(productsRequest.error && !REAL_SHOP) && (
        <ProductCarousel
          eyebrow={t('home.handpicked')}
          title={t('home.featured')}
          products={featured}
          isLoading={featuredLoading}
          viewAllTo={ROUTES.products}
          onAddToCart={handleAddToCart}
          muted={!CAN_SORT_BY_NEWEST}
        />
      )}

      <BenefitsSection benefits={localizedBenefits(t, freeShipping)} />

      <BrandStrip brands={brands} />

      {/* Phase 11: products this browser opened before (nothing when there are none). */}
      <RecentlyViewedSection onAddToCart={handleAddToCart} />

      <HomeNewsletter />
    </>
  )
}

function RecentlyViewedSection({ onAddToCart }) {
  if (useRecentlyViewed().length === 0) return null
  return (
    <div className="section home-section">
      <div className="container">
        <RecentlyViewed onAddToCart={onAddToCart} />
      </div>
    </div>
  )
}

export default HomePage
