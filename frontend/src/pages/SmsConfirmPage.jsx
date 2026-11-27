import { useEffect, useId, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { LuCircleCheck, LuCircleX, LuClipboardCheck, LuLink2Off } from 'react-icons/lu'
import { Trans, useTranslation } from 'react-i18next'
import PageMeta from '../components/common/PageMeta'
import LanguageSwitch from '../components/layout/LanguageSwitch'
import Button from '../components/ui/Button'
import Loader from '../components/ui/Loader'
import Modal from '../components/ui/Modal'
import { ROUTES } from '../constants/routes'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { answerOrderConfirmation, getOrderConfirmation } from '../services/shopService'
import { formatBasePrice, formatDate } from '../utils/formatters'
import './AuthPages.css'
import '../components/orders/CancelOrderButton.css'
import './SmsConfirmPage.css'

const MAX_REASON = 500

/** Which message a status shows once nothing is left to answer (`done`: the shopper answered just now). */
function resultKey(status, done) {
  if (status === 'confirmed') return done ? 'smsConfirm.confirmed' : 'smsConfirm.alreadyConfirmed'
  if (status === 'cancelled') return done ? 'smsConfirm.cancelled' : 'smsConfirm.alreadyCancelled'
  if (status === 'expired') return 'smsConfirm.expired'
  return 'smsConfirm.notWaiting'
}

/**
 * /c/:token (REAL_SHOP, phase 20): the one-tap link in the cash on delivery
 * text ("please confirm your order … {confirm_url}"). No sign-in: the token is
 * the proof. Opening the link only READS the order (SMS apps and link
 * previews open links too); the shopper confirms or cancels with a button.
 * Cancelling asks again in a dialog, with an optional reason. Once answered
 * the link stops working and shows the result. Expired or unknown links say
 * so plainly and point to "Track your order". Kept out of search results.
 */
function SmsConfirmPage() {
  const { t } = useTranslation('orders')
  const { token = '' } = useParams()
  useStoreSettings() // the store currency for the total
  const [answer, setAnswer] = useState(null) // the summary after Confirm / Cancel
  const [dialogOpen, setDialogOpen] = useState(false)
  const [reason, setReason] = useState('')
  const resultRef = useRef(null)
  const reasonId = useId()
  const hintId = useId()

  const summary = useQuery({
    queryKey: ['order-confirmation', token],
    queryFn: ({ signal }) => getOrderConfirmation(token, { signal }),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })

  const respond = useMutation({
    mutationFn: (input) => answerOrderConfirmation(token, input),
    onSuccess: (data) => {
      setDialogOpen(false)
      setAnswer(data)
    },
  })

  // Move focus to the result, so keyboard and screen reader users land on it.
  useEffect(() => {
    if (answer) resultRef.current?.focus()
  }, [answer])

  const order = answer ?? summary.data
  const linkGone = summary.error?.status === 404 || respond.error?.status === 404

  function closeDialog() {
    if (respond.isPending) return
    setDialogOpen(false)
    if (respond.variables?.action === 'cancel') respond.reset()
  }

  let title = t('smsConfirm.title')
  let body
  if (linkGone) {
    title = t('smsConfirm.invalidTitle')
    body = (
      <div className="sms-confirm__result" role="status" ref={resultRef} tabIndex={-1}>
        <LuLink2Off aria-hidden="true" className="sms-confirm__icon sms-confirm__icon--muted" />
        <p>{t('smsConfirm.invalid')}</p>
      </div>
    )
  } else if (summary.isPending) {
    body = <Loader label={t('smsConfirm.loading')} />
  } else if (summary.error) {
    body = (
      <>
        <p className="auth-alert auth-alert--error" role="alert">
          {summary.error.message}
        </p>
        <Button variant="outline" onClick={() => summary.refetch()}>
          {t('smsConfirm.retry')}
        </Button>
      </>
    )
  } else {
    const pending = order.status === 'pending'
    if (!pending) title = t('smsConfirm.doneTitle')
    const good = order.status === 'confirmed'
    const ResultIcon = good ? LuCircleCheck : LuCircleX
    body = (
      <>
        {pending ? (
          <p className="auth-card__subtitle">{t('smsConfirm.intro')}</p>
        ) : (
          <div className={`sms-confirm__result${good ? ' sms-confirm__result--good' : ''}`} role="status" ref={resultRef} tabIndex={-1}>
            <ResultIcon aria-hidden="true" className={`sms-confirm__icon${good ? '' : ' sms-confirm__icon--muted'}`} />
            <p>{t(resultKey(order.status, answer !== null), { number: order.number ?? '' })}</p>
          </div>
        )}
        <dl className="sms-confirm__summary" aria-label={t('smsConfirm.summary')}>
          {order.number && (
            <div>
              <dt>{t('smsConfirm.number')}</dt>
              <dd>{order.number}</dd>
            </div>
          )}
          {order.placedAt && (
            <div>
              <dt>{t('smsConfirm.placed')}</dt>
              <dd>{formatDate(order.placedAt)}</dd>
            </div>
          )}
          {order.itemsCount !== null && (
            <div>
              <dt>{t('smsConfirm.items')}</dt>
              <dd>{t('smsConfirm.itemsCount', { count: order.itemsCount })}</dd>
            </div>
          )}
          {order.total !== null && (
            <div>
              <dt>{t('smsConfirm.total')}</dt>
              <dd>
                <strong>{formatBasePrice(order.total)}</strong>
              </dd>
            </div>
          )}
        </dl>
        {pending && (
          <>
            {respond.error && respond.variables?.action === 'confirm' && (
              <p className="auth-alert auth-alert--error" role="alert">
                {respond.error.message}
              </p>
            )}
            <div className="sms-confirm__actions">
              <Button fullWidth onClick={() => respond.mutate({ action: 'confirm' })} disabled={respond.isPending}>
                {t(respond.isPending && respond.variables?.action === 'confirm' ? 'smsConfirm.confirming' : 'smsConfirm.confirm')}
              </Button>
              <Button
                variant="outline"
                fullWidth
                onClick={() => {
                  respond.reset()
                  setDialogOpen(true)
                }}
                disabled={respond.isPending}
              >
                {t('smsConfirm.cancel')}
              </Button>
            </div>
            <Modal
              isOpen={dialogOpen}
              onClose={closeDialog}
              title={t('smsConfirm.dialogTitle', { number: order.number ?? '' })}
              footer={
                <div className="cancel-order__actions">
                  <Button variant="ghost" onClick={closeDialog} disabled={respond.isPending}>
                    {t('smsConfirm.keep')}
                  </Button>
                  <Button className="cancel-order__confirm" onClick={() => respond.mutate({ action: 'cancel', reason })} disabled={respond.isPending}>
                    {t(respond.isPending ? 'smsConfirm.cancelling' : 'smsConfirm.cancelConfirm')}
                  </Button>
                </div>
              }
            >
              <div className="cancel-order__body">
                <p>{t('smsConfirm.dialogExplain')}</p>
                <label htmlFor={reasonId} className="cancel-order__label">
                  <Trans t={t} i18nKey="smsConfirm.why" components={{ optional: <span className="cancel-order__optional" /> }} />
                </label>
                <textarea
                  id={reasonId}
                  className="cancel-order__reason"
                  rows={3}
                  maxLength={MAX_REASON}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  aria-describedby={hintId}
                />
                <p id={hintId} className="cancel-order__hint">
                  {t('smsConfirm.hint', { max: MAX_REASON })}
                </p>
                {respond.error && respond.variables?.action === 'cancel' && (
                  <p className="cancel-order__error" role="alert">
                    {respond.error.message}
                  </p>
                )}
              </div>
            </Modal>
          </>
        )}
      </>
    )
  }

  const finished = linkGone || (order && order.status !== 'pending')
  return (
    <div className="auth-page section container sms-confirm">
      <PageMeta title={title} noindex />
      <div className="auth-card">
        <div className="sms-confirm__top">
          <LuClipboardCheck aria-hidden="true" size={32} />
          <LanguageSwitch />
        </div>
        <h1 className="auth-card__title">{title}</h1>
        {body}
        {finished && (
          <Button to={ROUTES.trackOrder} variant="outline" fullWidth>
            {t('smsConfirm.track')}
          </Button>
        )}
      </div>
    </div>
  )
}

export default SmsConfirmPage
