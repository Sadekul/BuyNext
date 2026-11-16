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
import { CategoryChecklist, GroupChecklist, ProductPicker } from '../components/RuleScope'
import { APPLIES_TO, CART_RULE_TYPES, EMPTY_COUPON, couponName, couponSchema, couponToForm, toCouponPayload } from '../utils/couponSchema'
import { formatCount } from '../utils/format'
import { couponStatus } from '../utils/orders'

/** /coupons/new and /coupons/:couponId: one form for adding and editing a code. */
function CouponFormPage() {
  const { couponId } = useParams()
  const isNew = couponId === undefined
  const coupon = useQuery({ queryKey: adminKeys.coupon(couponId), queryFn: ({ signal }) => getCoupon(couponId, { signal }), enabled: !isNew })

  if (!isNew && coupon.isPending) return <Loading label="Loading the coupon…" />
  if (!isNew && coupon.error) return <ErrorState error={coupon.error} onRetry={coupon.refetch} />

  const title = isNew ? 'Add coupon' : couponName(coupon.data)
  return (
    <>
      <title>{`${title} | BuyNest Admin`}</title>
      <Link to="/coupons" className="back-link">
        <LuArrowLeft aria-hidden="true" /> Coupons
      </Link>
      <PageHeader
        title={title}
        description={
          isNew
            ? 'A cart price rule: shoppers type its code, or it applies by itself. The server checks every condition.'
            : `${coupon.data.autoApply ? 'Automatic rule · ' : ''}Used ${formatCount(coupon.data.timesUsed)} ${coupon.data.timesUsed === 1 ? 'time' : 'times'}`
        }
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
    setValue,
    formState: { errors, isDirty },
  } = useForm({ resolver: zodResolver(couponSchema), defaultValues: initial, mode: 'onSubmit', reValidateMode: 'onChange' })
  const [type, autoApply, appliesTo, customerGroupIds, categoryIds, productIds] = useWatch({ control, name: ['type', 'autoApply', 'appliesTo', 'customerGroupIds', 'categoryIds', 'productIds'] })
  const [announcement, setAnnouncement] = useState('')
  const choose = (field) => (value) => setValue(field, value, { shouldDirty: true, shouldValidate: Object.keys(errors).length > 0 })

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
      // "categoryIds.0" belongs to categoryIds.
      for (const [field, messages] of Object.entries(error.fieldErrors ?? {})) {
        const name = field.split('.')[0]
        if (FIELDS.includes(name)) setError(name, { message: messages[0] }, { shouldFocus: true })
      }
    },
  })
  const unshownError = save.error && !Object.keys(save.error.fieldErrors ?? {}).some((field) => FIELDS.includes(field.split('.')[0]))
  const editable = can('coupons.edit')

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

      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      <fieldset disabled={!editable} className="form__fieldset">
        <fieldset className="scope-list">
          <legend>How shoppers get it</legend>
          <label className="checkbox">
            <input type="radio" name="coupon-kind" checked={!autoApply} onChange={() => choose('autoApply')(false)} />
            {/* No “code” or “type” in these labels: getByLabel('Code') and getByLabel('Type') must find only those fields. */}
            Shoppers enter it in the cart (a coupon)
          </label>
          <label className="checkbox">
            <input
              type="radio"
              name="coupon-kind"
              checked={autoApply}
              onChange={() => {
                choose('autoApply')(true)
                setValue('code', '', { shouldDirty: true })
              }}
            />
            Automatic, nothing to enter (the best automatic rule applies; one entered coupon can add to it)
          </label>
        </fieldset>

        <div className="form__grid">
          {!autoApply && (
            <Field label="Code" error={errors.code?.message} hint="Letters, digits, dashes; saved in capitals. Shoppers type it in any case.">
              {(a11y) => <input {...a11y} autoComplete="off" spellCheck={false} style={{ textTransform: 'uppercase' }} {...register('code')} />}
            </Field>
          )}
          <Field
            label="Description (optional)"
            error={errors.description?.message}
            hint={autoApply ? 'The rule’s name in the cart and on orders. Empty: written from the rule, e.g. “10% off shoes”.' : 'Shown to shoppers when the code applies. Empty: written from the rules, e.g. “10% off your order”.'}
            className="form__wide"
          >
            {(a11y) => <input {...a11y} {...register('description')} />}
          </Field>
          <Field label="Type" error={errors.type?.message}>
            {(a11y) => (
              <select {...a11y} {...register('type')}>
                {Object.entries(CART_RULE_TYPES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {(type === 'percent' || type === 'fixed') && (
            <Field label={type === 'percent' ? 'Percent off' : 'Amount off (USD)'} error={errors.value?.message} hint={type === 'percent' ? '1 to 100, off the eligible products.' : 'Off the eligible products, never more than they cost.'}>
              {(a11y) => <input {...a11y} type="number" inputMode="decimal" min={type === 'percent' ? 1 : 0.01} max={type === 'percent' ? 100 : undefined} step={type === 'percent' ? 1 : 0.01} {...register('value')} />}
            </Field>
          )}
          {type === 'buy_x_get_y' && (
            <>
              <Field label="Buy (units)" error={errors.buyQuantity?.message} hint="X: units bought at full price.">
                {(a11y) => <input {...a11y} type="number" inputMode="numeric" min="1" max="100" step="1" {...register('buyQuantity')} />}
              </Field>
              <Field label="Get free (units)" error={errors.getQuantity?.message} hint="Y: for every X + Y eligible units, the cheapest Y are free.">
                {(a11y) => <input {...a11y} type="number" inputMode="numeric" min="1" max="100" step="1" {...register('getQuantity')} />}
              </Field>
            </>
          )}
        </div>
        {type !== 'free_shipping' && (
          <label className="checkbox">
            <input type="checkbox" {...register('freeShipping')} />
            Also give free shipping on the whole order
          </label>
        )}

        <h2 className="panel__title">Conditions</h2>
        <div className="form__grid">
          <Field label="Minimum spend (USD, optional)" error={errors.minSubtotal?.message} hint="Cart subtotal needed (after group prices); empty for none.">
            {(a11y) => <input {...a11y} type="number" inputMode="decimal" min="0" step="0.01" {...register('minSubtotal')} />}
          </Field>
          <Field label="Applies to" error={errors.appliesTo?.message} hint="The discount is shared over these cart lines only.">
            {(a11y) => (
              <select {...a11y} {...register('appliesTo')}>
                {Object.entries(APPLIES_TO).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        {appliesTo === 'categories' && (
          <CategoryChecklist legend="Eligible categories" selected={categoryIds} onChange={choose('categoryIds')} error={errors.categoryIds?.message} disabled={!editable} />
        )}
        {appliesTo === 'products' && (
          <ProductPicker legend="Eligible products" selected={productIds} onChange={choose('productIds')} error={errors.productIds?.message} disabled={!editable} announce={setAnnouncement} />
        )}
        <GroupChecklist selected={customerGroupIds} onChange={choose('customerGroupIds')} error={errors.customerGroupIds?.message} disabled={!editable} />

        <div className="form__grid">
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
          {autoApply ? 'Active (applies by itself within the dates and limits above)' : 'Active (shoppers can use it within the dates and limits above)'}
        </label>
      </fieldset>

      <div className="form__actions">
        {editable ? (
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
