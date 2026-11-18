import { useEffect, useId, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuArrowLeft, LuBan, LuCopy, LuPlus, LuScale, LuSearch } from 'react-icons/lu'
import { adjustGiftCard, createGiftCard, disableGiftCard, getGiftCard, getGiftCards, phase10Keys } from '../api/phase10'
import ConfirmDialog from '../components/ConfirmDialog'
import Field from '../components/Field'
import FormDialog from '../components/FormDialog'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { useAdminAuth } from '../auth/useAdminAuth'
import { formatCount, formatDate, formatDateTime, formatMoney } from '../utils/format'
import { GIFT_CARD_FILTERS, adjustmentErrors, cardName, giftCardErrors, giftCardStatus, signedMoney } from '../utils/giftCards'

/*
 * Marketing → Gift cards (docs/backend/PHASE10_CONTRACT.md §5). Read with
 * gift_cards.view; create, adjust, and disable with gift_cards.manage. The
 * full code is never shown again after it is created (the server keeps only
 * a hash and the last 4 characters), and cards are never deleted: a card
 * that shouldn't be used any more is disabled.
 */

const LIMIT = 20

export function GiftCardsPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const status = params.get('status') ?? ''
  const skip = Number(params.get('skip')) || 0
  const [draft, setDraft] = useState(q)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(null) // { giftCard, code? }
  const createdRef = useRef(null)
  const openerRef = useRef(null)
  const { can } = useAdminAuth()
  const queryClient = useQueryClient()
  const query = { q, status, skip, limit: LIMIT }
  const cards = useQuery({ queryKey: phase10Keys.giftCards(query), queryFn: ({ signal }) => getGiftCards(query, { signal }), placeholderData: keepPreviousData })

  useEffect(() => {
    if (created) createdRef.current?.focus()
  }, [created])

  function update(changes) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === '' || value === 0) next.delete(key)
      else next.set(key, String(value))
    }
    setParams(next)
  }

  const filtered = Boolean(q || status)
  return (
    <>
      <title>Gift cards | BuyNest Admin</title>
      <PageHeader
        title="Gift cards"
        description={cards.data ? `${formatCount(cards.data.total)} ${filtered ? 'matching cards' : 'cards'} · bought in the store or made here` : 'Cards bought in the store or made here'}
        actions={
          can('gift_cards.manage') && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={(event) => {
                openerRef.current = event.currentTarget
                setCreated(null)
                setCreating(true)
              }}
            >
              <LuPlus aria-hidden="true" /> Create gift card
            </button>
          )
        }
      />
      <div role="status">{created && <CreatedNotice result={created} noticeRef={createdRef} />}</div>

      <div className="toolbar">
        <form
          role="search"
          className="toolbar__search"
          onSubmit={(event) => {
            event.preventDefault()
            update({ q: draft.trim(), skip: 0 })
          }}
        >
          <label htmlFor="gift-card-search" className="visually-hidden">
            Search gift cards
          </label>
          <input id="gift-card-search" type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Last 4, recipient, or email" />
          <button type="submit" className="btn btn--outline">
            <LuSearch aria-hidden="true" /> Search
          </button>
        </form>
        <label className="toolbar__select">
          <span>Status</span>
          <select value={status} onChange={(event) => update({ status: event.target.value, skip: 0 })}>
            <option value="">All cards</option>
            {Object.entries(GIFT_CARD_FILTERS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {cards.isPending && <Loading label="Loading gift cards…" />}
      {cards.error && <ErrorState error={cards.error} onRetry={cards.refetch} />}
      {cards.data && cards.data.giftCards.length === 0 && <Empty>{filtered ? 'No gift cards match.' : 'No gift cards yet.'}</Empty>}
      {cards.data && cards.data.giftCards.length > 0 && (
        <div className="table-wrap" aria-busy={cards.isFetching}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Card</th>
                <th scope="col" className="num">
                  Balance
                </th>
                <th scope="col">Status</th>
                <th scope="col">Recipient</th>
                <th scope="col">Expires</th>
                <th scope="col">From</th>
              </tr>
            </thead>
            <tbody>
              {cards.data.giftCards.map((card) => (
                <tr key={card.id}>
                  <td>
                    <Link to={`/gift-cards/${card.id}`}>
                      <strong>{cardName(card)}</strong>
                    </Link>
                    <br />
                    <small className="muted">Created {formatDate(card.createdAt)}</small>
                  </td>
                  <td className="num">
                    {formatMoney(card.balance)}
                    <br />
                    <small className="muted">of {formatMoney(card.initialBalance)}</small>
                  </td>
                  <td>
                    <StatusBadge {...giftCardStatus(card.status)} />
                  </td>
                  <td>
                    {card.recipientName || card.recipientEmail ? (
                      <>
                        {card.recipientName || '—'}
                        {card.recipientEmail && (
                          <>
                            <br />
                            <small className="muted">{card.recipientEmail}</small>
                          </>
                        )}
                      </>
                    ) : (
                      <span className="muted">None</span>
                    )}
                  </td>
                  <td>{card.expiresAt ? formatDate(card.expiresAt) : <span className="muted">Never</span>}</td>
                  <td className="muted">{cardSource(card)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={cards.data.total} limit={LIMIT} skip={skip} onChange={(next) => update({ skip: next })} />
        </div>
      )}

      {creating && (
        <CreateGiftCardDialog
          onDone={(result) => {
            setCreating(false)
            queryClient.invalidateQueries({ queryKey: ['gift-cards'] })
            setCreated(result)
          }}
          onCancel={() => {
            setCreating(false)
            openerRef.current?.focus()
          }}
        />
      )}
    </>
  )
}

function cardSource(card) {
  if (card.orderNumber) return `Bought in order ${card.orderNumber}`
  if (card.createdByAdmin) return `Made by ${card.createdByAdmin}`
  return 'Made by an admin'
}

/** After creating: the code, once (when the server shows it), to copy and pass on. */
function CreatedNotice({ result, noticeRef }) {
  const { giftCard, code, emailed } = result
  const [copied, setCopied] = useState(null)
  const codeId = useId()
  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied('Code copied.')
    } catch {
      const node = document.getElementById(codeId)
      if (node) window.getSelection()?.selectAllChildren(node)
      setCopied('The code is selected: press Ctrl+C (or ⌘+C) to copy it.')
    }
  }
  return (
    <div ref={noticeRef} tabIndex={-1} className="notice notice--success gift-card-created">
      <p>
        {cardName(giftCard)} created with {formatMoney(giftCard.initialBalance)}.{emailed ? ` It was emailed to ${giftCard.recipientEmail}.` : ''}
      </p>
      {code && (
        <>
          <p>
            Code: <code id={codeId}>{code}</code>{' '}
            <button type="button" className="btn btn--outline btn--sm" onClick={copy}>
              <LuCopy aria-hidden="true" /> Copy code
            </button>
          </p>
          <p className="field__hint">This is the only time the full code is shown. Only its last 4 characters are kept.</p>
          <p className="field__hint" aria-live="polite">
            {copied ?? ''}
          </p>
        </>
      )}
    </div>
  )
}

/** Create a card by hand (e.g. compensation); emailed to the recipient when asked. */
function CreateGiftCardDialog({ onDone, onCancel }) {
  const [values, setValues] = useState({ amount: '', recipientName: '', recipientEmail: '', message: '', expiresAt: '' })
  const [sendEmail, setSendEmail] = useState(true)
  const [errors, setErrors] = useState({})
  const set = (key) => (event) => setValues({ ...values, [key]: event.target.value })
  const create = useMutation({
    mutationFn: createGiftCard,
    onSuccess: (data, sent) => onDone({ giftCard: data.giftCard, code: data.code ?? null, emailed: sent.sendEmail && Boolean(sent.recipientEmail) }),
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  })

  function submit() {
    const found = giftCardErrors(values, { sendEmail })
    setErrors(found)
    if (Object.keys(found).length > 0) return
    create.mutate({
      amount: Number(values.amount),
      recipientName: values.recipientName.trim() || null,
      recipientEmail: values.recipientEmail.trim() || null,
      message: values.message.trim() || null,
      expiresAt: values.expiresAt || null,
      sendEmail,
    })
  }
  const error = (key) => errors[key]?.[0]
  const shown = ['amount', 'recipientName', 'recipientEmail', 'message', 'expiresAt', 'sendEmail']
  const other = create.error && (create.error.fieldErrors ? Object.entries(create.error.fieldErrors).find(([field]) => !shown.includes(field))?.[1]?.[0] : create.error.message)

  return (
    <FormDialog
      isOpen
      wide
      title="Create a gift card"
      description="For compensation or a giveaway. The code is shown once after it's created; the recipient gets it by email when you choose to send it."
      submitLabel="Create gift card"
      busy={create.isPending}
      error={other}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <div className="form__grid">
        <Field label="Amount (USD)" error={error('amount')}>
          {(a11y) => <input {...a11y} type="number" inputMode="decimal" min="1" step="0.01" value={values.amount} onChange={set('amount')} />}
        </Field>
        <Field label="Expires on (optional)" error={error('expiresAt')} hint="Empty: never expires.">
          {(a11y) => <input {...a11y} type="date" value={values.expiresAt} onChange={set('expiresAt')} />}
        </Field>
        <Field label="Recipient name" error={error('recipientName')}>
          {(a11y) => <input {...a11y} value={values.recipientName} maxLength={100} autoComplete="off" onChange={set('recipientName')} />}
        </Field>
        <Field label="Recipient email" error={error('recipientEmail')}>
          {(a11y) => <input {...a11y} type="email" value={values.recipientEmail} maxLength={255} autoComplete="off" onChange={set('recipientEmail')} />}
        </Field>
      </div>
      <Field label="Message (optional)" error={error('message')} hint="Included in the email.">
        {(a11y) => <textarea {...a11y} rows={2} maxLength={500} value={values.message} onChange={set('message')} />}
      </Field>
      <label className="checkbox">
        <input type="checkbox" checked={sendEmail} onChange={(event) => setSendEmail(event.target.checked)} />
        Email the card to the recipient
      </label>
    </FormDialog>
  )
}

/** One card: balance, recipient, where it came from, its history, and the manage actions. */
export function GiftCardDetailPage() {
  const { giftCardId } = useParams()
  const { can } = useAdminAuth()
  const queryClient = useQueryClient()
  const card = useQuery({ queryKey: phase10Keys.giftCard(giftCardId), queryFn: ({ signal }) => getGiftCard(giftCardId, { signal }) })
  const [dialog, setDialog] = useState(null) // 'adjust' | 'disable'
  const [notice, setNotice] = useState(null)
  const noticeRef = useRef(null)
  const openerRef = useRef(null)

  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  const disable = useMutation({
    mutationFn: () => disableGiftCard(giftCardId),
    onSuccess: () => done(`${cardName(card.data)} is disabled. It can no longer be used at checkout.`),
    onError: (error) => {
      setDialog(null)
      setNotice({ tone: 'error', text: error.message })
    },
  })

  if (card.isPending) return <Loading label="Loading the gift card…" />
  if (card.error) return <ErrorState error={card.error} onRetry={card.refetch} />
  const data = card.data
  const manage = can('gift_cards.manage')

  function open(name, event) {
    openerRef.current = event.currentTarget
    setNotice(null)
    setDialog(name)
  }
  function cancel() {
    setDialog(null)
    openerRef.current?.focus()
  }
  function done(text) {
    setDialog(null)
    queryClient.invalidateQueries({ queryKey: phase10Keys.giftCard(giftCardId) })
    queryClient.invalidateQueries({ queryKey: ['gift-cards'] })
    setNotice({ tone: 'success', text })
  }

  const transactions = data.transactions ?? []
  return (
    <>
      <title>{`${cardName(data)} | BuyNest Admin`}</title>
      <Link to="/gift-cards" className="back-link">
        <LuArrowLeft aria-hidden="true" /> Gift cards
      </Link>
      <PageHeader
        title={cardName(data)}
        description={`${formatMoney(data.balance)} left of ${formatMoney(data.initialBalance)} · created ${formatDate(data.createdAt)}`}
        actions={
          <>
            <StatusBadge {...giftCardStatus(data.status)} />
            {manage && data.status !== 'disabled' && (
              <>
                <button type="button" className="btn btn--outline" onClick={(event) => open('adjust', event)}>
                  <LuScale aria-hidden="true" /> Adjust balance
                </button>
                <button type="button" className="btn btn--danger" onClick={(event) => open('disable', event)}>
                  <LuBan aria-hidden="true" /> Disable
                </button>
              </>
            )}
          </>
        }
      />
      <div role={notice?.tone === 'error' ? 'alert' : 'status'}>
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className={notice.tone === 'success' ? 'notice notice--success' : 'form-error'}>
            {notice.text}
          </p>
        )}
      </div>

      <div className="panels">
        <section className="panel" aria-labelledby="gift-card-details">
          <h2 id="gift-card-details" className="panel__title">
            Details
          </h2>
          <dl className="details">
            <dt>Balance</dt>
            <dd>
              <strong>{formatMoney(data.balance)}</strong> <span className="muted">{data.currency ?? 'USD'}</span>
            </dd>
            <dt>First balance</dt>
            <dd>{formatMoney(data.initialBalance)}</dd>
            <dt>Expires</dt>
            <dd>{data.expiresAt ? formatDate(data.expiresAt) : 'Never'}</dd>
            <dt>From</dt>
            <dd>{data.orderNumber ? <Link to={`/orders/${data.orderNumber}`}>Bought in order {data.orderNumber}</Link> : cardSource(data)}</dd>
          </dl>
        </section>
        <section className="panel" aria-labelledby="gift-card-recipient">
          <h2 id="gift-card-recipient" className="panel__title">
            Recipient
          </h2>
          <dl className="details">
            <dt>Name</dt>
            <dd>{data.recipientName || '—'}</dd>
            <dt>Email</dt>
            <dd>{data.recipientEmail ? <a href={`mailto:${data.recipientEmail}`}>{data.recipientEmail}</a> : '—'}</dd>
            {data.message && (
              <>
                <dt>Message</dt>
                <dd>{data.message}</dd>
              </>
            )}
          </dl>
        </section>
        <section className="panel panel--wide" aria-labelledby="gift-card-history">
          <h2 id="gift-card-history" className="panel__title">
            History
          </h2>
          {transactions.length === 0 ? (
            <p className="muted page-note">No changes yet.</p>
          ) : (
            // Focusable, so keyboard users can scroll it sideways on a phone.
            <div className="table-wrap" role="region" aria-label="Balance changes" tabIndex={0}>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col" className="num">
                      Change
                    </th>
                    <th scope="col" className="num">
                      Balance after
                    </th>
                    <th scope="col">What</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                      </td>
                      <td className="num">{signedMoney(entry.amount)}</td>
                      <td className="num">{entry.balanceAfter === null || entry.balanceAfter === undefined ? '—' : formatMoney(entry.balanceAfter)}</td>
                      <td>
                        {entry.note || (entry.amount < 0 ? 'Spent' : 'Added')}
                        {entry.orderNumber && (
                          <>
                            {' · '}
                            <Link to={`/orders/${entry.orderNumber}`}>Order {entry.orderNumber}</Link>
                          </>
                        )}
                        {entry.creditMemoNumber && (
                          <>
                            {' · '}
                            <Link to={`/credit-memos/${entry.creditMemoNumber}`}>Credit memo {entry.creditMemoNumber}</Link>
                          </>
                        )}
                        {entry.adminName && <span className="muted"> · by {entry.adminName}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {dialog === 'adjust' && <AdjustDialog card={data} onDone={done} onCancel={cancel} />}
      <ConfirmDialog
        isOpen={dialog === 'disable'}
        title={`Disable ${cardName(data)}?`}
        message={`It can no longer be used at checkout; its ${formatMoney(data.balance)} balance stays on record. Gift cards can't be deleted or turned back on.`}
        confirmLabel="Disable"
        busy={disable.isPending}
        onConfirm={() => disable.mutate()}
        onCancel={cancel}
      />
    </>
  )
}

/** Add to or take from the balance, with the reason (recorded in the history). */
function AdjustDialog({ card, onDone, onCancel }) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState({})
  const adjust = useMutation({
    mutationFn: (values) => adjustGiftCard(card.id, values),
    onSuccess: (data, sent) => {
      const balance = data?.giftCard?.balance ?? Math.round((card.balance + sent.amount) * 100) / 100
      onDone(`Balance ${sent.amount < 0 ? 'reduced' : 'increased'} by ${formatMoney(Math.abs(sent.amount))}. ${cardName(card)} now has ${formatMoney(balance)}.`)
    },
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  })
  function submit() {
    const found = adjustmentErrors({ amount, note }, card.balance)
    setErrors(found)
    if (Object.keys(found).length === 0) adjust.mutate({ amount: Number(amount), note: note.trim() })
  }
  const value = Number(amount)
  const preview = amount.trim() !== '' && Number.isFinite(value) ? Math.round((card.balance + value) * 100) / 100 : null
  const other = adjust.error && (adjust.error.fieldErrors ? Object.entries(adjust.error.fieldErrors).find(([field]) => !['amount', 'note'].includes(field))?.[1]?.[0] : adjust.error.message)
  return (
    <FormDialog
      isOpen
      title={`Adjust ${cardName(card)}`}
      description={`Now ${formatMoney(card.balance)}. A positive amount adds to the balance, a negative one takes it away.`}
      submitLabel="Save adjustment"
      busy={adjust.isPending}
      error={other}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <Field label="Amount (USD)" error={errors.amount?.[0]} hint="For example 10.00 or -5.00.">
        {(a11y) => <input {...a11y} type="number" inputMode="decimal" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />}
      </Field>
      <Field label="Reason" error={errors.note?.[0]} hint="Kept in the card's history.">
        {(a11y) => <textarea {...a11y} rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />}
      </Field>
      <p className="field__hint" aria-live="polite">
        {preview !== null && preview >= 0 ? `New balance: ${formatMoney(preview)}` : ''}
      </p>
    </FormDialog>
  )
}
