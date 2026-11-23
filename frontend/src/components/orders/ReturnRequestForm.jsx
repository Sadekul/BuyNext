import { useId, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { LuUndo2 } from 'react-icons/lu'
import { SelectField } from '../forms/FormField'
import OrderStatusBadge from './OrderStatusBadge'
import Button from '../ui/Button'
import { useAuth } from '../../hooks/useAuth'
import { requestReturn } from '../../services/customerService'
import { orderKeys } from '../../queries/orderQueries'
import { customerKeys } from '../../queries/customerQueries'
import { ROUTES } from '../../constants/routes'
import { cn } from '../../utils/classNames'
import { formatDate, formatNumber } from '../../utils/formatters'
import { applyServerFieldErrors } from '../../utils/serverErrors'
import './ReturnRequestForm.css'
import { useTranslation } from 'react-i18next'

const COMMENT_MAX = 1000
const quantityField = (item) => `quantities.q${item.orderItemId}`

/**
 * Returns on one of the customer's orders (REAL_SHOP, phase 6): the returns
 * already asked for, and "Request a return" when the server says the order
 * is eligible (`order.returnEligibility`: returns on, shipped, inside the
 * window). Each line the server says can still be returned (`returnable`:
 * shipped, minus what's in a return or refunded) gets a quantity picker;
 * the reason comes from the store's list; the comment is optional. The
 * server checks everything again and answers 422 when something changed.
 */
function ReturnRequestForm({ order }) {
  const { t } = useTranslation('orders')
  const { user, authorizedRequest } = useAuth()
  const queryClient = useQueryClient()
  const id = useId()
  const [isOpen, setIsOpen] = useState(false)
  const [created, setCreated] = useState(null)
  const eligibility = order.returnEligibility
  const items = eligibility?.eligible ? eligibility.items.filter((item) => item.returnable > 0) : []
  const reasons = eligibility?.reasons ?? []

  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: { quantities: Object.fromEntries(items.map((item) => [`q${item.orderItemId}`, '0'])), reason: '', comment: '' },
  })

  const mutation = useMutation({
    mutationFn: (input) => authorizedRequest(() => requestReturn(order.number, input)),
    onSuccess: (createdReturn) => {
      setCreated(createdReturn)
      setIsOpen(false)
      reset()
      // The order's returnable quantities changed, and the returns list has a new entry.
      queryClient.invalidateQueries({ queryKey: orderKeys.detail(user.id, order.number) })
      queryClient.invalidateQueries({ queryKey: customerKeys.returns(user.id) })
    },
  })

  async function submit(values) {
    clearErrors()
    const chosen = items
      .map((item) => ({ item, quantity: Number.parseInt(values.quantities[`q${item.orderItemId}`], 10) || 0 }))
      .filter(({ quantity }) => quantity > 0)
    let invalid = false
    if (chosen.length === 0) {
      setError('root.items', { message: t('returnForm.chooseItem') })
      invalid = true
    }
    if (!values.reason) {
      setError('reason', { message: t('returnForm.chooseReason') })
      invalid = true
    }
    if (values.comment.trim().length > COMMENT_MAX) {
      setError('comment', { message: t('returnForm.commentLong', { max: COMMENT_MAX }) })
      invalid = true
    }
    if (invalid) return

    try {
      await mutation.mutateAsync({
        items: chosen.map(({ item, quantity }) => ({ orderItemId: item.orderItemId, quantity })),
        reason: values.reason,
        comment: values.comment,
      })
    } catch (error) {
      // items.N.* names the Nth item sent: put the message on that item's picker.
      const fieldMap = {
        reason: 'reason',
        comment: 'comment',
        items: 'root.items',
        order: 'root.server', // no longer eligible (window closed, returns turned off)
        ...Object.fromEntries(chosen.flatMap(({ item }, index) => [
          [`items.${index}.quantity`, quantityField(item)],
          [`items.${index}.orderItemId`, quantityField(item)],
        ])),
      }
      if (applyServerFieldErrors(error, setError, fieldMap)) return
      setError('root.server', { message: Object.values(error.fieldErrors ?? {})[0]?.[0] ?? error.message })
    }
  }

  // An older API, or an order seen without the customer's session: nothing to offer.
  if (!eligibility && !order.returns?.length) return null

  return (
    <section className="return-request order-view__card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t('returnForm.title')}</h2>
      {order.returns?.length > 0 && (
        <ul className="return-request__existing">
          {order.returns.map((entry) => (
            <li key={entry.number}>
              <Link to={ROUTES.returnDetails(entry.number)} className="order-view__link">
                {t('returnForm.returnNumber', { number: entry.number })}
              </Link>
              <OrderStatusBadge kind="return" status={entry.status} />
            </li>
          ))}
        </ul>
      )}
      {created && (
        <p className="return-request__success" role="status">
          {t('returnForm.requested', { number: created.number })} <Link to={ROUTES.returnDetails(created.number)}>{t('returnForm.see')}</Link>
        </p>
      )}
      {items.length === 0 || reasons.length === 0 ? (
        !created && eligibility && <p className="order-view__muted">{eligibility.message ?? t('returnForm.nothing')}</p>
      ) : (
        <>
          <p className="order-view__muted">
            {eligibility.deadline ? t('returnForm.until', { date: formatDate(eligibility.deadline) }) : t('returnForm.can')}
          </p>
          {!isOpen ? (
            <div>
              <Button variant="outline" onClick={() => setIsOpen(true)}>
                <LuUndo2 aria-hidden="true" /> {t('returnForm.request')}
              </Button>
            </div>
          ) : (
            <form className="return-request__form" onSubmit={handleSubmit(submit)} noValidate>
              <fieldset className={cn('return-request__items', errors.root?.items && 'return-request__items--invalid')} aria-describedby={errors.root?.items ? `${id}-items-error` : undefined}>
                <legend className="form-field__label">{t('returnForm.items')}</legend>
                <ul>
                  {items.map((item) => {
                    const name = item.variantLabel ? `${item.title} (${item.variantLabel})` : item.title
                    const field = quantityField(item)
                    const error = errors.quantities?.[`q${item.orderItemId}`]?.message
                    return (
                      <li key={item.orderItemId} className="return-request__item">
                        {item.thumbnail ? <img src={item.thumbnail} alt="" width="48" height="48" loading="lazy" /> : <span />}
                        <SelectField
                          label={t('returnForm.quantityOf', { name })}
                          options={Array.from({ length: item.returnable + 1 }, (_, count) => ({ value: String(count), label: formatNumber(count) }))}
                          error={error}
                          {...register(field)}
                        />
                        <span className="order-view__muted">
                          {t('returnForm.upTo', { returnable: item.returnable, ordered: item.ordered })}
                        </span>
                      </li>
                    )
                  })}
                </ul>
                {errors.root?.items && (
                  <p id={`${id}-items-error`} className="form-field__error">
                    {errors.root.items.message}
                  </p>
                )}
              </fieldset>

              <SelectField label={t('returnForm.reason')} options={[{ value: '', label: t('returnForm.chooseReasonOption') }, ...reasons]} error={errors.reason?.message} {...register('reason')} />

              <div className={cn('form-field', errors.comment && 'form-field--invalid')}>
                <label htmlFor={`${id}-comment`} className="form-field__label">
                  {t('returnForm.comment')}
                </label>
                <textarea
                  id={`${id}-comment`}
                  className="form-field__input return-request__comment"
                  rows={4}
                  maxLength={COMMENT_MAX}
                  aria-invalid={errors.comment ? true : undefined}
                  aria-describedby={[`${id}-comment-hint`, errors.comment && `${id}-comment-error`].filter(Boolean).join(' ')}
                  {...register('comment')}
                />
                <p id={`${id}-comment-hint`} className="form-field__hint">
                  {t('returnForm.commentHint')}
                </p>
                {errors.comment && (
                  <p id={`${id}-comment-error`} className="form-field__error">
                    {errors.comment.message}
                  </p>
                )}
              </div>

              {errors.root?.server && (
                <p className="return-request__error" role="alert">
                  {errors.root.server.message}
                </p>
              )}
              <div className="return-request__actions">
                <Button type="submit" disabled={isSubmitting}>
                  {t(isSubmitting ? 'returnForm.sending' : 'returnForm.send')}
                </Button>
                <Button variant="ghost" onClick={() => setIsOpen(false)} disabled={isSubmitting}>
                  {t('returnForm.cancel')}
                </Button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  )
}

export default ReturnRequestForm
