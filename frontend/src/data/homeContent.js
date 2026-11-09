import { ROUTES } from '../constants/routes'

/*
 * SAMPLE CONTENT — homepage marketing copy. In Phase 12 these sections become
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
]

// `icon` is a key the BenefitsSection component maps to an icon component.
export const customerBenefits = [
  { id: 'shipping', icon: 'truck', title: 'Free shipping', text: 'On every order over $50.' },
  { id: 'returns', icon: 'returns', title: 'Easy returns', text: '30 days to change your mind.' },
  { id: 'secure', icon: 'shield', title: 'Secure payments', text: 'Handled by trusted payment providers.' },
  { id: 'support', icon: 'support', title: 'Friendly support', text: 'Real people, seven days a week.' },
]
