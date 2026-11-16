import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuPencil, LuPlus, LuSearch, LuTrash2, LuUpload } from 'react-icons/lu'
import { createRedirect, deleteRedirect, getRedirects, importRedirects, systemKeys, updateRedirect } from '../api/admin'
import ConfirmDialog from '../components/ConfirmDialog'
import Field from '../components/Field'
import FormDialog from '../components/FormDialog'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount, formatDate } from '../utils/format'
import { actionErrorMessage } from '../utils/permissions'
import { REDIRECT_CODES, redirectErrors } from '../utils/redirects'

const LIMIT = 20
const MAX_CSV_BYTES = 2 * 1024 * 1024
const EMPTY = { fromPath: '', toPath: '', statusCode: 301 }

/**
 * Content → URL redirects (Magento's URL rewrites), seo.manage: an old store
 * address sends visitors to a new one. The storefront's "not found" page
 * follows them, and the server answers a real 301/302.
 */
function RedirectsPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const skip = Number(params.get('skip')) || 0
  const [draft, setDraft] = useState(q)
  const [editing, setEditing] = useState(null) // EMPTY for a new one, or the redirect
  const [toDelete, setToDelete] = useState(null)
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState(null)
  const noticeRef = useRef(null)
  const queryClient = useQueryClient()

  const query = { q, skip, limit: LIMIT }
  const redirects = useQuery({ queryKey: systemKeys.redirects(query), queryFn: ({ signal }) => getRedirects(query, { signal }), placeholderData: keepPreviousData })

  const say = (text, tone = 'success', details) => {
    setNotice({ text, tone, details })
    requestAnimationFrame(() => noticeRef.current?.focus())
  }
  const changed = () => queryClient.invalidateQueries({ queryKey: ['redirects'] })

  const remove = useMutation({
    mutationFn: (redirect) => deleteRedirect(redirect.id),
    onSuccess: (_, redirect) => {
      setToDelete(null)
      changed()
      say(`Redirect from ${redirect.fromPath} deleted.`)
    },
    onError: (error) => {
      setToDelete(null)
      say(actionErrorMessage(error), 'error')
    },
  })

  const update = (changes) => {
    const next = { q, skip, ...changes }
    setParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value !== '' && value !== 0).map(([key, value]) => [key, String(value)])))
  }

  return (
    <>
      <title>URL redirects | BuyNest Admin</title>
      <PageHeader
        title="URL redirects"
        description={redirects.data ? `${formatCount(redirects.data.total)} redirects from old store addresses to new ones` : 'Old store addresses sent to new ones'}
        actions={
          <>
            <button type="button" className="btn btn--outline" onClick={() => setImporting(true)}>
              <LuUpload aria-hidden="true" /> Import CSV
            </button>
            <button type="button" className="btn btn--primary" onClick={() => setEditing(EMPTY)}>
              <LuPlus aria-hidden="true" /> Add redirect
            </button>
          </>
        }
      />
      <div role={notice?.tone === 'error' ? 'alert' : 'status'}>
        {notice && (
          <div ref={noticeRef} tabIndex={-1} className={notice.tone === 'success' ? 'notice notice--success bulk-summary' : 'form-error'}>
            <p>{notice.text}</p>
            {notice.details?.length > 0 && (
              <ul>
                {notice.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="toolbar">
        <form
          role="search"
          className="toolbar__search"
          onSubmit={(event) => {
            event.preventDefault()
            update({ q: draft.trim(), skip: 0 })
          }}
        >
          <label htmlFor="redirect-search" className="visually-hidden">
            Search redirects
          </label>
          <input id="redirect-search" type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Search by path" />
          <button type="submit" className="btn btn--outline">
            <LuSearch aria-hidden="true" /> Search
          </button>
        </form>
      </div>

      {redirects.isPending && <Loading label="Loading redirects…" />}
      {redirects.error && <ErrorState error={redirects.error} onRetry={redirects.refetch} />}
      {redirects.data && redirects.data.redirects.length === 0 && <Empty>{q ? 'No redirects match.' : 'No redirects yet.'}</Empty>}
      {redirects.data && redirects.data.redirects.length > 0 && (
        <div className="table-wrap" aria-busy={redirects.isFetching}>
          <table className="table">
            <caption className="visually-hidden">URL redirects</caption>
            <thead>
              <tr>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">Type</th>
                <th scope="col" className="num">
                  Hits
                </th>
                <th scope="col">Changed</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {redirects.data.redirects.map((redirect) => (
                <tr key={redirect.id}>
                  <th scope="row">
                    <code className="path">{redirect.fromPath}</code>
                  </th>
                  <td>
                    <code className="path">{redirect.toPath}</code>
                  </td>
                  <td>{redirect.statusCode === 302 ? 'Temporary (302)' : 'Permanent (301)'}</td>
                  <td className="num">{formatCount(redirect.hits ?? 0)}</td>
                  <td>{formatDate(redirect.updatedAt ?? redirect.createdAt)}</td>
                  <td className="table__actions">
                    <button type="button" className="icon-button" aria-label={`Edit redirect from ${redirect.fromPath}`} onClick={() => setEditing(redirect)}>
                      <LuPencil aria-hidden="true" />
                    </button>
                    <button type="button" className="icon-button icon-button--danger" aria-label={`Delete redirect from ${redirect.fromPath}`} onClick={() => setToDelete(redirect)}>
                      <LuTrash2 aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={redirects.data.total} limit={LIMIT} skip={skip} onChange={(next) => update({ skip: next })} />
        </div>
      )}

      {editing && (
        <RedirectDialog
          redirect={editing}
          onCancel={() => setEditing(null)}
          onSaved={(redirect, isNew) => {
            setEditing(null)
            changed()
            say(`Redirect ${isNew ? 'added' : 'saved'}: ${redirect.fromPath} goes to ${redirect.toPath}.`)
          }}
        />
      )}
      {importing && (
        <ImportDialog
          onCancel={() => setImporting(false)}
          onDone={(result) => {
            setImporting(false)
            changed()
            const counts = `${formatCount(result.created)} added, ${formatCount(result.updated)} updated${result.skipped ? `, ${formatCount(result.skipped)} skipped` : ''}.`
            say(`Import finished: ${counts}`, 'success', (result.errors ?? []).map((error) => `Row ${error.row}: ${error.message}`))
          }}
        />
      )}
      <ConfirmDialog
        isOpen={toDelete !== null}
        title="Delete this redirect?"
        message={toDelete ? `Visitors to ${toDelete.fromPath} will see "not found" again.` : ''}
        confirmLabel="Delete redirect"
        busy={remove.isPending}
        onConfirm={() => remove.mutate(toDelete)}
        onCancel={() => setToDelete(null)}
      />
    </>
  )
}

function RedirectDialog({ redirect, onCancel, onSaved }) {
  const isNew = redirect.id === undefined
  const [values, setValues] = useState({ fromPath: redirect.fromPath, toPath: redirect.toPath, statusCode: redirect.statusCode ?? 301 })
  const [errors, setErrors] = useState({})
  const save = useMutation({
    mutationFn: (body) => (isNew ? createRedirect(body) : updateRedirect(redirect.id, body)),
    onSuccess: (result) => onSaved(result.redirect, isNew),
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  })
  const set = (field) => (event) => setValues({ ...values, [field]: field === 'statusCode' ? Number(event.target.value) : event.target.value })

  function submit() {
    const body = { fromPath: values.fromPath.trim(), toPath: values.toPath.trim(), statusCode: values.statusCode }
    const found = redirectErrors(body)
    setErrors(found)
    if (Object.keys(found).length === 0) save.mutate(body)
  }

  const shown = ['fromPath', 'toPath', 'statusCode']
  const other = save.error && (Object.entries(save.error.fieldErrors ?? {}).find(([field]) => !shown.includes(field))?.[1][0] ?? (save.error.fieldErrors ? null : actionErrorMessage(save.error)))
  return (
    <FormDialog isOpen title={isNew ? 'Add redirect' : 'Edit redirect'} submitLabel={isNew ? 'Add redirect' : 'Save redirect'} busy={save.isPending} error={other} onSubmit={submit} onCancel={onCancel}>
      <Field label="From (old address)" error={errors.fromPath?.[0]} hint="A store path, for example /products/12 or /summer-sale.">
        {(a11y) => <input {...a11y} value={values.fromPath} maxLength={255} autoCapitalize="none" spellCheck={false} onChange={set('fromPath')} />}
      </Field>
      <Field label="To" error={errors.toPath?.[0]} hint="A store path or an https:// address.">
        {(a11y) => <input {...a11y} value={values.toPath} maxLength={2048} autoCapitalize="none" spellCheck={false} onChange={set('toPath')} />}
      </Field>
      <Field label="Type" error={errors.statusCode?.[0]} hint="Permanent tells search engines to use the new address.">
        {(a11y) => (
          <select {...a11y} value={values.statusCode} onChange={set('statusCode')}>
            {REDIRECT_CODES.map((code) => (
              <option key={code.value} value={code.value}>
                {code.label}
              </option>
            ))}
          </select>
        )}
      </Field>
    </FormDialog>
  )
}

function ImportDialog({ onCancel, onDone }) {
  const [file, setFile] = useState(null)
  const [error, setError] = useState(null)
  const upload = useMutation({
    mutationFn: () => importRedirects(file),
    onSuccess: onDone,
    onError: (failure) => setError(failure.fieldErrors ? Object.values(failure.fieldErrors).flat().join(' ') : actionErrorMessage(failure)),
  })

  function submit() {
    if (!file) return setError('Choose a CSV file.')
    if (!/\.csv$/i.test(file.name)) return setError('Choose a .csv file.')
    if (file.size > MAX_CSV_BYTES) return setError('The file is larger than 2 MB.')
    setError(null)
    upload.mutate()
  }

  return (
    <FormDialog
      isOpen
      title="Import redirects"
      description="A CSV with the columns from_path, to_path, and optionally status_code (301 or 302). An existing from_path is updated."
      submitLabel="Import"
      busy={upload.isPending}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <Field label="CSV file" error={error}>
        {(a11y) => <input {...a11y} type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />}
      </Field>
    </FormDialog>
  )
}

export default RedirectsPage
