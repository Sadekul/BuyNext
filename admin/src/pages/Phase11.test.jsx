import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'
import { pointsAdjustmentErrors, refundSplit, rewardSettingsValues } from '../utils/rewards'
import { currencyErrors, isStale, rateAgeDays, toCurrencyValues } from '../utils/currencies'
import { specificationErrors, toLinkIds, toSpecifications } from '../utils/productLinks'
import { permissionLabel } from '../utils/permissions'

/*
 * Phase 11 (docs/backend/PHASE11_CONTRACT.md): a customer's wishlist and
 * reward points, product specifications and links, points on orders and
 * refunds, the wishlist and reward points reports, Settings → Reward points
 * and Currencies, the customer grid's Points column. BuyNest's backend.
 */
vi.mock('../api/mode', () => ({ LIVE_DATA: true }))

const sentTo = (fetchMock, method, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => (init?.method ?? 'GET') === method && new URL(url).pathname === path)
  return call && JSON.parse(call[1].body)
}
const withRole = (permissions) => ({ ...ADMIN, role: { id: 9, name: 'Custom' }, permissions })
const NOW = Date.parse('2026-11-18T12:00:00Z')

describe('helpers', () => {
  it('checks a points adjustment and the reward settings', () => {
    expect(pointsAdjustmentErrors({ points: '-400', note: 'Fix' }, 300)).toEqual({ points: ['The balance is 300 points: you can take away at most that.'] })
    expect(Object.keys(pointsAdjustmentErrors({ points: '1.5', note: ' ' }, 300)).sort()).toEqual(['note', 'points'])
    expect(pointsAdjustmentErrors({ points: '+250', note: 'Late parcel' }, 0)).toEqual({})
    const form = { enabled: true, earnRate: '1.5', pointValue: '0.01', minRedeem: '100', maxPercent: '50', signupBonus: '0', reviewBonus: '25' }
    expect(rewardSettingsValues(form)).toEqual({ values: { enabled: true, earnRate: 1.5, pointValue: 0.01, minRedeem: 100, maxPercent: 50, signupBonus: 0, reviewBonus: 25 } })
    expect(Object.keys(rewardSettingsValues({ ...form, pointValue: '0', maxPercent: '101', minRedeem: '' }).errors).sort()).toEqual(['maxPercent', 'minRedeem', 'pointValue'])
    expect(permissionLabel('rewards.manage')).toBe("Adjust customers' reward point balances")
  })

  it('splits a refund: points first, then the gift card, then the payment method', () => {
    const order = { rewardPoints: { spent: 500, amount: 5, earned: 45 }, giftCardPayment: { last4: 'ZZ99', amount: 20 } }
    const limits = { rewardPointsRefundable: 5, giftCardRefundable: 20 }
    expect(refundSplit(order, 3000, limits)).toEqual({ usedPoints: true, toPointsCents: 500, points: 500, usedGiftCard: true, last4: 'ZZ99', toCardCents: 2000, otherCents: 500 })
    expect(refundSplit(order, 300, limits)).toMatchObject({ toPointsCents: 300, points: 300, toCardCents: 0, otherCents: 0 })
    expect(refundSplit({ ...order, giftCardPayment: null }, 1000, { rewardPointsRefundable: 2 })).toEqual({ usedPoints: true, toPointsCents: 200, points: 200, usedGiftCard: false, last4: null, toCardCents: 0, otherCents: 800 })
    expect(refundSplit({ rewardPoints: { spent: 0, amount: 0, earned: 10 }, giftCardPayment: null }, 1000, {})).toBeNull()
  })

  it('checks currencies and spots old rates', () => {
    expect(rateAgeDays('2026-10-01T12:00:00Z', NOW)).toBe(48)
    expect(isStale({ rate: 110, updatedAt: '2026-10-01T12:00:00Z' }, NOW)).toBe(true)
    expect(isStale({ rate: 0, updatedAt: '2026-10-01T12:00:00Z' }, NOW)).toBe(false)
    expect(isStale({ rate: 110, stale: false, updatedAt: '2026-10-01T12:00:00Z' }, NOW)).toBe(false)
    const values = { code: 'bdt', symbol: '৳', rate: '0', decimals: '2', enabled: true }
    expect(currencyErrors(values, { isNew: true, codes: ['BDT'] })).toEqual({ code: ['BDT is already in the list.'], rate: ['Enter a rate before turning this currency on.'] })
    expect(Object.keys(currencyErrors({ ...values, code: 'usd', symbol: '', rate: '1.123456789', decimals: '4' }, { isNew: true })).sort()).toEqual(['code', 'decimals', 'rate', 'symbol'])
    expect(toCurrencyValues({ ...values, rate: '110.5' })).toEqual({ code: 'BDT', symbol: '৳', rate: 110.5, decimals: 2, enabled: true })
    expect(toCurrencyValues({ ...values, rate: '111' }, { symbol: '৳', rate: 110, decimals: 2, enabled: true })).toEqual({ rate: 111 })
  })

  it('checks specification rows and builds the links to send', () => {
    const rows = [{ label: 'Size', value: 'M' }, { label: ' ', value: '' }, { label: 'size', value: 'L' }, { label: '', value: 'Blue' }]
    expect(specificationErrors(rows)).toEqual({ rows: { 2: { label: '"size" is already row 1: each label once.' }, 3: { label: 'Give this row a label.' } }, list: 'Check the highlighted rows.' })
    expect(toSpecifications([{ label: ' Fit ', value: ' Slim ' }, { label: '', value: '' }])).toEqual([{ label: 'Fit', value: 'Slim' }])
    expect(toLinkIds({ related: [{ id: 4 }], upsell: [] })).toEqual({ related: [4], upsell: [], crosssell: [] })
  })
})

const NADIA = {
  id: 5, firstName: 'Nadia', lastName: 'Rahman', email: 'nadia@example.com', phone: null, emailVerified: true, isActive: true, group: null, groupId: null,
  ordersCount: 2, createdAt: '2026-11-10T08:00:00Z', lastLoginAt: null, addresses: [], lifetimeSpent: 50, reviewsCount: 0, recentOrders: [], notes: [], rewardPoints: 300, live: true,
}
const REWARDS = {
  enabled: true, balance: 300, value: 3, pointValue: 0.01, total: 2, live: true,
  transactions: [
    { id: 8, points: -200, balanceAfter: 300, type: 'spend', orderNumber: 'BN-100004', creditMemoNumber: null, adminName: null, note: null, createdAt: '2026-11-17T12:00:00Z' },
    { id: 7, points: 500, balanceAfter: 500, type: 'adjust', orderNumber: null, creditMemoNumber: null, adminName: 'Store Owner', note: 'Welcome gift', createdAt: '2026-11-16T12:00:00Z' },
  ],
}

describe('the customer page', () => {
  it('shows the wishlist, with hidden and deleted products marked', async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/customers/5': { body: NADIA },
      'GET /api/admin/customer-groups': { body: { groups: [] } },
      'GET /api/admin/customers/5/wishlist': {
        body: {
          items: [
            { id: 3, product: { id: 9, name: 'Mascara', sku: 'BEA-1', image: null, status: 'active', deleted: false }, variant: { id: 2, label: 'Black' }, note: 'For Eid', addedAt: '2026-11-18T10:00:00Z' },
            { id: 4, product: { id: 10, name: 'Old lamp', sku: null, image: null, status: 'archived', deleted: true }, variant: null, note: null, addedAt: '2026-11-17T10:00:00Z' },
          ],
          shared: true,
          sharedAt: '2026-11-18T11:00:00Z',
        },
      },
    })
    const user = userEvent.setup()
    renderApp('/customers/5')
    await user.click(await screen.findByRole('tab', { name: 'Wishlist' }))
    const region = await screen.findByRole('region', { name: "Nadia Rahman's wishlist" })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(within(region).getByRole('rowheader', { name: /Mascara/ }).closest('tr')).toHaveTextContent('BlackFor EidNov 18, 2026')
    expect(within(region).getByRole('link', { name: 'Mascara' })).toHaveAttribute('href', '/products/9')
    expect(within(region).getByRole('rowheader', { name: /Old lamp/ })).toHaveTextContent('Deleted product')
    expect(within(region).queryByRole('link', { name: 'Old lamp' })).not.toBeInTheDocument()
    expect(screen.getByText(/2 products saved/)).toHaveTextContent('Shared by link since Nov 18, 2026.')
  })

  it('shows the points balance and history, and adjusts it with a reason (rewards.manage)', async () => {
    withSession()
    let rewards = REWARDS
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/customers/5': { body: NADIA },
      'GET /api/admin/customer-groups': { body: { groups: [] } },
      'GET /api/admin/customers/5/rewards': () => ({ body: rewards }),
      'POST /api/admin/customers/5/rewards/adjust': () => {
        rewards = { ...REWARDS, balance: 50, value: 0.5 }
        return { body: { balance: 50, value: 0.5, transaction: null } }
      },
    })
    const user = userEvent.setup()
    renderApp('/customers/5')
    await user.click(await screen.findByRole('tab', { name: 'Reward points' }))
    expect(await screen.findByText('300 points', { selector: '.stat__value' })).toBeInTheDocument()
    expect(screen.getByText('Worth $3.00 at checkout')).toBeInTheDocument()
    const history = screen.getByRole('region', { name: 'Reward points history' })
    const rows = within(history).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('−200300 pointsSpent on an order · Order BN-100004')
    expect(rows[2]).toHaveTextContent('+500500 pointsAdjusted by staff“Welcome gift” · by Store Owner')

    const opener = screen.getByRole('button', { name: 'Adjust balance' })
    await user.click(opener)
    const dialog = await screen.findByRole('dialog', { name: "Adjust Nadia Rahman's reward points" })
    await user.type(within(dialog).getByLabelText('Points'), '-400')
    await user.click(within(dialog).getByRole('button', { name: 'Save adjustment' }))
    expect(within(dialog).getByLabelText('Points')).toHaveAccessibleDescription(/you can take away at most that/)
    expect(within(dialog).getByLabelText('Reason')).toHaveAccessibleDescription(/Say why the balance changes/)
    await user.clear(within(dialog).getByLabelText('Points'))
    await user.type(within(dialog).getByLabelText('Points'), '-250')
    expect(within(dialog).getByText('New balance: 50 points')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Reason'), 'Returned items')
    await user.click(within(dialog).getByRole('button', { name: 'Save adjustment' }))
    expect(await screen.findByText('Took away 250 points. Nadia Rahman now has 50 points.')).toHaveFocus()
    expect(sentTo(fetchMock, 'POST', '/api/admin/customers/5/rewards/adjust')).toEqual({ points: -250, note: 'Returned items' })
    expect(await screen.findByText('50 points', { selector: '.stat__value' })).toBeInTheDocument()
  })

  it('without rewards.manage there is no Adjust balance; a cancelled dialog gives focus back', async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: withRole(['customers.view']) },
      'GET /api/admin/customers/5': { body: NADIA },
      'GET /api/admin/customer-groups': { body: { groups: [] } },
      'GET /api/admin/customers/5/rewards': { body: { ...REWARDS, enabled: false } },
    })
    const user = userEvent.setup()
    renderApp('/customers/5')
    await user.click(await screen.findByRole('tab', { name: 'Reward points' }))
    expect(await screen.findByText(/Reward points are off/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Adjust balance' })).not.toBeInTheDocument()
  })
})

describe('the customer grid', () => {
  it('has an optional Points column, off until chosen', async () => {
    withSession()
    let saved = { key: 'customers_grid', columns: null, pageSize: null, filters: [], live: true }
    mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/customers': { body: { customers: [NADIA], total: 1, manageable: true } },
      'GET /api/admin/customer-groups': { body: { groups: [] } },
      'GET /api/admin/preferences/customers_grid': () => ({ body: saved }),
      'PUT /api/admin/preferences/customers_grid': (url, init) => {
        saved = { key: 'customers_grid', ...JSON.parse(init.body), live: true }
        return { body: saved }
      },
    })
    const user = userEvent.setup()
    renderApp('/customers')
    expect(await screen.findByRole('columnheader', { name: 'Last sign-in' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Points' })).not.toBeInTheDocument()
    await user.click(screen.getByText('Columns'))
    await user.click(within(screen.getByRole('group', { name: 'Columns to show' })).getByRole('checkbox', { name: 'Points' }))
    expect(await screen.findByRole('columnheader', { name: 'Points' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Nadia Rahman' }).closest('tr').lastElementChild.previousElementSibling).toHaveTextContent('300')
  })
})

const LINKED = { id: 4, name: 'Socks', sku: 'SOX', image: null, status: 'active' }
const PRODUCT = {
  id: 3, title: 'Tee', brand: '', category: 'tops', description: '', price: 20, discountPercentage: 0, stock: 5, status: 'active', metaTitle: '', metaDescription: '', type: 'simple', weight: null,
  imageList: [], options: [], variants: [], live: true,
  specifications: [{ label: 'Material', value: 'Cotton' }, { label: 'Fit', value: 'Regular' }],
  links: { related: [LINKED, { id: 6, name: 'Belt', sku: 'BLT', image: null, status: 'draft' }], upsell: [], crosssell: [] },
}

describe('product form: specifications and links', () => {
  function startProduct(routes = {}) {
    withSession()
    return mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/categories': { body: [{ id: 1, name: 'Tops', slug: 'tops', parentId: null }] },
      'GET /api/admin/products/3': { body: PRODUCT },
      'PUT /api/admin/products/3': (url, init) => ({ body: { product: { ...PRODUCT, ...JSON.parse(init.body) }, live: true } }),
      'GET /api/admin/products': (url) => ({
        body: { products: url.searchParams.get('q') === 'cap' ? [{ id: 7, title: 'Cap', sku: 'CAP', price: 12, thumbnail: null, status: 'active' }, { id: 3, title: 'Tee', sku: 'TEE', price: 20 }] : [], total: 2 },
      }),
      ...routes,
    })
  }

  it('edits, moves, and removes specification rows with the keyboard, and sends them only when changed', async () => {
    const fetchMock = startProduct()
    const user = userEvent.setup()
    renderApp('/products/3')
    const section = (await screen.findByRole('group', { name: 'Specifications' }))
    expect(within(section).getByLabelText('Label 1')).toHaveValue('Material')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()

    // Move "Fit" up: focus stays on its (now "up"-less) row, on the down button.
    const up = within(section).getByRole('button', { name: 'Move “Fit” up' })
    up.focus()
    await user.keyboard('{Enter}')
    expect(within(section).getByLabelText('Label 1')).toHaveValue('Fit')
    expect(screen.getByText('“Fit” moved to position 1 of 2.')).toBeInTheDocument()
    await waitFor(() => expect(within(section).getByRole('button', { name: 'Move “Fit” down' })).toHaveFocus())

    await user.click(within(section).getByRole('button', { name: 'Add a row' }))
    await waitFor(() => expect(within(section).getByLabelText('Label 3')).toHaveFocus())
    await user.keyboard('fit')
    await user.type(within(section).getByLabelText('Value 3'), 'Slim')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(within(section).getByLabelText('Label 3')).toHaveAccessibleDescription('"fit" is already row 1: each label once.')
    expect(within(section).getByRole('alert')).toHaveTextContent('Check the highlighted rows.')

    await user.click(within(section).getByRole('button', { name: 'Remove “fit”' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(sentTo(fetchMock, 'PUT', '/api/admin/products/3')).toBeDefined())
    const body = sentTo(fetchMock, 'PUT', '/api/admin/products/3')
    expect(body.specifications).toEqual([{ label: 'Fit', value: 'Regular' }, { label: 'Material', value: 'Cotton' }])
    expect(body).not.toHaveProperty('links')
  })

  it('adds a linked product by search (never itself), reorders and removes, and sends the ids per type', async () => {
    const fetchMock = startProduct()
    const user = userEvent.setup()
    renderApp('/products/3')
    const related = await screen.findByRole('group', { name: 'Related products' })
    expect(within(related).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Socks SKU SOX', 'Belt SKU BLT · draft (not shown in the store)'])

    const cross = screen.getByRole('group', { name: 'Cross-sells' })
    await user.type(within(cross).getByLabelText('Search products to add to cross-sells'), 'cap{Enter}')
    const results = await within(cross).findByRole('list', { name: 'Search results for cross-sells' })
    expect(within(results).getByRole('button', { name: 'Tee is this product' })).toBeDisabled()
    await user.click(within(results).getByRole('button', { name: 'Add Cap to cross-sells' }))
    expect(screen.getByText('Cap added to cross-sells (1 of 20).')).toBeInTheDocument()
    expect(within(results).getByRole('button', { name: 'Cap is already in cross-sells' })).toBeDisabled()

    const down = within(related).getByRole('button', { name: 'Move Socks down in related products' })
    down.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(within(related).getByRole('button', { name: 'Move Socks up in related products' })).toHaveFocus())
    await user.click(within(related).getByRole('button', { name: 'Remove Belt from related products' }))
    await waitFor(() => expect(within(related).getByRole('button', { name: 'Remove Socks from related products' })).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(sentTo(fetchMock, 'PUT', '/api/admin/products/3')).toBeDefined())
    const body = sentTo(fetchMock, 'PUT', '/api/admin/products/3')
    expect(body.links).toEqual({ related: [4], upsell: [], crosssell: [7] })
    expect(body).not.toHaveProperty('specifications')
  })

  it("a full list can't take more, and the server's list errors show on their list", async () => {
    const twenty = Array.from({ length: 20 }, (_, index) => ({ id: 100 + index, name: `Item ${index + 1}`, sku: null, image: null, status: 'active' }))
    startProduct({
      'GET /api/admin/products/3': { body: { ...PRODUCT, links: { related: [], upsell: twenty, crosssell: [] } } },
      'PUT /api/admin/products/3': { status: 422, body: { message: 'Invalid.', errors: { 'links.related.0': ["A product can't be linked to itself."] } } },
    })
    const user = userEvent.setup()
    renderApp('/products/3')
    const upsell = await screen.findByRole('group', { name: 'Up-sells' })
    expect(within(upsell).getByLabelText('Search products to add to up-sells')).toBeDisabled()
    expect(within(upsell).getByText(/The list is full \(20 products\)/)).toBeInTheDocument()
    await user.click(within(upsell).getByRole('button', { name: 'Remove Item 20 from up-sells' }))
    expect(within(upsell).getByLabelText('Search products to add to up-sells')).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await within(screen.getByRole('group', { name: 'Related products' })).findByText("A product can't be linked to itself.")).toBeInTheDocument()
  })
})

const ADDRESS = { firstName: 'Ava', lastName: 'Guest', line1: '12 Market Street', line2: '', city: 'Springfield', state: 'Oregon', postalCode: '29112', country: 'United States' }
const ORDER = {
  id: 'BN-100001', number: 'BN-100001', status: 'processing', paymentStatus: 'paid', paymentMethod: 'card',
  shippingMethod: { id: 'standard', label: 'Standard', eta: '3–5 business days' }, email: 'ava@example.com', phone: null,
  shippingAddress: ADDRESS, billingAddress: ADDRESS, couponCode: null,
  customer: { id: 5, guest: false, firstName: 'Ava', lastName: 'Guest', email: 'ava@example.com' },
  lines: [{ id: 1, sku: 'BEA-1', title: 'Mascara', thumbnail: 't.webp', price: 50, quantity: 1, discountedTotal: 50 }],
  totals: { itemCount: 1, subtotal: 50, discount: 0, shipping: 0, tax: 0, total: 50, paid: 50, refunded: 0 }, items: 1, placedAt: '2026-11-16T10:00:00Z',
  invoices: [], creditMemos: [], history: [],
  payment: { provider: 'stripe', reference: 'pi_123', dashboardUrl: 'https://dashboard.stripe.com/test/payments/pi_123', mode: 'test', paidAt: '2026-11-16T10:05:00Z', url: null, expiresAt: null, canPay: false },
  giftCardPayment: { last4: 'ZZ99', amount: 20 },
  giftCardsIssued: [],
  rewardPoints: { spent: 500, amount: 5, earned: 25 },
  live: true,
}
const LIMITS = { items: [{ orderItemId: 11, name: 'Mascara', variantLabel: null, sku: 'BEA-1', ordered: 1, refunded: 0, refundable: 1, unitRefund: 50 }], shippingRefundable: 0, maxTotal: 50, giftCardRefundable: 20, rewardPointsRefundable: 5, rewardPoints: { spent: 500, earned: 25, reversed: 0 } }

describe('duplicate a product', () => {
  it('copies the product into a draft and opens the copy with what was not copied', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/categories': { body: [{ id: 1, name: 'Tops', slug: 'tops', parentId: null }] },
      'GET /api/admin/products/3': { body: PRODUCT },
      'POST /api/admin/products/3/duplicate': { status: 201, body: { product: { id: 44, name: 'Tee (copy)', sku: 'TEE-COPY', status: 'draft' }, live: true } },
      'GET /api/admin/products/44': { body: { ...PRODUCT, id: 44, title: 'Tee (copy)', status: 'draft', links: { related: [], upsell: [], crosssell: [] } } },
    })
    const user = userEvent.setup()
    renderApp('/products/3')
    await user.click(await screen.findByRole('button', { name: 'Duplicate' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Tee (copy)' })).toBeInTheDocument()
    expect(screen.getByText(/Copy of “Tee” created as a draft/)).toHaveTextContent("options, variants and uploaded photos weren't copied")
    expect(fetchMock.mock.calls.some(([url, init]) => init?.method === 'POST' && new URL(url).pathname === '/api/admin/products/3/duplicate')).toBe(true)
  })

  it('is not offered without products.edit', async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: withRole(['products.view']) },
      'GET /api/admin/categories': { body: [] },
      'GET /api/admin/products/3': { body: PRODUCT },
    })
    renderApp('/products/3')
    expect(await screen.findByRole('heading', { level: 1, name: 'Tee' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Duplicate' })).toBeNull()
  })
})

describe('the order page', () => {
  it('shows points spent and earned, and the refund split points → gift card → card', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/orders/BN-100001': { body: ORDER },
      'GET /api/admin/orders/BN-100001/refundable': { body: LIMITS },
      'POST /api/admin/orders/BN-100001/credit-memos': {
        status: 201,
        body: { creditMemo: { number: 'CM-100001', total: 30, giftCardRefund: 20, otherRefund: 5, rewardPointsRefund: 5, rewardPointsReturned: 500, rewardPointsReversed: 15, restocked: false } },
      },
    })
    const user = userEvent.setup()
    renderApp('/orders/BN-100001')
    expect((await screen.findByRole('rowheader', { name: 'Paid with reward points (500 points)' })).closest('tr')).toHaveTextContent('−$5.00')
    expect(screen.getByRole('rowheader', { name: 'Paid by gift card (ending ZZ99)' }).closest('tr')).toHaveTextContent('−$20.00')
    expect(screen.getByRole('rowheader', { name: 'Paid by Card' }).closest('tr')).toHaveTextContent('$25.00')
    expect(screen.getByRole('rowheader', { name: 'Reward points earned' }).closest('tr')).toHaveTextContent('25 points')

    await user.click(screen.getByRole('button', { name: 'Refund' }))
    const dialog = await screen.findByRole('dialog', { name: 'Refund order BN-100001' })
    expect(dialog).toHaveAccessibleDescription(/Reward points that paid for it go back first, in proportion, then the gift card, then the payment method\. Points the order earned are taken back/)
    await user.type(within(dialog).getByLabelText('Adjustment (USD)'), '30')
    const split = within(dialog).getByText('How the refund is split').closest('div')
    expect(split).toHaveTextContent('Back as reward points (about 500 points)$5.00')
    expect(split).toHaveTextContent('Back to the gift card ending ZZ99$20.00')
    expect(split).toHaveTextContent('To the card through Stripe$5.00')
    await user.click(within(dialog).getByRole('button', { name: 'Refund $30.00' }))
    expect(await screen.findByText(/500 points \(\$5\.00\) went back to the customer's balance\. 15 points earned on the order were taken back\. \$20\.00 went back to the gift card\. Stripe is returning/)).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/orders/BN-100001/credit-memos')).toMatchObject({ adjustment: 30 })
  })

  it('an order paid in full with points says what is left to pay is nothing', async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/orders/BN-100001': { body: { ...ORDER, paymentMethod: 'reward_points', giftCardPayment: null, rewardPoints: { spent: 5000, amount: 50, earned: null }, payment: { ...ORDER.payment, provider: 'reward_points', reference: null, dashboardUrl: null, mode: null } } },
    })
    renderApp('/orders/BN-100001')
    expect((await screen.findByRole('rowheader', { name: 'Left to pay' })).closest('tr')).toHaveTextContent('$0.00')
    expect(screen.queryByRole('rowheader', { name: 'Reward points earned' })).not.toBeInTheDocument()
  })
})

describe('reports', () => {
  it('shows the most wished-for products and the reward points totals for the period', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/reports/sales': { body: { totals: { orders: 0, units: 0, gross: 0, discounts: 0, shipping: 0, tax: 0, refunds: 0, net: 0, averageOrder: 0 }, series: [] } },
      'GET /api/admin/reports/products': { body: { products: [] } },
      'GET /api/admin/reports/customers': { body: { newCustomers: 0, returningCustomers: 0, guestOrders: 0, topCustomers: [] } },
      'GET /api/admin/reports/coupons': { body: { coupons: [] } },
      'GET /api/admin/reports/low-stock': { body: { products: [] } },
      'GET /api/admin/reports/stock-alerts': { body: { products: [], total: 0, waitingTotal: 0, notifiedLast30Days: 0 } },
      'GET /api/admin/reports/wishlist': { body: { products: [{ productId: 9, name: 'Mascara', sku: 'BEA-1', customers: 12, inStock: false }] } },
      'GET /api/admin/reports/rewards': {
        body: { totals: { issued: 1200, spent: 500, returned: 100, reversed: 20, adjusted: -30 }, series: [{ period: '2026-11-10', issued: 1200, spent: 500 }], outstandingPoints: 9000, outstandingValue: 90, pointValue: 0.01 },
      },
    })
    renderApp('/reports?from=2026-11-01&to=2026-11-18&groupBy=week')
    const wishlist = (await screen.findByRole('heading', { name: 'Most wished-for products' })).closest('section')
    expect((await within(wishlist).findByRole('rowheader', { name: /Mascara/ })).closest('tr')).toHaveTextContent('12Out of stock')
    const rewards = screen.getByRole('heading', { name: 'Reward points' }).closest('section')
    expect(await within(rewards).findByText('Outstanding liability')).toBeInTheDocument()
    expect(within(rewards).getByText('$90.00')).toBeInTheDocument()
    expect(within(rewards).getByText('9,000 points held by customers now at $0.01 each')).toBeInTheDocument()
    expect(within(rewards).getByRole('rowheader', { name: 'Week of Nov 10' }).closest('tr')).toHaveTextContent('1,200500')
    const query = new URL(fetchMock.mock.calls.findLast(([url]) => new URL(url).pathname === '/api/admin/reports/rewards')[0]).searchParams
    expect(Object.fromEntries(query)).toEqual({ from: '2026-11-01', to: '2026-11-18', groupBy: 'week' })
  })
})

const SETTINGS = {
  general: { storeName: 'BuyNest' }, shipping: { enabledMethods: ['standard'] }, tax: {}, checkout: {}, inventory: { lowStockThreshold: 10 },
  rewards: { enabled: false, earnRate: 1, pointValue: 0.01, minRedeem: 100, maxPercent: 50, signupBonus: 0, reviewBonus: 0 }, live: true,
}
const CURRENCIES = {
  base: 'USD',
  currencies: [
    { id: 1, code: 'BDT', symbol: '৳', rate: 110.5, decimals: 2, enabled: true, position: 1, updatedAt: '2026-09-01T00:00:00Z', stale: true },
    { id: 2, code: 'EUR', symbol: '€', rate: 0, decimals: 2, enabled: false, position: 2, updatedAt: '2026-11-18T00:00:00Z', stale: false },
  ],
}

describe('Settings → Reward points and Currencies', () => {
  it('saves the reward points settings', async () => {
    withSession()
    const fetchMock = mockFetch({ 'GET /api/admin/me': { body: ADMIN }, 'GET /api/admin/settings': { body: SETTINGS }, 'PATCH /api/admin/settings': { body: SETTINGS }, 'GET /api/admin/currencies': { body: CURRENCIES } })
    const user = userEvent.setup()
    renderApp('/settings')
    const form = (await screen.findByRole('heading', { name: 'Reward points' })).closest('form')
    await user.click(within(form).getByLabelText('Reward points are on'))
    await user.clear(within(form).getByLabelText('Most of an order points may pay (%)'))
    await user.type(within(form).getByLabelText('Most of an order points may pay (%)'), '120')
    await user.click(within(form).getByRole('button', { name: 'Save reward points' }))
    expect(within(form).getByLabelText('Most of an order points may pay (%)')).toHaveAccessibleDescription(/Enter a whole percentage from 1 to 100/)
    await user.clear(within(form).getByLabelText('Most of an order points may pay (%)'))
    await user.type(within(form).getByLabelText('Most of an order points may pay (%)'), '30')
    await user.clear(within(form).getByLabelText('Review bonus (points)'))
    await user.type(within(form).getByLabelText('Review bonus (points)'), '20')
    expect(within(form).getByText(/\$100\.00 of eligible spend earns 100 points, worth \$1\.00/)).toBeInTheDocument()
    await user.click(within(form).getByRole('button', { name: 'Save reward points' }))
    expect(await within(form).findByText('Reward points saved.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/settings')).toEqual({ rewards: { enabled: true, earnRate: 1, pointValue: 0.01, minRedeem: 100, maxPercent: 30, signupBonus: 0, reviewBonus: 20 } })
  })

  it('lists currencies with the old-rate warning, adds one, edits, turns one off, and reorders with the keyboard', async () => {
    withSession()
    let list = CURRENCIES
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/settings': { body: SETTINGS },
      'GET /api/admin/currencies': () => ({ body: list }),
      'POST /api/admin/currencies': (url, init) => {
        const currency = { id: 3, position: 3, updatedAt: '2026-11-18T12:00:00Z', stale: false, ...JSON.parse(init.body) }
        list = { ...list, currencies: [...list.currencies, currency] }
        return { status: 201, body: { currency } }
      },
      'PATCH /api/admin/currencies/1': (url, init) => {
        const currency = { ...list.currencies[0], ...JSON.parse(init.body), stale: false }
        list = { ...list, currencies: [currency, ...list.currencies.slice(1)] }
        return { body: { currency } }
      },
      'POST /api/admin/currencies/reorder': (url, init) => {
        const ids = JSON.parse(init.body).ids
        list = { ...list, currencies: ids.map((id) => list.currencies.find((currency) => currency.id === id)) }
        return { body: list }
      },
    })
    const user = userEvent.setup()
    renderApp('/settings')
    const panel = (await screen.findByRole('heading', { name: 'Currencies' })).closest('section')
    const table = await within(panel).findByRole('region', { name: 'Display currencies' })
    expect(table).toHaveAttribute('tabindex', '0')
    expect(within(panel).getByText(/The BDT rate is more than 30 days old/)).toBeInTheDocument()
    const bdt = within(table).getByRole('rowheader', { name: /BDT/ }).closest('tr')
    expect(bdt).toHaveTextContent('1 USD = ৳ 110.50')
    expect(bdt).toHaveTextContent('Offered')
    expect(bdt).toHaveTextContent('Older than 30 days')
    expect(within(table).getByRole('rowheader', { name: /EUR/ }).closest('tr')).toHaveTextContent('No rate yet')

    // Add INR, checked here first.
    await user.click(within(panel).getByRole('button', { name: 'Add currency' }))
    let dialog = await screen.findByRole('dialog', { name: 'Add a display currency' })
    await user.type(within(dialog).getByLabelText('Code'), 'bdt')
    await user.click(within(dialog).getByRole('button', { name: 'Add currency' }))
    expect(within(dialog).getByLabelText('Code')).toHaveAccessibleDescription(/BDT is already in the list/)
    await user.clear(within(dialog).getByLabelText('Code'))
    await user.type(within(dialog).getByLabelText('Code'), 'inr')
    await user.type(within(dialog).getByLabelText('Symbol'), '₹')
    await user.type(within(dialog).getByLabelText('Rate (units per 1 USD)'), '83.25')
    await user.click(within(dialog).getByLabelText('Shoppers can choose it'))
    await user.click(within(dialog).getByRole('button', { name: 'Add currency' }))
    expect(await within(panel).findByText('INR added and shown to shoppers.')).toHaveFocus()
    expect(sentTo(fetchMock, 'POST', '/api/admin/currencies')).toEqual({ code: 'INR', symbol: '₹', rate: 83.25, decimals: 2, enabled: true })

    // Edit BDT's rate: only what changed is sent.
    await user.click(within(panel).getByRole('button', { name: 'Edit BDT' }))
    dialog = await screen.findByRole('dialog', { name: 'Edit BDT' })
    await user.clear(within(dialog).getByLabelText('Rate (units per 1 USD)'))
    await user.type(within(dialog).getByLabelText('Rate (units per 1 USD)'), '111')
    await user.click(within(dialog).getByRole('button', { name: 'Save currency' }))
    expect(await within(panel).findByText('BDT saved.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/currencies/1')).toEqual({ rate: 111 })
    await waitFor(() => expect(within(panel).queryByText(/more than 30 days old/)).not.toBeInTheDocument())

    await user.click(within(panel).getByRole('button', { name: 'Turn off BDT' }))
    expect(await within(panel).findByText('BDT is turned off: shoppers can no longer choose it.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/currencies/1')).toEqual({ enabled: false })

    const down = within(panel).getByRole('button', { name: 'Move BDT down' })
    down.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(sentTo(fetchMock, 'POST', '/api/admin/currencies/reorder')).toEqual({ ids: [2, 1, 3] }))
    expect(within(panel).getByText('BDT moved to position 2 of 3.')).toBeInTheDocument()
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Move BDT down' })).toHaveFocus())
  })

  it('a role with settings.view only sees the currencies without the buttons', async () => {
    withSession()
    mockFetch({ 'GET /api/admin/me': { body: withRole(['settings.view']) }, 'GET /api/admin/settings': { body: SETTINGS }, 'GET /api/admin/currencies': { body: CURRENCIES } })
    renderApp('/settings')
    const panel = (await screen.findByRole('heading', { name: 'Currencies' })).closest('section')
    expect(await within(panel).findByRole('region', { name: 'Display currencies' })).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Add currency' })).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Edit BDT' })).not.toBeInTheDocument()
  })
})

describe('roles', () => {
  it('names rewards.manage in plain words when the API sends only the key', async () => {
    withSession()
    const ROLES = { roles: [{ id: 2, name: 'Marketing', description: '', permissions: ['rewards.manage'], isSystem: false, adminCount: 0 }] }
    mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/roles': { body: ROLES },
      'GET /api/admin/permissions': { body: { groups: [{ label: 'Customers', permissions: [{ key: 'customers.view', label: 'View customers' }, { key: 'rewards.manage', label: 'rewards.manage' }] }] } },
    })
    const user = userEvent.setup()
    renderApp('/roles')
    await user.click(await screen.findByRole('button', { name: 'Edit Marketing' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Marketing' })
    expect(within(dialog).getByRole('checkbox', { name: "Adjust customers' reward point balances" })).toBeChecked()
  })
})
