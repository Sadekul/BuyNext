import { useState } from 'react'
import { LuCopy } from 'react-icons/lu'

/**
 * Phase 18: "Copy" next to a value (a consignment id, a tracking code, a
 * webhook URL). The button's name says what it copies ("Copy tracking code
 * 15BAEB8A"); the result is announced. Without clipboard access (an insecure
 * page, or refused) it says how to copy by hand instead.
 */
function CopyButton({ value, name, children = 'Copy' }) {
  const [state, setState] = useState(null) // null | 'copied' | 'failed'
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch {
      setState('failed')
    }
  }
  return (
    <>
      {/* The visible word starts the name (WCAG 2.5.3), the rest says what is copied. */}
      <button type="button" className="btn btn--outline btn--sm copy-button" aria-label={`${children} ${name}`} onClick={copy}>
        <LuCopy aria-hidden="true" /> {children}
      </button>
      <span role="status" className="copy-button__status">
        {state === 'copied' ? `Copied ${name}.` : state === 'failed' ? `Couldn't copy the ${name}: select it and press Ctrl+C (or ⌘+C).` : ''}
      </span>
    </>
  )
}

export default CopyButton
