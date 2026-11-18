import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'

// BuyNest's backend (VITE_API_PROVIDER=laravel with Laravel accounts): the phase 5 screens exist.
vi.mock('../api/mode', () => ({ LIVE_DATA: true }))

const CATALOG = ['products.view', 'products.edit', 'products.delete', 'categories.edit', 'products.import', 'reviews.view', 'reviews.moderate', 'settings.view', 'settings.edit']
const OWNER = { ...ADMIN, name: 'Store Owner', role: { id: 1, name: 'Owner' }, permissions: CATALOG }
const VIEWER = { ...ADMIN, name: 'Vic Viewer', role: { id: 5, name: 'Viewer' }, permissions: ['products.view', 'reviews.view'] }
const nav = () => within(screen.getByRole('navigation', { name: 'Admin' }))
const sentTo = (fetchMock, method, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => init?.method === method && new URL(url).pathname === path)
  return call && (call[1].body instanceof FormData ? call[1].body : JSON.parse(call[1].body))
}
const calledWith = (fetchMock, method, path) => fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && new URL(url).pathname === path)

const CATEGORIES = [
  { id: 1, name: 'Beauty', slug: 'beauty', parentId: null, position: 0, isActive: true, productCount: 5, childCount: 2, depth: 0, description: '', metaTitle: '', metaDescription: '', imageUrl: null },
  { id: 3, name: 'Lipstick', slug: 'lipstick', parentId: 1, position: 0, isActive: false, productCount: 2, childCount: 1, depth: 1, description: '', metaTitle: '', metaDescription: '', imageUrl: null },
  { id: 5, name: 'Matte', slug: 'matte', parentId: 3, position: 0, isActive: true, productCount: 1, childCount: 0, depth: 2, description: '', metaTitle: '', metaDescription: '', imageUrl: null },
  { id: 4, name: 'Mascara', slug: 'mascara', parentId: 1, position: 1, isActive: true, productCount: 0, childCount: 0, depth: 1, description: '', metaTitle: '', metaDescription: '', imageUrl: null },
  { id: 2, name: 'Laptops', slug: 'laptops', parentId: null, position: 1, isActive: true, productCount: 0, childCount: 0, depth: 0, description: '', metaTitle: '', metaDescription: '', imageUrl: null },
]

function start(me, route, routes) {
  withSession()
  const fetchMock = mockFetch({ 'GET /api/admin/me': { body: me }, 'GET /api/admin/categories': { body: CATEGORIES }, ...routes })
  renderApp(route)
  return fetchMock
}

describe('catalog navigation', () => {
  it('shows each catalog screen only to roles with its permission', async () => {
    start(VIEWER, '/categories', {})
    await screen.findByRole('heading', { name: 'Categories' })
    expect(nav().getAllByRole('link').map((link) => link.textContent)).toEqual(['Products', 'Categories', 'Reviews'])
    // Read-only: no add, edit, move, or delete.
    expect(screen.queryByRole('button', { name: /Add category/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Move Beauty down' })).not.toBeInTheDocument()
  })

  it('a screen the role lacks names the permission', async () => {
    start(VIEWER, '/import-export', {})
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument()
    expect(screen.getByText('(products.import)')).toBeInTheDocument()
  })
})

describe('categories page', () => {
  it('shows the tree nested, and moves a category among its siblings', async () => {
    const fetchMock = start(OWNER, '/categories', { 'POST /api/admin/categories/reorder': { body: { ok: true } } })
    const user = userEvent.setup()
    const beauty = (await screen.findByText('Beauty')).closest('li')
    // Children are a list inside their parent's item.
    expect(within(beauty).getByText('Lipstick')).toBeInTheDocument()
    expect(within(beauty).getByText('Inactive')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move Beauty up' })).toBeDisabled()
    // Grandchildren are the deepest level: no "add a subcategory" there.
    expect(screen.getByRole('button', { name: 'Add a subcategory to Lipstick' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add a subcategory to Matte' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Move Lipstick down' }))
    await waitFor(() => expect(sentTo(fetchMock, 'POST', '/api/admin/categories/reorder')).toEqual({ parentId: 1, ids: [4, 3] }))
    expect(await screen.findByText('Lipstick moved to position 2 of 2.')).toBeInTheDocument()
  })

  it('adds a subcategory with a slug made from the name', async () => {
    const fetchMock = start(OWNER, '/categories', { 'POST /api/admin/categories': { status: 201, body: { category: { id: 9, name: 'Eye Liner' } } } })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add a subcategory to Beauty' }))
    const dialog = screen.getByRole('dialog', { name: 'Add a subcategory to Beauty' })
    await user.type(within(dialog).getByLabelText('Name'), 'Eye Liner')
    expect(within(dialog).getByLabelText('URL key (slug)')).toHaveValue('eye-liner')
    expect(within(dialog).getByLabelText('Parent category')).toHaveValue('1')
    await user.click(within(dialog).getByRole('button', { name: 'Add category' }))
    expect(await screen.findByText('Eye Liner added.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/categories')).toEqual({ name: 'Eye Liner', slug: 'eye-liner', parentId: 1, isActive: true, description: null, imageUrl: null, metaTitle: null, metaDescription: null })
  })

  it("editing can't move a category under itself; delete shows the server's refusal", async () => {
    start(OWNER, '/categories', {
      'DELETE /api/admin/categories/1': { status: 422, body: { message: 'Beauty has 2 subcategories and 5 products. Move them first.' } },
      'PATCH /api/admin/categories/3': { body: { category: {} } },
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Edit Beauty' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Beauty' })
    const parents = within(within(dialog).getByLabelText('Parent category')).getAllByRole('option').map((option) => option.textContent)
    // Not itself or below it, and Beauty has 3 levels: under Laptops would be 4 deep.
    expect(parents).toEqual(['None (top level)'])
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Edit Mascara' }))
    const mascara = within(screen.getByRole('dialog', { name: 'Edit Mascara' })).getByLabelText('Parent category')
    expect(within(mascara).getAllByRole('option').map((option) => option.textContent)).toEqual(['None (top level)', 'Beauty', 'Beauty › Lipstick', 'Laptops'])
    await user.click(within(screen.getByRole('dialog', { name: 'Edit Mascara' })).getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Delete Beauty' }))
    await user.click(screen.getByRole('button', { name: 'Delete category' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Beauty has 2 subcategories and 5 products. Move them first.')
  })

  it('turns a category off and on', async () => {
    const fetchMock = start(OWNER, '/categories', { 'PATCH /api/admin/categories/3': { body: { category: {} } } })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Activate Lipstick' }))
    await waitFor(() => expect(sentTo(fetchMock, 'PATCH', '/api/admin/categories/3')).toEqual({ isActive: true }))
  })
})

describe('products grid mass actions', () => {
  const PRODUCTS = {
    products: [
      { id: 1, title: 'Mascara', category: 'beauty', price: 9.99, stock: 99, status: 'active' },
      { id: 2, title: 'Lipstick', category: 'beauty', price: 12.5, stock: 3, status: 'draft' },
      { id: 3, title: 'T-shirt', category: 'beauty', price: 20, stock: 0, status: 'active', hasVariants: true },
    ],
    total: 3,
    live: true,
  }

  it('selects all on the page and sets stock, listing what was skipped', async () => {
    const fetchMock = start(OWNER, '/products', {
      'GET /api/admin/products': { body: PRODUCTS },
      'POST /api/admin/products/bulk': { body: { updated: 2, skipped: [{ id: 3, reason: 'Has variants: set the stock per variant.' }] } },
    })
    const user = userEvent.setup()
    await screen.findByText('Mascara')
    expect(screen.queryByRole('form', { name: /selected/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Select all products on this page' }))
    const bar = screen.getByRole('form', { name: '3 selected' })
    await user.selectOptions(within(bar).getByLabelText('Action'), 'Set stock…')
    await user.click(within(bar).getByRole('button', { name: 'Apply' }))
    expect(within(bar).getByRole('alert')).toHaveTextContent('Enter a whole number of units')
    await user.type(within(bar).getByLabelText('Units in stock'), '25')
    await user.click(within(bar).getByRole('button', { name: 'Apply' }))
    expect(await screen.findByText('2 products restocked. 1 skipped:')).toBeInTheDocument()
    expect(screen.getByText('T-shirt: Has variants: set the stock per variant.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/products/bulk')).toEqual({ ids: [1, 2, 3], action: 'set_stock', value: 25 })
    // The selection is cleared afterwards.
    expect(screen.getByRole('checkbox', { name: 'Select all products on this page' })).not.toBeChecked()
  })

  it('asks before deleting or changing prices', async () => {
    const fetchMock = start(OWNER, '/products', { 'GET /api/admin/products': { body: PRODUCTS }, 'POST /api/admin/products/bulk': { body: { updated: 1, skipped: [] } } })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('checkbox', { name: 'Select Mascara' }))
    const bar = screen.getByRole('form', { name: '1 selected' })
    await user.selectOptions(within(bar).getByLabelText('Action'), 'Change price…')
    await user.type(within(bar).getByLabelText('Percent (negative lowers)'), '-10')
    await user.click(within(bar).getByRole('button', { name: 'Apply' }))
    const confirm = screen.getByRole('dialog', { name: 'Change the price of 1 product?' })
    expect(confirm).toHaveTextContent('Each price changes by -10%, and so do variant prices set separately.')
    expect(calledWith(fetchMock, 'POST', '/api/admin/products/bulk')).toHaveLength(0)
    await user.click(within(confirm).getByRole('button', { name: 'Change prices' }))
    await waitFor(() => expect(sentTo(fetchMock, 'POST', '/api/admin/products/bulk')).toEqual({ ids: [1], action: 'adjust_price', value: { mode: 'percent', amount: -10 } }))

    await user.click(await screen.findByRole('checkbox', { name: 'Select Lipstick' }))
    await user.selectOptions(within(screen.getByRole('form', { name: '1 selected' })).getByLabelText('Action'), 'Delete')
    await user.click(within(screen.getByRole('form', { name: '1 selected' })).getByRole('button', { name: 'Apply' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Delete 1 product?' })).getByRole('button', { name: 'Delete 1 product' }))
    await waitFor(() => expect(sentTo(fetchMock, 'POST', '/api/admin/products/bulk')).toEqual({ ids: [2], action: 'delete' }))
  })

  it('offers only the actions the role allows, and no checkboxes to a read-only role', async () => {
    start({ ...OWNER, permissions: ['products.view', 'products.edit'] }, '/products', { 'GET /api/admin/products': { body: PRODUCTS } })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('checkbox', { name: 'Select Mascara' }))
    const actions = within(screen.getByLabelText('Action')).getAllByRole('option').map((option) => option.textContent)
    expect(actions).not.toContain('Delete')
    expect(actions).toContain('Move to category…')
  })

  it('a read-only role gets no checkboxes', async () => {
    start(VIEWER, '/products', { 'GET /api/admin/products': { body: PRODUCTS } })
    await screen.findByText('Mascara')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Export CSV/ })).not.toBeInTheDocument()
  })
})

describe('product form: images, options, variants', () => {
  const PRODUCT = {
    id: 4,
    title: 'T-shirt',
    category: 'beauty',
    brand: '',
    price: 20,
    discountPercentage: 0,
    stock: 0,
    status: 'draft',
    description: '',
    imageList: [
      { id: 7, url: '/media/products/4/a.jpg', alt: 'Front', position: 0 },
      { id: 8, url: '/media/products/4/b.jpg', alt: '', position: 1 },
    ],
    options: [{ id: 1, name: 'Size', position: 0, values: [{ id: 11, value: 'S', position: 0 }, { id: 12, value: 'M', position: 1 }] }],
    variants: [{ id: 21, sku: 'TS-s', optionValueIds: [11], price: null, stock: 0, isActive: false }],
    hasVariants: true,
    live: true,
  }

  it('edits alt text, reorders with buttons, and uploads checked files', async () => {
    const fetchMock = start(OWNER, '/products/4', {
      'GET /api/admin/products/4': { body: PRODUCT },
      'PATCH /api/admin/products/4/images/8': { body: { image: { id: 8, alt: 'Back' } } },
      'POST /api/admin/products/4/images/reorder': { body: { images: [] } },
      'POST /api/admin/products/4/images': { status: 201, body: { images: [] } },
    })
    const user = userEvent.setup({ applyAccept: false })
    const images = within(await screen.findByRole('region', { name: 'Images' }))
    expect(images.getByText('Main image')).toBeInTheDocument()
    await user.type(images.getByLabelText('Alt text for image 2'), 'Back')
    await user.click(images.getAllByRole('button', { name: 'Save' })[1])
    await waitFor(() => expect(sentTo(fetchMock, 'PATCH', '/api/admin/products/4/images/8')).toEqual({ alt: 'Back' }))

    await user.click(images.getByRole('button', { name: 'Move image 2 up' }))
    await waitFor(() => expect(sentTo(fetchMock, 'POST', '/api/admin/products/4/images/reorder')).toEqual({ ids: [8, 7] }))
    expect(await images.findByText(/Image moved to position 1 of 2. It is now the main image./)).toBeInTheDocument()

    const input = images.getByLabelText('Add images')
    await user.upload(input, [new File(['x'], 'notes.gif', { type: 'image/gif' })])
    expect(images.getByText('notes.gif: use a JPEG, PNG, or WebP image.')).toBeInTheDocument()
    expect(images.getByRole('button', { name: /Upload 1 image/ })).toBeDisabled()

    await user.upload(input, [new File(['a'], 'front.jpg', { type: 'image/jpeg' }), new File(['b'], 'side.webp', { type: 'image/webp' })])
    await user.click(images.getByRole('button', { name: /Upload 2 images/ }))
    expect(await images.findByText('2 images uploaded.')).toBeInTheDocument()
    const form = sentTo(fetchMock, 'POST', '/api/admin/products/4/images')
    expect(form.getAll('images[]').map((file) => file.name)).toEqual(['front.jpg', 'side.webp'])
  })

  it('saves options, generates combinations, and saves a variant', async () => {
    const fetchMock = start(OWNER, '/products/4', {
      'GET /api/admin/products/4': { body: PRODUCT },
      'PUT /api/admin/products/4/options': { body: { options: [], variants: [] } },
      'POST /api/admin/products/4/variants/generate': { body: { created: 2, variants: [] } },
      'PATCH /api/admin/products/4/variants/21': { body: { variant: {} } },
    })
    const user = userEvent.setup()
    const section = within(await screen.findByRole('region', { name: 'Options and variants' }))
    expect(screen.getByText(/This product sells through its variants/)).toBeInTheDocument()
    expect(section.getByRole('button', { name: /Generate combinations/ })).toBeEnabled()

    await user.click(section.getByRole('button', { name: /Add option/ }))
    await user.type(section.getByLabelText('Option 2 name'), 'Color')
    await user.type(section.getByLabelText('Option 2 values'), 'Red, red')
    expect(section.getByRole('button', { name: /Generate combinations/ })).toBeDisabled()
    await user.click(section.getByRole('button', { name: 'Save options' }))
    expect(section.getByText('Each value can appear once.')).toBeInTheDocument()
    await user.clear(section.getByLabelText('Option 2 values'))
    await user.type(section.getByLabelText('Option 2 values'), 'Red,  Blue')
    await user.click(section.getByRole('button', { name: 'Save options' }))
    await waitFor(() => expect(sentTo(fetchMock, 'PUT', '/api/admin/products/4/options')).toEqual({ options: [{ name: 'Size', values: ['S', 'M'] }, { name: 'Color', values: ['Red', 'Blue'] }] }))

    const row = section.getByRole('row', { name: /Size: S/ })
    await user.type(within(row).getByLabelText('Units in stock for Size: S'), '5')
    await user.click(within(row).getByRole('checkbox', { name: 'Sell Size: S' }))
    await user.click(within(row).getByRole('button', { name: 'Save Size: S' }))
    await waitFor(() => expect(sentTo(fetchMock, 'PATCH', '/api/admin/products/4/variants/21')).toEqual({ sku: 'TS-s', price: null, stock: 5, isActive: true }))
  })

  it('a role without products.edit sees images and variants read-only', async () => {
    start(VIEWER, '/products/4', { 'GET /api/admin/products/4': { body: PRODUCT } })
    const images = within(await screen.findByRole('region', { name: 'Images' }))
    expect(images.queryByLabelText('Add images')).not.toBeInTheDocument()
    expect(images.queryByRole('button', { name: /Move image/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save options' })).not.toBeInTheDocument()
  })
})

describe('import / export', () => {
  const file = () => new File(['sku,name\nA,B\n'], 'products.csv', { type: 'text/csv' })

  it('downloads with the filters, checks a file, shows error rows, and imports nothing', async () => {
    const fetchMock = start(OWNER, '/import-export?category=beauty', {
      'POST /api/admin/products/import': { body: { dryRun: true, rows: 3, created: 1, updated: 1, unchanged: 0, errors: [{ row: 4, column: 'price', message: 'Enter a price.' }] } },
    })
    const user = userEvent.setup()
    const download = await screen.findByRole('link', { name: /Download CSV/ })
    expect(download).toHaveAttribute('href', '/api/admin/products/export.csv?category=beauty')
    await user.selectOptions(screen.getByLabelText('Status'), 'draft')
    expect(download).toHaveAttribute('href', '/api/admin/products/export.csv?category=beauty&status=draft')

    await user.upload(screen.getByLabelText('CSV file'), file())
    await user.click(screen.getByRole('button', { name: /Check file/ }))
    expect(await screen.findByText(/3 rows: 1 to create, 1 to update, 0 unchanged, 1 error/)).toBeInTheDocument()
    const errors = within(screen.getByRole('table', { name: 'Rows with errors' }))
    expect(errors.getByRole('row', { name: '4 price Enter a price.' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Import now/ })).not.toBeInTheDocument()
    const [url] = calledWith(fetchMock, 'POST', '/api/admin/products/import')[0]
    expect(new URL(url).searchParams.get('dryRun')).toBe('true')
  })

  it('imports after a clean check', async () => {
    const fetchMock = start(OWNER, '/import-export', {
      'POST /api/admin/products/import': (url) => ({ body: { dryRun: url.searchParams.get('dryRun') !== 'false', rows: 2, created: 2, updated: 0, unchanged: 0, errors: [] } }),
    })
    const user = userEvent.setup()
    await user.upload(await screen.findByLabelText('CSV file'), file())
    await user.click(screen.getByRole('button', { name: /Check file/ }))
    await user.click(await screen.findByRole('button', { name: /Import now/ }))
    expect(await screen.findByText(/Import finished\./)).toBeInTheDocument()
    expect(screen.getByText(/2 created, 0 updated/)).toBeInTheDocument()
    const [url, init] = calledWith(fetchMock, 'POST', '/api/admin/products/import').at(-1)
    expect(new URL(url).searchParams.get('dryRun')).toBe('false')
    expect(init.body.get('file').name).toBe('products.csv')
  })

  it('lists skipped values (phase 11 warnings) without blocking the import', async () => {
    start(OWNER, '/import-export', {
      'POST /api/admin/products/import': {
        body: { dryRun: true, rows: 1, created: 0, updated: 1, unchanged: 0, errors: [], warnings: [{ row: 2, column: 'related_skus', message: 'No product has SKU "NOPE": skipped.' }] },
      },
    })
    const user = userEvent.setup()
    await user.upload(await screen.findByLabelText('CSV file'), file())
    await user.click(screen.getByRole('button', { name: /Check file/ }))
    expect(await screen.findByText(/1 note: some values were skipped/)).toBeInTheDocument()
    const notes = within(screen.getByRole('table', { name: /Skipped values/ }))
    expect(notes.getByRole('row', { name: '2 related_skus No product has SKU "NOPE": skipped.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Import now/ })).toBeInTheDocument()
  })

  it('refuses a file that is not CSV before sending it', async () => {
    const fetchMock = start(OWNER, '/import-export', {})
    const user = userEvent.setup({ applyAccept: false })
    await user.upload(await screen.findByLabelText('CSV file'), new File(['x'], 'products.xlsx'))
    expect(screen.getByText('Choose a .csv file.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Check file/ }))
    expect(calledWith(fetchMock, 'POST', '/api/admin/products/import')).toHaveLength(0)
  })
})

describe('reviews', () => {
  const REVIEWS = {
    reviews: [
      { id: 5, productId: 4, productName: 'Mascara', authorName: 'Ava', rating: 4, title: 'Nice', comment: 'Lasts all day.', status: 'pending', verifiedPurchase: true, createdAt: '2026-11-10T10:00:00Z' },
      { id: 6, productId: 4, productName: 'Mascara', authorName: 'Ben', rating: 1, title: '', comment: 'Smudges a lot.', status: 'approved', verifiedPurchase: false, createdAt: '2026-11-11T10:00:00Z' },
    ],
    total: 2,
    live: true,
  }

  it('filters, approves one, and rejects the selected ones', async () => {
    const fetchMock = start(OWNER, '/reviews', {
      'GET /api/admin/reviews': { body: REVIEWS },
      'PATCH /api/admin/reviews/5': { body: { review: {} } },
      'POST /api/admin/reviews/bulk': { body: { updated: 2, skipped: [] } },
    })
    const user = userEvent.setup()
    expect(await screen.findByText('Lasts all day.')).toBeInTheDocument()
    expect(screen.getByText('Verified purchase')).toBeInTheDocument()
    expect(screen.getByText('4 of 5 stars')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Status'), 'pending')
    await waitFor(() => expect(new URL(calledWith(fetchMock, 'GET', '/api/admin/reviews').at(-1)[0]).searchParams.get('status')).toBe('pending'))

    await user.click(screen.getByRole('button', { name: 'Approve the review by Ava' }))
    expect(await screen.findByText('The review by Ava was approved.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/reviews/5')).toEqual({ status: 'approved' })

    await user.click(screen.getByRole('checkbox', { name: 'Select all reviews on this page' }))
    await user.click(within(screen.getByRole('group', { name: /Bulk actions/ })).getByRole('button', { name: /Reject selected/ }))
    expect(await screen.findByText('2 reviews rejected.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/reviews/bulk')).toEqual({ ids: [5, 6], status: 'rejected' })
  })

  it('without reviews.moderate it is read-only; a 403 shows the no-access screen', async () => {
    start(VIEWER, '/reviews', { 'GET /api/admin/reviews': { body: REVIEWS } })
    expect(await screen.findByText('Lasts all day.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('a 403 permission_denied from the server shows the friendly screen', async () => {
    start(OWNER, '/reviews', { 'GET /api/admin/reviews': { status: 403, body: { message: "Your role doesn't allow this.", code: 'permission_denied', permission: 'reviews.view' } } })
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument()
    expect(screen.getByText('View product reviews')).toBeInTheDocument()
  })
})

describe('settings → catalog', () => {
  it('turns review approval off', async () => {
    const saved = { general: {}, shipping: {}, tax: {}, checkout: {}, inventory: {}, catalog: { reviewsRequireApproval: true } }
    const fetchMock = start(OWNER, '/settings', {
      'GET /api/admin/settings': { body: saved },
      'PATCH /api/admin/settings': { body: { ...saved, catalog: { reviewsRequireApproval: false } } },
    })
    const user = userEvent.setup()
    const group = within(await screen.findByRole('form', { name: 'Catalog' }))
    const box = group.getByRole('checkbox', { name: 'New reviews wait for approval' })
    expect(box).toBeChecked()
    await user.click(box)
    await user.click(group.getByRole('button', { name: 'Save catalog' }))
    expect(await group.findByText('Catalog saved.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/settings')).toEqual({ catalog: { reviewsRequireApproval: false } })
  })
})
