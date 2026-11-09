import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import QuantitySelector from './QuantitySelector'

// A tiny parent that owns the state, like the cart line and product page do.
function Harness({ initial = 2, min = 2, max = 4 }) {
  const [quantity, setQuantity] = useState(initial)
  return <QuantitySelector value={quantity} min={min} max={max} onChange={setQuantity} />
}

describe('QuantitySelector (cart quantity updates)', () => {
  it('increases and decreases within [min, max]', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const increase = screen.getByRole('button', { name: 'Increase quantity' })
    const decrease = screen.getByRole('button', { name: 'Decrease quantity' })
    const output = screen.getByRole('status')

    expect(decrease).toBeDisabled() // already at the minimum order quantity
    await user.click(increase)
    await user.click(increase)
    expect(output).toHaveTextContent('4')
    expect(increase).toBeDisabled() // at the stock limit
    await user.click(decrease)
    expect(output).toHaveTextContent('3')
  })

  it('is labelled as a group for screen readers', () => {
    render(<QuantitySelector value={1} max={3} onChange={() => {}} label="Quantity for iPhone" />)
    expect(screen.getByRole('group', { name: 'Quantity for iPhone' })).toBeInTheDocument()
  })
})
