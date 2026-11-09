import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import ErrorBoundary from './ErrorBoundary'
import { renderWithProviders } from '../../test/renderWithProviders'

function Bomb({ shouldThrow }) {
  if (shouldThrow) throw new Error('Kaboom')
  return <p>All good</p>
}

function Harness() {
  const [shouldThrow, setShouldThrow] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setShouldThrow(false)}>
        Fix it
      </button>
      <ErrorBoundary>
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>
    </>
  )
}

describe('ErrorBoundary', () => {
  it('shows a fallback instead of crashing, and recovers with "Try again"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}) // React logs caught render errors
    const user = userEvent.setup()
    renderWithProviders(<Harness />)

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong on this page')
    await user.click(screen.getByRole('button', { name: 'Fix it' })) // outside the boundary: still works
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText('All good')).toBeInTheDocument()
  })
})
