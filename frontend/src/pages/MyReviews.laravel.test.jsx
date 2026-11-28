import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import MyReviewsPage from './MyReviewsPage'
import ProductDetailsPage from './ProductDetailsPage'
import AccountLayout from '../layouts/AccountLayout'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'
import { switchToBangla } from '../test/i18n'
import { productKeys } from '../queries/productQueries'
import enAccount from '../locales/en/account.json'
import bnAccount from '../locales/bn/account.json'
import enCatalog from '../locales/en/catalog.json'
import bnCatalog from '../locales/bn/catalog.json'

/*
 * Phase 23 (docs/backend/PHASE23_CONTRACT.md §2): Account → My reviews with
 * BuyNest's API. The list in every status, an unavailable product, a photo
 * the shop hid, deleting a photo or a review (dialog, API call, message,
 * focus), "Show more reviews", the load error, the menu link, and the product
 * page's "You've already reviewed this product".
 */
vi.mock('../services/providers/index', async () => ({ apiProvider: (await import('../services/providers/laravelProvider')).laravelProvider }))
vi.mock('../constants/shop', () => ({ REAL_SHOP: true }))
vi.mock('../constants/accounts', () => ({ ACCOUNTS_BACKEND: 'laravel', REAL_ACCOUNTS: true, DEMO_ACCOUNT: null }))

const signIn = () => {
  document.cookie = 'buynest_session=session; Path=/'
  window.localStorage.setItem('buynest.session.v2', JSON.stringify({ user: { id: 5, firstName: 'Ava' }, remember: false }))
}
const AVA = { id: 5, firstName: 'Ava', lastName: 'Chowdhury', email: 'customer@example.com', phone: '+8801712345678', role: 'customer', emailVerified: true }
const ME = {
  'GET /api/auth/me': { body: AVA },
  'GET /api/shop/me/cart': { body: { items: [], itemCount: 0, updatedAt: null } },
  'GET /api/shop/me/wishlist': { body: { items: [], shared: false } },
  'GET /api/catalog/store': { body: { data: { store_name: 'BuyNest' } } },
}

const photoUrl = (review, photo) => `/api/shop/me/reviews/${review}/photos/${photo}`
const LAMP = {
  id: 41,
  status: 'approved',
  rating: 4,
  title: 'True colour',
  comment: 'The colour is exactly as shown.',
  date: '2026-11-28T10:00:00Z',
  verifiedPurchase: true,
  product: { id: 12, name: 'Desk Lamp', thumbnail: '/media/products/12/abc.webp', available: true },
  photos: [
    { id: 7, url: photoUrl(41, 7), width: 1200, height: 1600, hidden: false },
    { id: 8, url: photoUrl(41, 8), width: 800, height: 600, hidden: true },
  ],
}
const KETTLE = {
  id: 40,
  status: 'pending',
  rating: 3,
  title: null,
  comment: 'Boils fast but it is loud.',
  date: '2026-11-27T10:00:00Z',
  verifiedPurchase: false,
  product: { id: 13, name: 'Old Kettle', thumbnail: null, available: false },
  photos: [],
}
const MUG = { ...KETTLE, id: 39, status: 'rejected', rating: 1, comment: 'Not what I expected at all.', product: { id: 14, name: 'Travel Mug', thumbnail: null, available: true } }

/** The shop service: `reviews` per page; deletes change what the next GET answers (like the API). */
function fakeShop({ pages = [[LAMP, KETTLE, MUG]], deleteStatus = 200, extra = {} } = {}) {
  const state = { pages: pages.map((page) => page.map((review) => ({ ...review, photos: [...review.photos] }))) }
  const all = () => state.pages.flat()
  return mockFetch({
    ...ME,
    'GET /api/shop/me/reviews': (url) => {
      const productId = Number(url.searchParams.get('productId'))
      if (productId) {
        const reviews = all().filter((review) => review.product?.id === productId)
        return { body: { reviews, page: 1, pages: 1, total: reviews.length } }
      }
      const page = Number(url.searchParams.get('page') ?? 1)
      return { body: { reviews: state.pages[page - 1] ?? [], page, pages: state.pages.length, total: all().length } }
    },
    'DELETE /api/shop/me/reviews/41': () => {
      if (deleteStatus !== 200) return { status: deleteStatus, body: { message: 'Too many requests. Please wait a moment.' } }
      state.pages = state.pages.map((page) => page.filter((review) => review.id !== 41))
      return { body: { deleted: true } }
    },
    'DELETE /api/shop/me/reviews/41/photos/8': () => {
      const review = all().find((entry) => entry.id === 41)
      review.photos = review.photos.filter((photo) => photo.id !== 8)
      return { body: { review } }
    },
    ...extra,
  })
}

const renderPage = () =>
  renderWithProviders(
    <Routes>
      <Route path="/account" element={<AccountLayout />}>
        <Route path="reviews" element={<MyReviewsPage />} />
      </Route>
    </Routes>,
    { route: '/account/reviews' },
  )
const calls = (fetchMock, method, path) => fetchMock.mock.calls.filter(([url, init]) => new URL(url).pathname === path && (init?.method ?? 'GET') === method)
const card = (name) => screen.getByRole('article', { name })

describe('My reviews (Account → My reviews)', () => {
  it('lists my reviews in every status, with an unavailable product, the stars, and the photos (hidden one labelled)', async () => {
    signIn()
    fakeShop()
    renderPage()
    expect(screen.getByRole('heading', { name: 'My reviews', level: 2 })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Desk Lamp' })).toHaveAttribute('href', '/products/12')
    expect(screen.getByRole('link', { name: 'My reviews' })).toHaveAttribute('href', '/account/reviews')

    const lamp = card('Desk Lamp')
    expect(within(lamp).getByText('Published')).toBeInTheDocument()
    expect(within(lamp).getByRole('img', { name: '4 out of 5 stars' })).toBeInTheDocument()
    expect(within(lamp).getByText('Written Nov 28, 2026')).toBeInTheDocument()
    expect(within(lamp).getByText('True colour')).toBeInTheDocument()
    expect(within(lamp).getByText('Verified purchase')).toBeInTheDocument()
    const photos = within(lamp).getByRole('list', { name: 'Photos in your review of Desk Lamp' })
    const thumbs = within(photos).getAllByRole('button', { name: /^Open photo/ })
    expect(thumbs).toHaveLength(2)
    expect(thumbs[0]).toHaveAccessibleName('Open photo 1 of 2 in your review of Desk Lamp')
    expect(thumbs[1]).toHaveAccessibleDescription('Hidden by the shop')
    expect(within(photos).getAllByText('Hidden by the shop')).toHaveLength(1)
    expect(thumbs[0].querySelector('img')).toHaveAttribute('src', photoUrl(41, 7))
    expect(within(photos).getByRole('button', { name: 'Delete photo 2 of your review of Desk Lamp' })).toHaveTextContent('Delete photo 2')
    expect(within(lamp).getByRole('button', { name: 'Delete your review of Desk Lamp' })).toHaveTextContent('Delete review')

    const kettle = card('Old Kettle')
    expect(within(kettle).getByText('Waiting for approval')).toBeInTheDocument()
    expect(within(kettle).getByText('No longer available')).toBeInTheDocument()
    expect(within(kettle).queryByRole('link')).not.toBeInTheDocument()
    expect(within(kettle).queryByRole('list')).not.toBeInTheDocument()

    expect(within(card('Travel Mug')).getByText('Not published')).toBeInTheDocument()
  })

  it('a photo opens in the viewer, and the focus comes back to it', async () => {
    signIn()
    fakeShop()
    const user = userEvent.setup()
    renderPage()
    const thumb = await screen.findByRole('button', { name: 'Open photo 2 of 2 in your review of Desk Lamp' })
    await user.click(thumb)
    const viewer = screen.getByRole('dialog', { name: 'Photos in your review of Desk Lamp' })
    expect(within(viewer).getByRole('img', { name: 'Photo 2 of 2 in your review of Desk Lamp' })).toHaveAttribute('src', photoUrl(41, 8))
    await user.click(within(viewer).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(thumb).toHaveFocus())
  })

  it('the empty state links to the products', async () => {
    signIn()
    fakeShop({ pages: [[]] })
    renderPage()
    expect(await screen.findByRole('heading', { name: "You haven't written any reviews yet." })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse products' })).toHaveAttribute('href', '/products')
  })

  it('deleting a review asks first; "Keep it" changes nothing; then it goes, with a message and the focus on the next review', async () => {
    signIn()
    const fetchMock = fakeShop()
    const user = userEvent.setup()
    const { queryClient } = renderPage()
    queryClient.setQueryData(productKeys.detail(12), { id: 12, title: 'Desk Lamp' })
    const button = await screen.findByRole('button', { name: 'Delete your review of Desk Lamp' })

    await user.click(button)
    let dialog = screen.getByRole('dialog', { name: 'Delete your review?' })
    expect(dialog).toHaveTextContent("Your review of Desk Lamp will be removed from the store. This can't be undone.")
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(button).toHaveFocus())
    expect(calls(fetchMock, 'DELETE', '/api/shop/me/reviews/41')).toHaveLength(0)

    await user.click(button)
    dialog = screen.getByRole('dialog', { name: 'Delete your review?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete review' }))
    expect(await screen.findByText('Your review was deleted.')).toHaveAttribute('role', 'status')
    expect(calls(fetchMock, 'DELETE', '/api/shop/me/reviews/41')).toHaveLength(1)
    expect(screen.queryByRole('article', { name: 'Desk Lamp' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Old Kettle' })).toHaveFocus())
    expect(queryClient.getQueryState(productKeys.detail(12)).isInvalidated).toBe(true)
  })

  it('deleting the last review moves the focus to the page heading', async () => {
    signIn()
    fakeShop({ pages: [[LAMP]] })
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Delete your review of Desk Lamp' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete review' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'My reviews', level: 2 })).toHaveFocus())
    expect(await screen.findByRole('heading', { name: "You haven't written any reviews yet." })).toBeInTheDocument()
  })

  it('a refused delete is explained in the dialog, which stays open', async () => {
    signIn()
    fakeShop({ deleteStatus: 429 })
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Delete your review of Desk Lamp' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete your review?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete review' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Too many requests. Please wait a moment.')
    expect(screen.getByRole('article', { name: 'Desk Lamp' })).toBeInTheDocument()
  })

  it('deleting a photo asks first, then the photo goes and the review stays', async () => {
    signIn()
    const fetchMock = fakeShop()
    const user = userEvent.setup()
    renderPage()
    const button = await screen.findByRole('button', { name: 'Delete photo 2 of your review of Desk Lamp' })
    await user.click(button)
    let dialog = screen.getByRole('dialog', { name: 'Delete this photo?' })
    expect(dialog).toHaveTextContent("Photo 2 will be removed from your review of Desk Lamp. This can't be undone.")
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }))
    await waitFor(() => expect(button).toHaveFocus())
    expect(within(card('Desk Lamp')).getAllByRole('button', { name: /^Open photo/ })).toHaveLength(2)

    await user.click(button)
    dialog = screen.getByRole('dialog', { name: 'Delete this photo?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete photo' }))
    expect(await screen.findByText('The photo was deleted.')).toHaveAttribute('role', 'status')
    expect(calls(fetchMock, 'DELETE', '/api/shop/me/reviews/41/photos/8')).toHaveLength(1)
    const lamp = card('Desk Lamp')
    expect(within(lamp).getAllByRole('button', { name: /^Open photo/ })).toHaveLength(1)
    expect(within(lamp).queryByText('Hidden by the shop')).not.toBeInTheDocument()
    expect(within(lamp).getByText('Published')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Desk Lamp' })).toHaveFocus())
  })

  it('"Show more reviews" appends the next page and moves the focus to its first review', async () => {
    signIn()
    const fetchMock = fakeShop({ pages: [[LAMP, KETTLE], [MUG]] })
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Show more reviews' }))
    expect(await screen.findByRole('article', { name: 'Travel Mug' })).toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Show more reviews' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Travel Mug' })).toHaveFocus())
    expect(calls(fetchMock, 'GET', '/api/shop/me/reviews').map(([url]) => new URL(url).searchParams.get('page'))).toEqual(['1', '2'])
  })

  it('a load error shows "Try again", which loads the list', async () => {
    signIn()
    let fail = true
    fakeShop({
      extra: {
        'GET /api/shop/me/reviews': () => (fail ? { status: 500, body: { message: 'The API is down.' } } : { body: { reviews: [LAMP], page: 1, pages: 1, total: 1 } }),
      },
    })
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByRole('heading', { name: "We couldn't load your reviews" })).toBeInTheDocument()
    fail = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('article', { name: 'Desk Lamp' })).toBeInTheDocument()
  })

  it('shows a skeleton while loading', async () => {
    signIn()
    fakeShop({ extra: { 'GET /api/shop/me/reviews': { delay: 50, body: { reviews: [], page: 1, pages: 1, total: 0 } } } })
    renderPage()
    expect(await screen.findByText('Loading your reviews…')).toBeInTheDocument()
    expect(document.querySelector('.my-reviews__skeleton')).toHaveAttribute('aria-busy', 'true')
    expect(await screen.findByText("You haven't written any reviews yet.")).toBeInTheDocument()
  })

  it('in Bangla: the heading and the status badges', async () => {
    signIn()
    fakeShop()
    await switchToBangla()
    renderPage()
    expect(await screen.findByRole('heading', { name: 'আমার রিভিউ', level: 2 })).toBeInTheDocument()
    expect(await screen.findByText('প্রকাশিত')).toBeInTheDocument()
    expect(screen.getByText('অনুমোদনের অপেক্ষায়')).toBeInTheDocument()
    expect(screen.getByText('প্রকাশ করা হয়নি')).toBeInTheDocument()
    expect(screen.getByText('শপ লুকিয়ে রেখেছে')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '৫-এর মধ্যে ৪ স্টার' })).toBeInTheDocument()
  })

  it('every new text exists in English and Bangla', () => {
    for (const key of Object.keys(enAccount.myReviews)) expect(bnAccount.myReviews[key], key).toBeTruthy()
    expect(bnAccount.nav.myReviews).toBe('আমার রিভিউ')
    expect(Object.keys(bnCatalog.reviewStatus)).toEqual(Object.keys(enCatalog.reviewStatus))
    expect(bnCatalog.reviewForm.alreadyReviewed).toContain('<page>')
  })
})

describe('the product page knows I already reviewed it', () => {
  const API_LAMP = { id: 12, name: 'Desk Lamp', price: '30.00', stock_quantity: 5, availability: 'in_stock', images: [], thumbnail_url: null, reviews: [] }
  const CATALOG = { 'GET /api/catalog/products/12': { body: { data: API_LAMP } }, 'GET /api/catalog/categories': { body: { data: [] } } }
  const renderLamp = () => renderWithProviders(<ProductDetailsPage />, { route: '/products/12', path: '/products/:productId' })

  it('"You\'ve already reviewed this product" with a link to My reviews and the status replaces the form', async () => {
    signIn()
    const fetchMock = fakeShop({ pages: [[{ ...LAMP, status: 'pending' }]], extra: CATALOG })
    renderLamp()
    expect(await screen.findByRole('link', { name: 'See it in My reviews' })).toHaveAttribute('href', '/account/reviews')
    expect(screen.getByText(/You've already reviewed this product\./)).toBeInTheDocument()
    expect(screen.getByText('Waiting for approval')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit review' })).not.toBeInTheDocument()
    const asked = calls(fetchMock, 'GET', '/api/shop/me/reviews')
    expect(new URL(asked[0][0]).searchParams.get('productId')).toBe('12')
  })

  it('without a review of this product (or when the check fails) the form shows as before', async () => {
    signIn()
    fakeShop({ pages: [[KETTLE]], extra: CATALOG })
    const { unmount } = renderLamp()
    expect(await screen.findByRole('button', { name: 'Submit review' })).toBeInTheDocument()
    unmount()

    fakeShop({ extra: { ...CATALOG, 'GET /api/shop/me/reviews': { status: 500, body: { message: 'Down.' } } } })
    renderLamp()
    expect(await screen.findByRole('button', { name: 'Submit review' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'See it in My reviews' })).not.toBeInTheDocument()
  })
})
