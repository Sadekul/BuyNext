import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'
import { ApiError } from '../api/client'
import { daysBefore, defaultRange, knownZone, periodLabel, rangeProblem, rememberZone, todayIn, zoneWords } from '../utils/reportRange'
import { payoutErrors, toPayoutValues } from '../utils/cash'

/*
 * Phase 21 (docs/backend/PHASE21_CONTRACT.md §2): sales and cash reports.
 * The Reports group in the menu, the store time zone on the sales report and
 * its split by payment method and delivery zone, Money in, Cash on delivery
 * (courier balances, the period table, Still to collect), Courier payments
 * (record / edit / delete, the duplicate step), and Settings → General →
 * Time zone. BuyNest's backend; the admin service is mocked with its
 * camelCase shapes (server/adminPhase21Api.js).
 */
vi.mock('../api/mode', () => ({ LIVE_DATA: true }))

const OWNER = { ...ADMIN, role: { id: 1, name: 'Owner' }, permissions: ['dashboard.view', 'reports.view', 'cash.manage', 'orders.view', 'settings.view', 'settings.edit'] }
const VIEWER = { ...ADMIN, role: { id: 5, name: 'Viewer' }, permissions: ['reports.view', 'orders.view'] }
const SALES = { ...ADMIN, role: { id: 3, name: 'Sales staff' }, permissions: ['orders.view'] }
const BDT_STORE = { body: { data: { currency: { code: 'BDT', symbol: '৳', decimals: 2 }, currencies: { base: 'BDT', display: [] } } } }

const sentTo = (fetchMock, method, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => (init?.method ?? 'GET') === method && new URL(url).pathname === path)
  return call && JSON.parse(call[1].body)
}
const lastQuery = (fetchMock, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => (init?.method ?? 'GET') === 'GET' && new URL(url).pathname === path)
  return call && new URL(call[0]).searchParams
}
const callsTo = (fetchMock, method, path) => fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && new URL(url).pathname === path)
const nav = () => within(screen.getByRole('navigation', { name: 'Admin' }))

function start(me, path, routes = {}) {
  withSession()
  const fetchMock = mockFetch({ 'GET /api/admin/me': { body: me }, 'GET /api/catalog/store': BDT_STORE, ...routes })
  renderApp(path)
  return fetchMock
}

// ---- fixtures (the admin service's shapes) ----

const RANGE = { from: '2026-11-01', to: '2026-11-28', groupBy: 'day', timezone: 'Asia/Dhaka' }
const SALES_REPORT = {
  currency: 'BDT',
  totals: { orders: 3, units: 4, gross: 5000, discounts: 0, shipping: 120, tax: 0, refunds: 500, net: 4500, averageOrder: 1500 },
  series: [{ period: '2026-11-27', orders: 3, gross: 5000, refunds: 500, net: 4500 }],
  otherCurrencies: [],
  byPaymentMethod: [
    { method: 'cod', label: 'Cash on delivery', orders: 2, gross: 3000, refunds: 500, net: 2500 },
    { method: 'sslcommerz:bkash', label: 'bKash', orders: 1, gross: 2000, refunds: 0, net: 2000 },
  ],
  byDeliveryZone: [
    { zoneCode: 'inside_dhaka', name: 'Inside Dhaka', orders: 2, gross: 4000, refunds: 500, net: 3500 },
    { zoneCode: null, name: '', orders: 1, gross: 1000, refunds: 0, net: 1000 },
  ],
  range: RANGE,
  live: true,
}
const OTHER_REPORTS = {
  'GET /api/admin/reports/products': { body: { products: [] } },
  'GET /api/admin/reports/customers': { body: { newCustomers: 0, returningCustomers: 0, guestOrders: 0, topCustomers: [] } },
  'GET /api/admin/reports/coupons': { body: { coupons: [] } },
  'GET /api/admin/reports/low-stock': { body: { products: [] } },
  'GET /api/admin/reports/stock-alerts': { body: { products: [], total: 0, waitingTotal: 0, notifiedLast30Days: 0 } },
  'GET /api/admin/reports/wishlist': { body: { products: [] } },
  'GET /api/admin/reports/rewards': { body: { totals: { issued: 0, spent: 0, returned: 0, reversed: 0, adjusted: 0 }, series: [], outstandingPoints: 0, outstandingValue: 0 } },
}
const PAYMENTS = {
  currency: 'BDT',
  totals: { received: 15300, online: 4000, codCash: 11000, other: 300, refunds: 500, netReceived: 14800 },
  channels: [
    { channel: 'sslcommerz:bkash', label: 'bKash', amount: 4000, count: 2 },
    { channel: 'cash:steadfast', label: 'Cash collected by Steadfast', amount: 9800, count: 4 },
    { channel: 'cash:staff', label: 'Cash collected by staff', amount: 1200, count: 1 },
    { channel: 'other', label: 'Other', amount: 300, count: 1 },
  ],
  series: [
    { period: '2026-11-26', online: 0, codCash: 0, other: 0, refunds: 0, netReceived: 0 },
    { period: '2026-11-27', online: 4000, codCash: 11000, other: 300, refunds: 500, netReceived: 14800 },
  ],
  otherCurrencies: [],
  range: { ...RANGE, from: '2026-11-26', to: '2026-11-27' },
  live: true,
}
const COD = {
  currency: 'BDT',
  period: [
    { carrier: 'steadfast', label: 'Steadfast', shipped: 5, delivered: 3, returned: 1, cancelled: 0, collected: 9000, fees: 360, payouts: 8640 },
    { carrier: 'redx', label: 'RedX', shipped: 2, delivered: 1, returned: 0, cancelled: 1, collected: 1500, fees: null, payouts: 0 },
  ],
  balances: [
    { carrier: 'steadfast', label: 'Steadfast', collectedAllTime: 20000, feesAllTime: 800, feesReported: true, payoutsAllTime: 6860, owed: 12340, note: null, lastPayoutOn: '2026-11-20' },
    { carrier: 'redx', label: 'RedX', collectedAllTime: 1500, feesAllTime: null, feesReported: false, payoutsAllTime: 2000, owed: -500, note: 'paid_more_than_recorded', lastPayoutOn: null },
  ],
  outstanding: { orders: 4, amount: 6200 },
  staff: { collected: 1200 },
  range: { from: '2026-11-01', to: '2026-11-28', timezone: 'Asia/Dhaka' },
  live: true,
}
const OUTSTANDING_ORDER = { number: 'BN-100045', placedAt: '2026-11-01T10:00:00Z', shippedAt: '2026-11-02T08:00:00Z', carrier: 'steadfast', consignmentId: 'SF-778812', deliveryStatus: 'in_transit', codDue: 1550, daysSinceShipped: 26 }
const PAYOUT = { id: 7, carrier: 'steadfast', carrierLabel: 'Steadfast', amount: 9800, fees: 200, currency: 'BDT', receivedOn: '2026-11-27', reference: 'TRX-8812', note: 'Statement 41', adminName: 'Store Owner', createdAt: '2026-11-27T09:12:00Z' }

describe('report dates in the store time zone', () => {
  it("knows today in a zone, and starts the default period on the store's today", () => {
    const lateEvening = new Date('2026-11-27T20:00:00Z')
    expect(todayIn('UTC', lateEvening)).toBe('2026-11-27')
    // 20:00 UTC is 02:00 the next day in Dhaka.
    expect(todayIn('Asia/Dhaka', lateEvening)).toBe('2026-11-28')
    expect(defaultRange('UTC', lateEvening)).toEqual({ from: '2026-10-29', to: '2026-11-27' })
    expect(defaultRange('Asia/Dhaka', lateEvening)).toEqual({ from: '2026-10-30', to: '2026-11-28' })
    expect(daysBefore('2026-03-01', 1)).toBe('2026-02-28')
    expect(zoneWords('Asia/Dhaka')).toBe('Asia/Dhaka time')
    expect(zoneWords('UTC')).toBe('UTC')
    // Period keys are store-local days already: never shifted by the browser's zone.
    expect(periodLabel('2026-11-27', 'day')).toBe('Nov 27')
    expect(rangeProblem({ from: '2026-11-28', to: '2026-11-01' })).toBe('The start date must be on or before the end date.')
  })

  it('learns the store time zone from the store info on any page, before a report has loaded', async () => {
    const DHAKA_STORE = { body: { data: { ...BDT_STORE.body.data, timezone: 'Asia/Dhaka' } } }
    start(OWNER, '/', { 'GET /api/catalog/store': DHAKA_STORE, 'GET /api/admin/overview': { body: {} } })
    await waitFor(() => expect(knownZone()).toBe('Asia/Dhaka'))
    rememberZone('UTC') // shared module state: the next tests start from UTC again
    window.localStorage.removeItem('buynest.admin.storeTimezone')
  })
})

describe('navigation', () => {
  it('groups the reports, marking only the page that is open', async () => {
    start(OWNER, '/reports/cod', { 'GET /api/admin/reports/cod': { body: COD }, 'GET /api/admin/reports/cod/outstanding': { body: { orders: [], total: 0, live: true } } })
    expect(await screen.findByRole('heading', { name: 'Cash on delivery', level: 1 })).toBeInTheDocument()
    const reports = within(nav().getByRole('list', { name: 'Reports' }))
    expect(reports.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Sales and products', '/reports'],
      ['Money in', '/reports/payments'],
      ['Cash on delivery', '/reports/cod'],
      ['Courier payments', '/reports/courier-payments'],
    ])
    expect(reports.getByRole('link', { name: 'Cash on delivery' })).toHaveAttribute('aria-current', 'page')
    expect(reports.getByRole('link', { name: 'Sales and products' })).not.toHaveAttribute('aria-current')
  })

  it('leaves the group out without reports.view, and says which permission a page needs', async () => {
    start(SALES, '/reports/courier-payments')
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument()
    expect(screen.getByText('View and download reports')).toBeInTheDocument()
    expect(nav().queryByRole('list', { name: 'Reports' })).not.toBeInTheDocument()
  })
})

describe('Reports → Sales and products', () => {
  it('moves the default period to the store’s today once the report names its time zone', async () => {
    const fetchMock = start(OWNER, '/reports', { 'GET /api/admin/reports/sales': { body: SALES_REPORT }, ...OTHER_REPORTS })
    expect(await screen.findByText(/Dates in Asia\/Dhaka time\./)).toBeInTheDocument()
    await waitFor(() => expect(lastQuery(fetchMock, '/api/admin/reports/sales').get('to')).toBe(todayIn('Asia/Dhaka')))
    expect(lastQuery(fetchMock, '/api/admin/reports/sales').get('from')).toBe(daysBefore(todayIn('Asia/Dhaka'), 29))
  })

  it('splits sales by payment method and by delivery zone: bars with a summary, and the numbers as a table', async () => {
    start(OWNER, '/reports?from=2026-11-01&to=2026-11-28&groupBy=day', { 'GET /api/admin/reports/sales': { body: SALES_REPORT }, ...OTHER_REPORTS })
    const method = within((await screen.findByRole('heading', { name: 'By payment method' })).closest('section'))
    const chart = method.getByRole('img', { name: 'By payment method' })
    expect(chart).toHaveAccessibleDescription('2 payment methods. Largest: Cash on delivery, ৳3,000.00 gross (60% of ৳5,000.00). Amounts in BDT.')
    expect(method.getByText('Show the numbers as a table')).toBeInTheDocument()
    const bkash = method.getByRole('rowheader', { name: 'bKash' }).closest('tr')
    expect(within(bkash).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['1', '৳2,000.00', '৳0.00', '৳2,000.00', '40%'])

    const zone = within(screen.getByRole('heading', { name: 'By delivery zone' }).closest('section'))
    expect(zone.getByRole('rowheader', { name: 'Inside Dhaka' })).toBeInTheDocument()
    // No zone: in words, never blank.
    expect(zone.getByRole('rowheader', { name: 'No zone (outside Bangladesh or a free-text address)' }).closest('tr')).toHaveTextContent('৳1,000.00')
  })

  it('has no breakdown sections with an older API', async () => {
    const older = { ...SALES_REPORT }
    delete older.byPaymentMethod
    delete older.byDeliveryZone
    start(OWNER, '/reports?from=2026-11-01&to=2026-11-28', { 'GET /api/admin/reports/sales': { body: { ...older, range: { from: '2026-11-01', to: '2026-11-28' } } }, ...OTHER_REPORTS })
    expect(await screen.findByRole('heading', { name: 'Sales' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'By payment method' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'By delivery zone' })).not.toBeInTheDocument()
  })
})

describe('Reports → Money in', () => {
  it('shows the tiles, a stacked chart with a legend, summary and table, the channels, and a CSV link', async () => {
    const fetchMock = start(VIEWER, '/reports/payments?from=2026-11-26&to=2026-11-27&groupBy=day', { 'GET /api/admin/reports/payments': { body: PAYMENTS } })
    expect(await screen.findByRole('heading', { name: 'Money in', level: 1 })).toBeInTheDocument()
    await screen.findByText('Net received', { selector: 'dt' })
    for (const [label, value] of [
      // Tiles: exact below 10,000, then compact (the table has every exact figure).
      ['Net received', '৳14.8K'],
      ['Received', '৳15.3K'],
      ['Online', '৳4,000.00'],
      ['Cash on delivery', '৳11K'],
      ['Refunds', '৳500.00'],
    ])
      expect(screen.getByText(label, { selector: 'dt' }).nextElementSibling).toHaveTextContent(value)

    const chart = screen.getByRole('img', { name: 'Money received by day' })
    expect(chart).toHaveAccessibleDescription(
      '2 days from Nov 26 to Nov 27. Received ৳15,300.00: online ৳4,000.00, cash on delivery ৳11,000.00, other ৳300.00. Refunds paid ৳500.00. Most received: Nov 27 (৳15,300.00). Amounts in BDT.',
    )
    expect(within(screen.getByRole('list', { name: 'Colours in the chart' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Online', 'Cash on delivery', 'Other'])
    expect(screen.getByRole('rowheader', { name: 'Nov 27' }).closest('tr')).toHaveTextContent('৳14,800.00')

    const channels = within(screen.getByRole('heading', { name: 'By channel' }).closest('section'))
    expect(within(channels.getByRole('rowheader', { name: 'Cash collected by Steadfast' }).closest('tr')).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['4', '৳9,800.00', '64%'])
    expect(screen.getByRole('link', { name: 'Download money-in CSV' })).toHaveAttribute('href', '/api/admin/reports/payments.csv?from=2026-11-26&to=2026-11-27&groupBy=day')
    expect(lastQuery(fetchMock, '/api/admin/reports/payments').get('groupBy')).toBe('day')
  })

  it('shows the friendly screen for a 403 from the API', async () => {
    start(OWNER, '/reports/payments', { 'GET /api/admin/reports/payments': { status: 403, body: { message: "Your role doesn't allow this.", code: 'permission_denied', permission: 'reports.view' } } })
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument()
    expect(screen.getByText('(reports.view)')).toBeInTheDocument()
  })
})

describe('Reports → Cash on delivery', () => {
  function codPage(me = OWNER, outstanding = { orders: [OUTSTANDING_ORDER], total: 1, currency: 'BDT', live: true }) {
    return start(me, '/reports/cod?from=2026-11-01&to=2026-11-28', {
      'GET /api/admin/reports/cod': { body: COD },
      'GET /api/admin/reports/cod/outstanding': { body: outstanding },
    })
  }

  it('shows each courier’s balance: what it owes, collected, fees, paid, the last payment', async () => {
    codPage()
    const steadfast = within((await screen.findByRole('heading', { name: 'Steadfast', level: 3 })).closest('li'))
    expect(steadfast.getByText('Steadfast owes you ৳12,340.00')).toBeInTheDocument()
    expect(steadfast.getByText('Collected').nextElementSibling).toHaveTextContent('৳20,000.00')
    expect(steadfast.getByText('Fees').nextElementSibling).toHaveTextContent('৳800.00')
    expect(steadfast.getByText('Paid to you').nextElementSibling).toHaveTextContent('৳6,860.00')
    expect(steadfast.getByText('Last payment').nextElementSibling).toHaveTextContent('Nov 20, 2026')
    expect(steadfast.getByRole('link', { name: 'See Steadfast payments' })).toHaveAttribute('href', '/reports/courier-payments?carrier=steadfast')
    expect(screen.getByText('Still to collect', { selector: 'dt' }).nextElementSibling).toHaveTextContent('৳6,200.00')
    expect(screen.getByRole('link', { name: 'Download balances CSV' })).toHaveAttribute('href', '/api/admin/reports/cod.csv?from=2026-11-01&to=2026-11-28')
  })

  it('says "Fees not reported" (never 0) and flags a courier that paid more than recorded', async () => {
    codPage()
    const redx = within((await screen.findByRole('heading', { name: 'RedX', level: 3 })).closest('li'))
    expect(redx.getByText('Fees').nextElementSibling).toHaveTextContent('Fees not reported')
    expect(redx.getByText('Paid more than recorded — check the payments')).toBeInTheDocument()
    expect(redx.getByText(/RedX has paid you ৳500.00 more than the cash recorded for it/)).toBeInTheDocument()
    expect(redx.queryByText(/owes you/)).not.toBeInTheDocument()
    expect(redx.getByText('Last payment').nextElementSibling).toHaveTextContent('None recorded yet')

    // The period table: "Not reported" for RedX's fees too.
    const row = screen.getByRole('rowheader', { name: 'RedX' }).closest('tr')
    expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['2', '1', '0', '1', '৳1,500.00', 'Not reported', '৳0.00'])
  })

  it('says the shop owes a courier whose fees are more than the cash it collected (no payment recorded)', async () => {
    const pathao = { carrier: 'pathao', label: 'Pathao', collectedAllTime: 200, feesAllTime: 240, feesReported: true, payoutsAllTime: 0, owed: -40, note: 'fees_more_than_collected', lastPayoutOn: null }
    start(OWNER, '/reports/cod?from=2026-11-01&to=2026-11-28', {
      'GET /api/admin/reports/cod': { body: { ...COD, balances: [pathao] } },
      'GET /api/admin/reports/cod/outstanding': { body: { orders: [], total: 0, currency: 'BDT', live: true } },
    })
    const card = within((await screen.findByRole('heading', { name: 'Pathao', level: 3 })).closest('li'))
    expect(card.getByText('You owe Pathao ৳40.00')).toBeInTheDocument()
    expect(card.getByText(/Pathao's fees, returned parcels included, are more than the cash it collected for you/)).toBeInTheDocument()
    expect(card.queryByText(/Paid more than recorded/)).not.toBeInTheDocument()
    expect(card.queryByText(/owes you/)).not.toBeInTheDocument()
  })

  it('lists the orders still to collect, linked to each order, with courier and age filters', async () => {
    const fetchMock = codPage()
    const user = userEvent.setup()
    const list = within((await screen.findByRole('heading', { name: 'Still to collect', level: 2 })).closest('section'))
    expect(await list.findByRole('link', { name: 'BN-100045' })).toHaveAttribute('href', '/orders/BN-100045')
    const row = list.getByRole('link', { name: 'BN-100045' }).closest('tr')
    expect(row).toHaveTextContent('SF-778812')
    expect(row).toHaveTextContent('In transit')
    expect(row).toHaveTextContent('৳1,550.00')

    await user.selectOptions(list.getByLabelText('Courier'), 'pathao')
    await user.selectOptions(list.getByLabelText('Shipped'), '14')
    await waitFor(() => expect(lastQuery(fetchMock, '/api/admin/reports/cod/outstanding').get('olderThanDays')).toBe('14'))
    expect(lastQuery(fetchMock, '/api/admin/reports/cod/outstanding').get('carrier')).toBe('pathao')
    expect(list.getByRole('link', { name: 'Download list CSV' })).toHaveAttribute('href', '/api/admin/reports/cod/outstanding.csv?carrier=pathao&olderThanDays=14')
  })

  it('shows plain words when nothing is left to collect', async () => {
    codPage(VIEWER, { orders: [], total: 0, live: true })
    expect(await screen.findByText('Nothing left to collect: every shipped COD order is paid.')).toBeInTheDocument()
  })
})

describe('Reports → Courier payments', () => {
  function payoutsPage(me = OWNER, extra = {}, path = '/reports/courier-payments') {
    return start(me, path, { 'GET /api/admin/courier-payouts': { body: { payouts: [PAYOUT], total: 1, live: true } }, ...extra })
  }
  const dialog = () => within(screen.getByRole('dialog'))

  it('lists payments; filters by courier (also from the Cash on delivery link)', async () => {
    const fetchMock = payoutsPage(OWNER, {}, '/reports/courier-payments?carrier=redx')
    const row = (await screen.findByRole('rowheader', { name: 'Nov 27, 2026' })).closest('tr')
    expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['Steadfast Statement 41', '৳9,800.00', '৳200.00', 'TRX-8812', 'Store Owner', ''])
    expect(lastQuery(fetchMock, '/api/admin/courier-payouts').get('carrier')).toBe('redx')
    const user = userEvent.setup()
    const filters = within(screen.getByRole('form', { name: 'Filter courier payments' }))
    await user.selectOptions(filters.getByLabelText('Courier'), 'steadfast')
    fireEvent.change(filters.getByLabelText('Received from'), { target: { value: '2026-11-01' } })
    await user.click(filters.getByRole('button', { name: 'Show' }))
    await waitFor(() => expect(lastQuery(fetchMock, '/api/admin/courier-payouts').get('from')).toBe('2026-11-01'))
    expect(lastQuery(fetchMock, '/api/admin/courier-payouts').get('carrier')).toBe('steadfast')
  })

  it('checks the dialog before sending: courier, amount, fees, a date not in the future', async () => {
    const fetchMock = payoutsPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Record a payment' }))
    expect(dialog().getAllByRole('option').map((option) => option.textContent)).toEqual(['Choose a courier', 'Steadfast', 'Pathao', 'RedX', 'Paperfly', 'Sundarban Courier'])
    await user.type(dialog().getByLabelText('Fees kept (BDT, optional)'), '-5')
    fireEvent.change(dialog().getByLabelText('Date received'), { target: { value: '2999-01-01' } })
    await user.click(dialog().getByRole('button', { name: 'Record payment' }))
    expect(dialog().getByLabelText('Courier')).toHaveAccessibleDescription('Choose the courier that paid you.')
    expect(dialog().getByLabelText('Amount received (BDT)')).toHaveAccessibleDescription(/Enter the amount received, more than 0, with at most 2 decimals./)
    expect(dialog().getByLabelText('Fees kept (BDT, optional)')).toHaveAccessibleDescription(/Enter the fees the courier kept/)
    expect(dialog().getByLabelText('Date received')).toHaveAccessibleDescription("The date can't be in the future.")
    expect(callsTo(fetchMock, 'POST', '/api/admin/courier-payouts')).toHaveLength(0)
  })

  it('records a payment and announces it', async () => {
    const fetchMock = payoutsPage(OWNER, { 'POST /api/admin/courier-payouts': { status: 201, body: { payout: PAYOUT, live: true } } })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Record a payment' }))
    await user.selectOptions(dialog().getByLabelText('Courier'), 'steadfast')
    await user.type(dialog().getByLabelText('Amount received (BDT)'), '9800')
    await user.type(dialog().getByLabelText('Fees kept (BDT, optional)'), '200')
    fireEvent.change(dialog().getByLabelText('Date received'), { target: { value: '2026-11-27' } })
    await user.type(dialog().getByLabelText('Reference (optional)'), ' TRX-8812 ')
    await user.click(dialog().getByRole('button', { name: 'Record payment' }))
    expect(await screen.findByText('Payment of ৳9,800.00 from Steadfast recorded.')).toHaveFocus()
    expect(sentTo(fetchMock, 'POST', '/api/admin/courier-payouts')).toEqual({ carrier: 'steadfast', amount: 9800, fees: 200, receivedOn: '2026-11-27', reference: 'TRX-8812', note: null })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('asks before recording what looks like a duplicate, then sends it again with confirmDuplicate', async () => {
    const fetchMock = payoutsPage(OWNER, {
      'POST /api/admin/courier-payouts': (url, init) =>
        JSON.parse(init.body).confirmDuplicate
          ? { status: 201, body: { payout: { ...PAYOUT, id: 9 }, live: true } }
          : { status: 409, body: { message: 'Already recorded.', duplicateOf: PAYOUT } },
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Record a payment' }))
    await user.selectOptions(dialog().getByLabelText('Courier'), 'steadfast')
    await user.type(dialog().getByLabelText('Amount received (BDT)'), '9800')
    fireEvent.change(dialog().getByLabelText('Date received'), { target: { value: '2026-11-27' } })
    await user.click(dialog().getByRole('button', { name: 'Record payment' }))

    const confirm = within(await screen.findByRole('dialog', { name: 'This payment may already be recorded' }))
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      'A payment of ৳9,800.00 from Steadfast received on Nov 27, 2026 is already recorded (reference TRX-8812). Record this one too only if Steadfast really paid you twice.',
    )
    // Cancel goes back to the form, values kept.
    await user.click(confirm.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('dialog', { name: 'Record a courier payment' })).toBeInTheDocument()
    expect(dialog().getByLabelText('Amount received (BDT)')).toHaveValue(9800)
    await user.click(dialog().getByRole('button', { name: 'Record payment' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'This payment may already be recorded' })).getByRole('button', { name: 'Record it anyway' }))

    expect(await screen.findByText('Payment of ৳9,800.00 from Steadfast recorded.')).toBeInTheDocument()
    const posts = callsTo(fetchMock, 'POST', '/api/admin/courier-payouts').map(([, init]) => JSON.parse(init.body))
    expect(posts).toHaveLength(3)
    expect(posts[2]).toEqual({ carrier: 'steadfast', amount: 9800, fees: null, receivedOn: '2026-11-27', reference: null, note: null, confirmDuplicate: true })
    expect(posts[0]).not.toHaveProperty('confirmDuplicate')
  })

  it('edits and deletes a payment after confirming, announcing each', async () => {
    const fetchMock = payoutsPage(OWNER, {
      'PATCH /api/admin/courier-payouts/7': (url, init) => ({ body: { payout: { ...PAYOUT, ...JSON.parse(init.body) }, live: true } }),
      'DELETE /api/admin/courier-payouts/7': { body: { id: 7, deleted: true, live: true } },
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Edit the payment of ৳9,800.00 from Steadfast on Nov 27, 2026' }))
    const amount = dialog().getByLabelText('Amount received (BDT)')
    expect(amount).toHaveValue(9800)
    await user.clear(amount)
    await user.type(amount, '9700')
    await user.click(dialog().getByRole('button', { name: 'Save payment' }))
    expect(await screen.findByText('Payment of ৳9,700.00 from Steadfast saved.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/courier-payouts/7')).toMatchObject({ carrier: 'steadfast', amount: 9700, fees: 200, receivedOn: '2026-11-27' })

    await user.click(screen.getByRole('button', { name: 'Delete the payment of ৳9,800.00 from Steadfast on Nov 27, 2026' }))
    expect(screen.getByRole('dialog', { name: 'Delete this payment?' })).toHaveAccessibleDescription(/the courier's balance goes back up by that amount/)
    await user.click(dialog().getByRole('button', { name: 'Delete payment' }))
    expect(await screen.findByText('Payment of ৳9,800.00 from Steadfast deleted.')).toBeInTheDocument()
    expect(callsTo(fetchMock, 'DELETE', '/api/admin/courier-payouts/7')).toHaveLength(1)
  })

  it('lets a Viewer read but not record, edit or delete', async () => {
    payoutsPage(VIEWER)
    expect(await screen.findByRole('rowheader', { name: 'Nov 27, 2026' })).toBeInTheDocument()
    expect(screen.getByText('Your role can see courier payments but not record them.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record a payment' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit the payment/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Delete the payment/ })).not.toBeInTheDocument()
  })

  it('names the missing permission when the API refuses a write', async () => {
    payoutsPage({ ...OWNER, permissions: ['reports.view', 'cash.manage'] }, {
      'POST /api/admin/courier-payouts': { status: 403, body: { message: "Your role doesn't allow this.", code: 'permission_denied', permission: 'cash.manage' } },
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Record a payment' }))
    await user.selectOptions(dialog().getByLabelText('Courier'), 'pathao')
    await user.type(dialog().getByLabelText('Amount received (BDT)'), '500')
    fireEvent.change(dialog().getByLabelText('Date received'), { target: { value: '2026-11-20' } })
    await user.click(dialog().getByRole('button', { name: 'Record payment' }))
    expect(await dialog().findByRole('alert')).toHaveTextContent("Your role doesn't allow this: Record courier payments (cash.manage).")
  })
})

describe('payment helpers and the API error', () => {
  it('checks and converts the dialog form', () => {
    const form = { carrier: 'steadfast', amount: '9800.5', fees: '', receivedOn: '2026-11-27', reference: ' x ', note: '' }
    expect(payoutErrors(form, '2026-11-28')).toEqual({})
    expect(toPayoutValues(form)).toEqual({ carrier: 'steadfast', amount: 9800.5, fees: null, receivedOn: '2026-11-27', reference: 'x', note: null })
    expect(payoutErrors({ ...form, amount: '1.005', receivedOn: '2019-12-31' }, '2026-11-28')).toEqual({
      amount: ['Enter the amount received, more than 0, with at most 2 decimals.'],
      receivedOn: ['Enter a date from 2020 on.'],
    })
  })

  it('keeps duplicateOf from a 409', () => {
    expect(new ApiError('Already recorded.', { status: 409, data: { message: 'Already recorded.', duplicateOf: { id: 7, amount: 9800 } } }).duplicateOf).toEqual({ id: 7, amount: 9800 })
    expect(new ApiError('Nope', { status: 422, data: {} }).duplicateOf).toBeNull()
  })
})

describe('Settings → General → Time zone', () => {
  it('offers Asia/Dhaka and UTC first, then every zone, and saves the choice', async () => {
    const settings = { general: { storeName: 'BuyNest', storeTimezone: 'UTC' }, shipping: { enabledMethods: ['standard'] }, tax: {}, inventory: { lowStockThreshold: 10 }, checkout: { allowedCountries: ['Bangladesh'], guestCheckout: true, enabledPaymentMethods: ['cod'] }, live: true }
    const fetchMock = start(ADMIN, '/settings', {
      'GET /api/admin/settings': { body: settings },
      'PATCH /api/admin/settings': (url, init) => ({ body: { ...settings, general: { ...settings.general, ...JSON.parse(init.body).general } } }),
      'GET /api/admin/currencies': { body: { base: 'BDT', currencies: [] } },
    })
    const user = userEvent.setup()
    const form = within((await screen.findByRole('heading', { name: 'General' })).closest('form'))
    const zone = form.getByLabelText('Time zone')
    expect(zone).toHaveValue('UTC')
    expect(zone).toHaveAccessibleDescription(/In Bangladesh choose Asia\/Dhaka/)
    const options = within(zone).getAllByRole('option')
    expect(options.slice(0, 2).map((option) => option.value)).toEqual(['Asia/Dhaka', 'UTC'])
    expect(options.length).toBeGreaterThan(2)
    await user.selectOptions(zone, 'Asia/Dhaka')
    await user.click(form.getByRole('button', { name: 'Save general' }))
    expect(await form.findByText('General saved.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/settings').general).toMatchObject({ storeName: 'BuyNest', storeTimezone: 'Asia/Dhaka' })
  })
})
