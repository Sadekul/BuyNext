import { ROUTES } from '../constants/routes'

/*
 * SAMPLE CONTENT — homepage marketing copy and editorial picks. In Phase 12 these sections become
 * admin-managed content (banners, promos) delivered by the backend API.
 * Images are real DummyJSON product photos.
 */
export const heroContent = {
  eyebrow: 'New season essentials',
  title: 'Everything you love, delivered to your nest.',
  description:
    'Discover premium electronics, fashion, beauty, and home essentials — curated for quality and priced for everyday life.',
  primaryCta: { label: 'Shop now', to: ROUTES.products },
  secondaryCta: { label: 'Explore deals', to: ROUTES.deals },
  image: 'https://cdn.dummyjson.com/product-images/mobile-accessories/apple-airpods-max-silver/1.webp',
  imageAlt: 'Apple AirPods Max over-ear headphones in silver',
  highlights: ['Free shipping over $50', '30-day returns', 'Secure checkout'],
}

export const promoBanners = [
  {
    id: 'work-anywhere',
    eyebrow: 'Laptops',
    title: 'Work from anywhere',
    description: 'Thin, light, powerful laptops for work and play.',
    cta: { label: 'Shop laptops', to: ROUTES.category('laptops') },
    image: 'https://cdn.dummyjson.com/product-images/laptops/huawei-matebook-x-pro/1.webp',
    imageAlt: 'Huawei MateBook X Pro laptop',
    tone: 'navy',
  },
  {
    id: 'signature-scents',
    eyebrow: 'Fragrances',
    title: 'Find your signature scent',
    description: 'Iconic fragrances from Chanel, Dior, Gucci and more.',
    cta: { label: 'Shop fragrances', to: ROUTES.category('fragrances') },
    image: 'https://cdn.dummyjson.com/product-images/fragrances/chanel-coco-noir-eau-de/1.webp',
    imageAlt: 'Chanel Coco Noir eau de parfum bottle',
    tone: 'emerald',
  },
  {
    id: 'smart-phones',
    eyebrow: 'Smartphones',
    title: 'Upgrade your phone',
    description: 'The latest smartphones from Apple, Samsung and more.',
    cta: { label: 'Shop smartphones', to: ROUTES.category('smartphones') },
    image: 'https://cdn.dummyjson.com/product-images/smartphones/iphone-13-pro/1.webp',
    imageAlt: 'iPhone 13 Pro smartphone',
    tone: 'amber',
  },
  // Phase 17: the first two sit beside the hero, the rest form the promo row below the top products.
  {
    id: 'cosy-home',
    eyebrow: 'Furniture',
    title: 'Make your home cosier',
    description: 'Sofas, beds and tables for every room.',
    cta: { label: 'Shop furniture', to: ROUTES.category('furniture') },
    image: 'https://cdn.dummyjson.com/product-images/furniture/annibale-colombo-sofa/thumbnail.webp',
    imageAlt: 'Annibale Colombo sofa',
    tone: 'rose',
  },
  {
    id: 'time-pieces',
    eyebrow: "Men's watches",
    title: 'Time for a new watch',
    description: 'Classic and modern watches from Rolex, Longines and more.',
    cta: { label: 'Shop watches', to: ROUTES.category('mens-watches') },
    image: 'https://cdn.dummyjson.com/product-images/mens-watches/rolex-cellini-date-black-dial/thumbnail.webp',
    imageAlt: 'Rolex Cellini Date watch with a black dial',
    tone: 'navy',
  },
]

// `icon` is a key the BenefitsSection component maps to an icon component.
export const customerBenefits = [
  { id: 'shipping', icon: 'truck', title: 'Free shipping', text: 'On every order over $50.' },
  { id: 'returns', icon: 'returns', title: 'Easy returns', text: '30 days to change your mind.' },
  { id: 'secure', icon: 'shield', title: 'Secure payments', text: 'Handled by trusted payment providers.' },
  { id: 'support', icon: 'support', title: 'Friendly support', text: 'Real people, seven days a week.' },
]

/*
 * Editorial collections (product IDs). DummyJSON has no "featured", "new
 * arrival", or "best seller" flags, so these are hand-picked — NOT real sales
 * or recency data. The products themselves are loaded live from the API.
 * Later, admins will manage these lists through the backend.
 */
export const homeCollectionIds = {
  featured: [123, 78, 100, 173, 90, 7, 160, 14],
  newArrivals: [133, 101, 186, 154, 79, 175, 88, 132],
  bestSellers: [99, 80, 95, 152, 103, 11, 130, 194],
}

/*
 * Categories to feature on the homepage. Names come live from the API; the
 * categories endpoint has no images, so each image is the real thumbnail of
 * one product from that category.
 */
export const featuredCategories = [
  { slug: 'smartphones', image: 'https://cdn.dummyjson.com/product-images/smartphones/iphone-13-pro/thumbnail.webp' },
  { slug: 'laptops', image: 'https://cdn.dummyjson.com/product-images/laptops/apple-macbook-pro-14-inch-space-grey/thumbnail.webp' },
  { slug: 'mens-watches', image: 'https://cdn.dummyjson.com/product-images/mens-watches/rolex-cellini-date-black-dial/thumbnail.webp' },
  { slug: 'womens-bags', image: "https://cdn.dummyjson.com/product-images/womens-bags/heshe-women's-leather-bag/thumbnail.webp" },
  { slug: 'fragrances', image: 'https://cdn.dummyjson.com/product-images/fragrances/chanel-coco-noir-eau-de/thumbnail.webp' },
  { slug: 'furniture', image: 'https://cdn.dummyjson.com/product-images/furniture/annibale-colombo-sofa/thumbnail.webp' },
  { slug: 'mens-shoes', image: 'https://cdn.dummyjson.com/product-images/mens-shoes/nike-air-jordan-1-red-and-black/thumbnail.webp' },
  { slug: 'sunglasses', image: 'https://cdn.dummyjson.com/product-images/sunglasses/black-sun-glasses/thumbnail.webp' },
]

/*
 * Phase 13: the demo's hero, banners and benefits in the shopper's language
 * (marketing:demo.* / marketing:benefits.*). With BuyNest's API the hero and
 * banners come from GET /home already in the request's language.
 */
/** freeShipping: the store's threshold as text ("$50"), or null: then the highlight doesn't name an amount. */
export function localizedHeroContent(t, freeShipping = null) {
  return {
    ...heroContent,
    eyebrow: t('demo.hero.eyebrow'),
    title: t('demo.hero.title'),
    description: t('demo.hero.description'),
    primaryCta: { ...heroContent.primaryCta, label: t('demo.hero.primary') },
    secondaryCta: { ...heroContent.secondaryCta, label: t('demo.hero.secondary') },
    imageAlt: t('demo.hero.imageAlt'),
    highlights: [
      freeShipping ? t('demo.hero.highlight1', { amount: freeShipping }) : t('demo.hero.highlight1Any'),
      t('demo.hero.highlight2'),
      t('demo.hero.highlight3'),
    ],
  }
}

export const localizedPromoBanners = (t) =>
  promoBanners.map((banner) => ({
    ...banner,
    eyebrow: t(`demo.banners.${banner.id}.eyebrow`),
    title: t(`demo.banners.${banner.id}.title`),
    description: t(`demo.banners.${banner.id}.description`),
    cta: { ...banner.cta, label: t(`demo.banners.${banner.id}.cta`) },
    imageAlt: t(`demo.banners.${banner.id}.imageAlt`),
  }))

/** freeShipping: as above; the shipping benefit names the store's own threshold (not a fixed "$50"). */
export const localizedBenefits = (t, freeShipping = null) =>
  customerBenefits.map((benefit) => ({
    ...benefit,
    title: t(`benefits.${benefit.id}.title`),
    text:
      benefit.id === 'shipping'
        ? freeShipping
          ? t('benefits.shipping.text', { amount: freeShipping })
          : t('benefits.shipping.textAny')
        : t(`benefits.${benefit.id}.text`),
  }))
