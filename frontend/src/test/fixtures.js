import { sampleProducts } from '../data/sampleProducts'

/*
 * Test data built from the offline DummyJSON snapshot (src/data/sampleProducts.js),
 * normalized like the API adapter does, plus raw API-shaped responses.
 */
export const productById = (id) => {
  const raw = sampleProducts.find((product) => product.id === id)
  return { description: null, images: [], minimumOrderQuantity: 1, ...raw, brand: raw.brand ?? null }
}

export const iphone13 = productById(123) // $1099.99, 9.37% off, in stock, Apple
export const galaxyS8 = productById(132) // stock 0 → out of stock
export const tennisRacket = productById(152) // no brand, low stock

/** A raw DummyJSON list response. */
export const productListResponse = (products) => ({
  products,
  total: products.length,
  skip: 0,
  limit: products.length,
})

/** A raw DummyJSON single-product response. */
export const productDetailResponse = (overrides = {}) => ({
  ...iphone13,
  description: 'A cutting-edge smartphone.',
  images: ['https://img.test/1.webp', 'https://img.test/2.webp'],
  minimumOrderQuantity: 1,
  sku: 'SMA-APP-IPH-123',
  warrantyInformation: '3 year warranty',
  shippingInformation: 'Ships in 2 weeks',
  returnPolicy: '7 days return policy',
  reviews: [
    { rating: 5, comment: 'Great!', date: '2025-04-30T09:41:02.054Z', reviewerName: 'Ada', reviewerEmail: 'ada@x.test' },
  ],
  ...overrides,
})

/** A configurable product (phase 5): Size (S, M) × Color (Red, Blue); S/Blue doesn't exist, M/Red is sold out. */
export const configurableTee = {
  id: 5,
  title: 'Tee',
  price: 20,
  discountPercentage: 10,
  stock: 7,
  hasVariants: true,
  options: [
    { id: 1, name: 'Size', values: [{ id: 11, value: 'S' }, { id: 12, value: 'M' }] },
    { id: 2, name: 'Color', values: [{ id: 21, value: 'Red' }, { id: 22, value: 'Blue' }] },
  ],
  variants: [
    { id: 51, sku: 'TEE-S-RED', optionValueIds: [11, 21], price: 20, stock: 4, inStock: true },
    { id: 52, sku: 'TEE-M-RED', optionValueIds: [12, 21], price: 22, stock: 0, inStock: false },
    { id: 53, sku: 'TEE-M-BLUE', optionValueIds: [12, 22], price: 22, stock: 3, inStock: true },
  ],
}
