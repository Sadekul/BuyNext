import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LuRotateCcw } from 'react-icons/lu'
import { adminKeys } from '../api/admin'
import { retrySms } from '../api/phase20'
import { useAdminAuth } from '../auth/useAdminAuth'
import StatusBadge from './StatusBadge'
import { formatDateTime } from '../utils/format'
import { actionErrorMessage } from '../utils/permissions'
import { retryErrorText, retryResult, smsEventLabel, smsStatus } from '../utils/sms'

/**
 * Phase 20 §2: the order page's "SMS" panel. The texts sent for the order
 * (event, status in words, time, phone); a failed one shows why, with Retry
 * (orders.edit, when the API gave the text's id). `sms` = order.sms.
 */
function OrderSms({ order }) {
  const { can } = useAdminAuth()
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState(null)
  const noticeRef = useRef(null)
  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])
  const retry = useMutation({
    mutationFn: (id) => retrySms(id),
    onSuccess: (data) => {
      setNotice(retryResult(data.message))
      for (const key of [adminKeys.order(order.number), ['sms']]) queryClient.invalidateQueries({ queryKey: key })
    },
    onError: (error) => setNotice({ tone: 'error', text: retryErrorText(error, actionErrorMessage) }),
  })
  const texts = order.sms ?? []
  return (
    <section className="panel" aria-labelledby="sms-title">
      <h2 id="sms-title" className="panel__title">
        SMS
      </h2>
      <div className="order-sms">
        <div role={notice?.tone === 'error' ? 'alert' : 'status'}>
          {notice && (
            <p ref={noticeRef} tabIndex={-1} className={notice.tone === 'success' ? 'notice notice--success' : 'form-error'}>
              {notice.text}
            </p>
          )}
        </div>
        {texts.length === 0 ? (
          <p className="muted">No texts for this order.</p>
        ) : (
          <ul className="order-sms__list" aria-labelledby="sms-title">
            {texts.map((text, index) => {
              const at = text.sentAt ?? text.createdAt
              return (
                <li key={text.id ?? `${text.event}-${index}`} className="order-sms__item">
                  <div className="order-sms__head">
                    <strong>{smsEventLabel(text.event)}</strong>
                    <StatusBadge {...smsStatus(text.status)} />
                  </div>
                  <p className="muted">
                    {at && (
                      <>
                        <time dateTime={at}>{formatDateTime(at)}</time> ·{' '}
                      </>
                    )}
                    {text.to}
                  </p>
                  {text.error && <p className="order-sms__error">{text.error}</p>}
                  {text.status === 'failed' && text.id && can('orders.edit') && (
                    <button
                      type="button"
                      className="btn btn--outline btn--sm"
                      aria-label={`Retry the ${smsEventLabel(text.event)} text`}
                      disabled={retry.isPending}
                      onClick={() => {
                        setNotice(null)
                        retry.mutate(text.id)
                      }}
                    >
                      <LuRotateCcw aria-hidden="true" /> Retry
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {can('orders.view') && (
          <p className="order-sms__more">
            <Link to={`/sms?q=${encodeURIComponent(order.number)}`}>Texts for this order in the SMS log</Link>
          </p>
        )}
      </div>
    </section>
  )
}

export default OrderSms
