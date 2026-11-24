import { useCallback } from 'react'
import HeroBanner from '../components/home/HeroBanner'
import HeroSlider from '../components/home/HeroSlider'
import FeaturedCategories from '../components/home/FeaturedCategories'
import ProductSection from '../components/home/ProductSection'
import PromoBanner from '../components/home/PromoBanner'
import BenefitsSection from '../components/home/BenefitsSection'
import Newsletter from '../components/forms/Newsletter'
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
import { allProductsQuery } from '../queries/productQueries'
import { homeContentQuery } from '../queries/contentQueries'
import { buildHomeCollections } from '../utils/productCollections'
import { useTranslation } from 'react-i18next'

const EMPTY_COLLECTIONS = { featured: [], newArrivals: [], bestSellers: [], specialOffers: [] }

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
  const { t } = useTranslation('marketing')
  const collectionsRequest = useQuery({ ...allProductsQuery(), select: selectHomeCollections })
  // REAL_SHOP: hero, promo banners, and featured products come from the admin's CMS.
  const homeRequest = useQuery({ ...homeContentQuery(), enabled: REAL_SHOP })
  const cmsFeatured = homeRequest.data?.featuredProducts ?? []
  const banners = REAL_SHOP ? (homeRequest.data?.banners ?? []) : localizedPromoBanners(t)
  const categoriesRequest = useCategories()
  const { addItem } = useCart()
  // The free-shipping line names the store's own threshold and currency ("৳৫,০০০"), never a fixed "$50".
  const { settings } = useStoreSettings()
  const freeShipping = freeShippingAmount(settings.freeShippingThreshold, formatBasePrice)

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
    <section className="section section--muted" aria-label={t('home.products')}>
      <div className="container">
        <ErrorMessage
          title={t('home.productsFailed')}
          message={collectionsRequest.error.message}
          onRetry={collectionsRequest.refetch}
        />
      </div>
    </section>
  )

  return (
    <>
      {REAL_SHOP ? <CmsHero request={homeRequest} storeName={settings.storeName} /> : <HeroBanner content={localizedHeroContent(t, freeShipping)} />}
      <BenefitsSection benefits={localizedBenefits(t, freeShipping)} />
      <FeaturedCategories
        categories={categories}
        isLoading={categoriesRequest.isPending}
        error={categoriesRequest.error}
        onRetry={categoriesRequest.refetch}
      />

      {REAL_SHOP && (homeRequest.isPending || cmsFeatured.length > 0) && (
        <ProductSection
          eyebrow={t('home.handpicked')}
          title={t('home.featured')}
          products={cmsFeatured}
          isLoading={homeRequest.isPending}
          viewAllTo={ROUTES.products}
          onAddToCart={handleAddToCart}
          muted
        />
      )}

      {productsUnavailable || (!REAL_SHOP && (
        <ProductSection
          eyebrow={t('home.handpicked')}
          title={t('home.featured')}
          products={collections.featured}
          isLoading={isLoadingProducts}
          viewAllTo={ROUTES.products}
          onAddToCart={handleAddToCart}
          muted
        />
      ))}

      {banners.length > 0 && (
        <section className="section" aria-label={t('home.promotions')}>
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
            eyebrow={t('home.justLanded')}
            title={t('home.newArrivals')}
            products={collections.newArrivals}
            isLoading={isLoadingProducts}
            viewAllTo={ROUTES.products}
            onAddToCart={handleAddToCart}
          />
          <ProductSection
            eyebrow={t('home.limited')}
            title={t('home.offers')}
            description={t('home.offersDescription')}
            products={collections.specialOffers}
            isLoading={isLoadingProducts}
            skeletonCount={4}
            viewAllTo={ROUTES.deals}
            onAddToCart={handleAddToCart}
            muted
          />
          <ProductSection
            eyebrow={t('home.favorites')}
            title={t('home.bestSellers')}
            products={collections.bestSellers}
            isLoading={isLoadingProducts}
            viewAllTo={ROUTES.products}
            onAddToCart={handleAddToCart}
          />
        </>
      )}

      {/* Phase 11: products this browser opened before (nothing when there are none). */}
      <RecentlyViewedSection onAddToCart={handleAddToCart} />

      <Newsletter />
    </>
  )
}

function RecentlyViewedSection({ onAddToCart }) {
  if (useRecentlyViewed().length === 0) return null
  return (
    <div className="section">
      <div className="container">
        <RecentlyViewed onAddToCart={onAddToCart} />
      </div>
    </div>
  )
}

export default HomePage
