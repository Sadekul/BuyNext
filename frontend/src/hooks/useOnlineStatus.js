import { useSyncExternalStore } from 'react'

// The browser is an "external store": React doesn't own navigator.onLine.
function subscribe(onChange) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

const getSnapshot = () => navigator.onLine

/**
 * true/false: is the browser online? useSyncExternalStore subscribes to an
 * outside source and re-renders when it changes — the hook-era replacement
 * for componentDidMount + componentWillUnmount listeners (compare with
 * learning/OnlineStatusClass.jsx).
 */
export function useOnlineStatus() {
  return useSyncExternalStore(subscribe, getSnapshot)
}
