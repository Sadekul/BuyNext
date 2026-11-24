import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'

/*
 * Phase 16 (docs/backend/PHASE16_CONTRACT.md §5): the product form's option
 * types (text buttons / color swatches) with a colour per value, the images'
 * "Shown for" choice, the variants' Bangla labels, and a read-only viewer.
 */
vi.mock('../api/mode', () => ({ LIVE_DATA: true }))

const OWNER = { ...ADMIN, name: 'Store Owner', role: { id: 1, name: 'Owner' }, permissions: ['products.view', 'products.edit'] }
const VIEWER = { ...ADMIN, name: 'Vic Viewer', role: { id: 5, name: 'Viewer' }, permissions: ['products.view'] }
const sentTo = (fetchMock, method, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => init?.method === method && new URL(url).pathname === path)
  return call && JSON.parse(call[1].body)
}
const calls = (fetchMock, method, path) => fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && new URL(url).pathname === path)

const SIZE = { id: 2, name: 'Size', type: 'text', nameBn: 'সাইজ', position: 1, values: [{ id: 21, value: 'M', swatch: null, valueBn: '', position: 0 }, { id: 22, value: 'L', swatch: null, valueBn: '', position: 1 }] }
const COLOR = {
  id: 1,
  name: 'Color',
  type: 'color',
  nameBn: 'রং',
  position: 0,
  values: [
    { id: 11, value: 'Red', swatch: '#C0392B', valueBn: 'লাল', position: 0 },
    { id: 12, value: 'Blue', swatch: '#1E40AF', valueBn: 'নীল', position: 1 },
  ],
}
const PRODUCT = {
  id: 4,
  title: 'Shirt',
  category: 'tops',
  brand: '',
  price: 1200,
  discountPercentage: 0,
  stock: 0,
  status: 'active',
  description: '',
  metaTitle: '',
  metaDescription: '',
  imageList: [
    { id: 7, url: '/media/products/4/a.jpg', alt: 'Front', position: 0, isUpload: true, optionValueId: null },
    { id: 8, url: '/media/products/4/b.jpg', alt: 'Blue', position: 1, isUpload: true, optionValueId: 12 },
  ],
  options: [COLOR, SIZE],
  variants: [{ id: 31, sku: 'SH-RED-M', optionValueIds: [11, 21], label: 'Color: Red / Size: M', price: null, stock: 3, isActive: true }],
  hasVariants: true,
  live: true,
  bn: { name: '', shortDescription: '', description: '', metaTitle: '', metaDescription: '' },
  specifications: [],
  links: { related: [], upsell: [], crosssell: [] },
}

function start(me, product = PRODUCT, routes = {}) {
  withSession()
  const fetchMock = mockFetch({
    'GET /api/admin/me': { body: me },
    'GET /api/admin/categories': { body: [{ id: 1, name: 'Tops', slug: 'tops', parentId: null }] },
    'GET /api/admin/products/4': { body: product },
    'PUT /api/admin/products/4/options': { body: { options: product.options, variants: product.variants, imageList: product.imageList, hasVariants: true, live: true } },
    'PATCH /api/admin/products/4/images/7': { body: { images: product.imageList, live: true } },
    'PATCH /api/admin/products/4/images/8': { body: { images: product.imageList, live: true } },
    'PUT /api/admin/products/4': { body: { product, live: true } },
    ...routes,
  })
  renderApp('/products/4')
  return fetchMock
}
const variantsSection = async () => within(await screen.findByRole('region', { name: 'Options and variants' }))

describe('option types and colour swatches', () => {
  it('shows each option’s type and the colour fields of a color option', async () => {
    start(OWNER)
    const section = await variantsSection()
    expect(section.getByLabelText('Option 1 type')).toHaveValue('color')
    expect(section.getByLabelText('Option 2 type')).toHaveValue('text')
    expect(within(section.getByLabelText('Option 1 type')).getAllByRole('option').map((option) => option.textContent)).toEqual(['Text buttons', 'Color swatches'])
    expect(section.getByLabelText('Color value Red: swatch colour')).toHaveValue('#c0392b')
    expect(section.getByLabelText('Color value Red: hex code')).toHaveValue('#C0392B')
    expect(section.getByLabelText('Color value Blue: hex code')).toHaveValue('#1E40AF')
    // A text option has no colour fields.
    expect(section.queryByLabelText(/^Size value M/)).not.toBeInTheDocument()
    expect(section.getByRole('button', { name: /Generate combinations/ })).toBeEnabled()
  })

  it('turns an option into colour swatches, checks #RRGGBB before sending, and saves type and swatches', async () => {
    const fetchMock = start(OWNER)
    const user = userEvent.setup()
    const section = await variantsSection()
    await user.selectOptions(section.getByLabelText('Option 2 type'), 'color')
    expect(section.getByRole('group', { name: 'Colours of option 2' })).toBeInTheDocument()
    expect(section.getByRole('button', { name: /Generate combinations/ })).toBeDisabled()
    await user.type(section.getByLabelText('Size value M: hex code'), 'navy')
    await user.click(section.getByRole('button', { name: 'Save options' }))
    expect(section.getByText('Pick a colour for M as #RRGGBB (for example #1E40AF).')).toBeInTheDocument()
    expect(section.getByText('Pick a colour for L as #RRGGBB (for example #1E40AF).')).toBeInTheDocument()
    expect(section.getByLabelText('Size value M: hex code')).toHaveAttribute('aria-invalid', 'true')
    expect(section.getByLabelText('Size value M: hex code')).toHaveAccessibleDescription(/Pick a colour for M/)
    expect(calls(fetchMock, 'PUT', '/api/admin/products/4/options')).toHaveLength(0)
    // Only one option can use colour swatches (the API's rule too).
    expect(section.getByLabelText('Option 2 type')).toHaveAccessibleDescription('Only one option can use colour swatches.')
    await user.selectOptions(section.getByLabelText('Option 1 type'), 'text')

    await user.clear(section.getByLabelText('Size value M: hex code'))
    await user.type(section.getByLabelText('Size value M: hex code'), '#00aa55')
    // The native picker sets the hex field too.
    fireEvent.change(section.getByLabelText('Size value L: swatch colour'), { target: { value: '#112233' } })
    await waitFor(() => expect(section.getByLabelText('Size value L: hex code')).toHaveValue('#112233'))
    await user.click(section.getByRole('button', { name: 'Save options' }))
    await waitFor(() =>
      expect(sentTo(fetchMock, 'PUT', '/api/admin/products/4/options')).toEqual({
        options: [
          { name: 'Color', type: 'text', values: ['Red', 'Blue'] },
          { name: 'Size', type: 'color', values: [{ value: 'M', swatch: '#00AA55' }, { value: 'L', swatch: '#112233' }] },
        ],
      }),
    )
  })

  it('sends a text option with its type, and shows the server’s type and swatch errors on their fields', async () => {
    const fetchMock = start(OWNER, PRODUCT, {
      'PUT /api/admin/products/4/options': { status: 422, body: { message: 'Check', errors: { 'options.0.values.1.swatch': ['That is not a colour.'], 'options.1.type': ['Choose a type.'] } } },
    })
    const user = userEvent.setup()
    const section = await variantsSection()
    await user.clear(section.getByLabelText('Option 2 values'))
    await user.type(section.getByLabelText('Option 2 values'), 'M, L, XL')
    await user.click(section.getByRole('button', { name: 'Save options' }))
    await waitFor(() => expect(sentTo(fetchMock, 'PUT', '/api/admin/products/4/options').options[1]).toEqual({ name: 'Size', type: 'text', values: ['M', 'L', 'XL'] }))
    expect(await section.findByText('That is not a colour.')).toBeInTheDocument()
    expect(section.getByLabelText('Color value Blue: hex code')).toHaveAttribute('aria-invalid', 'true')
    expect(section.getByLabelText('Option 2 type')).toHaveAccessibleDescription('Choose a type.')
  })

  it('shows the variant label in Bangla where the names are set', async () => {
    start(OWNER)
    const section = await variantsSection()
    const label = section.getByText('রং: লাল / সাইজ: M')
    expect(label).toHaveAttribute('lang', 'bn')
    expect(section.getByRole('row', { name: /Color: Red \/ Size: M/ })).toBeInTheDocument()
  })

  it('keeps the type and colours when only the Bangla names are saved', async () => {
    const fetchMock = start(OWNER)
    const user = userEvent.setup()
    const bangla = within(await screen.findByRole('group', { name: /^Bangla/ }))
    await user.type(bangla.getByLabelText('Size “M” in Bangla'), 'মাঝারি')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(sentTo(fetchMock, 'PUT', '/api/admin/products/4/options')).toEqual({
        options: [
          { name: 'Color', type: 'color', values: [{ value: 'Red', swatch: '#C0392B' }, { value: 'Blue', swatch: '#1E40AF' }], nameBn: 'রং', valuesBn: ['লাল', 'নীল'] },
          { name: 'Size', type: 'text', values: ['M', 'L'], nameBn: 'সাইজ', valuesBn: ['মাঝারি', ''] },
        ],
      }),
    )
  })
})

describe('images: shown for a choice', () => {
  it('offers All colours and each colour, and saves the choice right away', async () => {
    const fetchMock = start(OWNER)
    const user = userEvent.setup()
    const images = within(await screen.findByRole('region', { name: 'Images' }))
    const first = images.getByLabelText('Shown for image 1')
    expect(first).toHaveValue('')
    expect(within(first).getAllByRole('option').map((option) => option.textContent)).toEqual(['All colours', 'Red', 'Blue'])
    expect(images.getByLabelText('Shown for image 2')).toHaveValue('12')
    await user.selectOptions(first, 'Red')
    await waitFor(() => expect(sentTo(fetchMock, 'PATCH', '/api/admin/products/4/images/7')).toEqual({ optionValueId: 11 }))
    expect(await images.findByText('Image 1 is shown for Red.')).toBeInTheDocument()
    await user.selectOptions(images.getByLabelText('Shown for image 2'), 'All colours')
    await waitFor(() => expect(sentTo(fetchMock, 'PATCH', '/api/admin/products/4/images/8')).toEqual({ optionValueId: null }))
  })

  it('uses the first option when there is no color option', async () => {
    start(OWNER, { ...PRODUCT, options: [SIZE], imageList: [{ ...PRODUCT.imageList[0] }], variants: [] })
    const images = within(await screen.findByRole('region', { name: 'Images' }))
    expect(within(images.getByLabelText('Shown for image 1')).getAllByRole('option').map((option) => option.textContent)).toEqual(['All choices', 'M', 'L'])
  })

  it('has no "Shown for" when the product has no options', async () => {
    start(OWNER, { ...PRODUCT, options: [], variants: [], hasVariants: false })
    const images = within(await screen.findByRole('region', { name: 'Images' }))
    expect(images.getByLabelText('Alt text for image 1')).toBeInTheDocument()
    expect(images.queryByLabelText('Shown for image 1')).not.toBeInTheDocument()
  })
})

describe('read-only viewer', () => {
  it('sees the types, colours, and image choices but cannot change them', async () => {
    const fetchMock = start(VIEWER)
    const section = await variantsSection()
    expect(section.getByLabelText('Option 1 type')).toBeDisabled()
    expect(section.getByLabelText('Color value Red: swatch colour')).toBeDisabled()
    expect(section.getByLabelText('Color value Red: hex code')).toBeDisabled()
    expect(section.queryByRole('button', { name: 'Save options' })).not.toBeInTheDocument()
    const images = within(screen.getByRole('region', { name: 'Images' }))
    expect(images.queryByLabelText('Shown for image 1')).not.toBeInTheDocument()
    expect(images.getByText('Shown for: All colours')).toBeInTheDocument()
    expect(images.getByText('Shown for: Blue')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method && init.method !== 'GET')).toBe(false)
  })
})
