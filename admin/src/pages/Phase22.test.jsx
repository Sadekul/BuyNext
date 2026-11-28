import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'

/*
 * Phase 22 (docs/backend/PHASE22_CONTRACT.md §3): review photos on
 * Catalog → Reviews (thumbnails, the larger view, hide/show, the "With photos"
 * filter) and Settings → Catalog → "Customers can add photos to reviews".
 */

vi.mock('../api/mode', () => ({ LIVE_DATA: true }))

const OWNER = {
  ...ADMIN,
  name: 'Store Owner',
  role: { id: 1, name: 'Owner' },
  permissions: ['products.view', 'reviews.view', 'reviews.moderate', 'settings.view', 'settings.edit'],
}
const VIEWER = { ...ADMIN, name: 'Vic Viewer', role: { id: 5, name: 'Viewer' }, permissions: ['products.view', 'reviews.view'] }

const photo = (id, position, hidden = false) => ({ id, hidden, width: 1200, height: 900, sizeBytes: 183_204, position, url: `/api/admin/reviews/41/photos/${id}` })
const REVIEW = {
  id: 41,
  productId: 4,
  productName: 'Saree',
  authorName: 'Nadia R.',
  rating: 4,
  title: 'True colour',
  comment: 'Same as the photos.',
  status: 'approved',
  verifiedPurchase: true,
  createdAt: '2026-11-28T10:00:00Z',
  // Sent out of order: the page numbers them by position.
  photos: [photo(10, 1), photo(9, 0)],
}
const PLAIN = { id: 42, productId: 4, productName: 'Saree', authorName: 'Ben', rating: 5, title: '', comment: 'No photos here.', status: 'approved', createdAt: '2026-11-28T11:00:00Z', photos: [] }

/** A tiny Laravel stand-in: the review list follows what was saved. */
function reviewsApi(me) {
  let review = structuredClone(REVIEW)
  withSession()
  const fetchMock = mockFetch({
    'GET /api/admin/me': { body: me },
    'GET /api/admin/reviews': () => ({ body: { reviews: [review, PLAIN], total: 2, counts: { pending: 0, approved: 2, rejected: 0 }, live: true } }),
    'PATCH /api/admin/reviews/41/photos/10': (url, init) => {
      const { hidden } = JSON.parse(init.body)
      review = { ...review, photos: review.photos.map((entry) => (entry.id === 10 ? { ...entry, hidden } : entry)) }
      return { body: { review, live: true } }
    },
  })
  return fetchMock
}
const calledWith = (fetchMock, method, path) => fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && new URL(url).pathname === path)

describe('review photos on Catalog → Reviews', () => {
  it('shows each photo as a thumbnail from the admin service, numbered by position', async () => {
    reviewsApi(OWNER)
    renderApp('/reviews')
    const first = await screen.findByRole('button', { name: 'View photo 1 of review by Nadia R.' })
    const second = screen.getByRole('button', { name: 'View photo 2 of review by Nadia R.' })
    expect(first.querySelector('img')).toHaveAttribute('src', '/api/admin/reviews/41/photos/9')
    expect(second.querySelector('img')).toHaveAttribute('src', '/api/admin/reviews/41/photos/10')
    expect(screen.queryByText('Hidden from the store')).not.toBeInTheDocument()
    // A review without photos has none.
    expect(screen.queryByRole('button', { name: /of review by Ben/ })).not.toBeInTheDocument()
  })

  it('opens a thumbnail larger in a dialog; closing returns focus to it', async () => {
    reviewsApi(OWNER)
    renderApp('/reviews')
    const user = userEvent.setup()
    const thumbnail = await screen.findByRole('button', { name: 'View photo 2 of review by Nadia R.' })
    await user.click(thumbnail)
    const dialog = await screen.findByRole('dialog', { name: 'Photo 2 of 2, review by Nadia R.' })
    expect(within(dialog).getByRole('img', { name: 'Photo 2 of 2, review by Nadia R.' })).toHaveAttribute('src', '/api/admin/reviews/41/photos/10')
    expect(within(dialog).getByText('1200 × 900 px · 179 KB')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Close photo' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(thumbnail).toHaveFocus()
  })

  it('hides a photo from the store and shows it again', async () => {
    const fetchMock = reviewsApi(OWNER)
    renderApp('/reviews')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Hide photo 2 of review by Nadia R.' }))
    expect(await screen.findByText('Photo 2 of the review by Nadia R. is hidden from the store.')).toBeInTheDocument()
    expect(JSON.parse(calledWith(fetchMock, 'PATCH', '/api/admin/reviews/41/photos/10').at(-1)[1].body)).toEqual({ hidden: true })
    expect(screen.getByText('Hidden from the store')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View photo 2 of review by Nadia R.' }).closest('li')).toHaveClass('review-photo--hidden')
    // Photo 1 is untouched.
    expect(screen.getByRole('button', { name: 'Hide photo 1 of review by Nadia R.' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show photo 2 of review by Nadia R.' }))
    expect(await screen.findByText('Photo 2 of the review by Nadia R. is shown in the store again.')).toBeInTheDocument()
    expect(JSON.parse(calledWith(fetchMock, 'PATCH', '/api/admin/reviews/41/photos/10').at(-1)[1].body)).toEqual({ hidden: false })
    await waitFor(() => expect(screen.queryByText('Hidden from the store')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Hide photo 2 of review by Nadia R.' })).toBeInTheDocument()
  })

  it('a refused change says why and changes nothing', async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: OWNER },
      'GET /api/admin/reviews': { body: { reviews: [REVIEW], total: 1, live: true } },
      'PATCH /api/admin/reviews/41/photos/9': { status: 404, body: { message: 'Not found.' } },
    })
    renderApp('/reviews')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Hide photo 1 of review by Nadia R.' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found.')
    expect(screen.getByRole('button', { name: 'Hide photo 1 of review by Nadia R.' })).toBeInTheDocument()
  })

  it('sends the "With photos" filter', async () => {
    const fetchMock = reviewsApi(OWNER)
    renderApp('/reviews')
    const user = userEvent.setup()
    await screen.findByText('Same as the photos.')
    expect(new URL(calledWith(fetchMock, 'GET', '/api/admin/reviews').at(-1)[0]).searchParams.has('hasPhotos')).toBe(false)
    await user.selectOptions(screen.getByLabelText('Photos', { exact: true }), 'With photos')
    await waitFor(() => expect(new URL(calledWith(fetchMock, 'GET', '/api/admin/reviews').at(-1)[0]).searchParams.get('hasPhotos')).toBe('true'))
    expect(screen.getByText('2 matching reviews')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Photos', { exact: true }), 'Any')
    await waitFor(() => expect(new URL(calledWith(fetchMock, 'GET', '/api/admin/reviews').at(-1)[0]).searchParams.has('hasPhotos')).toBe(false))
  })

  it('without reviews.moderate the photos are shown but cannot be hidden', async () => {
    reviewsApi(VIEWER)
    renderApp('/reviews')
    expect(await screen.findByRole('button', { name: 'View photo 1 of review by Nadia R.' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Hide photo|Show photo/ })).not.toBeInTheDocument()
  })
})

describe('Settings → Catalog', () => {
  const saved = (catalog) => ({ general: {}, shipping: {}, tax: {}, checkout: {}, inventory: {}, catalog })

  it('turns "Customers can add photos to reviews" on', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: OWNER },
      'GET /api/admin/settings': { body: saved({ reviewsRequireApproval: false, reviewPhotosEnabled: false }) },
      'PATCH /api/admin/settings': { body: saved({ reviewsRequireApproval: false, reviewPhotosEnabled: true }) },
    })
    renderApp('/settings')
    const user = userEvent.setup()
    const group = within(await screen.findByRole('form', { name: 'Catalog' }))
    const box = group.getByRole('checkbox', { name: 'Customers can add photos to reviews' })
    expect(box).not.toBeChecked()
    expect(box).toHaveAccessibleDescription('Reviews with photos always wait for approval. Photos are shrunk and their location data is removed.')
    await user.click(box)
    await user.click(group.getByRole('button', { name: 'Save catalog' }))
    expect(await group.findByText('Catalog saved.')).toBeInTheDocument()
    const call = calledWith(fetchMock, 'PATCH', '/api/admin/settings').at(-1)
    expect(JSON.parse(call[1].body)).toEqual({ catalog: { reviewsRequireApproval: false, reviewPhotosEnabled: true } })
    expect(group.getByRole('checkbox', { name: 'Customers can add photos to reviews' })).toBeChecked()
  })

  it('is not offered when the API does not have the setting', async () => {
    withSession()
    mockFetch({ 'GET /api/admin/me': { body: OWNER }, 'GET /api/admin/settings': { body: saved({ reviewsRequireApproval: true }) } })
    renderApp('/settings')
    const group = within(await screen.findByRole('form', { name: 'Catalog' }))
    expect(group.getByRole('checkbox', { name: 'New reviews wait for approval' })).toBeChecked()
    expect(group.queryByRole('checkbox', { name: 'Customers can add photos to reviews' })).not.toBeInTheDocument()
  })
})
