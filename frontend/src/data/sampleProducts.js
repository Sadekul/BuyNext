/*
 * SAMPLE DATA — real DummyJSON product records, snapshotted on 2026-11-09 from
 * https://dummyjson.com/products?select=id,title,category,price,discountPercentage,rating,stock,brand,thumbnail,availabilityStatus
 *
 * Field names and values are copied unchanged, so components built against
 * this data will keep working when Phase 3 swaps it for live API requests.
 * Note: some products (e.g. sports accessories) have no `brand` field in the
 * API; we leave it missing rather than inventing one.
 */

export const sampleProducts = [
  {
    id: 123,
    title: "iPhone 13 Pro",
    category: "smartphones",
    price: 1099.99,
    discountPercentage: 9.37,
    rating: 4.12,
    stock: 56,
    brand: "Apple",
    thumbnail: "https://cdn.dummyjson.com/product-images/smartphones/iphone-13-pro/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 78,
    title: "Apple MacBook Pro 14 Inch Space Grey",
    category: "laptops",
    price: 1999.99,
    discountPercentage: 4.69,
    rating: 3.65,
    stock: 24,
    brand: "Apple",
    thumbnail: "https://cdn.dummyjson.com/product-images/laptops/apple-macbook-pro-14-inch-space-grey/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 100,
    title: "Apple Airpods",
    category: "mobile-accessories",
    price: 129.99,
    discountPercentage: 15.54,
    rating: 4.15,
    stock: 67,
    brand: "Apple",
    thumbnail: "https://cdn.dummyjson.com/product-images/mobile-accessories/apple-airpods/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 173,
    title: "Heshe Women's Leather Bag",
    category: "womens-bags",
    price: 129.99,
    discountPercentage: 3.87,
    rating: 4.92,
    stock: 99,
    brand: "Heshe",
    thumbnail: "https://cdn.dummyjson.com/product-images/womens-bags/heshe-women's-leather-bag/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 90,
    title: "Puma Future Rider Trainers",
    category: "mens-shoes",
    price: 89.99,
    discountPercentage: 4.2,
    rating: 4.9,
    stock: 90,
    brand: "Puma",
    thumbnail: "https://cdn.dummyjson.com/product-images/mens-shoes/puma-future-rider-trainers/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 7,
    title: "Chanel Coco Noir Eau De",
    category: "fragrances",
    price: 129.99,
    discountPercentage: 16.51,
    rating: 4.26,
    stock: 58,
    brand: "Chanel",
    thumbnail: "https://cdn.dummyjson.com/product-images/fragrances/chanel-coco-noir-eau-de/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 160,
    title: "Samsung Galaxy Tab S8 Plus Grey",
    category: "tablets",
    price: 599.99,
    discountPercentage: 13.31,
    rating: 4.68,
    stock: 62,
    brand: "Samsung",
    thumbnail: "https://cdn.dummyjson.com/product-images/tablets/samsung-galaxy-tab-s8-plus-grey/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 14,
    title: "Knoll Saarinen Executive Conference Chair",
    category: "furniture",
    price: 499.99,
    discountPercentage: 2.01,
    rating: 4.88,
    stock: 26,
    brand: "Knoll",
    thumbnail: "https://cdn.dummyjson.com/product-images/furniture/knoll-saarinen-executive-conference-chair/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 133,
    title: "Samsung Galaxy S10",
    category: "smartphones",
    price: 699.99,
    discountPercentage: 5.59,
    rating: 3.06,
    stock: 19,
    brand: "Samsung",
    thumbnail: "https://cdn.dummyjson.com/product-images/smartphones/samsung-galaxy-s10/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 101,
    title: "Apple AirPods Max Silver",
    category: "mobile-accessories",
    price: 549.99,
    discountPercentage: 13.67,
    rating: 3.47,
    stock: 59,
    brand: "Apple",
    thumbnail: "https://cdn.dummyjson.com/product-images/mobile-accessories/apple-airpods-max-silver/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 186,
    title: "Calvin Klein Heel Shoes",
    category: "womens-shoes",
    price: 79.99,
    discountPercentage: 3.19,
    rating: 4.92,
    stock: 93,
    brand: "Calvin Klein",
    thumbnail: "https://cdn.dummyjson.com/product-images/womens-shoes/calvin-klein-heel-shoes/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 154,
    title: "Black Sun Glasses",
    category: "sunglasses",
    price: 29.99,
    discountPercentage: 4.94,
    rating: 4.41,
    stock: 60,
    brand: "Fashion Shades",
    thumbnail: "https://cdn.dummyjson.com/product-images/sunglasses/black-sun-glasses/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 79,
    title: "Asus Zenbook Pro Dual Screen Laptop",
    category: "laptops",
    price: 1799.99,
    discountPercentage: 11.14,
    rating: 3.95,
    stock: 45,
    brand: "Asus",
    thumbnail: "https://cdn.dummyjson.com/product-images/laptops/asus-zenbook-pro-dual-screen-laptop/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 175,
    title: "White Faux Leather Backpack",
    category: "womens-bags",
    price: 39.99,
    discountPercentage: 15.2,
    rating: 3.36,
    stock: 39,
    brand: "Urban Chic",
    thumbnail: "https://cdn.dummyjson.com/product-images/womens-bags/white-faux-leather-backpack/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 88,
    title: "Nike Air Jordan 1 Red And Black",
    category: "mens-shoes",
    price: 149.99,
    discountPercentage: 4.12,
    rating: 4.77,
    stock: 7,
    brand: "Nike",
    thumbnail: "https://cdn.dummyjson.com/product-images/mens-shoes/nike-air-jordan-1-red-and-black/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 132,
    title: "Samsung Galaxy S8",
    category: "smartphones",
    price: 499.99,
    discountPercentage: 19.45,
    rating: 4.4,
    stock: 0,
    brand: "Samsung",
    thumbnail: "https://cdn.dummyjson.com/product-images/smartphones/samsung-galaxy-s8/thumbnail.webp",
    availabilityStatus: "Out of Stock"
  },
  {
    id: 99,
    title: "Amazon Echo Plus",
    category: "mobile-accessories",
    price: 99.99,
    discountPercentage: 12.07,
    rating: 4.99,
    stock: 61,
    brand: "Amazon",
    thumbnail: "https://cdn.dummyjson.com/product-images/mobile-accessories/amazon-echo-plus/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 80,
    title: "Huawei Matebook X Pro",
    category: "laptops",
    price: 1399.99,
    discountPercentage: 9.38,
    rating: 4.98,
    stock: 75,
    brand: "Huawei",
    thumbnail: "https://cdn.dummyjson.com/product-images/laptops/huawei-matebook-x-pro/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 95,
    title: "Rolex Cellini Date Black Dial",
    category: "mens-watches",
    price: 8999.99,
    discountPercentage: 8.88,
    rating: 4.97,
    stock: 40,
    brand: "Rolex",
    thumbnail: "https://cdn.dummyjson.com/product-images/mens-watches/rolex-cellini-date-black-dial/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 152,
    title: "Tennis Racket",
    category: "sports-accessories",
    price: 49.99,
    discountPercentage: 19.61,
    rating: 4.03,
    stock: 6,
    thumbnail: "https://cdn.dummyjson.com/product-images/sports-accessories/tennis-racket/thumbnail.webp",
    availabilityStatus: "Low Stock"
  },
  {
    id: 103,
    title: "Apple HomePod Mini Cosmic Grey",
    category: "mobile-accessories",
    price: 99.99,
    discountPercentage: 18.1,
    rating: 4.62,
    stock: 27,
    brand: "Apple",
    thumbnail: "https://cdn.dummyjson.com/product-images/mobile-accessories/apple-homepod-mini-cosmic-grey/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 11,
    title: "Annibale Colombo Bed",
    category: "furniture",
    price: 1899.99,
    discountPercentage: 8.57,
    rating: 4.77,
    stock: 88,
    brand: "Annibale Colombo",
    thumbnail: "https://cdn.dummyjson.com/product-images/furniture/annibale-colombo-bed/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 130,
    title: "Realme XT",
    category: "smartphones",
    price: 349.99,
    discountPercentage: 11.51,
    rating: 4.58,
    stock: 80,
    brand: "Realme",
    thumbnail: "https://cdn.dummyjson.com/product-images/smartphones/realme-xt/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 194,
    title: "Women's Wrist Watch",
    category: "womens-watches",
    price: 129.99,
    discountPercentage: 12.6,
    rating: 3.52,
    stock: 12,
    brand: "Fashion Co.",
    thumbnail: "https://cdn.dummyjson.com/product-images/womens-watches/women's-wrist-watch/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 126,
    title: "Oppo F19 Pro Plus",
    category: "smartphones",
    price: 399.99,
    discountPercentage: 18.64,
    rating: 3.51,
    stock: 78,
    brand: "Oppo",
    thumbnail: "https://cdn.dummyjson.com/product-images/smartphones/oppo-f19-pro-plus/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 105,
    title: "Apple MagSafe Battery Pack",
    category: "mobile-accessories",
    price: 99.99,
    discountPercentage: 17.17,
    rating: 3.62,
    stock: 1,
    brand: "Apple",
    thumbnail: "https://cdn.dummyjson.com/product-images/mobile-accessories/apple-magsafe-battery-pack/thumbnail.webp",
    availabilityStatus: "Low Stock"
  },
  {
    id: 161,
    title: "Samsung Galaxy Tab White",
    category: "tablets",
    price: 349.99,
    discountPercentage: 18.2,
    rating: 3.72,
    stock: 92,
    brand: "Samsung",
    thumbnail: "https://cdn.dummyjson.com/product-images/tablets/samsung-galaxy-tab-white/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 172,
    title: "Blue Women's Handbag",
    category: "womens-bags",
    price: 49.99,
    discountPercentage: 17.88,
    rating: 2.92,
    stock: 76,
    brand: "Fashionista",
    thumbnail: "https://cdn.dummyjson.com/product-images/womens-bags/blue-women's-handbag/thumbnail.webp",
    availabilityStatus: "In Stock"
  },
  {
    id: 150,
    title: "Metal Baseball Bat",
    category: "sports-accessories",
    price: 29.99,
    discountPercentage: 19.51,
    rating: 4.66,
    stock: 16,
    thumbnail: "https://cdn.dummyjson.com/product-images/sports-accessories/metal-baseball-bat/thumbnail.webp",
    availabilityStatus: "In Stock"
  }
]

/*
 * Editorial collections for the homepage. DummyJSON has no "featured",
 * "new arrival", or "best seller" flags, so these are hand-picked IDs —
 * NOT real sales or recency data. A real backend would supply these lists
 * (e.g. admin-managed featured products, sales reports).
 */
export const homeCollectionIds = {
  featured: [123, 78, 100, 173, 90, 7, 160, 14],
  newArrivals: [133, 101, 186, 154, 79, 175, 88, 132],
  bestSellers: [99, 80, 95, 152, 103, 11, 130, 194],
}
