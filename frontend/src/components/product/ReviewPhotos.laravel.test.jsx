import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import ReviewForm from './ReviewForm'
import ProductReviews from './ProductReviews'
import { mockFetch } from '../../test/mockFetch'
import { switchToBangla } from '../../test/i18n'
import en from '../../locales/en/catalog.json'
import bn from '../../locales/bn/catalog.json'

/*
 * Phase 22 (docs/backend/PHASE22_CONTRACT.md §2): the review form's photo
 * field (shown only while the store allows it; count, type and size checks;
 * FormData with photos, JSON without), and review photos on the product page
 * (thumbnails, the viewer, "With photos (n)").
 */
vi.mock('../../services/providers/index', async () => ({ apiProvider: (await import('../../services/providers/laravelProvider')).laravelProvider }))
vi.mock('../../constants/shop', () => ({ REAL_SHOP: true }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true, authorizedRequest: (request) => request() }) }))

const HEX = '0123456789abcdef0123456789abcdef'
const HEX2 = 'fedcba9876543210fedcba9876543210'
const REVIEWS_PATH = '/api/shop/products/5/reviews'
const STORE = (reviewPhotos) => ({ body: { data: { store_name: 'BuyNest', ...(reviewPhotos && { review_photos: reviewPhotos }) } } })
const ON = { enabled: true, max: 3, max_megabytes: 5 }
const REVIEW = (extra = {}) => ({ id: 9, rating: 4, title: null, comment: 'Lovely colour.', date: '2026-11-28T10:00:00Z', reviewerName: 'Ava C.', verifiedPurchase: false, status: 'pending', photos: [], ...extra })

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]
const photo = (name, head = PNG, type = 'image/png', size = 0) => new File([new Uint8Array(head), new Uint8Array(size)], name, { type })

function renderForm() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ReviewForm productId={5} productTitle="Tee" />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const posts = (fetchMock) => fetchMock.mock.calls.filter(([url, init]) => new URL(url).pathname === REVIEWS_PATH && init?.method === 'POST')

let previews = 0
beforeEach(() => {
  previews = 0
  URL.createObjectURL = vi.fn(() => `blob:preview-${++previews}`)
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  delete URL.createObjectURL
  delete URL.revokeObjectURL
})

async function fillReview(user) {
  await user.click(screen.getByText('4 stars').closest('label'))
  await user.type(screen.getByRole('textbox', { name: 'Your review' }), 'The colour is exactly as shown.')
}

describe('ReviewForm photo field', () => {
  it('is not shown while the store has review photos off', async () => {
    const fetchMock = mockFetch({ 'GET /api/catalog/store': STORE(null) })
    renderForm()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await screen.findByRole('button', { name: 'Submit review' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(screen.queryByLabelText('Add photos (optional)')).toBeNull()
  })

  it('is shown with its hint while it is on: a file input for JPEG, PNG and WebP', async () => {
    mockFetch({ 'GET /api/catalog/store': STORE(ON) })
    renderForm()
    const input = await screen.findByLabelText('Add photos (optional)')
    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp')
    expect(input).toHaveAttribute('multiple')
    expect(input).toHaveAccessibleDescription('Up to 3 photos, JPEG, PNG or WebP, 5 MB each.')
  })

  it('refuses more than 3 photos', async () => {
    mockFetch({ 'GET /api/catalog/store': STORE(ON) })
    const user = userEvent.setup({ applyAccept: false })
    renderForm()
    const input = await screen.findByLabelText('Add photos (optional)')
    await user.upload(input, [photo('1.png'), photo('2.png'), photo('3.png'), photo('4.png')])
    expect(await screen.findByRole('alert')).toHaveTextContent('You can add up to 3 photos.')
    expect(screen.queryByRole('list', { name: 'Chosen photos' })).toBeNull()
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('refuses a file that is not a photo, whatever its name says', async () => {
    mockFetch({ 'GET /api/catalog/store': STORE(ON) })
    const user = userEvent.setup({ applyAccept: false })
    renderForm()
    const input = await screen.findByLabelText('Add photos (optional)')
    await user.upload(input, [new File(['just some text'], 'note.jpg', { type: 'image/jpeg' })])
    expect(await screen.findByRole('alert')).toHaveTextContent("note.jpg isn't a JPEG, PNG or WebP photo.")
    expect(input).toHaveAccessibleDescription(expect.stringContaining("note.jpg isn't a JPEG, PNG or WebP photo."))
  })

  it('refuses a photo still larger than 5 MB after shrinking', async () => {
    mockFetch({ 'GET /api/catalog/store': STORE(ON) })
    const user = userEvent.setup({ applyAccept: false })
    renderForm()
    const input = await screen.findByLabelText('Add photos (optional)')
    await user.upload(input, [photo('big.jpg', JPEG, 'image/jpeg', 5 * 1024 * 1024)])
    expect(await screen.findByRole('alert')).toHaveTextContent('big.jpg is larger than 5 MB.')
  })

  it('shows previews that can be removed (the preview address is released)', async () => {
    mockFetch({ 'GET /api/catalog/store': STORE(ON) })
    const user = userEvent.setup({ applyAccept: false })
    renderForm()
    const input = await screen.findByLabelText('Add photos (optional)')
    await user.upload(input, [photo('a.png'), photo('b.jpg', JPEG, 'image/jpeg')])
    const list = await screen.findByRole('list', { name: 'Chosen photos' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByRole('img', { name: 'Photo 1: a.png' })).toHaveAttribute('src', 'blob:preview-1')
    await user.click(screen.getByRole('button', { name: 'Remove photo 1' }))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1')
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByRole('img', { name: 'Photo 1: b.jpg' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove photo 2' })).toBeNull()
    expect(input).toHaveFocus()
  })

  it('sends FormData (rating, title, comment, photos[]) with photos, and says the photos are checked first', async () => {
    const fetchMock = mockFetch({ 'GET /api/catalog/store': STORE(ON), [`POST ${REVIEWS_PATH}`]: { status: 201, body: REVIEW({ photos: [] }) } })
    const user = userEvent.setup({ applyAccept: false })
    renderForm()
    await user.upload(await screen.findByLabelText('Add photos (optional)'), [photo('a.png'), photo('b.jpg', JPEG, 'image/jpeg')])
    await screen.findByRole('list', { name: 'Chosen photos' })
    await fillReview(user)
    await user.click(screen.getByRole('button', { name: 'Submit review' }))
    await screen.findByText('Thanks — your review will appear after approval. Your photos will be checked first.')
    const [, init] = posts(fetchMock)[0]
    expect(init.body).toBeInstanceOf(FormData)
    expect(init.headers['Content-Type']).toBeUndefined()
    expect(init.body.get('rating')).toBe('4')
    expect(init.body.get('title')).toBe('')
    expect(init.body.get('comment')).toBe('The colour is exactly as shown.')
    expect(init.body.getAll('photos[]').map((file) => file.name)).toEqual(['a.png', 'b.jpg'])
  })

  it('sends JSON as before without photos', async () => {
    const fetchMock = mockFetch({ 'GET /api/catalog/store': STORE(ON), [`POST ${REVIEWS_PATH}`]: { status: 201, body: REVIEW() } })
    const user = userEvent.setup()
    renderForm()
    await screen.findByLabelText('Add photos (optional)')
    await fillReview(user)
    await user.click(screen.getByRole('button', { name: 'Submit review' }))
    await screen.findByText('Thanks — your review will appear after approval.')
    const [, init] = posts(fetchMock)[0]
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ rating: 4, title: null, comment: 'The colour is exactly as shown.' })
  })

  it("shows the server's photo errors under the field, numbered and linked to it", async () => {
    mockFetch({
      'GET /api/catalog/store': STORE(ON),
      [`POST ${REVIEWS_PATH}`]: { status: 422, body: { message: "This photo couldn't be read.", errors: { 'photos.1': ["This photo couldn't be read."] } } },
    })
    const user = userEvent.setup({ applyAccept: false })
    renderForm()
    const input = await screen.findByLabelText('Add photos (optional)')
    await user.upload(input, [photo('a.png'), photo('b.png')])
    await screen.findByRole('list', { name: 'Chosen photos' })
    await fillReview(user)
    await user.click(screen.getByRole('button', { name: 'Submit review' }))
    expect(await screen.findByText("Photo 2: This photo couldn't be read.")).toBeInTheDocument()
    expect(input).toHaveAccessibleDescription(expect.stringContaining("Photo 2: This photo couldn't be read."))
    // Shown once, under the field (not again above the button).
    expect(screen.getAllByText(/couldn't be read/)).toHaveLength(1)
  })
})

describe('review photos on the product page (ProductReviews)', () => {
  const PHOTOS = [
    { id: 1, url: `/media/reviews/${HEX}.jpg`, width: 1200, height: 1600 },
    { id: 2, url: `/media/reviews/${HEX2}.png`, width: 800, height: 600 },
  ]
  const REVIEWS = [
    { id: 1, rating: 5, title: null, comment: 'Great.', date: '2026-11-20', reviewerName: 'Nadia R.', verifiedPurchase: true, photos: PHOTOS },
    { id: 2, rating: 3, title: null, comment: 'Fine.', date: '2026-11-21', reviewerName: 'Ben S.', verifiedPurchase: false, photos: [] },
  ]

  it('shows thumbnails as buttons named after the photo and the reviewer', () => {
    render(<ProductReviews reviews={REVIEWS} reviewPhotoCount={2} />)
    const list = screen.getByRole('list', { name: "Photos from Nadia R.'s review" })
    const first = within(list).getByRole('button', { name: "Open photo 1 of 2 from Nadia R.'s review" })
    expect(within(list).getByRole('button', { name: "Open photo 2 of 2 from Nadia R.'s review" })).toBeInTheDocument()
    const image = first.querySelector('img')
    expect(image).toHaveAttribute('alt', '')
    expect(image).toHaveAttribute('loading', 'lazy')
    expect(image).toHaveAttribute('width', '1200')
    expect(image).toHaveAttribute('height', '1600')
    expect(image).toHaveAttribute('src', `/media/reviews/${HEX}.jpg`)
  })

  it('opens the viewer: Photo 1 of 2, Next / Previous and the arrow keys, Close returns focus', async () => {
    const user = userEvent.setup()
    render(<ProductReviews reviews={REVIEWS} reviewPhotoCount={2} />)
    const thumbnail = screen.getByRole('button', { name: "Open photo 1 of 2 from Nadia R.'s review" })
    await user.click(thumbnail)
    const dialog = screen.getByRole('dialog', { name: "Photos from Nadia R.'s review" })
    expect(within(dialog).getByRole('img', { name: "Photo 1 of 2 from Nadia R.'s review" })).toHaveAttribute('src', `/media/reviews/${HEX}.jpg`)
    expect(within(dialog).getByText('Photo 1 of 2')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Next photo' }))
    expect(within(dialog).getByText('Photo 2 of 2')).toBeInTheDocument()
    await user.keyboard('{ArrowRight}')
    expect(within(dialog).getByText('Photo 1 of 2')).toBeInTheDocument()
    await user.keyboard('{ArrowLeft}')
    expect(within(dialog).getByText('Photo 2 of 2')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Previous photo' }))
    expect(within(dialog).getByText('Photo 1 of 2')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(thumbnail).toHaveFocus()
  })

  it('Escape (the dialog closing itself) also returns focus to the thumbnail', async () => {
    const user = userEvent.setup()
    render(<ProductReviews reviews={REVIEWS} reviewPhotoCount={2} />)
    const thumbnail = screen.getByRole('button', { name: "Open photo 2 of 2 from Nadia R.'s review" })
    await user.click(thumbnail)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Photo 2 of 2')).toBeInTheDocument()
    dialog.close() // what the browser does on Escape
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(thumbnail).toHaveFocus()
  })

  it('has no Previous / Next with a single photo', async () => {
    const user = userEvent.setup()
    render(<ProductReviews reviews={[{ ...REVIEWS[0], photos: [PHOTOS[0]] }]} reviewPhotoCount={1} />)
    await user.click(screen.getByRole('button', { name: "Open photo 1 of 1 from Nadia R.'s review" }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Photo 1 of 1')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Next photo' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Previous photo' })).toBeNull()
  })

  it('"With photos (n)" counts reviews with photos and filters the list', async () => {
    const user = userEvent.setup()
    render(<ProductReviews reviews={REVIEWS} reviewPhotoCount={2} />)
    const filter = screen.getByRole('button', { name: 'With photos (1)' })
    expect(filter).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Fine.')).toBeInTheDocument()
    await user.click(filter)
    expect(filter).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Fine.')).toBeNull()
    expect(screen.getByText('Great.')).toBeInTheDocument()
    await user.click(filter)
    expect(screen.getByText('Fine.')).toBeInTheDocument()
  })

  it('has no filter while the product has no review photos', () => {
    render(<ProductReviews reviews={REVIEWS.map((review) => ({ ...review, photos: [] }))} reviewPhotoCount={0} />)
    expect(screen.queryByRole('button', { name: /With photos/ })).toBeNull()
  })

  it('hides a photo that no longer loads (hidden by staff), never a broken image', async () => {
    render(<ProductReviews reviews={REVIEWS} reviewPhotoCount={2} />)
    const image = screen.getByRole('button', { name: "Open photo 1 of 2 from Nadia R.'s review" }).querySelector('img')
    image.dispatchEvent(new Event('error'))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Open photo 1 of 2/ })).toBeNull())
    expect(screen.getByRole('button', { name: "Open photo 1 of 1 from Nadia R.'s review" })).toBeInTheDocument()
  })
})

describe('Bangla', () => {
  it('has every phase 22 text in Bangla', () => {
    for (const key of ['withPhotos', 'anonymous', 'photosOf', 'openPhoto', 'photoAlt', 'photoCount', 'previousPhoto', 'nextPhoto']) expect(bn.reviews[key]).toBeTruthy()
    for (const key of ['photosLabel', 'photosHint', 'photosTooMany', 'photoWrongType', 'photoTooLarge', 'preparingPhotos', 'chosenPhotos', 'photoPreview', 'removePhoto', 'photoError', 'pendingPhotos_one', 'pendingPhotos_other']) {
      expect(bn.reviewForm[key]).toBeTruthy()
      expect(bn.reviewForm[key]).not.toBe(en.reviewForm[key])
    }
  })

  it('shows the photo field label and the filter in Bangla', async () => {
    await switchToBangla()
    mockFetch({ 'GET /api/catalog/store': STORE(ON) })
    renderForm()
    expect(await screen.findByLabelText('ছবি যোগ করুন (ঐচ্ছিক)')).toHaveAttribute('type', 'file')
    render(<ProductReviews reviews={[{ id: 1, rating: 5, comment: 'ভালো', date: '2026-11-20', reviewerName: 'নাদিয়া', photos: [{ id: 1, url: `/media/reviews/${HEX}.jpg`, width: 10, height: 10 }] }]} reviewPhotoCount={1} />)
    expect(screen.getByRole('button', { name: 'ছবিসহ (১)' })).toHaveAttribute('aria-pressed', 'false')
  })
})
