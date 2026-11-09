import { useEffect, useState } from 'react'

/**
 * Returns `value`, but only after it has stopped changing for `delayMs`.
 * Typing "phone" quickly produces ONE update ("phone"), not five.
 * The cleanup cancels the pending timer whenever the value changes again.
 */
export function useDebouncedValue(value, delayMs = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timerId = setTimeout(() => setDebouncedValue(value), delayMs)
    return () => clearTimeout(timerId)
  }, [value, delayMs])

  return debouncedValue
}
