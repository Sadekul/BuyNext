import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router'
import { LuMail, LuPhone } from 'react-icons/lu'
import Breadcrumb from '../components/common/Breadcrumb'
import PageMeta from '../components/common/PageMeta'
import ErrorMessage from '../components/ui/ErrorMessage'
import Loader from '../components/ui/Loader'
import NotFoundPage from './NotFoundPage'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { cmsPageQuery } from '../queries/contentQueries'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import { toDescription } from '../utils/pageMeta'
import './CmsPage.css'

/**
 * Links in the admin's HTML are plain <a> tags. Same-site ones are followed
 * by the router (no full page reload); other sites, new-tab clicks, and
 * mailto: links keep the browser's behaviour.
 */
function useInAppLinks() {
  const navigate = useNavigate()
  return (event) => {
    const link = event.target.closest('a[href]')
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (link.target && link.target !== '_self') return
    const url = new URL(link.href, window.location.href)
    if (url.origin !== window.location.origin) return
    event.preventDefault()
    navigate(`${url.pathname}${url.search}${url.hash}`)
  }
}

/** Support details from the store settings, under the contact page. */
function SupportCard() {
  const { settings } = useStoreSettings()
  if (!settings.supportEmail && !settings.supportPhone) return null
  return (
    <aside className="cms-page__support" aria-labelledby="support-title">
      <h2 id="support-title">Customer support</h2>
      <ul>
        {settings.supportEmail && (
          <li>
            <LuMail aria-hidden="true" />
            <a href={`mailto:${settings.supportEmail}`}>{settings.supportEmail}</a>
          </li>
        )}
        {settings.supportPhone && (
          <li>
            <LuPhone aria-hidden="true" />
            <a href={`tel:${settings.supportPhone.replace(/[^\d+]/g, '')}`}>{settings.supportPhone}</a>
          </li>
        )}
      </ul>
    </aside>
  )
}

/**
 * /pages/:slug: a page the admin wrote in the CMS (REAL_SHOP). Unknown and
 * unpublished pages are a 404.
 *
 * The body is HTML. The server sanitizes it on save with an allow-list (no
 * scripts, styles, event attributes, iframes, or javascript: links), and
 * only this one field from our own API is ever rendered as HTML.
 */
function CmsPage() {
  const { slug } = useParams()
  const pageRequest = useQuery(cmsPageQuery(slug))
  const handleBodyClick = useInAppLinks()

  if (pageRequest.isPending) {
    return (
      <div className="section container">
        <Loader label="Loading page…" />
      </div>
    )
  }

  if (pageRequest.error?.status === 404) return <NotFoundPage />

  if (pageRequest.error) {
    return (
      <div className="section container">
        <title>{`Page unavailable | ${SITE.name}`}</title>
        <ErrorMessage titleAs="h1" title="We couldn't load this page" message={pageRequest.error.message} onRetry={pageRequest.refetch} />
      </div>
    )
  }

  const page = pageRequest.data
  return (
    <div className="section container">
      <PageMeta title={page.metaTitle ?? page.title} description={toDescription(page.metaDescription ?? page.body)} canonicalPath={ROUTES.page(page.slug ?? slug)} />
      <Breadcrumb items={[{ label: 'Home', to: ROUTES.home }, { label: page.title }]} />
      <article className="cms-page" aria-labelledby="cms-page-title">
        <h1 id="cms-page-title" className="cms-page__title">
          {page.title}
        </h1>
        {/* Clicks are only intercepted to route same-site links; the content itself isn't interactive. */}
        <div className="cms-page__body" onClick={handleBodyClick} dangerouslySetInnerHTML={{ __html: page.body }} />
        {page.slug === 'contact' && <SupportCard />}
      </article>
    </div>
  )
}

export default CmsPage
