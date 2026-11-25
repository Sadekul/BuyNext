import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AnnouncementBar from './AnnouncementBar'
import { STORAGE_KEYS } from '../../constants/storageKeys'

describe('AnnouncementBar', () => {
  beforeEach(() => window.localStorage.clear())

  it('shows one message in a labelled region', () => {
    render(<AnnouncementBar messages={['Free standard shipping on orders over $50', '30-day hassle-free returns']} />)
    const bar = screen.getByRole('complementary', { name: 'Store announcements' })
    expect(bar).toHaveTextContent('Free standard shipping on orders over $50')
    expect(bar).not.toHaveTextContent('30-day hassle-free returns')
  })

  it('renders nothing without messages', () => {
    const { container } = render(<AnnouncementBar messages={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('closes, and stays closed for the same message in this browser', async () => {
    const { unmount } = render(<AnnouncementBar messages={['30-day hassle-free returns']} />)
    await userEvent.click(screen.getByRole('button', { name: 'Close announcement' }))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(STORAGE_KEYS.announcement)).toBe('30-day hassle-free returns')
    unmount()
    render(<AnnouncementBar messages={['30-day hassle-free returns']} />)
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('a different message shows again after an earlier one was closed', () => {
    window.localStorage.setItem(STORAGE_KEYS.announcement, '30-day hassle-free returns')
    render(<AnnouncementBar messages={['Free standard shipping on orders over ৳5,000']} />)
    expect(screen.getByRole('complementary')).toHaveTextContent('৳5,000')
  })

  it('still works when storage is blocked', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked')
      },
    })
    try {
      render(<AnnouncementBar messages={['30-day hassle-free returns']} />)
      await userEvent.click(screen.getByRole('button', { name: 'Close announcement' }))
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    } finally {
      Object.defineProperty(window, 'localStorage', original)
    }
  })
})
