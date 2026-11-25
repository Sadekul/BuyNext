// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'
import { validateHome } from './adminSystemApi'

/*
 * Home page: single banner or slider (docs/backend/HOME_SLIDER_CONTRACT.md §2):
 * GET/PUT /api/admin/home carry heroMode, slides[] and slider in camelCase,
 * checked like the banners, with errors by path ("slides.0.title").
 * Laravel is faked; shapes from the contract.
 */

const SITE = 'https://shop.example'
const ME = { id: 1, name: 'Store Owner', email: 'admin@buynest.test', role: { id: 1, name: 'Owner' }, permissions: [] }

function fakeLaravel(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname, search } = new URL(url)
    const entry = { method: init.method ?? 'GET', path: pathname, search, body: init.body }
    calls.push(entry)
    const key = `${entry.method} ${pathname}`
    const found = key === 'GET /api/admin/v1/me' ? { body: { data: ME } } : routes[key]
    const route = typeof found === 'function' ? found(entry) : (found ?? { status: 404, body: { message: 'Not found' } })
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}

function admin(action, { method = 'GET', body } = {}) {
  return handleApiRequest(
    new Request(`${SITE}/api/admin/${action}`, {
      method,
      headers: { 'Sec-Fetch-Site': 'same-origin', Cookie: 'buynest_admin_at=9|ADMIN', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  )
}
const sent = (entry) => JSON.parse(entry.body)
const toApi = (calls) => calls.filter((entry) => entry.path !== '/api/admin/v1/me')

beforeEach(() => {
  vi.stubEnv('VITE_ACCOUNTS_BACKEND', 'laravel')
  vi.stubEnv('VITE_API_PROVIDER', 'laravel')
  vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const HERO = { eyebrow: '', title: 'Hello', description: '', primary_cta: { label: 'Shop', url: '/products' }, secondary_cta: null, image_url: '', image_alt: '', highlights: [] }
const API_SLIDE = {
  id: 'slide-laptops',
  eyebrow: 'New',
  title: 'Laptops',
  description: 'Fast ones',
  primary_cta: { label: 'Shop laptops', url: '/category/laptops' },
  secondary_cta: null,
  image_url: 'https://cdn.dummyjson.com/laptop.png',
  image_alt: 'A laptop',
  tone: 'emerald',
  is_active: true,
  position: 1,
  bn: { eyebrow: null, title: 'ল্যাপটপ', description: null, primary_cta_label: 'কিনুন', secondary_cta_label: null, image_alt: null },
}
const API_HOME = {
  hero: HERO,
  banners: [],
  featured_product_ids: [],
  hero_mode: 'slider',
  slides: [API_SLIDE, { ...API_SLIDE, id: 'slide-first', title: 'First', position: 0, is_active: false, tone: 'pink', bn: null }],
  slider: { autoplay: false, interval_seconds: 9 },
}
const SLIDE = { id: 'slide-a', eyebrow: '', title: 'Sale', description: '', primaryCta: { label: 'Shop', url: '/deals' }, secondaryCta: null, imageUrl: '', imageAlt: '', tone: 'navy', isActive: true }
const BODY = { hero: { title: 'Hello', primaryCta: { label: 'Shop', url: '/products' }, highlights: [] }, banners: [], featuredProductIds: [] }

describe('GET /api/admin/home: the slider', () => {
  it('maps heroMode, the slides by position (Bangla in bn), and the slider settings', async () => {
    fakeLaravel({ 'GET /api/admin/v1/home': { body: { data: API_HOME } } })
    const home = await (await admin('home')).json()
    expect(home.heroMode).toBe('slider')
    expect(home.slider).toEqual({ autoplay: false, intervalSeconds: 9 })
    expect(home.slides.map((slide) => slide.title)).toEqual(['First', 'Laptops'])
    expect(home.slides[1]).toEqual({
      id: 'slide-laptops',
      eyebrow: 'New',
      title: 'Laptops',
      description: 'Fast ones',
      primaryCta: { label: 'Shop laptops', url: '/category/laptops' },
      secondaryCta: null,
      imageUrl: 'https://cdn.dummyjson.com/laptop.png',
      imageAlt: 'A laptop',
      tone: 'emerald',
      position: 1,
      isActive: true,
      bn: { eyebrow: '', title: 'ল্যাপটপ', description: '', primaryCtaLabel: 'কিনুন', secondaryCtaLabel: '', imageAlt: '' },
    })
    // Unknown tone → navy; bn: null → empty Bangla texts.
    expect(home.slides[0]).toMatchObject({ isActive: false, tone: 'navy', bn: { title: '', primaryCtaLabel: '' } })
  })

  it('older stored content: single banner, no slides, default slider settings', async () => {
    fakeLaravel({ 'GET /api/admin/v1/home': { body: { data: { hero: HERO, banners: [], featured_product_ids: [] } } } })
    const home = await (await admin('home')).json()
    expect(home).toMatchObject({ heroMode: 'banner', slides: [], slider: { autoplay: true, intervalSeconds: 6 } })
  })
})

describe('PUT /api/admin/home: the slider', () => {
  it('sends hero_mode, the slides in list order as positions (Bangla in bn), and the slider settings in API names', async () => {
    const calls = fakeLaravel({ 'PUT /api/admin/v1/home': { body: { data: API_HOME } } })
    const response = await admin('home', {
      method: 'PUT',
      body: {
        ...BODY,
        heroMode: 'slider',
        slides: [
          { ...SLIDE, title: ' Sale ', secondaryCta: { label: 'More', url: 'https://example.com/more' }, imageUrl: 'https://cdn.example/sale.png', imageAlt: 'Sale', tone: 'rose', bn: { title: ' সেল ', primaryCtaLabel: '', imageAlt: 'সেল' } },
          { ...SLIDE, id: null, title: 'Second', primaryCta: { label: '', url: '' }, isActive: false },
        ],
        slider: { autoplay: true, intervalSeconds: 5 },
      },
    })
    expect(response.status).toBe(200)
    const body = sent(toApi(calls)[0])
    expect(body.hero_mode).toBe('slider')
    expect(body.slider).toEqual({ autoplay: true, interval_seconds: 5 })
    expect(body.slides).toEqual([
      {
        id: 'slide-a',
        eyebrow: '',
        title: 'Sale',
        description: '',
        primary_cta: { label: 'Shop', url: '/deals' },
        secondary_cta: { label: 'More', url: 'https://example.com/more' },
        image_url: 'https://cdn.example/sale.png',
        image_alt: 'Sale',
        tone: 'rose',
        position: 0,
        is_active: true,
        bn: { title: 'সেল', primary_cta_label: null, image_alt: 'সেল' },
      },
      { eyebrow: '', title: 'Second', description: '', primary_cta: null, secondary_cta: null, image_url: '', image_alt: '', tone: 'navy', position: 1, is_active: false },
    ])
    const { home } = await response.json()
    expect(home).toMatchObject({ heroMode: 'slider', slider: { intervalSeconds: 9 } })
  })

  it('an older client (no heroMode, slides, slider) sends none of them', async () => {
    const calls = fakeLaravel({ 'PUT /api/admin/v1/home': { body: { data: { hero: HERO, banners: [], featured_product_ids: [] } } } })
    expect((await admin('home', { method: 'PUT', body: BODY })).status).toBe(200)
    const body = sent(toApi(calls)[0])
    expect(body).not.toHaveProperty('hero_mode')
    expect(body).not.toHaveProperty('slides')
    expect(body).not.toHaveProperty('slider')
  })

  it('checks every slide field like the banners, errors by path, before any call', async () => {
    const calls = fakeLaravel({})
    const response = await admin('home', {
      method: 'PUT',
      body: {
        ...BODY,
        heroMode: 'carousel',
        slides: [
          { ...SLIDE, title: '  ', primaryCta: { label: 'Go', url: 'javascript:alert(1)' }, secondaryCta: { label: '', url: '/x' }, tone: 'pink', bn: { title: 'ক'.repeat(121) } },
          { ...SLIDE, imageUrl: '/images/local.png' },
          { ...SLIDE, imageUrl: 'https://cdn.example/a.png', imageAlt: '' },
          { ...SLIDE, primaryCta: { label: 'Go', url: '' }, imageAlt: 'x'.repeat(161) },
        ],
        slider: { autoplay: 'yes', intervalSeconds: 2 },
      },
    })
    expect(response.status).toBe(422)
    const { errors } = await response.json()
    expect(errors).toMatchObject({
      heroMode: ['Choose a single banner or a slider.'],
      'slides.0.title': ['Enter up to 120 characters.'],
      'slides.0.primaryCta.url': ['Use a store path like /products or an https:// address.'],
      'slides.0.secondaryCta.label': [expect.any(String)],
      'slides.0.tone': ['Choose a color.'],
      'slides.0.bn.title': ['Keep this under 120 characters.'],
      'slides.1.imageUrl': ['Use an https:// image address.'],
      'slides.2.imageAlt': ['Describe the image for people who cannot see it.'],
      'slides.3.primaryCta.url': ['Enter where the button goes.'],
      'slides.3.imageAlt': ['Keep this under 160 characters.'],
      'slider.autoplay': [expect.any(String)],
      'slider.intervalSeconds': ['Choose 3 to 15 seconds.'],
    })
    expect(toApi(calls)).toEqual([])
  })

  it('up to 8 slides; slider mode needs an active slide', () => {
    expect(validateHome({ ...BODY, slides: Array.from({ length: 9 }, () => SLIDE) }).errors.slides).toEqual(['Use up to 8 slides.'])
    expect(validateHome({ ...BODY, heroMode: 'slider', slides: [{ ...SLIDE, isActive: false }] }).errors.slides).toEqual(['Add at least one active slide, or show the single banner instead.'])
    expect(validateHome({ ...BODY, heroMode: 'slider', slides: [] }).errors.slides).toBeDefined()
    // Banner mode: inactive or no slides are fine (kept for later).
    expect(validateHome({ ...BODY, heroMode: 'banner', slides: [{ ...SLIDE, isActive: false }] }).errors).toBeUndefined()
    expect(validateHome({ ...BODY, slider: { intervalSeconds: 15 } }).values.slider).toEqual({ autoplay: true, intervalSeconds: 15 })
    expect(validateHome({ ...BODY, slider: { intervalSeconds: 3.5 } }).errors['slider.intervalSeconds']).toBeDefined()
    expect(validateHome({ ...BODY, slider: [] }).errors.slider).toBeDefined()
  })

  it("the API's 422 comes back with camelCase paths for the right fields", async () => {
    fakeLaravel({
      'PUT /api/admin/v1/home': {
        status: 422,
        body: { message: 'The given data was invalid.', errors: { 'slides.0.title': ['Enter a title.'], 'slides.1.primary_cta.url': ['Bad link.'], 'slides.0.bn.primary_cta_label': ['Too long.'], 'slider.interval_seconds': ['3 to 15.'], hero_mode: ['Pick one.'] } },
      },
    })
    const response = await admin('home', { method: 'PUT', body: { ...BODY, heroMode: 'slider', slides: [SLIDE, SLIDE] } })
    expect(response.status).toBe(422)
    expect(Object.keys((await response.json()).errors).sort()).toEqual(['heroMode', 'slider.intervalSeconds', 'slides.0.bn.primaryCtaLabel', 'slides.0.title', 'slides.1.primaryCta.url'])
  })
})

/*
 * Phase 17 §2 (docs/backend/PHASE17_CONTRACT.md): the top promo strip,
 * top_bar { enabled, message, message_bn, coupon_code } ↔ topBar { enabled, message, messageBn, couponCode }.
 */
describe('the top promo strip (Phase 17)', () => {
  it('GET maps top_bar to topBar (strings for the form); none stored → hidden and empty', async () => {
    fakeLaravel({ 'GET /api/admin/v1/home': { body: { data: { ...API_HOME, top_bar: { enabled: true, message: 'Free delivery over ৳999', message_bn: '৯৯৯ টাকার বেশি অর্ডারে ফ্রি ডেলিভারি', coupon_code: 'EID10' } } } } })
    expect((await (await admin('home')).json()).topBar).toEqual({ enabled: true, message: 'Free delivery over ৳999', messageBn: '৯৯৯ টাকার বেশি অর্ডারে ফ্রি ডেলিভারি', couponCode: 'EID10' })

    fakeLaravel({ 'GET /api/admin/v1/home': { body: { data: { ...API_HOME, top_bar: { enabled: false, message: 'Old', message_bn: null, coupon_code: null } } } } })
    expect((await (await admin('home')).json()).topBar).toEqual({ enabled: false, message: 'Old', messageBn: '', couponCode: '' })

    fakeLaravel({ 'GET /api/admin/v1/home': { body: { data: { hero: HERO, banners: [], featured_product_ids: [] } } } })
    expect((await (await admin('home')).json()).topBar).toEqual({ enabled: false, message: '', messageBn: '', couponCode: '' })
  })

  it('PUT sends top_bar trimmed, the code upper case, empty Bangla and code as null; the answer is mapped back', async () => {
    const calls = fakeLaravel({ 'PUT /api/admin/v1/home': { body: { data: { ...API_HOME, top_bar: { enabled: true, message: 'Eid sale', message_bn: null, coupon_code: 'EID10' } } } } })
    const response = await admin('home', { method: 'PUT', body: { ...BODY, topBar: { enabled: true, message: ' Eid sale ', messageBn: '  ', couponCode: ' eid10 ' } } })
    expect(response.status).toBe(200)
    expect(sent(toApi(calls)[0]).top_bar).toEqual({ enabled: true, message: 'Eid sale', message_bn: null, coupon_code: 'EID10' })
    expect((await response.json()).home.topBar).toEqual({ enabled: true, message: 'Eid sale', messageBn: '', couponCode: 'EID10' })
  })

  it('a hidden strip may keep an empty message; an older client sends no top_bar (the API keeps it)', async () => {
    const calls = fakeLaravel({ 'PUT /api/admin/v1/home': { body: { data: API_HOME } } })
    await admin('home', { method: 'PUT', body: { ...BODY, topBar: { enabled: false, message: '', messageBn: 'বাংলা', couponCode: '' } } })
    expect(sent(toApi(calls)[0]).top_bar).toEqual({ enabled: false, message: '', message_bn: 'বাংলা', coupon_code: null })
    await admin('home', { method: 'PUT', body: BODY })
    expect(sent(toApi(calls)[1])).not.toHaveProperty('top_bar')
  })

  it('checks the strip before any call, errors by path', async () => {
    const calls = fakeLaravel({})
    const response = await admin('home', { method: 'PUT', body: { ...BODY, topBar: { enabled: true, message: '  ', messageBn: 'ক'.repeat(121), couponCode: 'NO SPACES' } } })
    expect(response.status).toBe(422)
    expect((await response.json()).errors).toEqual({
      'topBar.message': ['Write the promo message, or turn the promo strip off.'],
      'topBar.messageBn': ['Use up to 120 characters.'],
      'topBar.couponCode': ["This coupon doesn't exist or isn't active."],
    })
    expect(toApi(calls)).toEqual([])

    expect(validateHome({ ...BODY, topBar: { enabled: false, message: 'x'.repeat(121) } }).errors).toEqual({ 'topBar.message': ['Use up to 120 characters.'] })
    expect(validateHome({ ...BODY, topBar: { enabled: 'yes', message: 'Hi' } }).errors['topBar.enabled']).toBeDefined()
    expect(validateHome({ ...BODY, topBar: { enabled: true, message: 42 } }).errors['topBar.message']).toEqual(['Enter text.'])
    expect(validateHome({ ...BODY, topBar: 'on' }).errors.topBar).toBeDefined()
    expect(validateHome({ ...BODY, topBar: { enabled: true, message: 'x'.repeat(120), couponCode: 'AB' } }).errors).toEqual({ 'topBar.couponCode': [expect.any(String)] })
    expect(validateHome({ ...BODY, topBar: { enabled: true, message: 'x'.repeat(120), messageBn: null, couponCode: null } }).values.topBar).toEqual({ enabled: true, message: 'x'.repeat(120), messageBn: null, couponCode: null })
  })

  it("the API's 422 (an inactive coupon, a long message) comes back on topBar.* paths", async () => {
    fakeLaravel({
      'PUT /api/admin/v1/home': {
        status: 422,
        body: { message: 'The given data was invalid.', errors: { 'top_bar.coupon_code': ["This coupon doesn't exist or isn't active."], 'top_bar.message_bn': ['Too long.'], 'top_bar.message': ['Required.'] } },
      },
    })
    const response = await admin('home', { method: 'PUT', body: { ...BODY, topBar: { enabled: true, message: 'Sale', messageBn: '', couponCode: 'OLD10' } } })
    expect(response.status).toBe(422)
    expect((await response.json()).errors).toEqual({ 'topBar.couponCode': ["This coupon doesn't exist or isn't active."], 'topBar.messageBn': ['Too long.'], 'topBar.message': ['Required.'] })
  })
})
