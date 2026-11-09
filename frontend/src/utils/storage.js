/*
 * Safe localStorage helpers. Storage can be unavailable (private mode,
 * blocked cookies) or contain corrupted JSON, so every access is guarded.
 */
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
