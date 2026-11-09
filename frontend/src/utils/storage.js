/*
 * Safe localStorage helpers. Storage can be unavailable (private mode,
 * blocked cookies) or contain corrupted JSON, so every access is guarded.
 */
/** Storage key for one owner: guests use the base key, each account its own copy. */
export function ownerStorageKey(storageKey, ownerId) {
  return ownerId == null ? storageKey : `${storageKey}.user-${ownerId}`
}

export function readJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota exceeded or storage blocked: the app keeps working in memory.
  }
}

export function removeKey(key) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // storage blocked: nothing to remove
  }
}
