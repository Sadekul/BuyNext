import { useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuArrowLeft, LuExternalLink, LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu'
import { adminKeys, createPage, deletePage, getPage, getPages, updatePage } from '../api/admin'
import { useAdminAuth } from '../auth/useAdminAuth'
import ConfirmDialog from '../components/ConfirmDialog'
import Field from '../components/Field'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount, formatDate } from '../utils/format'
// Phase 7: after a delete or an address change, offer a redirect from the old address.
import RedirectOffer from '../components/RedirectOffer'
import { storePaths } from '../utils/redirects'

const LIMIT = 20
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
const publishedStatus = (page) => (page.isPublished ? { tone: 'success', label: 'Published' } : { tone: 'neutral', label: 'Draft' })
const toSlug = (title) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

/** Content → Pages: the store's CMS pages (About, Shipping and returns, …). Needs content.view. */
export function ContentPagesPage() {
  const { can } = useAdminAuth()
  const [skip, setSkip] = useState(0)
  // A page just deleted in the editor comes back here with its old address.
  const location = useLocation()
  const [deleted, setDeleted] = useState(location.state?.deletedPage ?? null)
  const pages = useQuery({ queryKey: adminKeys.pages({ skip }), queryFn: ({ signal }) => getPages({ limit: LIMIT, skip }, { signal }) })

  return (
    <>
      <title>Pages | BuyNest Admin</title>
      <PageHeader
        title="Pages"
        description={pages.data ? `${formatCount(pages.data.total)} pages; published ones are linked from the store's footer` : 'Store pages linked from the footer'}
        actions={
          can('content.edit') && (
            <Link to="/pages/new" className="btn btn--primary">
              <LuPlus aria-hidden="true" /> Add page
            </Link>
          )
        }
      />
      {deleted && (
        <>
          <p className="notice notice--success" role="status">
            "{deleted.title}" was deleted.
          </p>
          <RedirectOffer fromPath={storePaths.page(deleted)} suggestedTo="/" what={`the deleted page "${deleted.title}"`} onClose={() => setDeleted(null)} />
        </>
      )}
      {pages.isPending && <Loading label="Loading pages…" />}
      {pages.error && <ErrorState error={pages.error} onRetry={pages.refetch} />}
      {pages.data && pages.data.pages.length === 0 && <Empty>No pages yet.</Empty>}
      {pages.data && pages.data.pages.length > 0 && (
        <div className="table-wrap" aria-busy={pages.isFetching}>
          <table className="table">
            <caption className="visually-hidden">Content pages</caption>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Address</th>
                <th scope="col">Status</th>
                <th scope="col">Updated</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pages.data.pages.map((page) => (
                <tr key={page.id}>
                  <th scope="row">
                    <Link to={`/pages/${page.id}`}>{page.title}</Link>
                  </th>
                  <td>
                    <code>/pages/{page.slug}</code>
                  </td>
                  <td>
                    <StatusBadge {...publishedStatus(page)} />
                  </td>
                  <td>{formatDate(page.updatedAt)}</td>
                  <td className="table__actions">
                    {can('content.edit') && (
                      <Link to={`/pages/${page.id}`} className="icon-button" aria-label={`Edit ${page.title}`}>
                        <LuPencil aria-hidden="true" />
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={pages.data.total} limit={LIMIT} skip={skip} onChange={setSkip} />
        </div>
      )}
    </>
  )
}

/** /pages/new or /pages/:pageId. */
export function PageEditorPage() {
  const { pageId } = useParams()
  const isNew = pageId === undefined
  const page = useQuery({ queryKey: adminKeys.page(pageId), queryFn: ({ signal }) => getPage(pageId, { signal }), enabled: !isNew })

  if (!isNew && page.isPending) return <Loading label="Loading the page…" />
  if (!isNew && page.error) return <ErrorState error={page.error} onRetry={page.refetch} />
  // Remounted per page, so the form starts from that page's saved values.
  return <PageEditor key={pageId ?? 'new'} saved={isNew ? null : page.data} />
}

/**
 * The editor: a plain HTML textarea (no WYSIWYG library). The preview shows
 * the body AS SAVED, i.e. after the server's allow-list sanitizer; what is
 * typed is never rendered as HTML here, so pasted scripts can't run.
 */
function PageEditor({ saved }) {
  const isNew = !saved
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { can } = useAdminAuth()
  const editable = can('content.edit')
  const [values, setValues] = useState({
    title: saved?.title ?? '',
    slug: saved?.slug ?? '',
    body: saved?.body ?? '',
    metaTitle: saved?.metaTitle ?? '',
    metaDescription: saved?.metaDescription ?? '',
    isPublished: saved?.isPublished ?? false,
  })
  const [slugTouched, setSlugTouched] = useState(!isNew)
  const [errors, setErrors] = useState({})
  const location = useLocation()
  // After "Create page" the editor reopens at the page's address, carrying the message.
  const [notice, setNotice] = useState(location.state?.notice ? { tone: 'success', text: location.state.notice } : null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [movedFrom, setMovedFrom] = useState(null) // the old slug, after the address changed
  const noticeRef = useRef(null)

  const set = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    setValues((current) => ({ ...current, [field]: value, ...(field === 'title' && !slugTouched && { slug: toSlug(value) }) }))
    if (field === 'slug') setSlugTouched(true)
  }

  const save = useMutation({
    mutationFn: (body) => (isNew ? createPage(body) : updatePage(saved.id, body)),
    // The address before this save (for the redirect offer when it changes).
    onMutate: () => ({ oldSlug: saved?.slug }),
    onSuccess: ({ page }, _body, context) => {
      queryClient.setQueryData(adminKeys.page(page.id), { ...page, live: true })
      queryClient.invalidateQueries({ queryKey: ['pages'] })
      // The server's cleaned HTML replaces what was typed, so the textarea shows what the store shows.
      setValues((current) => ({ ...current, body: page.body }))
      const cleaned = page.body !== values.body ? ' Some HTML was removed by the safety filter (scripts, styles, or unsupported tags).' : ''
      const text = `${isNew ? 'Page created' : 'Saved'}${page.isPublished ? ' and published' : ' as a draft'}.${cleaned}`
      if (isNew) return navigate(`/pages/${page.id}`, { replace: true, state: { notice: text } })
      setNotice({ tone: 'success', text })
      if (context?.oldSlug && page.slug !== context.oldSlug) setMovedFrom(context.oldSlug)
      requestAnimationFrame(() => noticeRef.current?.focus())
    },
    onError: (error) => {
      setErrors(error.fieldErrors ?? {})
      setNotice({ tone: 'error', text: error.message })
      requestAnimationFrame(() => noticeRef.current?.focus())
    },
  })
  const remove = useMutation({
    mutationFn: () => deletePage(saved.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pages'] })
      navigate('/pages', { replace: true, state: { deletedPage: { slug: saved.slug, title: saved.title } } })
    },
    onError: (error) => {
      setConfirmDelete(false)
      setNotice({ tone: 'error', text: error.message })
    },
  })

  function submit(event) {
    event.preventDefault()
    const found = {}
    if (!values.title.trim()) found.title = ['Enter a title.']
    if (!SLUG.test(values.slug) || values.slug.length > 80) found.slug = ['Use lower-case letters, digits, and dashes (up to 80).']
    setErrors(found)
    if (Object.keys(found).length > 0) return
    save.mutate({
      title: values.title.trim(),
      slug: values.slug,
      body: values.body,
      metaTitle: values.metaTitle.trim() || null,
      metaDescription: values.metaDescription.trim() || null,
      isPublished: values.isPublished,
    })
  }

  const unsaved = saved && values.body !== saved.body

  return (
    <>
      <title>{`${isNew ? 'New page' : saved.title} | BuyNest Admin`}</title>
      <Link to="/pages" className="back-link">
        <LuArrowLeft aria-hidden="true" /> All pages
      </Link>
      <PageHeader
        title={isNew ? 'New page' : saved.title}
        description={isNew ? undefined : <StatusBadge {...publishedStatus(saved)} />}
        actions={
          saved?.isPublished && (
            <a href={`/pages/${saved.slug}`} className="btn btn--outline" target="_blank" rel="noopener noreferrer">
              <LuExternalLink aria-hidden="true" /> View in store
            </a>
          )
        }
      />
      <div role={notice?.tone === 'error' ? 'alert' : 'status'}>
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className={notice.tone === 'success' ? 'notice notice--success' : 'form-error'}>
            {notice.text}
          </p>
        )}
      </div>

      {movedFrom && (
        <RedirectOffer
          key={movedFrom}
          fromPath={storePaths.page({ slug: movedFrom })}
          suggestedTo={storePaths.page({ slug: values.slug })}
          what="this page's old address"
          onClose={() => setMovedFrom(null)}
        />
      )}

      <div className="editor">
        <form className="form panel" noValidate onSubmit={submit}>
          <fieldset disabled={!editable} className="form__fieldset">
            <div className="form__grid">
              <Field label="Title" error={errors.title?.[0]}>
                {(a11y) => <input {...a11y} value={values.title} maxLength={200} onChange={set('title')} />}
              </Field>
              <Field label="Address" error={errors.slug?.[0]} hint={`The page opens at /pages/${values.slug || '…'}`}>
                {(a11y) => <input {...a11y} value={values.slug} maxLength={80} autoCapitalize="none" spellCheck={false} onChange={set('slug')} />}
              </Field>
            </div>
            <Field label="Content (HTML)" error={errors.body?.[0]} hint="Allowed: paragraphs, headings (h2–h4), lists, bold, italics, links, quotes, line breaks, rules, and tables. Everything else is removed when saved.">
              {(a11y) => <textarea {...a11y} className="editor__body" rows={16} value={values.body} spellCheck onChange={set('body')} />}
            </Field>
            <div className="form__grid">
              <Field label="Meta title (optional)" error={errors.metaTitle?.[0]} hint="Shown in search results and the browser tab.">
                {(a11y) => <input {...a11y} value={values.metaTitle} maxLength={255} onChange={set('metaTitle')} />}
              </Field>
              <Field label="Meta description (optional)" error={errors.metaDescription?.[0]}>
                {(a11y) => <textarea {...a11y} rows={2} value={values.metaDescription} maxLength={500} onChange={set('metaDescription')} />}
              </Field>
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={values.isPublished} onChange={set('isPublished')} />
              Published (visible in the store and linked from the footer)
            </label>
          </fieldset>
          <div className="form__actions">
            {editable ? (
              <>
                <button type="submit" className="btn btn--primary" disabled={save.isPending}>
                  {save.isPending ? 'Saving…' : isNew ? 'Create page' : 'Save page'}
                </button>
                {!isNew && (
                  <button type="button" className="btn btn--outline" onClick={() => setConfirmDelete(true)}>
                    <LuTrash2 aria-hidden="true" /> Delete
                  </button>
                )}
              </>
            ) : (
              <span className="muted">Your role can view this page but not change it.</span>
            )}
          </div>
        </form>

        <section className="panel editor__preview" aria-labelledby="preview-title">
          <h2 id="preview-title" className="panel__title">
            Preview
          </h2>
          {saved ? (
            <>
              <p className="field__hint" aria-live="polite">
                {unsaved ? 'You have unsaved changes: save to see them here, cleaned by the server.' : 'As saved: the HTML after the server removed anything unsafe.'}
              </p>
              {/* Safe: this is the server's sanitized body (allow-listed tags, no scripts or event attributes), never the draft. */}
              <article className="cms-preview" dangerouslySetInnerHTML={{ __html: saved.body }} />
            </>
          ) : (
            <p className="muted">Save the page to see a preview of its cleaned HTML.</p>
          )}
        </section>
      </div>

      <ConfirmDialog
        isOpen={confirmDelete}
        title={`Delete "${saved?.title}"?`}
        message="The page and its address stop working in the store. This can't be undone."
        confirmLabel="Delete page"
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  )
}
