import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuArrowLeft, LuCircleCheck, LuListChecks, LuRotateCcw, LuSend, LuTriangleAlert } from 'react-icons/lu'
import { getSms, phase20Keys, sendTestSms, updateSmsSettings } from '../api/phase20'
import { useAdminAuth } from '../auth/useAdminAuth'
import Field from '../components/Field'
import PageHeader from '../components/PageHeader'
import StatTile from '../components/StatTile'
import StatusBadge from '../components/StatusBadge'
import Tabs from '../components/Tabs'
import { ErrorState, Loading } from '../components/States'
import { formatCount } from '../utils/format'
import { MAX_TEMPLATE, SMS_EVENTS, SMS_EVENT_KEYS, SMS_LANGUAGES, SMS_PROVIDERS, insertAt, smsErrors, smsSettingsToForm, templateCountText, toSmsPayload, unknownVariables, variableDescription, variableNames } from '../utils/sms'
import { smsCountText } from '../utils/smsText'

/*
 * Phase 20 §2, Settings → SMS: a text to the customer at each step of an
 * order (placed, confirmed, shipped, delivered, cancelled), and a one-tap
 * confirmation link for cash on delivery orders. Off by default. The
 * provider's keys live in backend/.env: this page names the variables, never
 * a value. settings.view to see, settings.edit to change and send a test.
 */

const LANGUAGE_NAMES = { en: 'English', bn: 'Bangla' }
const BD_MOBILE = /^(?:\+?88)?01[3-9]\d{8}$/

export default function SmsSettingsPage() {
  const { can } = useAdminAuth()
  const sms = useQuery({ queryKey: phase20Keys.sms, queryFn: ({ signal }) => getSms({ signal }) })
  // Kept here: the form is remade with the saved settings after a save.
  const [justSaved, setJustSaved] = useState(false)
  return (
    <>
      <title>SMS | BuyNest Admin</title>
      <Link to="/settings" className="back-link">
        <LuArrowLeft aria-hidden="true" /> Settings
      </Link>
      <PageHeader
        title="SMS notifications"
        description="A text to the customer at each step of an order, in English or Bangla, and a one-tap link that confirms a cash on delivery order without a phone call."
      />
      {sms.isPending && <Loading label="Loading the SMS settings…" />}
      {sms.error && <ErrorState error={sms.error} onRetry={sms.refetch} />}
      {sms.data && (
        <div className="settings">
          <section aria-labelledby="sms-stats">
            <h2 id="sms-stats" className="visually-hidden">
              Texts so far
            </h2>
            <dl className="stats stats--three">
              <StatTile label="Sent today" value={formatCount(sms.data.stats.sentToday)} />
              <StatTile label="Failed today" value={formatCount(sms.data.stats.failedToday)} note={sms.data.stats.failedToday > 0 ? 'Retried every 10 minutes, or from the SMS log' : undefined} />
              <StatTile label="Last 30 days" value={formatCount(sms.data.stats.sent30d)} note="Texts sent" />
            </dl>
            {can('orders.view') && (
              <p>
                <Link to="/sms">
                  <LuListChecks aria-hidden="true" /> Open the SMS log
                </Link>
              </p>
            )}
          </section>
          {/* key: a fresh form once the saved settings change (after Save). */}
          <SmsSettingsForm
            key={JSON.stringify(sms.data.settings)}
            saved={sms.data.settings}
            providers={sms.data.providers}
            defaults={sms.data.defaults?.templates ?? {}}
            variables={sms.data.defaults?.variables}
            justSaved={justSaved}
            onSaved={setJustSaved}
          />
          {can('settings.edit') && <SmsTestForm provider={sms.data.settings.provider} />}
        </div>
      )}
    </>
  )
}

function SmsSettingsForm({ saved, providers, defaults, variables, justSaved, onSaved }) {
  const { can } = useAdminAuth()
  const editable = can('settings.edit')
  const queryClient = useQueryClient()
  const [initial] = useState(() => smsSettingsToForm(saved, defaults))
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState(null)
  const noticeRef = useRef(null)
  const savedRef = useRef(null)
  const changed = JSON.stringify(form) !== JSON.stringify(initial)
  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])
  // After a save, this form is new: the success notice takes the focus.
  useEffect(() => {
    if (justSaved) savedRef.current?.focus()
  }, [justSaved])

  const update = (changes) => {
    onSaved(false)
    setForm((current) => ({ ...current, ...(typeof changes === 'function' ? changes(current) : changes) }))
  }
  const toggleEvent = (event) => (change) => update((current) => ({ events: change.target.checked ? [...current.events, event] : current.events.filter((key) => key !== event) }))
  const setTemplate = (event, locale, text) => update((current) => ({ templates: { ...current.templates, [event]: { ...current.templates[event], [locale]: text } } }))

  const save = useMutation({
    mutationFn: (body) => updateSmsSettings(body),
    onSuccess: (data) => {
      setErrors({})
      onSaved(true)
      // The settings and stats as saved; the form is remade with them (its key).
      queryClient.setQueryData(phase20Keys.sms, data)
    },
    onError: (error) => {
      setErrors(error.fieldErrors ?? {})
      setNotice({ text: error.fieldErrors ? 'Please check the highlighted fields.' : error.message })
    },
  })

  function submit(event) {
    event.preventDefault()
    const found = smsErrors(form)
    setErrors(found)
    if (Object.keys(found).length > 0) return setNotice({ text: 'Please check the highlighted fields.' })
    setNotice(null)
    onSaved(false)
    save.mutate(toSmsPayload(form, initial, defaults))
  }

  const known = providers.length > 0 ? providers : Object.keys(SMS_PROVIDERS).map((key) => ({ key, label: SMS_PROVIDERS[key].label, configured: key === 'log' }))
  const providerError = errors.provider?.[0]
  return (
    <form className="panel form settings__group" aria-labelledby="sms-settings" noValidate onSubmit={submit}>
      <h2 id="sms-settings" className="panel__title">
        SMS settings
      </h2>
      <div role="status">
        {justSaved && (
          <p ref={savedRef} tabIndex={-1} className="notice notice--success">
            SMS settings saved.
          </p>
        )}
      </div>
      <div role={notice ? 'alert' : undefined}>
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className="form-error">
            {notice.text}
          </p>
        )}
      </div>
      <fieldset disabled={!editable} className="form__fieldset">
        <div className="welcome-switch">
          <label className="checkbox">
            <input type="checkbox" role="switch" checked={form.enabled} onChange={(event) => update({ enabled: event.target.checked })} aria-describedby="sms-state" />
            SMS notifications
          </label>
          <span id="sms-state">
            <StatusBadge tone={form.enabled ? 'success' : 'neutral'} label={form.enabled ? 'On: customers get order texts' : 'Off: no texts are sent'} />
          </span>
        </div>

        <fieldset className="sms-providers" aria-describedby={providerError ? 'sms-provider-error' : undefined}>
          <legend>Provider</legend>
          <div className="sms-providers__cards">
            {known.map((provider) => {
              const info = SMS_PROVIDERS[provider.key] ?? { note: '', env: [] }
              const noteId = `sms-provider-${provider.key}-note`
              return (
                <div key={provider.key} className="sms-provider">
                  <label className="sms-provider__head">
                    <input
                      type="radio"
                      name="sms-provider"
                      value={provider.key}
                      checked={form.provider === provider.key}
                      // A provider without its keys can't be chosen (the API refuses it too).
                      disabled={!provider.configured && initial.provider !== provider.key}
                      onChange={() => update({ provider: provider.key })}
                      aria-describedby={noteId}
                    />
                    <span className="sms-provider__name">{provider.label}</span>
                  </label>
                  <span id={noteId} className="sms-provider__note">
                    {provider.configured ? <StatusBadge tone="success" icon={LuCircleCheck} label="Set up" /> : <StatusBadge tone="warning" icon={LuTriangleAlert} label="Not set up" />}
                    <span className="field__hint">{info.note}</span>
                  </span>
                </div>
              )
            })}
          </div>
          {providerError && (
            <span id="sms-provider-error" className="field__error">
              {providerError}
            </span>
          )}
        </fieldset>
        <details className="courier-card__setup sms-setup">
          <summary>How to set up a provider</summary>
          <ol>
            <li>Open an account with SSL Wireless or BulkSMSBD and get an approved sender id (masking or non-masking).</li>
            <li>
              Put the provider’s details in <code>backend/.env</code> (never in this admin or in git), under these names:
              {Object.entries(SMS_PROVIDERS)
                .filter(([, info]) => info.env.length > 0)
                .map(([key, info]) => (
                  <div key={key} className="sms-setup__provider">
                    <strong>{info.label}</strong>
                    <ul className="courier-card__env">
                      {info.env.map((name) => (
                        <li key={name}>
                          <code>{name.split(' ')[0]}</code>
                          {name.includes(' ') && <span className="muted"> {name.slice(name.indexOf(' ') + 1)}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </li>
            <li>Restart the API so it reads them, then come back here: the provider says “Set up”.</li>
            <li>Choose it, save, and send a test SMS to your own phone before turning SMS on for customers.</li>
          </ol>
        </details>

        <fieldset className="scope-list" aria-describedby={errors.events ? 'sms-events-error' : undefined}>
          <legend>Texts to send</legend>
          {SMS_EVENT_KEYS.map((event) => (
            <div key={event} className="sms-event">
              <label className="checkbox">
                <input type="checkbox" checked={form.events.includes(event)} onChange={toggleEvent(event)} aria-describedby={`sms-event-${event}`} />
                {SMS_EVENTS[event].label}
              </label>
              <span id={`sms-event-${event}`} className="field__hint">
                {SMS_EVENTS[event].description}
              </span>
            </div>
          ))}
          {errors.events && (
            <span id="sms-events-error" className="field__error">
              {errors.events[0]}
            </span>
          )}
        </fieldset>
        <label className="checkbox">
          <input type="checkbox" checked={form.confirmLink} onChange={(event) => update({ confirmLink: event.target.checked })} aria-describedby="sms-link-hint" />
          Include a one-tap confirmation link
        </label>
        <p id="sms-link-hint" className="field__hint">
          In the “Please confirm” text: the customer opens it to confirm or cancel the order, and it moves out of To confirm without a phone call. Each link works once, for 72 hours.
        </p>
      </fieldset>

      <TemplateEditor form={form} defaults={defaults} variables={variableNames(variables)} errors={errors} editable={editable} onChange={setTemplate} />

      {editable ? (
        <div className="form__actions">
          <button type="submit" className="btn btn--primary" disabled={save.isPending || !changed}>
            {save.isPending ? 'Saving…' : 'Save SMS settings'}
          </button>
        </div>
      ) : (
        <p className="muted">Your role can view these settings but not change them.</p>
      )}
    </form>
  )
}

/** One template at a time: the text (picked with "Template"), English / বাংলা tabs, variables, counter, reset. */
function TemplateEditor({ form, defaults, variables, errors, editable, onChange }) {
  const [event, setEvent] = useState(SMS_EVENT_KEYS[0])
  const [locale, setLocale] = useState('en')
  const textRef = useRef(null)
  const baseId = useId()
  const text = form.templates[event]?.[locale] ?? ''
  const fallback = defaults[event]?.[locale] ?? ''
  const unknown = unknownVariables(text, variables)
  const error = errors[`templates.${event}.${locale}`]?.[0]
  const counterId = `${baseId}-counter`
  const errorId = `${baseId}-error`

  function insert(name) {
    const area = textRef.current
    const { text: next, caret } = insertAt(text, `{${name}}`, area?.selectionStart, area?.selectionEnd)
    onChange(event, locale, next)
    requestAnimationFrame(() => {
      area?.focus()
      area?.setSelectionRange(caret, caret)
    })
  }

  return (
    <section className="sms-templates" aria-labelledby="sms-templates">
      <h3 id="sms-templates" className="sms-templates__heading">
        Templates
      </h3>
      <p className="field__hint">The customer gets the text in their language (their account’s, else the order’s). Leave a text as it is to use the default.</p>
      <Field label="Template">
        {(a11y) => (
          <select {...a11y} value={event} onChange={(change) => setEvent(change.target.value)}>
            {SMS_EVENT_KEYS.map((key) => (
              <option key={key} value={key}>
                {SMS_EVENTS[key].label}
                {form.events.includes(key) ? '' : ' (not sent)'}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Tabs label="Template language" tabs={Object.entries(SMS_LANGUAGES).map(([id, label]) => ({ id, label }))} selected={locale} onSelect={setLocale}>
        {() => (
          <div className="sms-template">
            <div className="field">
              <label htmlFor={`${baseId}-text`}>
                {SMS_EVENTS[event].label} text ({LANGUAGE_NAMES[locale]})
              </label>
              <textarea
                id={`${baseId}-text`}
                ref={textRef}
                rows={4}
                lang={locale}
                value={text}
                readOnly={!editable}
                maxLength={MAX_TEMPLATE}
                onChange={(change) => onChange(event, locale, change.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={[counterId, error && errorId].filter(Boolean).join(' ')}
              />
              <span id={counterId} className="sms-counter">
                {templateCountText(text, variables)}
              </span>
              {error && (
                <span id={errorId} className="field__error">
                  {error}
                </span>
              )}
            </div>
            <div role="status" className="sms-template__warning">
              {unknown.length > 0 && (
                <p className="field__error">
                  <LuTriangleAlert aria-hidden="true" /> {unknown.length === 1 ? 'Unknown variable' : 'Unknown variables'} {unknown.map((name) => `{${name}}`).join(', ')}: left out of the text.
                </p>
              )}
            </div>
            {editable && (
              <>
                <div role="group" aria-labelledby={`${baseId}-variables`} className="sms-variables">
                  <span id={`${baseId}-variables`} className="sms-variables__label">
                    Insert a variable:
                  </span>
                  {variables.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className="btn btn--outline btn--sm sms-variables__button"
                      title={variableDescription(name)}
                      aria-label={`Insert {${name}}: ${variableDescription(name)}`}
                      onClick={() => insert(name)}
                    >
                      <code>{`{${name}}`}</code>
                    </button>
                  ))}
                </div>
                <p className="field__hint">Counted as written: names, totals and links make the real text longer. A link or a Bangla word makes it Unicode (70 characters a text).</p>
                <div className="sms-template__actions">
                  <button type="button" className="btn btn--outline btn--sm" disabled={text === fallback} onClick={() => onChange(event, locale, fallback)}>
                    <LuRotateCcw aria-hidden="true" /> Reset to default
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </Tabs>
    </section>
  )
}

/** Settings → SMS → Send a test SMS: through the saved provider (the log driver only saves it). */
function SmsTestForm({ provider }) {
  const queryClient = useQueryClient()
  const [to, setTo] = useState('')
  const [body, setBody] = useState('')
  const [errors, setErrors] = useState({})
  const resultRef = useRef(null)
  const test = useMutation({
    mutationFn: (values) => sendTestSms(values),
    onSuccess: () => {
      setErrors({})
      queryClient.invalidateQueries({ queryKey: ['sms'] })
    },
    onError: (error) => setErrors(error.fieldErrors ?? {}),
    onSettled: () => requestAnimationFrame(() => resultRef.current?.focus()),
  })

  function submit(event) {
    event.preventDefault()
    const found = {}
    if (!BD_MOBILE.test(to.replace(/[\s\-().]/g, ''))) found.to = ['Enter a Bangladeshi mobile number, like 01712345678.']
    if (body.length > MAX_TEMPLATE) found.body = [`Keep the text to ${MAX_TEMPLATE} characters.`]
    setErrors(found)
    if (Object.keys(found).length > 0) return
    test.reset()
    test.mutate({ to: to.trim(), ...(body.trim() && { body: body.trim() }) })
  }

  const message = test.data?.message
  const failed = message?.status === 'failed'
  return (
    <form className="panel form settings__group" aria-labelledby="sms-test" noValidate onSubmit={submit}>
      <h2 id="sms-test" className="panel__title">
        Send a test SMS
      </h2>
      <p className="field__hint">
        Through the saved provider ({SMS_PROVIDERS[provider]?.label ?? provider}){provider === 'log' ? ': saved in the SMS log and the dev SMS inbox, not sent to a phone.' : '.'} Save your changes first.
      </p>
      <div className="form__grid">
        <Field label="Mobile number" error={errors.to?.[0]} hint="A Bangladeshi mobile, like 01712345678.">
          {(a11y) => <input {...a11y} type="tel" inputMode="tel" autoComplete="off" value={to} onChange={(event) => setTo(event.target.value)} />}
        </Field>
        <Field label="Text (optional)" error={errors.body?.[0]} hint={body ? smsCountText(body) : 'Empty: a short standard test text.'}>
          {(a11y) => <textarea {...a11y} rows={2} maxLength={MAX_TEMPLATE} value={body} onChange={(event) => setBody(event.target.value)} />}
        </Field>
      </div>
      <div className="form__actions">
        <button type="submit" className="btn btn--primary" disabled={test.isPending}>
          <LuSend aria-hidden="true" /> {test.isPending ? 'Sending…' : 'Send test SMS'}
        </button>
      </div>
      <div role={failed || (test.error && !test.error.fieldErrors) ? 'alert' : 'status'}>
        {message && (
          <p ref={resultRef} tabIndex={-1} className={failed ? 'form-error' : 'notice notice--success'}>
            {failed
              ? `The test SMS to ${message.to} failed: ${message.error ?? 'the provider refused it.'}`
              : message.status === 'sent'
                ? `Test SMS sent to ${message.to}${provider === 'log' ? ' (saved only: test mode).' : '.'}`
                : `Test SMS to ${message.to} is waiting to send.`}
          </p>
        )}
        {test.error && !test.error.fieldErrors && (
          <p ref={resultRef} tabIndex={-1} className="form-error">
            {test.error.message}
          </p>
        )}
      </div>
    </form>
  )
}
