import { useCallback, useState } from 'react'

/** Message state for <Toast />: `const toast = useToast(); toast.show('Saved')`. */
export function useToast() {
  const [message, setMessage] = useState('')

  // Stable function identities so <Toast />'s effect doesn't restart needlessly.
  const show = useCallback((text) => setMessage(text), [])
  const dismiss = useCallback(() => setMessage(''), [])

  return { message, show, dismiss }
}
