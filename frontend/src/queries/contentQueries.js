import { queryOptions } from '@tanstack/react-query'
import { getCmsPage, getHomeContent, getStoreSettings } from '../services/contentService'
import { currentLanguage } from '../i18n'

/* The admin's content and store settings (REAL_SHOP). The server caches them for 60 s too. */
// Phase 13: home content and pages come back in the shopper's language, so it is part of their keys.
export const contentKeys = {
  get home() {
    return ['content', 'home', currentLanguage()]
  },
  page: (slug) => ['content', 'page', slug, currentLanguage()],
  store: ['content', 'store'],
}

export const homeContentQuery = () =>
  queryOptions({
    queryKey: contentKeys.home,
    queryFn: ({ signal }) => getHomeContent({ signal }),
    staleTime: 5 * 60_000,
  })

export const cmsPageQuery = (slug) =>
  queryOptions({
    queryKey: contentKeys.page(slug),
    queryFn: ({ signal }) => getCmsPage(slug, { signal }),
    staleTime: 5 * 60_000,
  })

/** One shared entry for the cart, drawer, checkout, and footer: settings change rarely. */
export const storeSettingsQuery = () =>
  queryOptions({
    queryKey: contentKeys.store,
    queryFn: ({ signal }) => getStoreSettings({ signal }),
    staleTime: 5 * 60_000,
  })
