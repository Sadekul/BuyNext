import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuArrowDown, LuArrowUp, LuPlus, LuSearch, LuTrash2 } from 'react-icons/lu'
import { adminKeys, getHome, getProducts, updateHome } from '../api/admin'
import { useAdminAuth } from '../auth/useAdminAuth'
import Field from '../components/Field'
import PageHeader from '../components/PageHeader'
import { ErrorState, Loading } from '../components/States'
import { formatMoney } from '../utils/format'
// Phase 13 §4: the hero's and banners' Bangla texts.
import BanglaField from '../components/BanglaField'
import { BANNER_BANGLA_FIELDS, HERO_BANGLA_FIELDS, banglaValues, toBangla } from '../utils/bangla'

const TONES = [
  { value: 'navy', label: 'Navy' },
  { value: 'emerald', label: 'Emerald' },
  { value: 'amber', label: 'Amber' },
  { value: 'rose', label: 'Rose' },
]
const MAX_BANNERS = 10
const MAX_FEATURED = 8
const LINK = /^(\/(?!\/)|https?:\/\/)\S*$/i

let nextKey = 0
// A stable React key per banner, so reordering keeps each banner's inputs (and focus) with it.
const withKey = (banner) => ({ ...banner, key: `banner-${nextKey++}` })
const emptyBanner = (bangla = false) =>
  withKey({ id: null, eyebrow: '', title: '', description: '', cta: { label: '', url: '' }, imageUrl: '', imageAlt: '', tone: 'navy', isActive: true, ...(bangla && { bn: banglaValues(null, BANNER_BANGLA_FIELDS) }) })
const heroBangla = (bn) => ({ ...banglaValues(bn, HERO_BANGLA_FIELDS), highlights: [0, 1, 2].map((index) => bn?.highlights?.[index] ?? '') })

/** Phase 13: a "Bangla (বাংলা)" group of fields inside a hero or banner. */
function BanglaGroup({ children }) {
  return (
    <fieldset className="form__fieldset bangla-section">
      <legend>
        Bangla{' '}
        <span lang="bn" className="muted">
          (বাংলা)
        </span>
      </legend>
      <p className="field__hint">Shown when shoppers use the store in Bangla. Empty fields show the English text.</p>
      {children}
    </fieldset>
  )
}

/** Content → Home page: hero, promo banners (ordered), and featured products. Needs content.view; saving content.edit. */
function HomeEditorPage() {
  const home = useQuery({ queryKey: adminKeys.home, queryFn: ({ signal }) => getHome({ signal }) })
  if (home.isPending) return <Loading label="Loading the home page…" />
  if (home.error) return <ErrorState error={home.error} onRetry={home.refetch} />
  return <HomeEditor saved={home.data} />
}

function HomeEditor({ saved }) {
  const queryClient = useQueryClient()
  const { can } = useAdminAuth()
  const editable = can('content.edit')
  const [hero, setHero] = useState(() => ({
    ...saved.hero,
    secondaryCta: saved.hero.secondaryCta ?? { label: '', url: '' },
    highlights: [0, 1, 2].map((index) => saved.hero.highlights[index] ?? ''),
    // Phase 13: only when the API has the Bangla texts.
    ...(saved.hero.bn !== undefined && { bn: heroBangla(saved.hero.bn) }),
  }))
  const bangla = saved.hero.bn !== undefined
  const [banners, setBanners] = useState(() => saved.banners.map((banner) => withKey(bangla ? { ...banner, bn: banglaValues(banner.bn, BANNER_BANGLA_FIELDS) } : banner)))
  const setHeroBn = (field) => (text) => setHero((current) => ({ ...current, bn: { ...current.bn, [field]: text } }))
  const setBannerBn = (banner, field) => (text) => setBanner(banner.key, { bn: { ...banner.bn, [field]: text } })
  const [featured, setFeatured] = useState(() => saved.featuredProductIds.map((id) => saved.featuredProducts.find((product) => product.id === id) ?? { id, title: `Product #${id}` }))
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState(null)
  const [announcement, setAnnouncement] = useState('') // reorder/add/remove, for screen readers
  const noticeRef = useRef(null)
  const buttons = useRef(new Map())

  const setHeroField = (field) => (event) => setHero((current) => ({ ...current, [field]: event.target.value }))
  const setHeroCta = (cta, part) => (event) => setHero((current) => ({ ...current, [cta]: { ...current[cta], [part]: event.target.value } }))
  const setBanner = (key, change) => setBanners((current) => current.map((banner) => (banner.key === key ? { ...banner, ...change } : banner)))

  function moveBanner(index, step) {
    const target = index + step
    if (target < 0 || target >= banners.length) return
    const next = [...banners]
    ;[next[index], next[target]] = [next[target], next[index]]
    setBanners(next)
    setErrors({}) // field errors are numbered by position
    setAnnouncement(`${next[target].title || 'Banner'} moved to position ${target + 1} of ${next.length}.`)
    // Keep focus on the same button of the moved banner (or its other arrow at the ends).
    const direction = step < 0 ? 'up' : 'down'
    requestAnimationFrame(() => {
      const atEnd = (direction === 'up' && target === 0) || (direction === 'down' && target === next.length - 1)
      buttons.current.get(`${next[target].key}-${atEnd ? (direction === 'up' ? 'down' : 'up') : direction}`)?.focus()
    })
  }
  function addBanner() {
    const banner = emptyBanner(bangla)
    setBanners((current) => [...current, banner])
    setAnnouncement(`Banner ${banners.length + 1} added.`)
    requestAnimationFrame(() => document.querySelector(`[data-banner-title="${banner.key}"]`)?.focus())
  }
  function removeBanner(index) {
    setAnnouncement(`${banners[index].title || 'Banner'} removed.`)
    setBanners((current) => current.filter((_, position) => position !== index))
    setErrors({})
  }

  function moveFeatured(index, step) {
    const target = index + step
    if (target < 0 || target >= featured.length) return
    const next = [...featured]
    ;[next[index], next[target]] = [next[target], next[index]]
    setFeatured(next)
    setAnnouncement(`${next[target].title} moved to position ${target + 1}.`)
  }

  const save = useMutation({
    mutationFn: updateHome,
    onSuccess: ({ home }) => {
      queryClient.setQueryData(adminKeys.home, { ...home, live: true })
      setErrors({})
      setNotice({ tone: 'success', text: 'Home page saved. The store shows the changes within a minute.' })
      requestAnimationFrame(() => noticeRef.current?.focus())
    },
    onError: (error) => {
      setErrors(error.fieldErrors ?? {})
      setNotice({ tone: 'error', text: error.fieldErrors ? 'Please check the highlighted fields.' : error.message })
      requestAnimationFrame(() => noticeRef.current?.focus())
    },
  })

  function submit(event) {
    event.preventDefault()
    const found = {}
    if (!hero.title.trim()) found['hero.title'] = ['Enter a headline.']
    for (const [path, value] of [['hero.primaryCta.url', hero.primaryCta.url], ['hero.secondaryCta.url', hero.secondaryCta.url], ['hero.imageUrl', hero.imageUrl]]) {
      if (value && !LINK.test(value)) found[path] = ['Use a store path like /products or an https:// address.']
    }
    banners.forEach((banner, index) => {
      if (!banner.title.trim()) found[`banners.${index}.title`] = ['Enter a title.']
      if (!banner.cta.label.trim()) found[`banners.${index}.cta.label`] = ['Enter the button text.']
      if (!LINK.test(banner.cta.url)) found[`banners.${index}.cta.url`] = ['Use a store path like /products or an https:// address.']
    })
    setErrors(found)
    if (Object.keys(found).length > 0) {
      setNotice({ tone: 'error', text: 'Please check the highlighted fields.' })
      return
    }
    const secondary = hero.secondaryCta.label.trim() || hero.secondaryCta.url.trim() ? hero.secondaryCta : null
    save.mutate({
      hero: {
        ...hero,
        secondaryCta: secondary,
        highlights: hero.highlights.map((text) => text.trim()).filter(Boolean),
        ...(hero.bn && { bn: { ...toBangla(hero.bn, HERO_BANGLA_FIELDS), highlights: hero.bn.highlights.map((text) => text.trim()).filter(Boolean) } }),
      },
      banners: banners.map((banner) => ({
        id: banner.id,
        eyebrow: banner.eyebrow,
        title: banner.title,
        description: banner.description,
        cta: banner.cta,
        imageUrl: banner.imageUrl,
        imageAlt: banner.imageAlt,
        tone: banner.tone,
        isActive: banner.isActive,
        ...(banner.bn && { bn: toBangla(banner.bn, BANNER_BANGLA_FIELDS) }),
      })),
      featuredProductIds: featured.map((product) => product.id),
    })
  }

  const err = (path) => errors[path]?.[0]

  return (
    <>
      <title>Home page | BuyNest Admin</title>
      <PageHeader title="Home page" description="The store's front page: the hero, promo banners, and featured products." />
      <div role={notice?.tone === 'error' ? 'alert' : 'status'}>
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className={notice.tone === 'success' ? 'notice notice--success' : 'form-error'}>
            {notice.text}
          </p>
        )}
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>

      <form className="form" noValidate onSubmit={submit}>
        <fieldset disabled={!editable} className="form__fieldset">
          <section className="panel" aria-labelledby="hero-title">
            <h2 id="hero-title" className="panel__title">
              Hero
            </h2>
            <div className="form__grid">
              <Field label="Eyebrow (small text above the headline)" error={err('hero.eyebrow')}>
                {(a11y) => <input {...a11y} value={hero.eyebrow} maxLength={60} onChange={setHeroField('eyebrow')} />}
              </Field>
              <Field label="Headline" error={err('hero.title')}>
                {(a11y) => <input {...a11y} value={hero.title} maxLength={120} onChange={setHeroField('title')} />}
              </Field>
            </div>
            <Field label="Description" error={err('hero.description')}>
              {(a11y) => <textarea {...a11y} rows={2} value={hero.description} maxLength={300} onChange={setHeroField('description')} />}
            </Field>
            <div className="form__grid">
              <Field label="Main button text" error={err('hero.primaryCta.label')}>
                {(a11y) => <input {...a11y} value={hero.primaryCta.label} maxLength={40} onChange={setHeroCta('primaryCta', 'label')} />}
              </Field>
              <Field label="Main button link" error={err('hero.primaryCta.url')} hint="A store path like /products, or https://…">
                {(a11y) => <input {...a11y} value={hero.primaryCta.url} maxLength={500} onChange={setHeroCta('primaryCta', 'url')} />}
              </Field>
              <Field label="Second button text (optional)" error={err('hero.secondaryCta.label')}>
                {(a11y) => <input {...a11y} value={hero.secondaryCta.label} maxLength={40} onChange={setHeroCta('secondaryCta', 'label')} />}
              </Field>
              <Field label="Second button link" error={err('hero.secondaryCta.url')}>
                {(a11y) => <input {...a11y} value={hero.secondaryCta.url} maxLength={500} onChange={setHeroCta('secondaryCta', 'url')} />}
              </Field>
              <Field label="Image address" error={err('hero.imageUrl')}>
                {(a11y) => <input {...a11y} value={hero.imageUrl} maxLength={500} onChange={setHeroField('imageUrl')} />}
              </Field>
              <Field label="Image description (alt text)" error={err('hero.imageAlt')} hint="What the image shows, for people who can't see it.">
                {(a11y) => <input {...a11y} value={hero.imageAlt} maxLength={200} onChange={setHeroField('imageAlt')} />}
              </Field>
            </div>
            <fieldset className="form__fieldset">
              <legend>Highlights (up to 3 short selling points)</legend>
              <div className="form__grid">
                {hero.highlights.map((text, index) => (
                  <Field key={index} label={`Highlight ${index + 1}`} error={err(`hero.highlights.${index}`)}>
                    {(a11y) => (
                      <input
                        {...a11y}
                        value={text}
                        maxLength={80}
                        onChange={(event) => setHero((current) => ({ ...current, highlights: current.highlights.map((item, position) => (position === index ? event.target.value : item)) }))}
                      />
                    )}
                  </Field>
                ))}
              </div>
            </fieldset>
            {hero.bn && (
              <BanglaGroup>
                <div className="form__grid">
                  <BanglaField label="Hero eyebrow in Bangla" value={hero.bn.eyebrow} english={hero.eyebrow} onChange={setHeroBn('eyebrow')} maxLength={60} error={err('hero.bn.eyebrow')} />
                  <BanglaField label="Headline in Bangla" value={hero.bn.title} english={hero.title} onChange={setHeroBn('title')} maxLength={120} error={err('hero.bn.title')} />
                </div>
                <BanglaField label="Hero description in Bangla" value={hero.bn.description} english={hero.description} onChange={setHeroBn('description')} maxLength={300} multiline rows={2} error={err('hero.bn.description')} />
                <div className="form__grid">
                  <BanglaField label="Main button text in Bangla" value={hero.bn.primaryCtaLabel} english={hero.primaryCta.label} onChange={setHeroBn('primaryCtaLabel')} maxLength={40} error={err('hero.bn.primaryCtaLabel')} />
                  <BanglaField label="Second button text in Bangla" value={hero.bn.secondaryCtaLabel} english={hero.secondaryCta.label} onChange={setHeroBn('secondaryCtaLabel')} maxLength={40} error={err('hero.bn.secondaryCtaLabel')} />
                  <BanglaField label="Hero image description in Bangla" value={hero.bn.imageAlt} english={hero.imageAlt} onChange={setHeroBn('imageAlt')} maxLength={200} error={err('hero.bn.imageAlt')} />
                  {hero.bn.highlights.map((text, index) => (
                    <BanglaField
                      key={index}
                      label={`Highlight ${index + 1} in Bangla`}
                      value={text}
                      english={hero.highlights[index]}
                      maxLength={80}
                      error={err('hero.bn.highlights')}
                      onChange={(next) => setHero((current) => ({ ...current, bn: { ...current.bn, highlights: current.bn.highlights.map((item, position) => (position === index ? next : item)) } }))}
                    />
                  ))}
                </div>
              </BanglaGroup>
            )}
          </section>

          <section className="panel" aria-labelledby="banners-title">
            <h2 id="banners-title" className="panel__title">
              Promo banners
            </h2>
            <p className="field__hint">Shown in this order. Inactive banners are kept but not shown.</p>
            {err('banners') && <p className="field__error">{err('banners')}</p>}
            {banners.length === 0 && <p className="muted">No banners.</p>}
            <ol className="banner-list">
              {banners.map((banner, index) => {
                const path = `banners.${index}`
                const name = banner.title || `Banner ${index + 1}`
                return (
                  <li key={banner.key} className="banner-item">
                    <fieldset className="form__fieldset">
                      <legend>
                        {index + 1}. {name} {!banner.isActive && <span className="muted">(inactive)</span>}
                      </legend>
                      <div className="banner-item__tools">
                        <button type="button" ref={(node) => buttons.current.set(`${banner.key}-up`, node)} className="icon-button" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => moveBanner(index, -1)}>
                          <LuArrowUp aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          ref={(node) => buttons.current.set(`${banner.key}-down`, node)}
                          className="icon-button"
                          aria-label={`Move ${name} down`}
                          disabled={index === banners.length - 1}
                          onClick={() => moveBanner(index, 1)}
                        >
                          <LuArrowDown aria-hidden="true" />
                        </button>
                        <button type="button" className="icon-button icon-button--danger" aria-label={`Remove ${name}`} onClick={() => removeBanner(index)}>
                          <LuTrash2 aria-hidden="true" />
                        </button>
                      </div>
                      <div className="form__grid">
                        <Field label="Title" error={err(`${path}.title`)}>
                          {(a11y) => <input {...a11y} data-banner-title={banner.key} value={banner.title} maxLength={120} onChange={(event) => setBanner(banner.key, { title: event.target.value })} />}
                        </Field>
                        <Field label="Eyebrow" error={err(`${path}.eyebrow`)}>
                          {(a11y) => <input {...a11y} value={banner.eyebrow} maxLength={60} onChange={(event) => setBanner(banner.key, { eyebrow: event.target.value })} />}
                        </Field>
                      </div>
                      <Field label="Description" error={err(`${path}.description`)}>
                        {(a11y) => <input {...a11y} value={banner.description} maxLength={300} onChange={(event) => setBanner(banner.key, { description: event.target.value })} />}
                      </Field>
                      <div className="form__grid">
                        <Field label="Button text" error={err(`${path}.cta.label`)}>
                          {(a11y) => <input {...a11y} value={banner.cta.label} maxLength={40} onChange={(event) => setBanner(banner.key, { cta: { ...banner.cta, label: event.target.value } })} />}
                        </Field>
                        <Field label="Button link" error={err(`${path}.cta.url`)}>
                          {(a11y) => <input {...a11y} value={banner.cta.url} maxLength={500} onChange={(event) => setBanner(banner.key, { cta: { ...banner.cta, url: event.target.value } })} />}
                        </Field>
                        <Field label="Image address" error={err(`${path}.imageUrl`)}>
                          {(a11y) => <input {...a11y} value={banner.imageUrl} maxLength={500} onChange={(event) => setBanner(banner.key, { imageUrl: event.target.value })} />}
                        </Field>
                        <Field label="Image description (alt text)" error={err(`${path}.imageAlt`)}>
                          {(a11y) => <input {...a11y} value={banner.imageAlt} maxLength={200} onChange={(event) => setBanner(banner.key, { imageAlt: event.target.value })} />}
                        </Field>
                        <Field label="Color" error={err(`${path}.tone`)}>
                          {(a11y) => (
                            <select {...a11y} value={banner.tone} onChange={(event) => setBanner(banner.key, { tone: event.target.value })}>
                              {TONES.map((tone) => (
                                <option key={tone.value} value={tone.value}>
                                  {tone.label}
                                </option>
                              ))}
                            </select>
                          )}
                        </Field>
                      </div>
                      <label className="checkbox">
                        <input type="checkbox" checked={banner.isActive} onChange={(event) => setBanner(banner.key, { isActive: event.target.checked })} />
                        Active (shown in the store)
                      </label>
                      {banner.bn && (
                        <BanglaGroup>
                          <div className="form__grid">
                            <BanglaField label={`${name}: title in Bangla`} value={banner.bn.title} english={banner.title} onChange={setBannerBn(banner, 'title')} maxLength={120} error={err(`${path}.bn.title`)} />
                            <BanglaField label={`${name}: eyebrow in Bangla`} value={banner.bn.eyebrow} english={banner.eyebrow} onChange={setBannerBn(banner, 'eyebrow')} maxLength={60} error={err(`${path}.bn.eyebrow`)} />
                            <BanglaField label={`${name}: description in Bangla`} value={banner.bn.description} english={banner.description} onChange={setBannerBn(banner, 'description')} maxLength={300} error={err(`${path}.bn.description`)} />
                            <BanglaField label={`${name}: button text in Bangla`} value={banner.bn.ctaLabel} english={banner.cta.label} onChange={setBannerBn(banner, 'ctaLabel')} maxLength={40} error={err(`${path}.bn.ctaLabel`)} />
                            <BanglaField label={`${name}: image description in Bangla`} value={banner.bn.imageAlt} english={banner.imageAlt} onChange={setBannerBn(banner, 'imageAlt')} maxLength={200} error={err(`${path}.bn.imageAlt`)} />
                          </div>
                        </BanglaGroup>
                      )}
                    </fieldset>
                  </li>
                )
              })}
            </ol>
            {banners.length < MAX_BANNERS && (
              <button type="button" className="btn btn--outline btn--sm" onClick={addBanner}>
                <LuPlus aria-hidden="true" /> Add banner
              </button>
            )}
          </section>

          <FeaturedProducts featured={featured} setFeatured={setFeatured} move={moveFeatured} announce={setAnnouncement} error={err('featuredProductIds')} />
        </fieldset>

        <div className="form__actions">
          {editable ? (
            <button type="submit" className="btn btn--primary" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save home page'}
            </button>
          ) : (
            <span className="muted">Your role can view the home page but not change it.</span>
          )}
        </div>
      </form>
    </>
  )
}

/** Featured products: the chosen list (ordered, up to 8) and a product search to add more. */
function FeaturedProducts({ featured, setFeatured, move, announce, error }) {
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const results = useQuery({ queryKey: adminKeys.products({ q: query, limit: 8, picker: true }), queryFn: ({ signal }) => getProducts({ q: query, limit: 8 }, { signal }), enabled: query !== '' })
  const chosen = new Set(featured.map((product) => product.id))
  const full = featured.length >= MAX_FEATURED

  function add(product) {
    if (full || chosen.has(product.id)) return
    setFeatured((current) => [...current, { id: product.id, title: product.title, sku: product.sku ?? null }])
    announce(`${product.title} added to featured products (${featured.length + 1} of ${MAX_FEATURED}).`)
  }
  function remove(product) {
    setFeatured((current) => current.filter((item) => item.id !== product.id))
    announce(`${product.title} removed from featured products.`)
  }

  return (
    <section className="panel" aria-labelledby="featured-title">
      <h2 id="featured-title" className="panel__title">
        Featured products
      </h2>
      <p className="field__hint">
        Up to {MAX_FEATURED}, shown in this order. Only active products appear in the store. {featured.length} of {MAX_FEATURED} chosen.
      </p>
      {error && <p className="field__error">{error}</p>}
      {featured.length > 0 && (
        <ol className="picker-list">
          {featured.map((product, index) => (
            <li key={product.id}>
              <span>
                {product.title} <small className="muted">#{product.id}</small>
              </span>
              <span className="picker-list__tools">
                <button type="button" className="icon-button" aria-label={`Move ${product.title} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                  <LuArrowUp aria-hidden="true" />
                </button>
                <button type="button" className="icon-button" aria-label={`Move ${product.title} down`} disabled={index === featured.length - 1} onClick={() => move(index, 1)}>
                  <LuArrowDown aria-hidden="true" />
                </button>
                <button type="button" className="icon-button icon-button--danger" aria-label={`Remove ${product.title}`} onClick={() => remove(product)}>
                  <LuTrash2 aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {/* Not a nested <form>: Enter in the search box searches instead of saving the page. */}
      <div className="toolbar" role="search" aria-label="Find products to feature">
        <label className="toolbar__search">
          <span className="visually-hidden">Search products to feature</span>
          <input
            type="search"
            value={draft}
            placeholder="Search products by name"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              setQuery(draft.trim())
            }}
          />
        </label>
        <button type="button" className="btn btn--outline" onClick={() => setQuery(draft.trim())}>
          <LuSearch aria-hidden="true" /> Search
        </button>
      </div>
      <div aria-live="polite">
        {results.isFetching && <Loading label="Searching…" />}
        {results.error && <ErrorState error={results.error} />}
        {results.data && results.data.products.length === 0 && <p className="muted">No products match “{query}”.</p>}
        {results.data && results.data.products.length > 0 && (
          <ul className="picker-list">
            {results.data.products.map((product) => (
              <li key={product.id}>
                <span>
                  {product.title} <small className="muted">#{product.id} · {formatMoney(product.price)}</small>
                </span>
                <button type="button" className="btn btn--outline btn--sm" disabled={full || chosen.has(product.id)} onClick={() => add(product)} aria-label={`Feature ${product.title}`}>
                  {chosen.has(product.id) ? 'Featured' : 'Feature'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

export default HomeEditorPage
