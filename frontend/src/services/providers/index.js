import { dummyJsonProvider } from './dummyJsonProvider'
import { laravelProvider } from './laravelProvider'

/*
 * Which backend the storefront talks to, chosen at build time:
 *   VITE_API_PROVIDER=dummyjson   (default, learning API)
 *   VITE_API_PROVIDER=laravel     (future BuyNest backend)
 * Adding Shopify or Magento later means adding one more provider here.
 */
const PROVIDERS = { dummyjson: dummyJsonProvider, laravel: laravelProvider }

const providerName = import.meta.env.VITE_API_PROVIDER || 'dummyjson'

export const apiProvider = PROVIDERS[providerName]

if (!apiProvider) {
  throw new Error(`Unknown VITE_API_PROVIDER "${providerName}". Use one of: ${Object.keys(PROVIDERS).join(', ')}.`)
}
