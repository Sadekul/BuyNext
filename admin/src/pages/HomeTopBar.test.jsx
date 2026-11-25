import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'
import { toTopBar, topBarErrors, topBarForm } from '../utils/homeTopBar'

/*
 * Phase 17 §2 (docs/backend/PHASE17_CONTRACT.md): Content → Home page →
 * "Top promo strip": show it, the message (English and Bangla), an optional
 * coupon code; checks before saving, the API's errors on the right field,
 * always sent with the home page, and the read-only view.
 */

vi.mock('../api/mode', () => ({ LIVE_DATA: true }))

const OWNER = { ...ADMIN, id: 1, name: 'Store Owner', role: { id: 1, name: 'Owner' }, permissions: ['content.view', 'content.edit'] }
const VIEWER = { ...ADMIN, id: 3, name: 'Vera Viewer', role: { id: 3, name: 'Viewer' }, permissions: ['content.view'] }
const sentTo = (fetchMock, method, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => init?.method === method && new URL(url).pathname === path)
  return call && JSON.parse(call[1].body)
}

const HERO = { eyebrow: '', title: 'Hello', description: '', primaryCta: { label: 'Shop', url: '/products' }, secondaryCta: null, imageUrl: '', imageAlt: '', highlights: [] }
const BAR = { enabled: true, message: 'Free delivery over ৳999', messageBn: '', couponCode: 'EID10' }
const home = (extra = {}) => ({ hero: HERO, banners: [], featuredProductIds: [], featuredProducts: [], heroMode: 'banner', slides: [], slider: { autoplay: true, intervalSeconds: 6 }, topBar: BAR, ...extra })

function setup(saved, { me = OWNER, put } = {}) {
  withSession()
  const fetchMock = mockFetch({
    'GET /api/admin/me': { body: me },
    'GET /api/admin/home': { body: saved },
    'PUT /api/admin/home': put ?? ((url, init) => ({ body: { home: { ...saved, ...JSON.parse(init.body) } } })),
  })
  renderApp('/home-page')
  return fetchMock
}

describe('the top promo strip', () => {
  it('shows the saved strip and saves the edits with the home page (code upper case, Bangla marked as Bangla)', async () => {
    const fetchMock = setup(home())
    const user = userEvent.setup()
    expect(await screen.findByRole('heading', { name: 'Top promo strip' })).toBeInTheDocument()
    const show = screen.getByRole('checkbox', { name: 'Show the top promo strip' })
    expect(show).toBeChecked()
    expect(show).toHaveAccessibleDescription(/above the store’s header/)
    expect(screen.getByLabelText('Message')).toHaveValue('Free delivery over ৳999')
    const bangla = screen.getByLabelText('Message in Bangla')
    expect(bangla).toHaveAttribute('lang', 'bn')
    expect(bangla).toHaveAccessibleDescription(/Falls back to English.*“Free delivery over ৳999”/)
    const code = screen.getByLabelText('Coupon code (optional)')
    expect(code).toHaveValue('EID10')
    expect(code).toHaveAccessibleDescription(/only while the coupon is active/)

    await user.clear(screen.getByLabelText('Message'))
    await user.type(screen.getByLabelText('Message'), ' Eid sale: 10% off ')
    await user.type(bangla, 'ঈদ সেল')
    await user.clear(code)
    await user.type(code, 'eid-2026')
    expect(code).toHaveValue('EID-2026')
    await user.click(screen.getByRole('button', { name: 'Save home page' }))
    expect(await screen.findByText(/Home page saved/)).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PUT', '/api/admin/home').topBar).toEqual({ enabled: true, message: 'Eid sale: 10% off', messageBn: 'ঈদ সেল', couponCode: 'EID-2026' })
  }, 15_000) // typing into the full home form is slow in jsdom

  it('an API without the strip: hidden and empty, and it is still sent (hidden) on save', async () => {
    const saved = home()
    delete saved.topBar
    const fetchMock = setup(saved)
    const user = userEvent.setup()
    expect(await screen.findByRole('checkbox', { name: 'Show the top promo strip' })).not.toBeChecked()
    expect(screen.getByLabelText('Message')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Save home page' }))
    expect(await screen.findByText(/Home page saved/)).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PUT', '/api/admin/home').topBar).toEqual({ enabled: false, message: '', messageBn: '', couponCode: '' })
  })

  it('needs a message when shown, and a code in the coupon format, before saving', async () => {
    const fetchMock = setup(home({ topBar: { enabled: false, message: '', messageBn: '', couponCode: '' } }))
    const user = userEvent.setup()
    await user.click(await screen.findByRole('checkbox', { name: 'Show the top promo strip' }))
    await user.type(screen.getByLabelText('Coupon code (optional)'), 'no way')
    await user.click(screen.getByRole('button', { name: 'Save home page' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Please check the highlighted fields.')
    expect(screen.getByLabelText('Message')).toBeInvalid()
    expect(screen.getByLabelText('Message')).toHaveAccessibleDescription(/Write the promo message, or turn the promo strip off\./)
    expect(screen.getByLabelText('Coupon code (optional)')).toHaveAccessibleDescription(/This coupon doesn't exist or isn't active\./)
    expect(sentTo(fetchMock, 'PUT', '/api/admin/home')).toBeUndefined()

    // Hidden again with no code: an empty message is fine (kept for later).
    await user.click(screen.getByRole('checkbox', { name: 'Show the top promo strip' }))
    await user.clear(screen.getByLabelText('Coupon code (optional)'))
    await user.click(screen.getByRole('button', { name: 'Save home page' }))
    expect(await screen.findByText(/Home page saved/)).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PUT', '/api/admin/home').topBar).toEqual({ enabled: false, message: '', messageBn: '', couponCode: '' })
  })

  it("shows the API's errors on the right fields (a coupon that isn't active)", async () => {
    setup(home(), {
      put: () => ({
        status: 422,
        body: { message: 'Please check the highlighted fields.', errors: { 'topBar.couponCode': ["This coupon doesn't exist or isn't active."], 'topBar.messageBn': ['Use up to 120 characters.'], 'topBar.message': ['Enter a message.'] } },
      }),
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Save home page' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Please check the highlighted fields.')
    expect(screen.getByLabelText('Coupon code (optional)')).toHaveAccessibleDescription(/This coupon doesn't exist or isn't active\./)
    expect(screen.getByLabelText('Coupon code (optional)')).toBeInvalid()
    expect(screen.getByLabelText('Message in Bangla')).toHaveAccessibleDescription(/Use up to 120 characters\./)
    expect(screen.getByLabelText('Message')).toHaveAccessibleDescription(/Enter a message\./)
  })

  it('a viewer (content.view only) sees the strip read-only', async () => {
    setup(home(), { me: VIEWER })
    expect(await screen.findByRole('checkbox', { name: 'Show the top promo strip' })).toBeDisabled()
    expect(screen.getByLabelText('Message')).toBeDisabled()
    expect(screen.getByLabelText('Message in Bangla')).toBeDisabled()
    expect(screen.getByLabelText('Coupon code (optional)')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save home page' })).not.toBeInTheDocument()
  })
})

describe('homeTopBar helpers', () => {
  it('form values, checks, and what is sent', () => {
    expect(topBarForm(undefined)).toEqual({ enabled: false, message: '', messageBn: '', couponCode: '' })
    expect(topBarForm({ enabled: true, message: 'Hi', messageBn: null, couponCode: null })).toEqual({ enabled: true, message: 'Hi', messageBn: '', couponCode: '' })
    expect(topBarErrors({ enabled: true, message: ' ', messageBn: '', couponCode: '' })).toEqual({ 'topBar.message': ['Write the promo message, or turn the promo strip off.'] })
    expect(topBarErrors({ enabled: false, message: 'x'.repeat(121), messageBn: 'ক'.repeat(121), couponCode: 'AB' })).toEqual({
      'topBar.message': ['Use up to 120 characters.'],
      'topBar.messageBn': ['Use up to 120 characters.'],
      'topBar.couponCode': ["This coupon doesn't exist or isn't active."],
    })
    expect(topBarErrors({ enabled: true, message: 'x'.repeat(120), messageBn: '', couponCode: 'save_10' })).toEqual({})
    expect(toTopBar({ enabled: true, message: ' Hi ', messageBn: ' হাই ', couponCode: ' eid10 ' })).toEqual({ enabled: true, message: 'Hi', messageBn: 'হাই', couponCode: 'EID10' })
  })
})
