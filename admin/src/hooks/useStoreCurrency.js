import { useQuery } from '@tanstack/react-query'
import { LIVE_DATA } from '../api/mode'
import { getStoreInfo, phase12Keys } from '../api/phase12'
import { getStoreCurrency, setStoreCurrency } from '../utils/format'

/*
 * Phase 12 §1: the store currency for every money display. Read once per
 * session from the store's public settings (BuyNest's backend only; the
 * demo data is in USD). The last one seen is remembered in this browser so
 * the next visit starts with it; until it is known, USD.
 */
const REMEMBERED = 'buynest.admin.storeCurrency'

function remembered() {
  try {
    return JSON.parse(window.localStorage.getItem(REMEMBERED) ?? 'null')
  } catch {
    return null
  }
}
function remember(currency) {
  try {
    window.localStorage.setItem(REMEMBERED, JSON.stringify(currency))
  } catch {
    // storage blocked: the next visit starts with USD until the settings load
  }
}

if (LIVE_DATA) setStoreCurrency(remembered())

/** The store info query (shared with Settings → Payment methods). */
export function useStoreInfo({ enabled = true } = {}) {
  return useQuery({
    queryKey: phase12Keys.store,
    queryFn: ({ signal }) => getStoreInfo({ signal }),
    enabled: LIVE_DATA && enabled,
    staleTime: 5 * 60_000,
    retry: 1,
  })
}

/**
 * The store currency's code ("USD" until known). Sets the formatters'
 * currency as soon as the settings arrive (AdminLayout re-renders the page
 * when the code changes, so every amount follows).
 */
export function useStoreCurrency() {
  const store = useStoreInfo()
  const currency = store.data?.currency
  const now = getStoreCurrency()
  // Idempotent, so safe during render: the page below renders with the right currency straight away.
  if (currency && (currency.code !== now.code || currency.symbol !== now.symbol || currency.decimals !== now.decimals)) {
    setStoreCurrency(currency)
    remember(currency)
  }
  return getStoreCurrency().code
}
