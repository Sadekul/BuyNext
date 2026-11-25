import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BottomTabBar, { MOBILE_SEARCH_INPUT_ID } from './BottomTabBar'
import { renderWithProviders } from '../../test/renderWithProviders'
import { switchToBangla } from '../../test/i18n'

// Phase 17 §3.4: the phone tab bar.
const seedCart = () =>
  window.localStorage.setItem('buynest.cart.v1', JSON.stringify({ items: [{ productId: 1, title: 'Mascara', thumbnail: 'm.webp', price: 10, discountPercentage: 0, stock: 9, minimumOrderQuantity: 1, quantity: 3 }], couponCode: null }))

describe('BottomTabBar', () => {
  it('Home, Categories, Search, Wishlist and Cart; the current page has aria-current', () => {
    seedCart()
    renderWithProviders(<BottomTabBar onOpenCategories={() => {}} />, { route: '/wishlist' })
    const bar = screen.getByRole('navigation', { name: 'Quick links' })
    expect(within(bar).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
    expect(within(bar).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
    expect(within(bar).getByRole('button', { name: 'Categories' })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'Search' })).toBeInTheDocument()
    expect(within(bar).getByRole('link', { name: 'Wishlist, 0 items' })).toHaveAttribute('aria-current', 'page')
    const cart = within(bar).getByRole('link', { name: 'Cart, 3 items' })
    expect(cart).toHaveAttribute('href', '/cart')
    expect(cart).toHaveTextContent('3')
  })

  it('Categories opens the drawer (callback); Search moves focus to the phone search box', async () => {
    const onOpenCategories = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <input id={MOBILE_SEARCH_INPUT_ID} aria-label="Search products" />
        <BottomTabBar onOpenCategories={onOpenCategories} />
      </>,
    )
    await user.click(screen.getByRole('button', { name: 'Categories' }))
    expect(onOpenCategories).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(screen.getByRole('textbox', { name: 'Search products' })).toHaveFocus()
  })

  it('keeps room for itself at the bottom of the page while it is shown (body class)', () => {
    const view = renderWithProviders(<BottomTabBar onOpenCategories={() => {}} />)
    expect(document.body).toHaveClass('has-tab-bar')
    view.unmount()
    expect(document.body).not.toHaveClass('has-tab-bar')
  })

  it('in Bangla with Bangla digits', async () => {
    await switchToBangla()
    seedCart()
    renderWithProviders(<BottomTabBar onOpenCategories={() => {}} />)
    expect(screen.getByRole('link', { name: 'হোম' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ক্যাটাগরি' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'খুঁজুন' })).toBeInTheDocument()
    expect(screen.getByText('৩')).toBeInTheDocument()
  })
})
