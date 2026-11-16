import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuArrowLeft, LuDownload, LuMailX, LuPlus, LuSearch, LuSend, LuTrash2 } from 'react-icons/lu'
import {
  createCampaign,
  deleteCampaign,
  getCampaign,
  getCampaigns,
  getSubscribers,
  marketingKeys,
  sendCampaign,
  subscribersCsvUrl,
  testCampaign,
  unsubscribeSubscriber,
  updateCampaign,
} from '../api/marketing'
import { useAdminAuth } from '../auth/useAdminAuth'
import ConfirmDialog from '../components/ConfirmDialog'
import Field from '../components/Field'
import Notice from '../components/Notice'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import StatTile from '../components/StatTile'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount, formatDate, formatDateTime } from '../utils/format'
import { CAMPAIGN_STATUSES, SUBSCRIBER_SOURCES, SUBSCRIBER_STATUSES, campaignStatus, subscriberStatus, useNotice } from '../utils/marketing'
import { MAX_HTML_LENGTH, sanitizeHtml } from '../utils/sanitizeHtml'

/*
 * Marketing → Newsletter (phase 7): subscribers (double opt-in from the
 * store) and campaigns. newsletter.view to read and export; newsletter.send
 * to write, test, and send campaigns, and to unsubscribe someone.
 */

const LIMIT = 20

function useListParams() {
  const [params, setParams] = useSearchParams()
  function update(changes) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === '' || value === 0) next.delete(key)
      else next.set(key, String(value))
    }
    setParams(next)
  }
  return [params, update]
}

export function SubscribersPage() {
  const [params, update] = useListParams()
  const q = params.get('q') ?? ''
  const status = params.get('status') ?? ''
  const source = params.get('source') ?? ''
  const skip = Number(params.get('skip')) || 0
  const [draft, setDraft] = useState(q)
  const [pending, setPending] = useState(null)
  const { notice, setNotice, ref } = useNotice()
  const queryClient = useQueryClient()
  const { can } = useAdminAuth()
  const query = { q, status, source, skip, limit: LIMIT }
  const subscribers = useQuery({ queryKey: marketingKeys.subscribers(query), queryFn: ({ signal }) => getSubscribers(query, { signal }), placeholderData: keepPreviousData })
  const counts = subscribers.data?.counts ?? {}

  const unsubscribe = useMutation({
    mutationFn: (subscriber) => unsubscribeSubscriber(subscriber.id),
    onSuccess: (_, subscriber) => {
      setPending(null)
      queryClient.invalidateQueries({ queryKey: ['newsletter-subscribers'] })
      setNotice({ tone: 'success', text: `${subscriber.email} is unsubscribed and won’t get any more newsletters.` })
    },
    onError: (error) => {
      setPending(null)
      setNotice({ tone: 'error', text: error.message })
    },
  })

  const filtered = Boolean(q || status || source)
  return (
    <>
      <title>Newsletter subscribers | BuyNest Admin</title>
      <PageHeader
        title="Newsletter subscribers"
        description={subscribers.data ? `${formatCount(subscribers.data.total)} ${filtered ? 'matching addresses' : 'addresses'} · new sign-ups confirm by email first` : 'Who gets the newsletter'}
        actions={
          <a href={subscribersCsvUrl({ q, status, source })} className="btn btn--outline" download>
            <LuDownload aria-hidden="true" /> Export CSV
          </a>
        }
      />
      <Notice notice={notice} noticeRef={ref} />
      {subscribers.data && (
        <dl className="stats stats--compact">
          {Object.entries(SUBSCRIBER_STATUSES).map(([key, { label }]) => (
            <StatTile key={key} label={label} value={formatCount(counts[key] ?? 0)} />
          ))}
        </dl>
      )}

      <div className="toolbar">
        <form
          role="search"
          className="toolbar__search"
          onSubmit={(event) => {
            event.preventDefault()
            update({ q: draft.trim(), skip: 0 })
          }}
        >
          <label htmlFor="subscriber-search" className="visually-hidden">
            Search subscribers
          </label>
          <input id="subscriber-search" type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Email address" />
          <button type="submit" className="btn btn--outline">
            <LuSearch aria-hidden="true" /> Search
          </button>
        </form>
        <label className="toolbar__select">
          <span>Status</span>
          <select value={status} onChange={(event) => update({ status: event.target.value, skip: 0 })}>
            <option value="">Any status</option>
            {Object.entries(SUBSCRIBER_STATUSES).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar__select">
          <span>Source</span>
          <select value={source} onChange={(event) => update({ source: event.target.value, skip: 0 })}>
            <option value="">Any source</option>
            {Object.entries(SUBSCRIBER_SOURCES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {subscribers.isPending && <Loading label="Loading subscribers…" />}
      {subscribers.error && <ErrorState error={subscribers.error} onRetry={subscribers.refetch} />}
      {subscribers.data && subscribers.data.subscribers.length === 0 && <Empty>{filtered ? 'No addresses match.' : 'Nobody has signed up yet.'}</Empty>}
      {subscribers.data && subscribers.data.subscribers.length > 0 && (
        <div className="table-wrap" aria-busy={subscribers.isFetching}>
          <table className="table">
            <caption className="visually-hidden">Newsletter subscribers, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Customer</th>
                <th scope="col">Status</th>
                <th scope="col">Source</th>
                <th scope="col">Signed up</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {subscribers.data.subscribers.map((subscriber) => (
                <tr key={subscriber.id}>
                  <th scope="row">{subscriber.email}</th>
                  <td>
                    {subscriber.customerId ? (
                      can('customers.view') ? (
                        <Link to={`/customers/${subscriber.customerId}`}>{subscriber.customerName ?? `Customer #${subscriber.customerId}`}</Link>
                      ) : (
                        (subscriber.customerName ?? `Customer #${subscriber.customerId}`)
                      )
                    ) : (
                      <span className="muted">Guest</span>
                    )}
                  </td>
                  <td>
                    <StatusBadge {...subscriberStatus(subscriber.status)} />
                    {subscriber.status === 'unsubscribed' && subscriber.unsubscribedAt && (
                      <>
                        <br />
                        <small className="muted">{formatDate(subscriber.unsubscribedAt)}</small>
                      </>
                    )}
                  </td>
                  <td>{SUBSCRIBER_SOURCES[subscriber.source] ?? subscriber.source ?? '—'}</td>
                  <td>{formatDate(subscriber.createdAt)}</td>
                  <td className="table__actions">
                    {can('newsletter.send') && subscriber.status !== 'unsubscribed' && (
                      <button type="button" className="btn btn--outline btn--sm" onClick={() => setPending(subscriber)} aria-label={`Unsubscribe ${subscriber.email}`}>
                        <LuMailX aria-hidden="true" /> Unsubscribe
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={subscribers.data.total} limit={LIMIT} skip={skip} onChange={(next) => update({ skip: next })} />
        </div>
      )}

      <ConfirmDialog
        isOpen={pending !== null}
        title={`Unsubscribe ${pending?.email}?`}
        message="They stop getting newsletters at once. They can sign up again from the store."
        confirmLabel="Unsubscribe"
        busy={unsubscribe.isPending}
        onConfirm={() => unsubscribe.mutate(pending)}
        onCancel={() => setPending(null)}
      />
    </>
  )
}

/** "3 of 3 sent", "2 of 3 sent · 1 failed". */
function deliveryText(campaign) {
  if (campaign.status === 'draft') return '—'
  const failed = campaign.failedCount ? ` · ${formatCount(campaign.failedCount)} failed` : ''
  return `${formatCount(campaign.sentCount)} of ${formatCount(campaign.recipientCount ?? campaign.sentCount)} sent${failed}`
}

export function CampaignsPage() {
  const [params, update] = useListParams()
  const status = params.get('status') ?? ''
  const skip = Number(params.get('skip')) || 0
  const { can } = useAdminAuth()
  const query = { status, skip, limit: LIMIT }
  const campaigns = useQuery({ queryKey: marketingKeys.campaigns(query), queryFn: ({ signal }) => getCampaigns(query, { signal }), placeholderData: keepPreviousData })

  return (
    <>
      <title>Newsletter campaigns | BuyNest Admin</title>
      <PageHeader
        title="Newsletter campaigns"
        description={campaigns.data ? `${formatCount(campaigns.data.total)} ${status ? 'matching campaigns' : 'campaigns'}` : 'Emails to every subscriber'}
        actions={
          can('newsletter.send') && (
            <Link to="/newsletter/campaigns/new" className="btn btn--primary">
              <LuPlus aria-hidden="true" /> New campaign
            </Link>
          )
        }
      />
      <div className="toolbar">
        <label className="toolbar__select">
          <span>Status</span>
          <select value={status} onChange={(event) => update({ status: event.target.value, skip: 0 })}>
            <option value="">Any status</option>
            {Object.entries(CAMPAIGN_STATUSES).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {campaigns.isPending && <Loading label="Loading campaigns…" />}
      {campaigns.error && <ErrorState error={campaigns.error} onRetry={campaigns.refetch} />}
      {campaigns.data && campaigns.data.campaigns.length === 0 && <Empty>{status ? 'No campaigns match.' : 'No campaigns yet.'}</Empty>}
      {campaigns.data && campaigns.data.campaigns.length > 0 && (
        <div className="table-wrap" aria-busy={campaigns.isFetching}>
          <table className="table">
            <caption className="visually-hidden">Newsletter campaigns</caption>
            <thead>
              <tr>
                <th scope="col">Subject</th>
                <th scope="col">Status</th>
                <th scope="col">Delivery</th>
                <th scope="col">Sent</th>
                <th scope="col">By</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.data.campaigns.map((campaign) => (
                <tr key={campaign.id}>
                  <td>
                    <Link to={`/newsletter/campaigns/${campaign.id}`}>
                      <strong>{campaign.subject}</strong>
                    </Link>
                    {campaign.preheader && (
                      <>
                        <br />
                        <small className="muted">{campaign.preheader}</small>
                      </>
                    )}
                  </td>
                  <td>
                    <StatusBadge {...campaignStatus(campaign.status)} />
                  </td>
                  <td>{deliveryText(campaign)}</td>
                  <td>{campaign.sentAt ? formatDateTime(campaign.sentAt) : <span className="muted">Not yet</span>}</td>
                  <td>{campaign.createdByName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={campaigns.data.total} limit={LIMIT} skip={skip} onChange={(next) => update({ skip: next })} />
        </div>
      )}
    </>
  )
}

/** /newsletter/campaigns/new and /newsletter/campaigns/:campaignId. */
export function CampaignEditorPage() {
  const { campaignId } = useParams()
  const isNew = campaignId === undefined
  const campaign = useQuery({
    queryKey: marketingKeys.campaign(campaignId),
    queryFn: ({ signal }) => getCampaign(campaignId, { signal }),
    enabled: !isNew,
    // While the batches go out (a real queue), the sent count grows: check every 5 seconds.
    refetchInterval: (query) => (query.state.data?.status === 'sending' ? 5000 : false),
  })
  if (!isNew && campaign.isPending) return <Loading label="Loading the campaign…" />
  if (!isNew && campaign.error) return <ErrorState error={campaign.error} onRetry={campaign.refetch} />
  return <CampaignEditor key={campaignId ?? 'new'} saved={isNew ? null : campaign.data} />
}

const CAMPAIGN_FIELDS = ['subject', 'preheader', 'body']

function CampaignEditor({ saved }) {
  const isNew = !saved
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { can, user } = useAdminAuth()
  const draftable = !saved || saved.status === 'draft'
  const editable = can('newsletter.send') && draftable
  const [values, setValues] = useState({ subject: saved?.subject ?? '', preheader: saved?.preheader ?? '', body: saved?.body ?? '' })
  const [errors, setErrors] = useState({})
  const [confirm, setConfirm] = useState(null) // 'send' | 'delete'
  const { notice, setNotice, ref } = useNotice(location.state?.notice ? { tone: 'success', text: location.state.notice } : null)
  const dirty = !saved || CAMPAIGN_FIELDS.some((field) => (values[field] ?? '') !== (saved[field] ?? ''))
  // Cleaned like the server will clean it, as the admin types (utils/sanitizeHtml.js).
  const preview = useMemo(() => sanitizeHtml(values.body), [values.body])
  const subscribed = useQuery({
    queryKey: marketingKeys.subscribers({ status: 'subscribed', limit: 1, count: true }),
    queryFn: ({ signal }) => getSubscribers({ status: 'subscribed', limit: 1 }, { signal }),
    enabled: can('newsletter.view') && draftable && !isNew,
  })
  const audience = subscribed.data ? (subscribed.data.counts?.subscribed ?? subscribed.data.total) : null

  const set = (field) => (event) => setValues((current) => ({ ...current, [field]: event.target.value }))
  const afterSave = (campaign) => {
    queryClient.setQueryData(marketingKeys.campaign(campaign.id), { ...campaign, live: true })
    queryClient.invalidateQueries({ queryKey: ['newsletter-campaigns'] })
  }
  const fail = (error) => {
    setErrors(error.fieldErrors ?? {})
    setNotice({ tone: 'error', text: error.fieldErrors?.campaign?.[0] ?? error.message })
  }

  function check() {
    const found = {}
    if (!values.subject.trim() || values.subject.trim().length > 150) found.subject = ['Enter a subject of up to 150 characters.']
    if (values.preheader.trim().length > 150) found.preheader = ['Keep the preview text under 150 characters.']
    if (!values.body.trim() || values.body.length > MAX_HTML_LENGTH) found.body = ['Write the email (up to 100,000 characters).']
    setErrors(found)
    if (Object.keys(found).length > 0) setNotice({ tone: 'error', text: 'Please check the highlighted fields.' })
    return Object.keys(found).length === 0
  }
  const payload = () => ({ subject: values.subject.trim(), preheader: values.preheader.trim() || null, body: values.body })

  const save = useMutation({
    mutationFn: () => (isNew ? createCampaign(payload()) : updateCampaign(saved.id, payload())),
    onSuccess: ({ campaign }) => {
      afterSave(campaign)
      const cleaned = campaign.body !== values.body ? ' Some HTML was removed by the safety filter (scripts, styles, images, or unsupported tags).' : ''
      setValues({ subject: campaign.subject, preheader: campaign.preheader, body: campaign.body })
      const text = `Draft saved.${cleaned}`
      if (isNew) return navigate(`/newsletter/campaigns/${campaign.id}`, { replace: true, state: { notice: text } })
      setNotice({ tone: 'success', text })
      return undefined
    },
    onError: fail,
  })
  // A test is sent from the saved copy: save first when there are changes.
  const test = useMutation({
    mutationFn: async () => {
      if (dirty) afterSave((await updateCampaign(saved.id, payload())).campaign)
      return testCampaign(saved.id)
    },
    onSuccess: (result) => setNotice({ tone: 'success', text: result.message ?? `Test sent to ${result.email ?? user?.email ?? 'your email'}.` }),
    onError: fail,
  })
  const send = useMutation({
    mutationFn: () => sendCampaign(saved.id),
    onSuccess: (result) => {
      setConfirm(null)
      if (result.campaign) afterSave(result.campaign)
      else queryClient.invalidateQueries({ queryKey: marketingKeys.campaign(saved.id) })
      queryClient.invalidateQueries({ queryKey: ['newsletter-campaigns'] })
      const done = result.campaign?.status === 'sent'
      setNotice({ tone: 'success', text: done ? `Sent to ${formatCount(result.campaign.sentCount)} subscribers.` : (result.message ?? 'Sending to every subscriber now.') })
    },
    onError: (error) => {
      setConfirm(null)
      fail(error)
    },
  })
  const remove = useMutation({
    mutationFn: () => deleteCampaign(saved.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['newsletter-campaigns'] })
      navigate('/newsletter/campaigns', { replace: true })
    },
    onError: (error) => {
      setConfirm(null)
      fail(error)
    },
  })
  const busy = save.isPending || test.isPending || send.isPending || remove.isPending
  const err = (field) => errors[field]?.[0]

  return (
    <>
      <title>{`${isNew ? 'New campaign' : saved.subject} | BuyNest Admin`}</title>
      <Link to="/newsletter/campaigns" className="back-link">
        <LuArrowLeft aria-hidden="true" /> Campaigns
      </Link>
      <PageHeader title={isNew ? 'New campaign' : saved.subject} description={isNew ? 'Write it, send yourself a test, then send it to every subscriber.' : <StatusBadge {...campaignStatus(saved.status)} />} />
      <Notice notice={notice} noticeRef={ref} />

      {saved && saved.status !== 'draft' && (
        <dl className="stats stats--compact" aria-live="polite">
          <StatTile label="Recipients" value={formatCount(saved.recipientCount ?? 0)} />
          <StatTile label="Sent" value={formatCount(saved.sentCount)} note={saved.status === 'sending' ? 'Still sending: this updates by itself.' : saved.sentAt ? formatDateTime(saved.sentAt) : undefined} />
          <StatTile label="Failed" value={formatCount(saved.failedCount ?? 0)} />
        </dl>
      )}

      <div className="editor">
        <form
          className="form panel"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            if (check()) save.mutate()
          }}
        >
          <fieldset disabled={!editable} className="form__fieldset">
            <Field label="Subject" error={err('subject')}>
              {(a11y) => <input {...a11y} value={values.subject} maxLength={150} onChange={set('subject')} />}
            </Field>
            <Field label="Preview text (optional)" error={err('preheader')} hint="Shown after the subject in most inboxes.">
              {(a11y) => <input {...a11y} value={values.preheader} maxLength={150} onChange={set('preheader')} />}
            </Field>
            <Field
              label="Email body (HTML)"
              error={err('body')}
              hint="Allowed: paragraphs, headings (h2–h4), lists, bold, italics, links, quotes, line breaks, rules, and tables. Everything else is removed. An unsubscribe link is added to every email."
            >
              {(a11y) => <textarea {...a11y} className="editor__body" rows={16} value={values.body} spellCheck onChange={set('body')} />}
            </Field>
          </fieldset>
          <div className="form__actions">
            {can('newsletter.send') && draftable ? (
              <>
                <button type="submit" className="btn btn--primary" disabled={busy}>
                  {save.isPending ? 'Saving…' : 'Save draft'}
                </button>
                {!isNew && (
                  <>
                    <button type="button" className="btn btn--outline" disabled={busy} onClick={() => check() && test.mutate()}>
                      {test.isPending ? 'Sending test…' : dirty ? 'Save and send test' : 'Send test to me'}
                    </button>
                    <button type="button" className="btn btn--outline" disabled={busy || dirty} onClick={() => setConfirm('send')} aria-describedby={dirty ? 'send-hint' : undefined}>
                      <LuSend aria-hidden="true" /> Send to subscribers
                    </button>
                    <button type="button" className="btn btn--outline" disabled={busy} onClick={() => setConfirm('delete')}>
                      <LuTrash2 aria-hidden="true" /> Delete
                    </button>
                  </>
                )}
              </>
            ) : (
              <span className="muted">{draftable ? 'Your role can read campaigns but not write or send them.' : 'This campaign has been sent, so it can’t be changed.'}</span>
            )}
            {!isNew && saved.status !== 'draft' && can('newsletter.send') && (
              <button type="button" className="btn btn--outline" disabled={busy} onClick={() => test.mutate()}>
                {test.isPending ? 'Sending test…' : 'Send test to me'}
              </button>
            )}
          </div>
          {!isNew && draftable && dirty && can('newsletter.send') && (
            <p id="send-hint" className="field__hint">
              Save the draft before sending it to subscribers.
            </p>
          )}
        </form>

        <section className="panel editor__preview" aria-labelledby="campaign-preview-title">
          <h2 id="campaign-preview-title" className="panel__title">
            Preview
          </h2>
          <p className="field__hint">Updates as you type, cleaned the way the server will clean it.</p>
          <div className="email-preview">
            <p className="email-preview__subject">
              <span className="visually-hidden">Subject: </span>
              {values.subject.trim() || <span className="muted">(no subject)</span>}
            </p>
            {values.preheader.trim() && <p className="email-preview__preheader">{values.preheader.trim()}</p>}
            {preview ? (
              // Safe: rebuilt from an allow-list (utils/sanitizeHtml.js), never the raw draft.
              <article className="cms-preview" dangerouslySetInnerHTML={{ __html: preview }} />
            ) : (
              <p className="muted">The email body shows here.</p>
            )}
            <p className="email-preview__footer">You get this email because you subscribed to the BuyNest newsletter. Unsubscribe</p>
          </div>
        </section>
      </div>

      <ConfirmDialog
        isOpen={confirm === 'send'}
        title={`Send “${saved?.subject}”?`}
        message={`It goes to ${audience === null ? 'every subscribed address' : `${formatCount(audience)} subscribed ${audience === 1 ? 'address' : 'addresses'}`} and can’t be undone or changed afterwards. Send yourself a test first if you haven’t.`}
        confirmLabel="Send campaign"
        busy={send.isPending}
        onConfirm={() => send.mutate()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        isOpen={confirm === 'delete'}
        title={`Delete “${saved?.subject}”?`}
        message="The draft is removed. This can’t be undone."
        confirmLabel="Delete draft"
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirm(null)}
      />
    </>
  )
}
