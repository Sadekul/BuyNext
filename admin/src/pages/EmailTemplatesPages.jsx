import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuArrowLeft, LuPencil, LuRotateCcw, LuSend } from 'react-icons/lu'
import { getEmailTemplate, getEmailTemplates, previewEmailTemplate, resetEmailTemplate, systemKeys, testEmailTemplate, updateEmailTemplate } from '../api/admin'
import ConfirmDialog from '../components/ConfirmDialog'
import Field from '../components/Field'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatDate } from '../utils/format'
import { actionErrorMessage } from '../utils/permissions'

const PREVIEW_DELAY_MS = 500
const customizedStatus = (template) => (template.isCustomized ? { tone: 'info', label: 'Customized' } : { tone: 'neutral', label: 'Default' })
/** Every {{ name }} in a text (the names). */
const variablesIn = (text) => [...text.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map((match) => match[1])

/** Content → Email templates (Magento's Marketing → Email templates). Needs email_templates.manage. */
export function EmailTemplatesPage() {
  const templates = useQuery({ queryKey: systemKeys.emailTemplates, queryFn: ({ signal }) => getEmailTemplates({ signal }) })

  return (
    <>
      <title>Email templates | BuyNest Admin</title>
      <PageHeader title="Email templates" description="Every email the store sends. Change the wording; reset to go back to BuyNest's default." />
      {templates.isPending && <Loading label="Loading email templates…" />}
      {templates.error && <ErrorState error={templates.error} onRetry={templates.refetch} />}
      {templates.data && templates.data.templates.length === 0 && <Empty>No email templates.</Empty>}
      {templates.data && templates.data.templates.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <caption className="visually-hidden">Email templates</caption>
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Subject</th>
                <th scope="col">Status</th>
                <th scope="col">Changed</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {templates.data.templates.map((template) => (
                <tr key={template.key}>
                  <th scope="row">
                    <Link to={`/email-templates/${template.key}`}>{template.name}</Link>
                    {template.description && <small className="muted table__sub">{template.description}</small>}
                  </th>
                  <td>{template.subject}</td>
                  <td>
                    <StatusBadge {...customizedStatus(template)} />
                  </td>
                  <td>{template.isCustomized ? formatDate(template.updatedAt) : '—'}</td>
                  <td className="table__actions">
                    <Link to={`/email-templates/${template.key}`} className="icon-button" aria-label={`Edit ${template.name}`}>
                      <LuPencil aria-hidden="true" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/** /email-templates/:templateKey. */
export function EmailTemplateEditorPage() {
  const { templateKey } = useParams()
  const template = useQuery({ queryKey: systemKeys.emailTemplate(templateKey), queryFn: ({ signal }) => getEmailTemplate(templateKey, { signal }) })
  // Kept here: the editor below remounts after a save or reset, the message stays.
  const [notice, setNotice] = useState(null)
  const noticeRef = useRef(null)
  const say = (text, tone = 'success') => {
    setNotice({ text, tone })
    requestAnimationFrame(() => noticeRef.current?.focus())
  }

  if (template.isPending) return <Loading label="Loading the template…" />
  if (template.error) return <ErrorState error={template.error} onRetry={template.refetch} />
  const saved = template.data
  return (
    <>
      <title>{`${saved.name} | Email templates | BuyNest Admin`}</title>
      <Link to="/email-templates" className="back-link">
        <LuArrowLeft aria-hidden="true" /> Email templates
      </Link>
      <PageHeader
        title={saved.name}
        description={
          <>
            <StatusBadge {...customizedStatus(saved)} />
            {saved.isCustomized && saved.updatedAt && (
              <span className="muted">
                {' '}
                Changed {formatDate(saved.updatedAt)}
                {saved.updatedBy ? ` by ${saved.updatedBy}` : ''}
              </span>
            )}
          </>
        }
      />
      {saved.description && <p className="page-note muted">{saved.description}</p>}
      <div role={notice?.tone === 'error' ? 'alert' : 'status'}>
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className={notice.tone === 'success' ? 'notice notice--success' : 'form-error'}>
            {notice.text}
          </p>
        )}
      </div>
      {/* Remounted after a save or reset, so the form starts from what the server has. */}
      <TemplateEditor key={`${saved.key}|${saved.updatedAt}|${saved.isCustomized}`} saved={saved} say={say} />
    </>
  )
}

/** `value`, `delay` ms after it last changed (so the preview isn't asked on every key). */
function useSettled(value, delay) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return settled
}

/**
 * The editor: subject and HTML body with the template's variables, a live
 * preview with sample data (rendered by the server and shown in a sandboxed
 * frame, where no script can run), a test send to the admin's own address,
 * and reset to default.
 */
function TemplateEditor({ saved, say }) {
  const queryClient = useQueryClient()
  const [values, setValues] = useState({ subject: saved.subject, body: saved.body })
  const [errors, setErrors] = useState({})
  const [confirmReset, setConfirmReset] = useState(false)
  const bodyRef = useRef(null)
  const variables = saved.variables ?? []
  const known = new Set(variables.map((variable) => variable.name))
  const blocks = new Set(variables.filter((variable) => variable.kind === 'block').map((variable) => variable.name))
  const requiredGroups = saved.requiredGroups ?? variables.filter((variable) => variable.required).map((variable) => [variable.name])

  const refresh = (template) => {
    queryClient.setQueryData(systemKeys.emailTemplate(saved.key), { ...template, live: true })
    queryClient.invalidateQueries({ queryKey: systemKeys.emailTemplates })
  }
  const failed = (error) => {
    setErrors(error.fieldErrors ?? {})
    say(actionErrorMessage(error), 'error')
  }

  const draft = useSettled(values, PREVIEW_DELAY_MS)
  const preview = useQuery({
    queryKey: ['email-preview', saved.key, draft],
    queryFn: ({ signal }) => previewEmailTemplate(saved.key, draft, { signal }),
    placeholderData: (previous) => previous,
    retry: false,
    staleTime: Infinity,
  })

  /** Client-side checks; the server repeats them (422) and has the last word. */
  function check() {
    const found = {}
    if (!values.subject.trim()) found.subject = ['Enter a subject.']
    else if (values.subject.length > 255) found.subject = ['Keep the subject under 255 characters.']
    const inSubject = variablesIn(values.subject)
    const used = [...inSubject, ...variablesIn(values.body)]
    const unknown = [...new Set(used.filter((name) => !known.has(name)))]
    const blockInSubject = inSubject.find((name) => blocks.has(name))
    // Each group needs at least one of its variables (e.g. {{ button }} or {{ confirm_url }}).
    const missing = requiredGroups.find((group) => !group.some((name) => used.includes(name)))
    const tokens = (names, joiner) => names.map((name) => `{{ ${name} }}`).join(joiner)
    if (!found.subject && blockInSubject) found.subject = [`{{ ${blockInSubject} }} can only be used in the body.`]
    if (!values.body.trim()) found.body = ['Enter the email body.']
    else if (unknown.length > 0) found.body = [`Unknown variables: ${tokens(unknown, ', ')}. Use only the variables listed.`]
    else if (missing) found.body = [`This email must include ${tokens(missing, ' or ')}.`]
    setErrors(found)
    return Object.keys(found).length === 0
  }

  const save = useMutation({
    mutationFn: () => updateEmailTemplate(saved.key, { subject: values.subject.trim(), body: values.body }),
    onSuccess: ({ template }) => {
      const cleaned = template.body !== values.body ? ' Some HTML was removed by the safety filter.' : ''
      say(`Template saved. New emails use it now.${cleaned}`)
      refresh(template)
    },
    onError: failed,
  })
  const sendTest = useMutation({
    mutationFn: () => testEmailTemplate(saved.key, { subject: values.subject.trim(), body: values.body }),
    onSuccess: (result) => say(result.message || `Test email sent to ${result.to}.`),
    onError: failed,
  })
  const reset = useMutation({
    mutationFn: () => resetEmailTemplate(saved.key),
    onSuccess: ({ template }) => {
      setConfirmReset(false)
      say('Back to the default template.')
      refresh(template)
    },
    onError: (error) => {
      setConfirmReset(false)
      failed(error)
    },
  })

  function insertVariable(name) {
    const token = `{{ ${name} }}`
    const textarea = bodyRef.current
    const start = textarea?.selectionStart ?? values.body.length
    const end = textarea?.selectionEnd ?? values.body.length
    setValues((current) => ({ ...current, body: current.body.slice(0, start) + token + current.body.slice(end) }))
    requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const busy = save.isPending || sendTest.isPending || reset.isPending
  const unsaved = values.subject !== saved.subject || values.body !== saved.body
  const previewProblem = preview.error && (preview.error.fieldErrors ? Object.values(preview.error.fieldErrors).flat()[0] : actionErrorMessage(preview.error))
  return (
    <div className="editor">
      <form
        className="form panel"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (check()) save.mutate()
        }}
      >
        <Field label="Subject" error={errors.subject?.[0]}>
          {(a11y) => <input {...a11y} value={values.subject} maxLength={255} onChange={(event) => setValues({ ...values, subject: event.target.value })} />}
        </Field>
        <Field label="Body (HTML)" error={errors.body?.[0]} hint="Paragraphs, headings, lists, bold, italics, links, and tables. Scripts and styles are removed when saved.">
          {(a11y) => (
            <textarea {...a11y} ref={bodyRef} className="editor__body" rows={16} value={values.body} spellCheck onChange={(event) => setValues({ ...values, body: event.target.value })} />
          )}
        </Field>

        <section aria-labelledby="variables-title" className="variables">
          <h2 id="variables-title" className="panel__title">
            Variables
          </h2>
          <p className="field__hint">Insert one at the cursor in the body; each email fills in its own value. Blocks are ready-made HTML and go in the body only.</p>
          {requiredGroups.length > 0 && (
            <p className="field__hint">
              Must include:{' '}
              {requiredGroups.map((group) => group.map((name) => `{{ ${name} }}`).join(' or ')).join('; ')}.
            </p>
          )}
          <ul className="variables__list">
            {variables.map((variable) => (
              <li key={variable.name}>
                <button type="button" className="btn btn--outline btn--sm" aria-label={`Insert ${variable.name}${variable.required ? ' (required)' : ''}`} onClick={() => insertVariable(variable.name)}>
                  <code>{`{{ ${variable.name} }}`}</code>
                </button>
                <span className="variables__text">
                  {variable.description}
                  {variable.kind === 'block' && <span className="muted"> (block)</span>} {variable.required && <StatusBadge tone="warning" label="Required" />}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <div className="form__actions">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {save.isPending ? 'Saving…' : 'Save template'}
          </button>
          <button type="button" className="btn btn--outline" disabled={busy} onClick={() => check() && sendTest.mutate()}>
            <LuSend aria-hidden="true" /> {sendTest.isPending ? 'Sending…' : 'Send test to me'}
          </button>
          {saved.isCustomized && (
            <button type="button" className="btn btn--outline" disabled={busy} onClick={() => setConfirmReset(true)}>
              <LuRotateCcw aria-hidden="true" /> Reset to default
            </button>
          )}
          {unsaved && <span className="muted">Unsaved changes</span>}
        </div>
      </form>

      <section className="panel editor__preview" aria-labelledby="email-preview-title" aria-busy={preview.isFetching}>
        <h2 id="email-preview-title" className="panel__title">
          Preview
        </h2>
        <p className="field__hint">With sample data. It follows your changes; nothing is saved until you save.</p>
        {preview.isPending && !previewProblem && <Loading label="Rendering the preview…" />}
        {previewProblem && (
          <p className="form-error" role="alert">
            {previewProblem}
          </p>
        )}
        {preview.data && (
          <>
            <p className="email-preview__subject">
              <span className="muted">Subject: </span>
              <strong>{preview.data.subject}</strong>
            </p>
            {/* An empty sandbox: the server's rendered HTML can't run scripts, submit forms, or navigate this page. */}
            <iframe className="email-preview" title={`Preview of ${saved.name}`} sandbox="" srcDoc={preview.data.html} />
          </>
        )}
      </section>

      <ConfirmDialog
        isOpen={confirmReset}
        title={`Reset "${saved.name}"?`}
        message="Your changes to this email are deleted and BuyNest's default is used again. This can't be undone."
        confirmLabel="Reset to default"
        busy={reset.isPending}
        onConfirm={() => reset.mutate()}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  )
}
