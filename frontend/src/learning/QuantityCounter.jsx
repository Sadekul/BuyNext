import { useState } from 'react'
import { LuMinus, LuPlus } from 'react-icons/lu'
import './QuantityCounter.css'

/*
 * LEARNING EXAMPLE — a stateful functional component. A preview of the
 * quantity selector we build properly in Phases 5–6.
 * Compare with QuantityCounterClass.jsx.
 */
function QuantityCounter({ min = 1, max = 10 }) {
  const [quantity, setQuantity] = useState(min)

  // The updater form (current => next) always uses the latest state value.
  const decrease = () => setQuantity((current) => Math.max(min, current - 1))
  const increase = () => setQuantity((current) => Math.min(max, current + 1))

  return (
    <div className="quantity-counter" role="group" aria-label="Quantity">
      <button type="button" onClick={decrease} disabled={quantity <= min} aria-label="Decrease quantity">
        <LuMinus aria-hidden="true" />
      </button>
      <output aria-live="polite">{quantity}</output>
      <button type="button" onClick={increase} disabled={quantity >= max} aria-label="Increase quantity">
        <LuPlus aria-hidden="true" />
      </button>
    </div>
  )
}

export default QuantityCounter
