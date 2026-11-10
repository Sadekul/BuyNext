import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuArrowLeft } from 'react-icons/lu'
import { adminKeys, createCoupon, getCoupon, updateCoupon } from '../api/admin'
import Field from '../components/Field'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { ErrorState, Loading } from '../components/States'
import { useAdminAuth } from '../auth/useAdminAuth'
import { EMPTY_COUPON, couponSchema, couponToForm, toCouponPayload } from '../utils/couponSchema'
import { formatCount } from '../utils/format'
import { COUPON_TYPES, couponStatus } from '../utils/orders'

/** /coupons/new and /coupons/:couponId: one form for adding and editing a code. */
function CouponFormPage() {
  const { couponId } = useParams()
  const isNew = couponId === undefined
  const coupon = useQuery({ queryKey: adminKeys.coupon(couponId), queryFn: ({ signal }) => getCoupon(couponId, { signal }), enabled: !isNew })

  if (!isNew && coupon.isPending) return <Loading label="Loading the coupon…" />
  if (!isNew && coupon.error) return <ErrorState error={coupon.error} onRetry={coupon.refetch} />

  const title = isNew ? 'Add coupon' : coupon.data.code
  return (
    <>
      <title>{`${title} | BuyNest Admin`}</title>
      <Link to="/coupons" className="back-link">
        <LuArrowLeft aria-hidden="true" /> Coupons
      </Link>
      <PageHeader
        title={title}
        description={isNew ? 'Shoppers type the code in the cart; the server checks every rule.' : `Used ${formatCount(coupon.data.timesUsed)} ${coupon.data.timesUsed === 1 ? 'time' : 'times'}`}
        actions={!isNew && <StatusBadge {...couponStatus(coupon.data.status)} />}
      />
      {/* key: a fresh form (and default values) per coupon */}
      <CouponForm key={couponId ?? 'new'} couponId={couponId} initial={isNew ? EMPTY_COUPON : couponToForm(coupon.data)} />
    </>
  )
}

const FIELDS = Object.keys(EMPTY_COUPON)

function CouponForm({ couponId, initial }) {
  const isNew = couponId === undefined
  const navigate = useNavigate()
  const { can } = useAdminAuth()
  const queryClient = useQueryClient()
  const justCreated = useLocation().state?.created === true
  const [saved, setSaved] = useState(false)
  const {
    register,
    handleSubmit,
    setError,
    reset,
    control,
    formState: { errors, isDirty },
  } = useForm({ resolver: zodResolver(couponSchema), defaultValues: initial, mode: 'onSubmit', reValidateMode: 'onChange' })
  const type = useWatch({ control, name: 'type' })

  const save = useMutation({
    mutationFn: (values) => (isNew ? createCoupon(toCouponPayload(values)) : updateCoupon(couponId, toCouponPayload(values))),
    onSuccess: (response, values) => {
      queryClient.invalidateQueries({ queryKey: ['coupons'] })
      queryClient.setQueryData(adminKeys.coupon(response.coupon.id), { ...response.coupon, live: true })
      if (isNew) {
        navigate(`/coupons/${response.coupon.id}`, { replace: true, state: { created: true } })
        return
      }
      setSaved(true)
      reset(values)
    },
    onError: (error) => {
      // Server-side validation (422): each message on its field.
      for (const [field, messages] of Object.entries(error.fieldErrors ?? {})) {
        if (FIELDS.includes(field)) setError(field, { message: messages[0] }, { shouldFocus: true })
      }
    },
  })
  const unshownError = save.error && !Object.keys(save.error.fieldErrors ?? {}).some((field) => FIELDS.includes(field))

  return (
    <form className="form" onSubmit={handleSubmit((values) => save.mutate(values))} noValidate>
      <div role="status">
        {(saved || (justCreated && !save.isSuccess)) && <p className="notice notice--success">{saved ? 'Changes saved.' : 'Coupon created.'}</p>}
      </div>
      {unshownError && (
        <p className="form-error" role="alert">
          {save.error.message}
        </p>
      )}

      <div className="form__grid">
        <Field label="Code" error={errors.code?.message} hint="Letters, digits, dashes; saved in capitals. Shoppers type it in any case.">
          {(a11y) => <input {...a11y} autoComplete="off" spellCheck={false} style={{ textTransform: 'uppercase' }} {...register('code')} />}
        </Field>
        <Field label="Description (optional)" error={errors.description?.message} hint="Shown to shoppers when the code applies. Empty: written from the rules, e.g. “10% off your order”." className="form__wide">
          {(a11y) => <input {...a11y} {...register('description')} />}
        </Field>
        <Field label="Type" error={errors.type?.message}>
          {(a11y) => (
            <select {...a11y} {...register('type')}>
              {Object.entries(COUPON_TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
        {type !== 'free_shipping' && (
          <Field label={type === 'percent' ? 'Percent off' : 'Amount off (USD)'} error={errors.value?.message} hint={type === 'percent' ? '1 to 100, off the merchandise.' : 'Off the merchandise, never more than it costs.'}>
            {(a11y) => <input {...a11y} type="number" inputMode="decimal" min={type === 'percent' ? 1 : 0.01} max={type === 'percent' ? 100 : undefined} step={type === 'percent' ? 1 : 0.01} {...register('value')} />}
          </Field>
        )}
        <Field label="Minimum spend (USD, optional)" error={errors.minSubtotal?.message} hint="Merchandise total needed; empty for none.">
          {(a11y) => <input {...a11y} type="number" inputMode="decimal" min="0" step="0.01" {...register('minSubtotal')} />}
        </Field>
        <Field label="Starts (optional)" error={errors.startsAt?.message} hint="Your local time; empty to start now.">
          {(a11y) => <input {...a11y} type="datetime-local" {...register('startsAt')} />}
        </Field>
        <Field label="Ends (optional)" error={errors.endsAt?.message} hint="Your local time; empty for no end.">
          {(a11y) => <input {...a11y} type="datetime-local" {...register('endsAt')} />}
        </Field>
        <Field label="Total uses (optional)" error={errors.usageLimit?.message} hint="Across all shoppers; empty for no limit.">
          {(a11y) => <input {...a11y} type="number" inputMode="numeric" min="1" step="1" {...register('usageLimit')} />}
        </Field>
        <Field label="Uses per customer (optional)" error={errors.usageLimitPerCustomer?.message} hint="By account, or by email for guests.">
          {(a11y) => <input {...a11y} type="number" inputMode="numeric" min="1" step="1" {...register('usageLimitPerCustomer')} />}
        </Field>
      </div>
      <label className="checkbox">
        <input type="checkbox" {...register('isActive')} />
        Active (shoppers can use it within the dates and limits above)
      </label>

      <div className="form__actions">
        {can('coupons.edit') ? (
          <button type="submit" className="btn btn--primary" disabled={save.isPending || (!isNew && !isDirty)}>
            {save.isPending ? 'Saving…' : isNew ? 'Add coupon' : 'Save changes'}
          </button>
        ) : (
          <span className="muted">Your role can view this coupon but not change it.</span>
        )}
        <Link to="/coupons" className="btn btn--outline">
          Cancel
        </Link>
      </div>
    </form>
  )
}

export default CouponFormPage
