import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'
import { insertAt, smsErrors, smsSettingsToForm, templateCountText, toSmsPayload, unknownVariables } from '../utils/sms'
import { isGsm, measureSms, smsCountText } from '../utils/smsText'

/*
 * Phase 20 (docs/backend/PHASE20_CONTRACT.md §2): Settings → SMS (on/off,
 * provider cards, texts to send, the confirmation link, the template editor
 * with English / বাংলা tabs and a live SMS counter, a test send), Sales → SMS
 * log (filters, search, Retry), and the order page's SMS panel. BuyNest's
 * backend; the admin service is mocked.
 */
vi.mock('../api/mode', () => ({ LIVE_DATA: true }))

const OWNER = { ...ADMIN, role: { id: 1, name: 'Owner' }, permissions: ['settings.view', 'settings.edit', 'orders.view', 'orders.edit'] }
const VIEWER = { ...ADMIN, role: { id: 5, name: 'Viewer' }, permissions: ['settings.view'] }
const SALES = { ...ADMIN, role: { id: 3, name: 'Sales' }, permissions: ['orders.view'] }

const sentTo = (fetchMock, method, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => (init?.method ?? 'GET') === method && new URL(url).pathname === path)
  return call && JSON.parse(call[1].body)
}
const lastQuery = (fetchMock, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => (init?.method ?? 'GET') === 'GET' && new URL(url).pathname === path)
  return call && new URL(call[0]).searchParams
}
const callsTo = (fetchMock, method, path) => fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && new URL(url).pathname === path)

const EVENTS = ['order_placed', 'cod_confirm_request', 'order_confirmed', 'order_shipped', 'order_delivered', 'order_cancelled']
const DEFAULTS = {
  order_placed: { en: "{store}: order {order} received, total {total}. We'll text you when it ships.", bn: '{store}: আপনার অর্ডার {order} পেয়েছি, মোট {total}। পাঠানোর সময় আমরা আপনাকে জানাব।' },
  cod_confirm_request: { en: '{store}: please confirm your order {order} ({total}, cash on delivery): {confirm_url}', bn: '{store}: অর্ডার {order} নিশ্চিত করুন: {confirm_url}' },
  order_confirmed: { en: '{store}: order {order} is confirmed.', bn: '{store}: অর্ডার {order} নিশ্চিত হয়েছে।' },
  order_shipped: { en: '{store}: order {order} is on its way with {courier}. Track: {tracking_url}', bn: '{store}: অর্ডার {order} পাঠানো হয়েছে।' },
  order_delivered: { en: '{store}: order {order} was delivered.', bn: '{store}: অর্ডার {order} পৌঁছেছে।' },
  order_cancelled: { en: '{store}: order {order} was cancelled.', bn: '{store}: অর্ডার {order} বাতিল হয়েছে।' },
}
const EMPTY_TEMPLATES = Object.fromEntries(EVENTS.map((event) => [event, { en: '', bn: '' }]))
const SETTINGS = { enabled: false, provider: 'log', events: EVENTS, templates: EMPTY_TEMPLATES, confirmLink: true }
const PROVIDERS = [
  { key: 'log', label: 'Log (test mode)', configured: true },
  { key: 'ssl_wireless', label: 'SSL Wireless', configured: false },
  { key: 'bulksmsbd', label: 'BulkSMSBD', configured: true },
]
const VARIABLES = ['store', 'order', 'total', 'name', 'courier', 'tracking', 'tracking_url', 'confirm_url', 'order_url']
const SMS = { settings: SETTINGS, providers: PROVIDERS, stats: { sentToday: 4, failedToday: 1, sent30d: 120 }, defaults: { templates: DEFAULTS, variables: VARIABLES }, live: true }

function smsPage(me = OWNER, extra = {}) {
  withSession()
  const fetchMock = mockFetch({
    'GET /api/admin/me': { body: me },
    'GET /api/catalog/store': { body: { data: {} } },
    'GET /api/admin/sms': { body: SMS },
    ...extra,
  })
  renderApp('/settings/sms')
  return fetchMock
}

describe('the SMS counter (like the backend’s SmsText::measure)', () => {
  it('counts GSM-7: 160 in one SMS, 153 a part when longer', () => {
    expect(measureSms('')).toEqual({ encoding: 'gsm', length: 0, segments: 1 })
    expect(measureSms('Hello')).toEqual({ encoding: 'gsm', length: 5, segments: 1 })
    expect(measureSms('a'.repeat(160))).toEqual({ encoding: 'gsm', length: 160, segments: 1 })
    expect(measureSms('a'.repeat(161))).toEqual({ encoding: 'gsm', length: 161, segments: 2 })
    expect(measureSms('a'.repeat(306)).segments).toBe(2)
    expect(measureSms('a'.repeat(307)).segments).toBe(3)
    // Line breaks, @, £, é are GSM-7.
    expect(measureSms('Café @ £5\nThanks').encoding).toBe('gsm')
  })

  it('counts the extension characters as two', () => {
    expect(measureSms('{store}')).toEqual({ encoding: 'gsm', length: 9, segments: 1 })
    expect(measureSms('€')).toMatchObject({ encoding: 'gsm', length: 2 })
    expect(measureSms(`${'a'.repeat(159)}[`)).toMatchObject({ length: 161, segments: 2 })
  })

  it('switches to Unicode for any character outside GSM-7: 70 in one SMS, 67 a part', () => {
    expect(isGsm('অর্ডার')).toBe(false)
    expect(measureSms('ক'.repeat(70))).toEqual({ encoding: 'unicode', length: 70, segments: 1 })
    expect(measureSms('ক'.repeat(71))).toEqual({ encoding: 'unicode', length: 71, segments: 2 })
    expect(measureSms('ক'.repeat(134)).segments).toBe(2)
    expect(measureSms('ক'.repeat(135)).segments).toBe(3)
    // One Bangla letter, the taka sign or curly quotes make the whole text Unicode.
    expect(measureSms(`${'a'.repeat(100)}ক`)).toEqual({ encoding: 'unicode', length: 101, segments: 2 })
    expect(measureSms('Total ৳1,060').encoding).toBe('unicode')
    expect(measureSms('We’ll text you').encoding).toBe('unicode')
    // An emoji is two UTF-16 units.
    expect(measureSms('Hi 😀')).toMatchObject({ encoding: 'unicode', length: 5 })
  })

  it('says it in words', () => {
    expect(smsCountText('a'.repeat(72))).toBe('72 characters · 1 SMS')
    expect(smsCountText('a')).toBe('1 character · 1 SMS')
    expect(smsCountText('ক'.repeat(95))).toBe('Unicode (Bangla): 2 SMS · 95 characters')
  })

  it('counts a template as written: a known variable’s braces count once, an unknown one’s twice', () => {
    expect(templateCountText('{store}: order {order}')).toBe('22 characters · 1 SMS')
    expect(templateCountText('{ordr}')).toBe('8 characters · 1 SMS')
    expect(templateCountText('{store}: অর্ডার {order}')).toMatch(/^Unicode \(Bangla\): 1 SMS/)
  })
})

describe('helpers', () => {
  it('finds unknown variables and inserts at the cursor', () => {
    expect(unknownVariables('{store} {order} {ordr} {x} {ordr} { }')).toEqual(['ordr', 'x'])
    expect(unknownVariables('{store}: {tracking_url}')).toEqual([])
    // The API's list when it sends one.
    expect(unknownVariables('{store} {order}', ['store'])).toEqual(['order'])
    expect(insertAt('Hi there', '{name}', 3)).toEqual({ text: 'Hi {name}there', caret: 9 })
    expect(insertAt('Hi there', '{name}', 3, 8)).toEqual({ text: 'Hi {name}', caret: 9 })
    expect(insertAt('Hi', '{name}')).toEqual({ text: 'Hi{name}', caret: 8 })
  })

  it('turns the settings into the form, and sends only what changed', () => {
    const initial = smsSettingsToForm({ ...SETTINGS, templates: { ...EMPTY_TEMPLATES, order_placed: { en: 'Thanks {name}', bn: '' } } }, DEFAULTS)
    expect(initial).toMatchObject({ enabled: false, provider: 'log', events: EVENTS, confirmLink: true })
    expect(initial.templates.order_placed).toEqual({ en: 'Thanks {name}', bn: DEFAULTS.order_placed.bn })
    expect(initial.templates.order_shipped.en).toBe(DEFAULTS.order_shipped.en)
    expect(toSmsPayload(initial, initial, DEFAULTS)).toEqual({})

    const changed = { ...initial, enabled: true, events: ['order_shipped', 'order_placed'], templates: { ...initial.templates, order_placed: { en: DEFAULTS.order_placed.en, bn: 'নতুন {order}' } } }
    const body = toSmsPayload(changed, initial, DEFAULTS)
    expect(body.enabled).toBe(true)
    expect(body.events).toEqual(['order_placed', 'order_shipped'])
    expect(body.provider).toBeUndefined()
    // The default text goes as "" (the default); every event goes.
    expect(body.templates.order_placed).toEqual({ en: '', bn: 'নতুন {order}' })
    expect(body.templates.order_shipped).toEqual({ en: '', bn: '' })
  })

  it('checks the form with the server’s words', () => {
    const form = smsSettingsToForm(SETTINGS, DEFAULTS)
    expect(smsErrors(form)).toEqual({})
    expect(smsErrors({ ...form, enabled: true, events: [] })).toEqual({ events: ['Choose at least one text to send.'] })
    expect(smsErrors({ ...form, events: [] })).toEqual({})
    expect(smsErrors({ ...form, templates: { ...form.templates, order_placed: { en: 'x'.repeat(481), bn: '' } } })).toEqual({ 'templates.order_placed.en': ['Keep the text to 480 characters.'] })
  })
})

describe('Settings → SMS', () => {
  it('is in the menu and linked from Settings', async () => {
    smsPage()
    expect(await screen.findByRole('heading', { name: 'SMS notifications', level: 1 })).toBeInTheDocument()
    const nav = within(screen.getByRole('navigation', { name: 'Admin' }))
    expect(nav.getByRole('link', { name: 'SMS' })).toHaveAttribute('href', '/settings/sms')
    expect(within(nav.getByRole('list', { name: 'Sales' })).getByRole('link', { name: 'SMS log' })).toHaveAttribute('href', '/sms')
    expect(await screen.findByRole('link', { name: 'Open the SMS log' })).toHaveAttribute('href', '/sms')
  })

  it('shows the stats, the state in words, and the providers with their set-up badges', async () => {
    smsPage()
    const form = within(await screen.findByRole('form', { name: 'SMS settings' }))
    for (const [label, value] of [['Sent today', '4'], ['Failed today', '1'], ['Last 30 days', '120']]) expect(screen.getByText(label, { selector: 'dt' }).nextElementSibling).toHaveTextContent(value)

    const toggle = form.getByRole('switch', { name: 'SMS notifications' })
    expect(toggle).not.toBeChecked()
    expect(toggle).toHaveAccessibleDescription('Off: no texts are sent')

    const providers = within(form.getByRole('group', { name: 'Provider' }))
    expect(providers.getByRole('radio', { name: 'Log (test mode)' })).toBeChecked()
    expect(providers.getByRole('radio', { name: 'Log (test mode)' })).toHaveAccessibleDescription(/Set up.*Test mode: messages are only saved, not sent/)
    // Without its keys a provider can't be chosen.
    expect(providers.getByRole('radio', { name: 'SSL Wireless' })).toBeDisabled()
    expect(providers.getByRole('radio', { name: 'SSL Wireless' })).toHaveAccessibleDescription(/Not set up/)
    expect(providers.getByRole('radio', { name: 'BulkSMSBD' })).toBeEnabled()
    // The setup steps name the variables, never a value.
    expect(form.getByText('SMS_SSL_WIRELESS_API_TOKEN')).toBeInTheDocument()
    expect(form.getByText('SMS_BULKSMSBD_SENDER_ID')).toBeInTheDocument()

    const texts = within(form.getByRole('group', { name: 'Texts to send' }))
    expect(texts.getAllByRole('checkbox')).toHaveLength(6)
    expect(texts.getByRole('checkbox', { name: 'Order shipped' })).toHaveAccessibleDescription(/tracking link/)
    expect(form.getByRole('checkbox', { name: 'Include a one-tap confirmation link' })).toBeChecked()
    expect(form.getByRole('button', { name: 'Save SMS settings' })).toBeDisabled()
  })

  it('edits a template with English / বাংলা tabs, a live counter, variables, a warning and Reset', async () => {
    smsPage()
    const user = userEvent.setup()
    const form = within(await screen.findByRole('form', { name: 'SMS settings' }))
    const tabs = form.getByRole('tablist', { name: 'Template language' })
    expect(within(tabs).getByRole('tab', { name: 'English' })).toHaveAttribute('aria-selected', 'true')

    // The default text, and its count (as written).
    let text = form.getByRole('textbox', { name: 'Order placed text (English)' })
    expect(text).toHaveValue(DEFAULTS.order_placed.en)
    expect(text).toHaveAccessibleDescription(`${DEFAULTS.order_placed.en.length} characters · 1 SMS`)
    expect(form.getByRole('button', { name: 'Reset to default' })).toBeDisabled()

    // Bangla: Unicode parts.
    await user.click(within(tabs).getByRole('tab', { name: 'বাংলা' }))
    text = form.getByRole('textbox', { name: 'Order placed text (Bangla)' })
    expect(text).toHaveAttribute('lang', 'bn')
    expect(text).toHaveAccessibleDescription(/^Unicode \(Bangla\): 2 SMS · \d+ characters$/)
    fireEvent.change(text, { target: { value: 'ক'.repeat(71) } })
    expect(text).toHaveAccessibleDescription('Unicode (Bangla): 2 SMS · 71 characters')
    await user.click(form.getByRole('button', { name: 'Reset to default' }))
    expect(text).toHaveValue(DEFAULTS.order_placed.bn)

    // Another text, a variable at the cursor, an unknown one warned about.
    await user.selectOptions(form.getByLabelText('Template'), 'order_delivered')
    await user.click(within(tabs).getByRole('tab', { name: 'English' }))
    text = form.getByRole('textbox', { name: 'Order delivered text (English)' })
    await user.clear(text)
    await user.type(text, 'Hi , thanks')
    text.setSelectionRange(3, 3)
    await user.click(form.getByRole('button', { name: /^Insert \{name\}/ }))
    expect(text).toHaveValue('Hi {name}, thanks')
    expect(form.queryByText(/Unknown variable/)).not.toBeInTheDocument()
    await user.type(text, ' {{ordr}')
    expect(form.getByText(/Unknown variable \{ordr\}: left out of the text\./)).toBeInTheDocument()
  })

  it('saves only what changed, then says so', async () => {
    const fetchMock = smsPage(OWNER, {
      'PUT /api/admin/sms/settings': (url, init) => {
        const body = JSON.parse(init.body)
        return { body: { ...SMS, settings: { ...SETTINGS, ...body, templates: body.templates ?? SETTINGS.templates } } }
      },
    })
    const user = userEvent.setup()
    const form = within(await screen.findByRole('form', { name: 'SMS settings' }))
    await user.click(form.getByRole('switch', { name: 'SMS notifications' }))
    expect(form.getByRole('switch', { name: 'SMS notifications' })).toHaveAccessibleDescription('On: customers get order texts')
    await user.click(form.getByRole('radio', { name: 'BulkSMSBD' }))
    await user.click(form.getByRole('checkbox', { name: 'Order delivered' }))
    await user.click(form.getByRole('checkbox', { name: 'Include a one-tap confirmation link' }))
    const text = form.getByRole('textbox', { name: 'Order placed text (English)' })
    fireEvent.change(text, { target: { value: '{store}: thanks for order {order}' } })
    await user.click(form.getByRole('button', { name: 'Save SMS settings' }))

    expect(await screen.findByText('SMS settings saved.')).toHaveFocus()
    const sent = sentTo(fetchMock, 'PUT', '/api/admin/sms/settings')
    expect(sent).toMatchObject({ enabled: true, provider: 'bulksmsbd', confirmLink: false, events: EVENTS.filter((event) => event !== 'order_delivered') })
    expect(sent.templates.order_placed).toEqual({ en: '{store}: thanks for order {order}', bn: '' })
    expect(sent.templates.order_shipped).toEqual({ en: '', bn: '' })
    // The saved form shows the saved text.
    expect(screen.getByRole('textbox', { name: 'Order placed text (English)' })).toHaveValue('{store}: thanks for order {order}')
  })

  it('needs at least one text while on, and shows the server’s field errors', async () => {
    const fetchMock = smsPage(OWNER, {
      'PUT /api/admin/sms/settings': { status: 422, body: { message: 'Invalid', errors: { provider: ['BulkSMSBD is not set up.'] } } },
    })
    const user = userEvent.setup()
    const form = within(await screen.findByRole('form', { name: 'SMS settings' }))
    await user.click(form.getByRole('switch', { name: 'SMS notifications' }))
    for (const checkbox of within(form.getByRole('group', { name: 'Texts to send' })).getAllByRole('checkbox')) await user.click(checkbox)
    await user.click(form.getByRole('button', { name: 'Save SMS settings' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Please check the highlighted fields.')
    expect(form.getByText('Choose at least one text to send.')).toBeInTheDocument()
    expect(callsTo(fetchMock, 'PUT', '/api/admin/sms/settings')).toHaveLength(0)

    await user.click(within(form.getByRole('group', { name: 'Texts to send' })).getByRole('checkbox', { name: 'Order placed' }))
    await user.click(form.getByRole('radio', { name: 'BulkSMSBD' }))
    await user.click(form.getByRole('button', { name: 'Save SMS settings' }))
    expect(await form.findByText('BulkSMSBD is not set up.')).toBeInTheDocument()
  })

  it('sends a test SMS and shows the result', async () => {
    const fetchMock = smsPage(OWNER, {
      'POST /api/admin/sms/test': (url, init) => ({
        status: 201,
        body: { message: { id: 40, order: null, event: null, to: '+8801712345678', body: JSON.parse(init.body).body ?? 'Test', status: 'sent', error: null, segments: 1, encoding: 'gsm' } },
      }),
    })
    const user = userEvent.setup()
    const test = within(await screen.findByRole('form', { name: 'Send a test SMS' }))
    expect(test.getByText(/saved in the SMS log and the dev SMS inbox, not sent to a phone/)).toBeInTheDocument()
    await user.type(test.getByLabelText('Mobile number'), '02-9876543')
    await user.click(test.getByRole('button', { name: 'Send test SMS' }))
    expect(test.getByLabelText('Mobile number')).toHaveAccessibleDescription(/Enter a Bangladeshi mobile number, like 01712345678\./)
    expect(callsTo(fetchMock, 'POST', '/api/admin/sms/test')).toHaveLength(0)

    await user.clear(test.getByLabelText('Mobile number'))
    await user.type(test.getByLabelText('Mobile number'), '01712 345678')
    await user.type(test.getByLabelText('Text (optional)'), 'অর্ডার')
    expect(test.getByLabelText('Text (optional)')).toHaveAccessibleDescription('Unicode (Bangla): 1 SMS · 6 characters')
    await user.click(test.getByRole('button', { name: 'Send test SMS' }))
    expect(await test.findByText('Test SMS sent to +8801712345678 (saved only: test mode).')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/sms/test')).toEqual({ to: '01712 345678', body: 'অর্ডার' })
  })

  it('reports a failed test send in words', async () => {
    smsPage(OWNER, {
      'POST /api/admin/sms/test': { status: 201, body: { message: { id: 41, to: '+8801712345678', status: 'failed', error: 'Provider said: invalid sender id' } } },
    })
    const user = userEvent.setup()
    const test = within(await screen.findByRole('form', { name: 'Send a test SMS' }))
    await user.type(test.getByLabelText('Mobile number'), '01712345678')
    await user.click(test.getByRole('button', { name: 'Send test SMS' }))
    expect(await test.findByRole('alert')).toHaveTextContent('The test SMS to +8801712345678 failed: Provider said: invalid sender id')
  })

  it('is read-only without settings.edit: no Save, no test send, templates readable', async () => {
    smsPage(VIEWER)
    const user = userEvent.setup()
    const form = within(await screen.findByRole('form', { name: 'SMS settings' }))
    expect(form.getByRole('switch', { name: 'SMS notifications' })).toBeDisabled()
    expect(form.queryByRole('button', { name: 'Save SMS settings' })).not.toBeInTheDocument()
    expect(form.getByText('Your role can view these settings but not change them.')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Send a test SMS' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open the SMS log' })).not.toBeInTheDocument()
    // Still able to read each template.
    await user.click(form.getByRole('tab', { name: 'বাংলা' }))
    expect(form.getByRole('textbox', { name: 'Order placed text (Bangla)' })).toHaveAttribute('readonly')
    expect(form.queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument()
  })
})

const MESSAGES = {
  messages: [
    {
      id: 31, order: { number: 'BN-100042' }, event: 'order_shipped', to: '+8801712345678', body: 'BuyNest: order BN-100042 is on its way', locale: 'en', segments: 1, encoding: 'gsm',
      provider: 'bulksmsbd', status: 'failed', error: 'Provider said: invalid sender', attempts: 2, sentAt: null, createdAt: '2026-11-27T09:00:00Z',
    },
    {
      id: 30, order: null, event: null, to: '+8801812345678', body: 'BuyNest: পরীক্ষা', locale: 'bn', segments: 1, encoding: 'unicode',
      provider: 'log', status: 'sent', error: null, attempts: 1, sentAt: '2026-11-27T08:00:00Z', createdAt: '2026-11-27T08:00:00Z',
    },
  ],
  total: 2,
  live: true,
}

function logPage(me = OWNER, extra = {}, route = '/sms') {
  withSession()
  const fetchMock = mockFetch({
    'GET /api/admin/me': { body: me },
    'GET /api/catalog/store': { body: { data: {} } },
    'GET /api/admin/sms/messages': { body: MESSAGES },
    ...extra,
  })
  renderApp(route)
  return fetchMock
}

describe('Sales → SMS log', () => {
  it('lists the texts: time, phone, order link, text, status in words, parts, error', async () => {
    logPage()
    const table = await screen.findByRole('table', { name: 'Texts, newest first' })
    const [, failed, test] = within(table).getAllByRole('row')
    expect(within(failed).getByRole('link', { name: 'BN-100042' })).toHaveAttribute('href', '/orders/BN-100042')
    expect(failed).toHaveTextContent('Order shipped')
    expect(failed).toHaveTextContent('Failed')
    expect(failed).toHaveTextContent('2 attempts')
    expect(failed).toHaveTextContent('Provider said: invalid sender')
    expect(test).toHaveTextContent('Test message')
    expect(test).toHaveTextContent('Sent')
    expect(test).toHaveTextContent('1 · Unicode')
    // Retry only on the failed row.
    expect(within(failed).getByRole('button', { name: 'Retry the Order shipped text to +8801712345678' })).toBeInTheDocument()
    expect(within(test).queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'SMS settings' })).toHaveAttribute('href', '/settings/sms')
  })

  it('filters by status and text, and searches', async () => {
    const fetchMock = logPage()
    const user = userEvent.setup()
    await screen.findByRole('table', { name: 'Texts, newest first' })
    await user.selectOptions(screen.getByLabelText('Status'), 'failed')
    await user.selectOptions(screen.getByLabelText('Text'), 'order_shipped')
    await user.type(screen.getByRole('searchbox', { name: 'Search texts' }), '1712')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(lastQuery(fetchMock, '/api/admin/sms/messages')?.get('q')).toBe('1712'))
    const query = lastQuery(fetchMock, '/api/admin/sms/messages')
    expect(query.get('status')).toBe('failed')
    expect(query.get('event')).toBe('order_shipped')
    await user.selectOptions(screen.getByLabelText('Text'), 'test')
    await waitFor(() => expect(lastQuery(fetchMock, '/api/admin/sms/messages')?.get('event')).toBe('test'))
  })

  it('retries a failed text and says how it went', async () => {
    const fetchMock = logPage(OWNER, {
      'POST /api/admin/sms/messages/31/retry': { body: { message: { ...MESSAGES.messages[0], status: 'sent', error: null, attempts: 3 } } },
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Retry the Order shipped text to +8801712345678' }))
    expect(await screen.findByText('Text sent again to +8801712345678.')).toHaveFocus()
    expect(callsTo(fetchMock, 'POST', '/api/admin/sms/messages/31/retry')).toHaveLength(1)
    // The list is asked again.
    await waitFor(() => expect(callsTo(fetchMock, 'GET', '/api/admin/sms/messages').length).toBeGreaterThan(1))
  })

  it('says why the API refused a retry', async () => {
    logPage(OWNER, {
      'POST /api/admin/sms/messages/31/retry': { status: 422, body: { message: 'Please check the highlighted fields.', errors: { message: ['This text was already tried 5 times.'] } } },
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Retry the Order shipped text to +8801712345678' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This text was already tried 5 times.')
  })

  it('has no Retry without orders.edit, and an empty state', async () => {
    logPage(SALES, { 'GET /api/admin/sms/messages': { body: { messages: [], total: 0 } } })
    expect(await screen.findByText('No texts sent yet. Turn SMS on under Settings → SMS.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'SMS settings' })).not.toBeInTheDocument()
  })
})

const ADDRESS = { firstName: 'Nadia', lastName: 'Rahman', line1: 'House 4', city: 'Dhaka', postalCode: '1216', country: 'Bangladesh', phone: '+8801712345678' }
const ORDER = {
  id: 'BN-100042', number: 'BN-100042', currency: 'BDT', status: 'processing', paymentStatus: 'unpaid', paymentMethod: 'cod',
  shippingMethod: { id: 'standard', label: 'Standard', eta: 'Delivery in 1–2 days' }, email: 'nadia@example.com', phone: '+8801712345678',
  shippingAddress: ADDRESS, billingAddress: ADDRESS, couponCode: null,
  customer: { id: 5, guest: false, firstName: 'Nadia', lastName: 'Rahman', email: 'nadia@example.com' },
  lines: [{ id: 1, sku: 'BEA-1', title: 'Mascara', thumbnail: 't.webp', price: 1000, quantity: 1, discountedTotal: 1000 }],
  totals: { itemCount: 1, subtotal: 1000, discount: 0, shipping: 60, tax: 0, total: 1060, refunded: 0 }, items: 1, placedAt: '2026-11-25T09:00:00Z',
  invoices: [], creditMemos: [], shipments: [{ number: 'SHP-1', carrier: 'redx', trackingNumber: 'R1', createdAt: '2026-11-26T09:00:00Z' }], history: [], payment: { provider: null, paidAt: null, url: null, canPay: false },
  sms: [
    { id: 30, event: 'order_placed', status: 'sent', to: '+8801712345678', sentAt: '2026-11-25T09:00:10Z', createdAt: '2026-11-25T09:00:00Z', error: null },
    { id: 31, event: 'order_shipped', status: 'failed', to: '+8801712345678', sentAt: null, createdAt: '2026-11-26T09:00:00Z', error: 'Provider said: invalid sender' },
  ],
  live: true,
}

function orderPage(order, me = OWNER, extra = {}) {
  withSession()
  const fetchMock = mockFetch({
    'GET /api/admin/me': { body: me },
    'GET /api/catalog/store': { body: { data: {} } },
    'GET /api/admin/orders/BN-100042': { body: order },
    ...extra,
  })
  renderApp('/orders/BN-100042')
  return fetchMock
}

describe('the order page’s SMS panel', () => {
  it('lists the texts with their status in words, and retries a failed one', async () => {
    const fetchMock = orderPage(ORDER, OWNER, {
      'POST /api/admin/sms/messages/31/retry': { body: { message: { id: 31, to: '+8801712345678', status: 'sent', event: 'order_shipped' } } },
    })
    const user = userEvent.setup()
    const panel = within(await screen.findByRole('region', { name: 'SMS' }))
    const items = within(panel.getByRole('list', { name: 'SMS' })).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Order placed')
    expect(items[0]).toHaveTextContent('Sent')
    expect(items[0]).toHaveTextContent('+8801712345678')
    expect(items[1]).toHaveTextContent('Order shipped')
    expect(items[1]).toHaveTextContent('Failed')
    expect(items[1]).toHaveTextContent('Provider said: invalid sender')
    expect(within(items[0]).queryByRole('button')).not.toBeInTheDocument()
    expect(panel.getByRole('link', { name: 'Texts for this order in the SMS log' })).toHaveAttribute('href', '/sms?q=BN-100042')

    await user.click(within(items[1]).getByRole('button', { name: 'Retry the Order shipped text' }))
    expect(await panel.findByText('Text sent again to +8801712345678.')).toBeInTheDocument()
    expect(callsTo(fetchMock, 'POST', '/api/admin/sms/messages/31/retry')).toHaveLength(1)
  })

  it('says when there are none', async () => {
    orderPage({ ...ORDER, sms: [] }, SALES)
    const panel = within(await screen.findByRole('region', { name: 'SMS' }))
    expect(panel.getByText('No texts for this order.')).toBeInTheDocument()
  })

  it('hides Retry from roles without orders.edit', async () => {
    orderPage(ORDER, SALES)
    const panel = within(await screen.findByRole('region', { name: 'SMS' }))
    expect(panel.getByText('Failed')).toBeInTheDocument()
    expect(panel.queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument()
  })

  it('has no panel when the API sends no texts list (before phase 20)', async () => {
    const { sms, ...old } = ORDER
    void sms
    orderPage(old)
    expect(await screen.findByRole('region', { name: 'History' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'SMS' })).not.toBeInTheDocument()
  })
})
