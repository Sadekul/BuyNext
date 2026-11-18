import { useEffect, useId, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuDownload, LuFileCheck, LuUpload } from 'react-icons/lu'
import { adminKeys, getCategories, importProducts, productsCsvUrl } from '../api/admin'
import Field from '../components/Field'
import PageHeader from '../components/PageHeader'
import { withPaths } from '../utils/categories'
import { formatCount } from '../utils/format'
import { PRODUCT_STATUSES } from '../utils/orders'
import { actionErrorMessage } from '../utils/permissions'

const CSV_COLUMNS = [
  ['sku', 'Required. Matches an existing product (update) or creates a new one.'],
  ['name', 'Required.'],
  ['category_slug', 'Required for new products, e.g. beauty.'],
  ['brand', ''],
  ['price', 'Required for new products, e.g. 19.99'],
  ['discount_percent', '0 to 90'],
  ['stock_quantity', 'Whole units'],
  ['status', 'active, draft, or archived (new products: draft)'],
  ['description', ''],
  ['tags', 'Separated by |'],
  ['image_urls', 'https:// addresses separated by |; only new ones are added'],
]
const MAX_CSV_BYTES = 2 * 1024 * 1024

/**
 * Catalog → Import / Export (Magento's System → Data transfer), products.import:
 * download the products as CSV (with the list's filters), or upload a CSV,
 * see what it would change (a dry run, nothing saved), then "Import now".
 * With any error row, the server saves nothing.
 */
function ImportExportPage() {
  return (
    <>
      <title>Import / Export | BuyNest Admin</title>
      <PageHeader title="Import / Export" description="Products as a CSV file: download them, or add and update many at once." />
      <ExportPanel />
      <ImportPanel />
    </>
  )
}

function ExportPanel() {
  const [params] = useSearchParams()
  const [filters, setFilters] = useState({ q: params.get('q') ?? '', category: params.get('category') ?? '', status: params.get('status') ?? '' })
  const categories = useQuery({ queryKey: adminKeys.categories, queryFn: ({ signal }) => getCategories({ signal }), staleTime: Infinity })
  const set = (key) => (event) => setFilters({ ...filters, [key]: event.target.value })
  return (
    <section className="panel form panel--padded" aria-labelledby="export-title">
      <h2 id="export-title" className="panel__title">
        Export
      </h2>
      <p className="field__hint">The same filters as the product list. Leave them empty for every product.</p>
      <div className="form__grid">
        <Field label="Search">
          {(a11y) => <input {...a11y} type="search" value={filters.q} maxLength={100} placeholder="Name or brand" onChange={set('q')} />}
        </Field>
        <Field label="Category">
          {(a11y) => (
            <select {...a11y} value={filters.category} onChange={set('category')}>
              <option value="">All categories</option>
              {withPaths(categories.data).map((category) => (
                <option key={category.slug} value={category.slug}>
                  {category.path}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Status">
          {(a11y) => (
            <select {...a11y} value={filters.status} onChange={set('status')}>
              <option value="">All statuses</option>
              {Object.entries(PRODUCT_STATUSES).map(([value, { label }]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="form__actions">
        <a className="btn btn--primary" href={productsCsvUrl({ ...filters, q: filters.q.trim() })} download>
          <LuDownload aria-hidden="true" /> Download CSV
        </a>
      </div>
    </section>
  )
}

function ImportPanel() {
  const queryClient = useQueryClient()
  const inputId = useId()
  const fileInput = useRef(null)
  const resultRef = useRef(null)
  const [file, setFile] = useState(null)
  const [fileError, setFileError] = useState(null)
  const [report, setReport] = useState(null) // the last answer: a dry run or the import itself
  const [error, setError] = useState(null)

  useEffect(() => {
    if (report || error) resultRef.current?.focus()
  }, [report, error])

  const run = useMutation({
    mutationFn: ({ dryRun }) => importProducts(file, { dryRun }),
    onSuccess: (result) => {
      setError(null)
      setReport(result)
      if (!result.dryRun) {
        queryClient.invalidateQueries({ queryKey: ['products'] })
        queryClient.invalidateQueries({ queryKey: ['product'] })
        queryClient.invalidateQueries({ queryKey: adminKeys.overview })
      }
    },
    onError: (failure) => {
      // Error rows can come back as a 422 with the report.
      setReport(failure.report)
      setError(failure.report ? null : failure)
    },
  })

  function choose(event) {
    const chosen = event.target.files?.[0] ?? null
    setReport(null)
    setError(null)
    setFile(chosen)
    if (!chosen) return setFileError(null)
    if (!/\.csv$/i.test(chosen.name)) setFileError('Choose a .csv file.')
    else if (chosen.size > MAX_CSV_BYTES) setFileError(`The file is ${(chosen.size / 1024 / 1024).toFixed(1)} MB; the limit is 2 MB (about 5,000 rows).`)
    else setFileError(null)
  }

  function check(event) {
    event.preventDefault()
    if (!file) return setFileError('Choose a CSV file first.')
    if (fileError) return
    run.mutate({ dryRun: true })
  }

  const errors = report?.errors ?? []
  // Phase 11: notes that don't stop the import (e.g. an unknown SKU in a related-products column, which is skipped).
  const warnings = report?.warnings ?? []
  const canImport = report?.dryRun && errors.length === 0 && report.created + report.updated > 0
  return (
    <section className="panel form panel--padded" aria-labelledby="import-title">
      <h2 id="import-title" className="panel__title">
        Import
      </h2>
      <p className="field__hint">
        UTF-8 CSV with a header row, up to 2 MB and 5,000 rows; columns in any order. Checking the file saves nothing. If any row has an error, nothing is imported.
      </p>
      <details className="csv-columns">
        <summary>Columns</summary>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Column</th>
              <th scope="col">Notes</th>
            </tr>
          </thead>
          <tbody>
            {CSV_COLUMNS.map(([column, note]) => (
              <tr key={column}>
                <td>
                  <code>{column}</code>
                </td>
                <td>{note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <form onSubmit={check} noValidate>
        <div className="field">
          <label htmlFor={inputId}>CSV file</label>
          <input
            id={inputId}
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            aria-invalid={fileError ? true : undefined}
            aria-describedby={fileError ? `${inputId}-error` : undefined}
            onChange={choose}
          />
          {fileError && (
            <span id={`${inputId}-error`} className="field__error">
              {fileError}
            </span>
          )}
        </div>
        <div className="form__actions">
          <button type="submit" className="btn btn--outline" disabled={run.isPending}>
            <LuFileCheck aria-hidden="true" /> {run.isPending && run.variables?.dryRun ? 'Checking…' : 'Check file'}
          </button>
          {canImport && (
            <button type="button" className="btn btn--primary" disabled={run.isPending} onClick={() => run.mutate({ dryRun: false })}>
              <LuUpload aria-hidden="true" /> {run.isPending ? 'Importing…' : 'Import now'}
            </button>
          )}
        </div>
      </form>

      <div role={error || errors.length > 0 ? 'alert' : 'status'}>
        {error && (
          <p ref={resultRef} tabIndex={-1} className="form-error">
            {actionErrorMessage(error)}
          </p>
        )}
        {report && (
          <div ref={resultRef} tabIndex={-1} className={errors.length > 0 ? 'form-error import-report' : 'notice notice--success import-report'}>
            <p>
              <strong>{report.dryRun ? 'Check finished (nothing saved yet).' : errors.length > 0 ? 'Nothing was imported.' : 'Import finished.'}</strong>{' '}
              {formatCount(report.rows)} {report.rows === 1 ? 'row' : 'rows'}: {formatCount(report.created)} {report.dryRun ? 'to create' : 'created'}, {formatCount(report.updated)}{' '}
              {report.dryRun ? 'to update' : 'updated'}, {formatCount(report.unchanged)} unchanged
              {errors.length > 0 ? `, ${formatCount(errors.length)} ${errors.length === 1 ? 'error' : 'errors'}.` : '.'}
            </p>
            {errors.length > 0 && <p>Fix the rows below and check the file again.</p>}
            {warnings.length > 0 && (
              <p>
                {formatCount(warnings.length)} {warnings.length === 1 ? 'note' : 'notes'}: some values were skipped (listed below).
              </p>
            )}
            {canImport && <p>Ready: choose “Import now” to save these changes.</p>}
          </div>
        )}
      </div>

      {errors.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <caption>Rows with errors</caption>
            <thead>
              <tr>
                <th scope="col" className="num">
                  Row
                </th>
                <th scope="col">Column</th>
                <th scope="col">Problem</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((entry, index) => (
                <tr key={`${entry.row}-${entry.column}-${index}`}>
                  <td className="num">{entry.row ?? '—'}</td>
                  <td>{entry.column ? <code>{entry.column}</code> : '—'}</td>
                  <td>{entry.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <caption>Skipped values (the rest of each row is still imported)</caption>
            <thead>
              <tr>
                <th scope="col" className="num">
                  Row
                </th>
                <th scope="col">Column</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {warnings.map((entry, index) => (
                <tr key={`${entry.row}-${entry.column}-${index}`}>
                  <td className="num">{entry.row ?? '—'}</td>
                  <td>{entry.column ? <code>{entry.column}</code> : '—'}</td>
                  <td>{entry.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default ImportExportPage
