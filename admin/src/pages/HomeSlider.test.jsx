import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'

/*
 * Home page: single banner or slider (docs/backend/HOME_SLIDER_CONTRACT.md §4, §5):
 * the mode switch, adding / editing / moving / deleting slides, the 8-slide
 * limit, the checks before saving, the API's errors on the right field, and
 * the read-only view.
 */

vi.mock('../api/mode', () => ({ LIVE_DATA: true }))

const OWNER = { ...ADMIN, id: 1, name: 'Store Owner', role: { id: 1, name: 'Owner' }, permissions: ['content.view', 'content.edit'] }
const VIEWER = { ...ADMIN, id: 3, name: 'Vera Viewer', role: { id: 3, name: 'Viewer' }, permissions: ['content.view'] }
const sentTo = (fetchMock, method, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => init?.method === method && new URL(url).pathname === path)
  return call && JSON.parse(call[1].body)
}

const HERO = { eyebrow: '', title: 'Hello', description: '', primaryCta: { label: 'Shop', url: '/products' }, secondaryCta: null, imageUrl: '', imageAlt: '', highlights: [] }
const slide = (id, title, extra = {}) => ({
  id,
  eyebrow: '',
  title,
  description: '',
  primaryCta: { label: 'Shop', url: '/products' },
  secondaryCta: null,
  imageUrl: '',
  imageAlt: '',
  tone: 'navy',
  position: 0,
  isActive: true,
  bn: { eyebrow: '', title: '', description: '', primaryCtaLabel: '', secondaryCtaLabel: '', imageAlt: '' },
  ...extra,
})
const home = (extra = {}) => ({ hero: HERO, banners: [], featuredProductIds: [], featuredProducts: [], heroMode: 'banner', slides: [], slider: { autoplay: true, intervalSeconds: 6 }, ...extra })

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

describe('the top of the home page: single banner or slider', () => {
  it('switches to the slider, asks for an active slide, then saves a new slide with its Bangla title', async () => {
    const fetchMock = setup(home())
    const user = userEvent.setup()
    const group = await screen.findByRole('radiogroup', { name: 'Top of the home page' })
    expect(within(group).getByRole('radio', { name: 'Single banner' })).toBeChecked()
    expect(within(group).getByRole('radio', { name: 'Slider' })).toHaveAccessibleDescription(/Up to 8 slides/)
    expect(screen.getByRole('heading', { name: 'Hero' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Slides' })).not.toBeInTheDocument()

    await user.click(within(group).getByRole('radio', { name: 'Slider' }))
    expect(screen.getByRole('heading', { name: 'Slides' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Hero' })).not.toBeInTheDocument() // hidden, kept
    expect(screen.getByRole('button', { name: 'Add slide' })).toHaveAccessibleDescription('0 of 8 slides.')

    await user.click(screen.getByRole('button', { name: 'Save home page' }))
    expect(await screen.findAllByText('Add at least one active slide, or show the single banner instead.')).not.toHaveLength(0)
    expect(sentTo(fetchMock, 'PUT', '/api/admin/home')).toBeUndefined()

    await user.click(screen.getByRole('button', { name: 'Add slide' }))
    await waitFor(() => expect(screen.getByLabelText('Slide 1: Title')).toHaveFocus())
    await user.type(screen.getByLabelText('Slide 1: Title'), 'Eid sale')
    await user.type(screen.getByLabelText('Slide 1: Main button text (optional)'), 'Shop now')
    await user.type(screen.getByLabelText('Slide 1: Main button link'), '/deals')
    await user.type(screen.getByLabelText('Slide 1: Image address'), 'https://cdn.example/eid.png')
    await user.type(screen.getByLabelText('Slide 1: Image description (alt text)'), 'Gift boxes')
    await user.selectOptions(screen.getByLabelText('Slide 1: Color'), 'amber')
    await user.type(screen.getByLabelText('Slide 1: title in Bangla'), 'ঈদ সেল')
    expect(screen.getByRole('group', { name: /Slide 1: Eid sale/ })).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Seconds per slide'))
    await user.type(screen.getByLabelText('Seconds per slide'), '8')
    await user.click(screen.getByRole('checkbox', { name: 'Play automatically' }))

    await user.click(screen.getByRole('button', { name: 'Save home page' }))
    expect(await screen.findByText(/Home page saved/)).toBeInTheDocument()
    const body = sentTo(fetchMock, 'PUT', '/api/admin/home')
    expect(body.heroMode).toBe('slider')
    expect(body.slider).toEqual({ autoplay: false, intervalSeconds: 8 })
    expect(body.slides).toEqual([
      {
        id: null,
        eyebrow: '',
        title: 'Eid sale',
        description: '',
        primaryCta: { label: 'Shop now', url: '/deals' },
        secondaryCta: null,
        imageUrl: 'https://cdn.example/eid.png',
        imageAlt: 'Gift boxes',
        tone: 'amber',
        isActive: true,
        bn: { eyebrow: '', title: 'ঈদ সেল', description: '', primaryCtaLabel: '', secondaryCtaLabel: '', imageAlt: '' },
      },
    ])
    // The hero is saved too (switching back never loses it).
    expect(body.hero).toMatchObject({ title: 'Hello' })
  }, 15_000) // types a whole slide into the full home form (Phase 17 added the promo strip): slow in jsdom

  it('moves and deletes slides (after confirming), keeping focus on the moved slide', async () => {
    const fetchMock = setup(home({ heroMode: 'slider', slides: [slide('slide-a', 'Laptops'), slide('slide-b', 'Scents', { position: 1, isActive: false })] }))
    const user = userEvent.setup()
    expect(await screen.findByRole('radio', { name: 'Slider' })).toBeChecked()
    expect(screen.getByLabelText('Slide 2: Title')).toHaveValue('Scents')
    expect(screen.getByRole('button', { name: 'Move slide 1 up' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Move slide 1 down' }))
    expect(screen.getByText('Laptops moved to position 2 of 2.')).toBeInTheDocument()
    expect(screen.getByLabelText('Slide 1: Title')).toHaveValue('Scents')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move slide 2 up' })).toHaveFocus())

    // Cancel keeps it; confirming deletes it.
    await user.click(screen.getByRole('button', { name: 'Delete slide 1' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete slide 1?' })
    expect(dialog).toHaveTextContent('“Scents” is removed from the slider when you save the home page.')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByLabelText('Slide 2: Title')).toHaveValue('Laptops')
    await user.click(screen.getByRole('button', { name: 'Delete slide 1' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Delete slide 1?' })).getByRole('button', { name: 'Delete slide' }))
    expect(screen.queryByLabelText('Slide 2: Title')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Slide 1: Title')).toHaveValue('Laptops')
    expect(screen.getByText(/Slide 1 \(Scents\) deleted\./)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save home page' }))
    expect(await screen.findByText(/Home page saved/)).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PUT', '/api/admin/home').slides.map((item) => [item.id, item.title, item.isActive])).toEqual([['slide-a', 'Laptops', true]])
  })

  it('holds up to 8 slides: Add slide is then disabled, with the reason', async () => {
    setup(home({ heroMode: 'slider', slides: Array.from({ length: 7 }, (_, index) => slide(`slide-${index}`, `Slide ${index}`, { position: index })) }))
    const user = userEvent.setup()
    const add = await screen.findByRole('button', { name: 'Add slide' })
    expect(add).toHaveAccessibleDescription('7 of 8 slides.')
    await user.click(add)
    expect(screen.getByLabelText('Slide 8: Title')).toBeInTheDocument()
    expect(add).toBeDisabled()
    expect(add).toHaveAccessibleDescription(/8 of 8 slides, the most the slider holds. Delete one to add another./)

  }, 20_000) // 8 slides × 17 fields: role queries on a big form are slow in jsdom

  it('checks the fields before saving and links each message to its field', async () => {
    const fetchMock = setup(home({ heroMode: 'slider', slides: [slide('slide-a', 'Laptops')] }))
    const user = userEvent.setup()
    await user.clear(await screen.findByLabelText('Slide 1: Title'))
    await user.clear(screen.getByLabelText('Slide 1: Main button link'))
    await user.type(screen.getByLabelText('Slide 1: Main button link'), 'javascript:alert(1)')
    await user.type(screen.getByLabelText('Slide 1: Second button link'), '/more')
    await user.type(screen.getByLabelText('Slide 1: Image address'), 'ftp://x/y.png')
    await user.clear(screen.getByLabelText('Seconds per slide'))
    await user.type(screen.getByLabelText('Seconds per slide'), '20')
    await user.click(screen.getByRole('button', { name: 'Save home page' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Please check the highlighted fields.')
    expect(screen.getByLabelText('Slide 1: Title')).toHaveAccessibleDescription('Enter a title.')
    expect(screen.getByLabelText('Slide 1: Title')).toBeInvalid()
    expect(screen.getByLabelText('Slide 1: Main button link')).toHaveAccessibleDescription(/Use a store path like \/products or an https:\/\/ address\./)
    expect(screen.getByLabelText('Slide 1: Second button text (optional)')).toHaveAccessibleDescription('Enter the button text.')
    expect(screen.getByLabelText('Slide 1: Image address')).toHaveAccessibleDescription(/Use an https:\/\/ image address\./)
    expect(screen.getByLabelText('Seconds per slide')).toHaveAccessibleDescription(/Choose 3 to 15 seconds\./)
    expect(sentTo(fetchMock, 'PUT', '/api/admin/home')).toBeUndefined()

    // Only inactive slides in slider mode.
    await user.click(screen.getByRole('checkbox', { name: 'Slide 1: Active (shown in the store)' }))
    expect(screen.getByRole('group', { name: /Slide 1: New slide Inactive/ })).toBeInTheDocument()
  })

  it("shows the API's errors on the right fields, and tells when the problem is in the part not shown", async () => {
    setup(home({ heroMode: 'slider', slides: [slide('slide-a', 'Laptops'), slide('slide-b', 'Scents', { position: 1 })] }), {
      put: () => ({
        status: 422,
        body: { message: 'Please check the highlighted fields.', errors: { 'slides.1.title': ['That title is taken.'], 'slides.0.bn.primaryCtaLabel': ['Keep this under 40 characters.'], 'slider.intervalSeconds': ['Choose 3 to 15 seconds.'], 'hero.title': ['Enter a headline.'] } },
      }),
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Save home page' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The single banner has a problem too: choose “Single banner” to see it.')
    expect(screen.getByLabelText('Slide 2: Title')).toHaveAccessibleDescription('That title is taken.')
    expect(screen.getByLabelText('Slide 1: main button text in Bangla')).toHaveAccessibleDescription(/Keep this under 40 characters\./)
    expect(screen.getByLabelText('Seconds per slide')).toHaveAccessibleDescription(/Choose 3 to 15 seconds\./)
    await user.click(screen.getByRole('radio', { name: 'Single banner' }))
    expect(screen.getByLabelText('Headline')).toHaveAccessibleDescription('Enter a headline.')
  })

  it('a viewer (content.view only) sees the slides read-only', async () => {
    setup(home({ heroMode: 'slider', slides: [slide('slide-a', 'Laptops'), slide('slide-b', 'Scents', { position: 1 })] }), { me: VIEWER })
    expect(await screen.findByRole('radio', { name: 'Slider' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Single banner' })).toBeDisabled()
    expect(screen.getByLabelText('Slide 1: Title')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add slide' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move slide 1 down' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete slide 2' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Play automatically' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save home page' })).not.toBeInTheDocument()
    expect(screen.getByText('Your role can view the home page but not change it.')).toBeInTheDocument()
  })
})
