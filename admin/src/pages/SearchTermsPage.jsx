import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuPencil, LuPlus, LuSearch, LuTrash2 } from 'react-icons/lu'
import { createSearchTerm, deleteSearchTerm, getSearchTermReport, getSearchTerms, marketingKeys, updateSearchTerm } from '../api/marketing'
import { useAdminAuth } from '../auth/useAdminAuth'
import ConfirmDialog from '../components/ConfirmDialog'
import Field from '../components/Field'
import FormDialog from '../components/FormDialog'
import Notice from '../components/Notice'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount, formatDate } from '../utils/format'
import { useNotice } from '../utils/marketing'

/*
 * Reports → Search terms (phase 7): what shoppers type in the store's
 * search, most searched first, and the searches that found nothing.
 * reports.view to read. With seo.manage, a term can send shoppers straight
 * to a page (its redirect), like Magento's search term redirects.
 */

const LIMIT = 25
const VIEWS = { top: 'Top searches', zero: 'Searches with no results', redirects: 'Terms with a redirect' }

// A store path ("/category/shoes", not "//…") or an https:// address; the server checks again.
const isRedirect = (value) => (/^\/(?!\/)\S*$/.test(value) || /^https:\/\/\S+$/i.test(value)) && value.length <= 2048
const REDIRECT_HINT = 'A store path like /category/shoes, or an https:// address. Searching exactly this term goes there.'

function SearchTermsPage() {
  const [params, setParams] = useSearchParams()
  const { can } = useAdminAuth()
  const seo = can('seo.manage')
  const requested = params.get('view') ?? 'top'
  const view = requested === 'redirects' && !seo ? 'top' : Object.hasOwn(VIEWS, requested) ? requested : 'top'
  const q = params.get('q') ?? ''
  const skip = Number(params.get('skip')) || 0
  const [draft, setDraft] = useState(q)
  const [editing, setEditing] = useState(null) // a term, or { new: true }
  const [deleting, setDeleting] = useState(null)
  const { notice, setNotice, ref } = useNotice()
  const queryClient = useQueryClient()
  const query = { view, q, skip, limit: LIMIT }
  const terms = useQuery({
    queryKey: marketingKeys.searchTerms(query),
    queryFn: ({ signal }) =>
      view === 'redirects' ? getSearchTerms({ q, hasRedirect: true, skip, limit: LIMIT }, { signal }) : getSearchTermReport({ type: view, q, skip, limit: LIMIT }, { signal }),
    placeholderData: keepPreviousData,
  })

  const remove = useMutation({
    mutationFn: (term) => deleteSearchTerm(term.id),
    onSuccess: (_, term) => {
      setDeleting(null)
      queryClient.invalidateQueries({ queryKey: ['search-terms'] })
      setNotice({ tone: 'success', text: `“${term.term}” removed, with its count and redirect.` })
    },
    onError: (error) => {
      setDeleting(null)
      setNotice({ tone: 'error', text: error.message })
    },
  })

  function update(changes) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === '' || value === 0 || (key === 'view' && value === 'top')) next.delete(key)
      else next.set(key, String(value))
    }
    setParams(next)
  }

  return (
    <>
      <title>Search terms | BuyNest Admin</title>
      <PageHeader
        title="Search terms"
        description={terms.data ? `${formatCount(terms.data.total)} ${q ? 'matching terms' : 'terms'} · counted once per visitor per hour` : 'What shoppers search for'}
        actions={
          seo && (
            <button type="button" className="btn btn--primary" onClick={() => setEditing({ new: true })}>
              <LuPlus aria-hidden="true" /> Add redirect
            </button>
          )
        }
      />
      <Notice notice={notice} noticeRef={ref} />

      <div className="toolbar">
        <form
          role="search"
          className="toolbar__search"
          onSubmit={(event) => {
            event.preventDefault()
            update({ q: draft.trim(), skip: 0 })
          }}
        >
          <label htmlFor="term-search" className="visually-hidden">
            Search terms
          </label>
          <input id="term-search" type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Find a term" />
          <button type="submit" className="btn btn--outline">
            <LuSearch aria-hidden="true" /> Search
          </button>
        </form>
        <label className="toolbar__select">
          <span>Show</span>
          <select value={view} onChange={(event) => update({ view: event.target.value, skip: 0 })}>
            {Object.entries(VIEWS)
              .filter(([value]) => value !== 'redirects' || seo)
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </select>
        </label>
      </div>

      {terms.isPending && <Loading label="Loading search terms…" />}
      {terms.error && <ErrorState error={terms.error} onRetry={terms.refetch} />}
      {terms.data && terms.data.terms.length === 0 && (
        <Empty>{q ? 'No terms match.' : view === 'zero' ? 'Every search found something.' : view === 'redirects' ? 'No term has a redirect yet.' : 'Nobody has searched yet.'}</Empty>
      )}
      {terms.data && terms.data.terms.length > 0 && (
        <div className="table-wrap" aria-busy={terms.isFetching}>
          <table className="table">
            <caption className="visually-hidden">{VIEWS[view]}, most searched first</caption>
            <thead>
              <tr>
                <th scope="col">Term</th>
                <th scope="col" className="num">
                  Searches
                </th>
                <th scope="col" className="num">
                  Results
                </th>
                <th scope="col">Redirect</th>
                <th scope="col">Last searched</th>
                {seo && (
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {terms.data.terms.map((term) => (
                <tr key={term.id}>
                  <th scope="row">{term.term}</th>
                  <td className="num">{formatCount(term.hits)}</td>
                  <td className="num">{term.lastResultsCount === 0 ? <strong>None</strong> : formatCount(term.lastResultsCount)}</td>
                  <td className="external-link">{term.redirectUrl ? <code>{term.redirectUrl}</code> : <span className="muted">—</span>}</td>
                  <td>{term.hits > 0 ? formatDate(term.updatedAt) : <span className="muted">Never</span>}</td>
                  {seo && (
                    <td className="table__actions">
                      <button type="button" className="icon-button" onClick={() => setEditing(term)} aria-label={`Edit the redirect for “${term.term}”`}>
                        <LuPencil aria-hidden="true" />
                      </button>
                      <button type="button" className="icon-button icon-button--danger" onClick={() => setDeleting(term)} aria-label={`Remove “${term.term}”`}>
                        <LuTrash2 aria-hidden="true" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={terms.data.total} limit={LIMIT} skip={skip} onChange={(next) => update({ skip: next })} />
        </div>
      )}

      {editing && (
        <RedirectDialog
          term={editing.new ? null : editing}
          onDone={(text) => {
            setEditing(null)
            queryClient.invalidateQueries({ queryKey: ['search-terms'] })
            setNotice({ tone: 'success', text })
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        isOpen={deleting !== null}
        title={`Remove “${deleting?.term}”?`}
        message="Its search count and redirect are removed. It comes back the next time someone searches for it."
        confirmLabel="Remove"
        busy={remove.isPending}
        onConfirm={() => remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}

/** Add a term with a redirect, or change or clear a term's redirect (empty = none). */
function RedirectDialog({ term, onDone, onCancel }) {
  const [values, setValues] = useState({ term: '', redirectUrl: term?.redirectUrl ?? '' })
  const [errors, setErrors] = useState({})
  const save = useMutation({
    mutationFn: () => (term ? updateSearchTerm(term.id, values.redirectUrl.trim() || null) : createSearchTerm({ term: values.term.trim(), redirectUrl: values.redirectUrl.trim() })),
    onSuccess: (result) => {
      const saved = result.term
      onDone(saved.redirectUrl ? `Searching “${saved.term}” now goes to ${saved.redirectUrl}.` : `“${saved.term}” no longer redirects; it shows search results.`)
    },
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  })

  function submit() {
    const found = {}
    const url = values.redirectUrl.trim()
    if (!term && (!values.term.trim() || values.term.trim().length > 100)) found.term = ['Enter the search term (up to 100 characters).']
    if (!term && !url) found.redirectUrl = ['Enter where this search should go.']
    else if (url && !isRedirect(url)) found.redirectUrl = ['Enter a store path like /category/shoes or an https:// address.']
    setErrors(found)
    if (Object.keys(found).length === 0) save.mutate()
  }

  return (
    <FormDialog
      isOpen
      title={term ? `Redirect for “${term.term}”` : 'Add a search redirect'}
      description={term ? 'Leave it empty to show search results again.' : 'For a term nobody searched yet, or any term you want to send somewhere.'}
      submitLabel="Save redirect"
      busy={save.isPending}
      error={save.error && !save.error.fieldErrors ? save.error.message : undefined}
      onSubmit={submit}
      onCancel={onCancel}
    >
      {!term && (
        <Field label="Search term" error={errors.term?.[0]} hint="Matched exactly, in any case.">
          {(a11y) => <input {...a11y} value={values.term} maxLength={100} onChange={(event) => setValues((current) => ({ ...current, term: event.target.value }))} />}
        </Field>
      )}
      <Field label="Redirect to" error={errors.redirectUrl?.[0]} hint={REDIRECT_HINT}>
        {(a11y) => (
          <input
            {...a11y}
            value={values.redirectUrl}
            maxLength={2048}
            autoCapitalize="none"
            spellCheck={false}
            inputMode="url"
            placeholder="/category/shoes"
            onChange={(event) => setValues((current) => ({ ...current, redirectUrl: event.target.value }))}
          />
        )}
      </Field>
    </FormDialog>
  )
}

export default SearchTermsPage
