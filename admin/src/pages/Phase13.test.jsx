import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'
import { banglaProgress, banglaValues, languageName, toBangla } from '../utils/bangla'
import { toSpecifications } from '../utils/productLinks'

/*
 * Phase 13 (docs/backend/PHASE13_CONTRACT.md §4): the admin stays English;
 * staff type the Bangla texts of products (with option and value names and
 * specification rows), categories, CMS pages and home blocks, see which
 * fields fall back to English, edit each email template in English and
 * Bangla, set the store's default language and Bangla digits, see and change
 * a customer's language, see an order's language, and find products whose
 * Bangla texts are missing. Every Bangla input has lang="bn".
 */
vi.mock('../api/mode', () => ({ LIVE_DATA: true }))

const sentTo = (fetchMock, method, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => (init?.method ?? 'GET') === method && new URL(url).pathname === path)
  return call && JSON.parse(call[1].body)
}
const callsTo = (fetchMock, method, path) => fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && new URL(url).pathname === path).map(([url]) => new URL(url))

describe('helpers', () => {
  it('names languages, trims texts, and counts what is translated', () => {
    expect(languageName('bn')).toBe('Bangla (বাংলা)')
    expect(languageName('en')).toBe('English')
    expect(languageName(null, 'Store default')).toBe('Store default')
    expect(banglaValues({ name: 'টি-শার্ট' }, ['name', 'description'])).toEqual({ name: 'টি-শার্ট', description: '' })
    expect(toBangla({ title: ' শিরোনাম ', body: '<p>লেখা</p>\n' }, ['title', 'body'], { raw: ['body'] })).toEqual({ title: 'শিরোনাম', body: '<p>লেখা</p>\n' })
    expect(banglaProgress({ name: 'টি', description: '' }, { name: 'Tee', description: 'Soft', metaTitle: '' }, ['name', 'description', 'metaTitle'])).toEqual({ done: 1, total: 2 })
    expect(toSpecifications([{ label: 'Fit', value: 'Slim', labelBn: ' ফিট ', valueBn: '' }], { bangla: true })).toEqual([{ label: 'Fit', value: 'Slim', labelBn: 'ফিট', valueBn: '' }])
  })
})

const PRODUCT = {
  id: 3, title: 'Tee', brand: '', category: 'tops', description: 'A soft cotton tee.', price: 20, discountPercentage: 0, stock: 5, status: 'active', metaTitle: '', metaDescription: '', type: 'simple', weight: null,
  imageList: [], variants: [], live: true, links: { related: [], upsell: [], crosssell: [] },
  specifications: [{ label: 'Material', value: 'Cotton', labelBn: 'উপাদান', valueBn: '' }],
  options: [{ id: 8, name: 'Size', nameBn: '', position: 0, values: [{ id: 81, value: 'Small', valueBn: 'ছোট', position: 0 }, { id: 82, value: 'Large', valueBn: '', position: 1 }] }],
  bn: { name: '', shortDescription: '', description: 'নরম সুতির টি-শার্ট।', metaTitle: '', metaDescription: '' },
}

describe('product form: Bangla', () => {
  function startProduct(product = PRODUCT) {
    withSession()
    return mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/categories': { body: [{ id: 1, name: 'Tops', slug: 'tops', parentId: null }] },
      'GET /api/admin/products/3': { body: product },
      'PUT /api/admin/products/3': (url, init) => ({ body: { product: { ...product, ...JSON.parse(init.body) }, live: true } }),
      'PUT /api/admin/products/3/options': (url, init) => {
        const [option] = JSON.parse(init.body).options
        return { body: { options: [{ id: 8, name: option.name, nameBn: option.nameBn, position: 0, values: product.options[0].values.map((entry, index) => ({ ...entry, valueBn: option.valuesBn[index] })) }], variants: [], imageList: [], hasVariants: false, live: true } }
      },
    })
  }

  it('shows the Bangla texts with lang="bn" and which fields fall back to English', async () => {
    startProduct()
    renderApp('/products/3')
    const section = within((await screen.findByRole('group', { name: /^Bangla/ })))
    const name = section.getByLabelText('Name in Bangla')
    expect(name).toHaveAttribute('lang', 'bn')
    expect(name).toHaveValue('')
    expect(name).toHaveAccessibleDescription(/Falls back to English.*Shoppers using Bangla see: “Tee”/)
    const description = section.getByLabelText('Description in Bangla')
    expect(description).toHaveValue('নরম সুতির টি-শার্ট।')
    expect(description).not.toHaveAccessibleDescription(/Falls back/)
    expect(section.getByText(/1 of 2 main texts translated/)).toBeInTheDocument()
    // Saved options and values, and the specification rows.
    expect(section.getByLabelText('“Size” in Bangla')).toHaveAccessibleDescription(/Falls back to English.*“Size”/)
    expect(section.getByLabelText('Size “Small” in Bangla')).toHaveValue('ছোট')
    expect(section.getByLabelText('Label 1 in Bangla')).toHaveValue('উপাদান')
    expect(section.getByLabelText('Value 1 in Bangla')).toHaveAccessibleDescription(/“Cotton”/)
    for (const input of section.getAllByRole('textbox')) expect(input).toHaveAttribute('lang', 'bn')
  })

  it('saves only what changed: the Bangla texts, option names, and specification rows', async () => {
    const fetchMock = startProduct()
    const user = userEvent.setup()
    renderApp('/products/3')
    const section = within(await screen.findByRole('group', { name: /^Bangla/ }))
    const save = screen.getByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()
    await user.type(section.getByLabelText('Name in Bangla'), 'টি-শার্ট')
    await user.type(section.getByLabelText('“Size” in Bangla'), 'সাইজ')
    await user.type(section.getByLabelText('Value 1 in Bangla'), 'সুতি')
    expect(save).toBeEnabled()
    await user.click(save)
    expect(await screen.findByText(/Changes saved/)).toBeInTheDocument()
    const body = sentTo(fetchMock, 'PUT', '/api/admin/products/3')
    expect(body.bn).toEqual({ name: 'টি-শার্ট', shortDescription: '', description: 'নরম সুতির টি-শার্ট।', metaTitle: '', metaDescription: '' })
    expect(body.optionTranslations).toBeUndefined()
    // The options' Bangla names go with the options (their own route), the values' in their order.
    expect(sentTo(fetchMock, 'PUT', '/api/admin/products/3/options')).toEqual({ options: [{ name: 'Size', values: ['Small', 'Large'], nameBn: 'সাইজ', valuesBn: ['ছোট', ''] }] })
    expect(body.specifications).toEqual([{ label: 'Material', value: 'Cotton', labelBn: 'উপাদান', valueBn: 'সুতি' }])
    expect(section.getByText(/2 of 2 main texts translated/)).toBeInTheDocument()
  })

  it("shows the server's Bangla errors on their fields, and no section for an older API", async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/categories': { body: [{ id: 1, name: 'Tops', slug: 'tops', parentId: null }] },
      'GET /api/admin/products/3': { body: PRODUCT },
      'PUT /api/admin/products/3': { status: 422, body: { message: 'Invalid.', errors: { 'bn.name': ['Keep this under 120 characters.'] } } },
    })
    const user = userEvent.setup()
    const view = renderApp('/products/3')
    const name = await screen.findByLabelText('Name in Bangla')
    await user.type(name, 'নাম')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(name).toHaveAccessibleDescription(/Keep this under 120 characters/))
    view.unmount()

    const older = { ...PRODUCT, bn: undefined }
    startProduct(older)
    renderApp('/products/3')
    expect(await screen.findByLabelText('Name')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /^Bangla/ })).not.toBeInTheDocument()
  })
})

describe('categories, pages and the home page in Bangla', () => {
  it('adds a category with its Bangla name', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/categories': { body: [{ id: 1, name: 'Beauty', slug: 'beauty', parentId: null, position: 0, isActive: true, productCount: 0, childCount: 0, depth: 0, description: '', metaTitle: '', metaDescription: '', imageUrl: null, bn: { name: 'সৌন্দর্য', description: '', metaTitle: '', metaDescription: '' } }] },
      'POST /api/admin/categories': { status: 201, body: { category: { id: 2 }, live: true } },
      'PATCH /api/admin/categories/1': { body: { category: { id: 1 }, live: true } },
    })
    const user = userEvent.setup()
    renderApp('/categories')
    await user.click(await screen.findByRole('button', { name: 'Edit Beauty' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit Beauty' }))
    expect(dialog.getByLabelText('Name in Bangla')).toHaveValue('সৌন্দর্য')
    expect(dialog.getByLabelText('Description in Bangla')).toHaveAttribute('lang', 'bn')
    await user.type(dialog.getByLabelText('Description in Bangla'), 'প্রসাধনী')
    await user.click(dialog.getByRole('button', { name: 'Save category' }))
    await waitFor(() => expect(sentTo(fetchMock, 'PATCH', '/api/admin/categories/1')?.bn).toEqual({ name: 'সৌন্দর্য', description: 'প্রসাধনী', metaTitle: '', metaDescription: '' }))
  })

  it("edits a page's Bangla title and content (HTML kept as typed)", async () => {
    withSession()
    const page = { id: 3, slug: 'about', title: 'About', body: '<p>Hello</p>', metaTitle: '', metaDescription: '', isPublished: true, bn: { title: '', body: '', metaTitle: '', metaDescription: '' } }
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/pages/3': { body: page },
      'PATCH /api/admin/pages/3': (url, init) => ({ body: { page: { ...page, bn: { ...page.bn, ...JSON.parse(init.body).bn } } } }),
    })
    const user = userEvent.setup()
    renderApp('/pages/3')
    const title = await screen.findByLabelText('Title in Bangla')
    expect(title).toHaveAccessibleDescription(/Falls back to English.*“About”/)
    await user.type(title, 'আমাদের কথা')
    fireEvent.change(screen.getByLabelText('Content in Bangla (HTML)'), { target: { value: '<p>স্বাগতম</p>' } })
    await user.click(screen.getByRole('button', { name: 'Save page' }))
    expect(await screen.findByText(/Saved and published/)).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/pages/3').bn).toEqual({ title: 'আমাদের কথা', body: '<p>স্বাগতম</p>', metaTitle: '', metaDescription: '' })
  })

  it("saves the hero's and a banner's Bangla texts with the home page", async () => {
    withSession()
    const home = {
      hero: { eyebrow: '', title: 'Hello', description: '', primaryCta: { label: 'Shop', url: '/products' }, secondaryCta: null, imageUrl: '', imageAlt: '', highlights: ['Free shipping'], bn: { title: 'হ্যালো', highlights: [] } },
      banners: [{ id: 1, eyebrow: '', title: 'Laptops', description: '', cta: { label: 'Go', url: '/laptops' }, imageUrl: '', imageAlt: '', tone: 'navy', position: 1, isActive: true, bn: {} }],
      featuredProductIds: [],
      featuredProducts: [],
    }
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/home': { body: home },
      'PUT /api/admin/home': (url, init) => ({ body: { home: { ...home, ...JSON.parse(init.body) } } }),
    })
    const user = userEvent.setup()
    renderApp('/home-page')
    expect(await screen.findByLabelText('Headline in Bangla')).toHaveValue('হ্যালো')
    await user.type(screen.getByLabelText('Highlight 1 in Bangla'), 'ফ্রি ডেলিভারি')
    await user.type(screen.getByLabelText('Laptops: button text in Bangla'), 'দেখুন')
    expect(screen.getByLabelText('Laptops: title in Bangla')).toHaveAccessibleDescription(/Falls back to English.*“Laptops”/)
    await user.click(screen.getByRole('button', { name: 'Save home page' }))
    expect(await screen.findByText(/Home page saved/)).toBeInTheDocument()
    const body = sentTo(fetchMock, 'PUT', '/api/admin/home')
    expect(body.hero.bn).toMatchObject({ title: 'হ্যালো', highlights: ['ফ্রি ডেলিভারি'] })
    expect(body.banners[0].bn).toMatchObject({ ctaLabel: 'দেখুন', title: '' })
  })
})

const TEMPLATE = {
  key: 'order_confirmation', name: 'Order confirmation', description: '', subject: 'Your order {{ order_number }}', body: '<p>Thanks {{ order_number }}</p>', isCustomized: false, updatedAt: null, updatedBy: null,
  variables: [{ name: 'order_number', description: 'Order number', kind: 'text', required: true }], requiredGroups: [['order_number']], locale: 'en', live: true,
}
const BANGLA_TEMPLATE = { ...TEMPLATE, subject: 'আপনার অর্ডার {{ order_number }}', body: '<p>ধন্যবাদ {{ order_number }}</p>', isCustomized: true, updatedAt: '2026-11-20T10:00:00Z', locale: 'bn' }

describe('email templates in English and Bangla', () => {
  it("lists each template's Bangla version", async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/email-templates': { body: { templates: [{ ...TEMPLATE, locales: { en: { subject: TEMPLATE.subject, isCustomized: false }, bn: { subject: BANGLA_TEMPLATE.subject, isCustomized: true } } }] } },
    })
    renderApp('/email-templates')
    const row = (await screen.findByRole('rowheader', { name: /Order confirmation/ })).closest('tr')
    expect(within(row).getByRole('link', { name: 'Bangla version of Order confirmation: customized' })).toHaveAttribute('href', '/email-templates/order_confirmation?lang=bn')
    expect(screen.getByRole('columnheader', { name: 'Bangla' })).toBeInTheDocument()
  })

  it('switches to Bangla, edits and previews it, and resets only the Bangla version', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/email-templates/order_confirmation': (url) => ({ body: url.searchParams.get('locale') === 'bn' ? BANGLA_TEMPLATE : TEMPLATE }),
      'POST /api/admin/email-templates/order_confirmation/preview': (url, init) => ({ body: { subject: JSON.parse(init.body).subject, html: '<p>preview</p>', text: 'preview', locale: url.searchParams.get('locale') } }),
      'PUT /api/admin/email-templates/order_confirmation': (url, init) => ({ body: { template: { ...BANGLA_TEMPLATE, ...JSON.parse(init.body), updatedAt: '2026-11-21T10:00:00Z' }, live: true } }),
      'POST /api/admin/email-templates/order_confirmation/reset': { body: { template: { ...BANGLA_TEMPLATE, isCustomized: false }, live: true } },
    })
    const user = userEvent.setup()
    renderApp('/email-templates/order_confirmation')
    const english = await screen.findByRole('tab', { name: 'English' })
    expect(english).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Subject')).toHaveValue(TEMPLATE.subject)
    expect(screen.getByLabelText('Subject')).not.toHaveAttribute('lang')

    await user.click(screen.getByRole('tab', { name: 'Bangla (বাংলা)' }))
    const subject = await screen.findByDisplayValue(BANGLA_TEMPLATE.subject)
    expect(subject).toHaveAttribute('lang', 'bn')
    expect(screen.getByLabelText('Body (HTML)')).toHaveAttribute('lang', 'bn')
    expect(callsTo(fetchMock, 'GET', '/api/admin/email-templates/order_confirmation').at(-1).searchParams.get('locale')).toBe('bn')

    fireEvent.change(subject, { target: { value: 'অর্ডার {{ order_number }} পেয়েছি' } })
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/admin/email-templates/order_confirmation/preview').at(-1).searchParams.get('locale')).toBe('bn'), { timeout: 2000 })
    expect(await screen.findByTitle('Preview of Order confirmation in Bangla')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save template' }))
    expect(await screen.findByText('Bangla template saved. New emails in Bangla use it now.')).toBeInTheDocument()
    expect(callsTo(fetchMock, 'PUT', '/api/admin/email-templates/order_confirmation').at(-1).searchParams.get('locale')).toBe('bn')

    await user.click(screen.getByRole('button', { name: 'Reset Bangla to default' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Reset the Bangla "Order confirmation"?' }))
    expect(dialog.getByText(/the English version is kept/)).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Reset to default' }))
    expect(await screen.findByText('The Bangla version is back to the default template.')).toBeInTheDocument()
    expect(callsTo(fetchMock, 'POST', '/api/admin/email-templates/order_confirmation/reset').at(-1).searchParams.get('locale')).toBe('bn')
  })
})

describe('Settings → General: language', () => {
  it('saves the default language and Bangla digits', async () => {
    withSession()
    const settings = { general: { storeName: 'BuyNest', defaultLocale: 'en', banglaDigits: true }, shipping: { enabledMethods: ['standard'] }, tax: {}, inventory: { lowStockThreshold: 10 }, checkout: { allowedCountries: ['Bangladesh'], guestCheckout: true, enabledPaymentMethods: ['cod'] }, live: true }
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/settings': { body: settings },
      'PATCH /api/admin/settings': (url, init) => ({ body: { ...settings, general: { ...settings.general, ...JSON.parse(init.body).general } } }),
      'GET /api/admin/currencies': { body: { base: 'BDT', currencies: [] } },
    })
    const user = userEvent.setup()
    renderApp('/settings')
    const form = within((await screen.findByRole('heading', { name: 'General' })).closest('form'))
    const language = form.getByLabelText('Default store language')
    expect(language).toHaveValue('en')
    const digits = form.getByRole('checkbox', { name: 'Use Bangla digits' })
    expect(digits).toBeChecked()
    expect(digits).toHaveAccessibleDescription(/Bangla digits/)
    await user.selectOptions(language, 'bn')
    await user.click(digits)
    await user.click(form.getByRole('button', { name: 'Save general' }))
    expect(await form.findByText('General saved.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/settings').general).toMatchObject({ storeName: 'BuyNest', defaultLocale: 'bn', banglaDigits: false })
  })
})

const NADIA = {
  id: 5, firstName: 'Nadia', lastName: 'Rahman', email: 'nadia@example.com', phone: null, emailVerified: true, isActive: true, group: null, groupId: null, locale: 'bn',
  ordersCount: 0, createdAt: '2026-11-10T08:00:00Z', lastLoginAt: null, addresses: [], lifetimeSpent: 0, reviewsCount: 0, recentOrders: [], notes: [], live: true,
}

describe('customers and orders', () => {
  it("shows the customer's language and changes it", async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/customers/5': { body: NADIA },
      'GET /api/admin/customer-groups': { body: { groups: [] } },
      'PATCH /api/admin/customers/5': (url, init) => ({ body: { ...NADIA, ...JSON.parse(init.body) } }),
    })
    const user = userEvent.setup()
    renderApp('/customers/5')
    expect((await screen.findByText('Language', { selector: 'dt' })).nextElementSibling).toHaveTextContent('Bangla (বাংলা)')
    const select = screen.getByRole('combobox', { name: 'Language' })
    expect(select).toHaveValue('bn')
    await user.selectOptions(select, '')
    await user.click(screen.getByRole('button', { name: 'Save account' }))
    await waitFor(() => expect(sentTo(fetchMock, 'PATCH', '/api/admin/customers/5')).toEqual({ locale: null }))
  })

  it('shows the language an order was placed in', async () => {
    withSession()
    const address = { firstName: 'Nadia', lastName: 'Rahman', line1: 'House 12', line2: '', city: 'Dhaka', state: '', postalCode: '1209', country: 'Bangladesh' }
    const order = {
      id: 'BN-100001', number: 'BN-100001', status: 'processing', paymentStatus: 'paid', paymentMethod: 'cod', locale: 'bn',
      shippingMethod: { id: 'standard', label: 'Standard', eta: '3–5 business days' }, email: 'nadia@example.com', phone: null, shippingAddress: address, billingAddress: address, couponCode: null,
      customer: { id: null, guest: true, firstName: 'Nadia', lastName: 'Rahman', email: 'nadia@example.com' },
      lines: [], totals: { itemCount: 0, subtotal: 0, discount: 0, shipping: 0, tax: 0, total: 0, paid: 0, refunded: 0 }, items: 0, placedAt: '2026-11-19T10:00:00Z',
      invoices: [], creditMemos: [], history: [], payment: { provider: null, canPay: false }, giftCardPayment: null, giftCardsIssued: [], live: true,
    }
    mockFetch({ 'GET /api/admin/me': { body: ADMIN }, 'GET /api/admin/orders/BN-100001': { body: order } })
    renderApp('/orders/BN-100001')
    const panel = within((await screen.findByRole('heading', { name: 'Customer' })).closest('section'))
    expect(panel.getByText('Language').nextElementSibling).toHaveTextContent('Bangla (বাংলা) · placed in this language')
  })
})

describe('products grid and import', () => {
  it('filters products by their Bangla texts and shows the optional Bangla column', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/categories': { body: [] },
      'GET /api/admin/preferences/products_grid': { body: { key: 'products_grid', columns: ['product', 'bangla'], pageSize: null, filters: [], live: true } },
      'GET /api/admin/products': {
        body: { products: [{ id: 3, title: 'Tee', category: 'tops', price: 20, stock: 5, status: 'active', thumbnail: null, banglaStatus: 'missing' }], total: 1, live: true },
      },
    })
    const user = userEvent.setup()
    renderApp('/products')
    const row = (await screen.findByRole('link', { name: 'Edit Tee' })).closest('tr')
    expect(await screen.findByRole('columnheader', { name: 'Bangla' })).toBeInTheDocument()
    expect(within(row).getByText('Missing')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Bangla' }), 'missing')
    await waitFor(() => expect(callsTo(fetchMock, 'GET', '/api/admin/products').at(-1).searchParams.get('bangla')).toBe('missing'))
  })

  it('lists the Bangla CSV columns', async () => {
    withSession()
    mockFetch({ 'GET /api/admin/me': { body: ADMIN }, 'GET /api/admin/categories': { body: [] } })
    renderApp('/import-export')
    for (const column of ['name_bn', 'short_description_bn', 'description_bn', 'meta_title_bn', 'meta_description_bn']) {
      expect((await screen.findAllByText(column)).length).toBeGreaterThan(0)
    }
  })
})
