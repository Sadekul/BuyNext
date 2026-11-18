import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuArrowLeft, LuBellRing } from 'react-icons/lu'
import { adminKeys, createProduct, getCategories, getProduct, updateProduct } from '../api/admin'
import DemoNotice from '../components/DemoNotice'
import Field from '../components/Field'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { ErrorState, Loading } from '../components/States'
import { useAdminAuth } from '../auth/useAdminAuth'
import { EMPTY_PRODUCT, GIFT_CARD_FIELDS, LIVE_ONLY_FIELDS, giftCardFormFields, productSchema, toGiftCardValues } from '../utils/productSchema'
import { formatCount, formatMoney } from '../utils/format'
import { PRODUCT_STATUSES } from '../utils/orders'
import { LIVE_DATA } from '../api/mode'
import ProductImages from '../components/ProductImages'
import ProductVariants from '../components/ProductVariants'
import { withPaths } from '../utils/categories'

/**
 * /products/new and /products/:id: one form for adding and editing. With real
 * data, a saved product also has Images and Options and variants (phase 5),
 * each saved on its own.
 */
function ProductFormPage() {
  const { productId } = useParams()
  const { can } = useAdminAuth()
  const isNew = productId === undefined
  const product = useQuery({
    queryKey: adminKeys.product(productId),
    queryFn: ({ signal }) => getProduct(productId, { signal }),
    enabled: !isNew,
  })
  const categories = useQuery({ queryKey: adminKeys.categories, queryFn: ({ signal }) => getCategories({ signal }), staleTime: Infinity })

  // The category list first too: the form's category select keeps its value only if the option exists.
  if ((!isNew && product.isPending) || categories.isPending) return <Loading label="Loading the product…" />
  if (!isNew && product.error) return <ErrorState error={product.error} onRetry={product.refetch} />

  const initial = isNew
    ? EMPTY_PRODUCT
    : { ...Object.fromEntries(Object.keys(EMPTY_PRODUCT).map((key) => [key, product.data[key] ?? EMPTY_PRODUCT[key]])), ...giftCardFormFields(product.data) }

  return (
    <>
      <title>{`${isNew ? 'Add product' : product.data.title} | BuyNest Admin`}</title>
      <Link to="/products" className="back-link">
        <LuArrowLeft aria-hidden="true" /> Products
      </Link>
      <PageHeader title={isNew ? 'Add product' : product.data.title} description={isNew ? undefined : `Product #${productId}`} />
      {!LIVE_DATA && <DemoNotice />}
      {/* Phase 9 §7: shoppers who asked to be emailed when it's back in stock. */}
      {!isNew && product.data.stockAlertsWaiting > 0 && <StockAlertsNotice count={product.data.stockAlertsWaiting} />}
      {/* key: a fresh form (and default values) per product */}
      <ProductForm key={productId ?? 'new'} productId={productId} initial={initial} categories={categories.data ?? []} hasVariants={!isNew && product.data.hasVariants === true} />
      {LIVE_DATA && !isNew && product.data.live && (
        <>
          <ProductImages productId={productId} images={product.data.imageList ?? []} editable={can('products.edit')} />
          <ProductVariants
            key={`variants-${productId}`}
            productId={productId}
            product={{ price: product.data.price, options: product.data.options ?? [], variants: product.data.variants ?? [] }}
            editable={can('products.edit')}
          />
        </>
      )}
    </>
  )
}

const FIELDS_FROM_SERVER = Object.keys(EMPTY_PRODUCT)
// Phase 10 §5: the server's names for the gift card fields' errors ("giftCardAmounts.1" → the amounts field).
const fieldOf = (field) => (field.startsWith('giftCardAmounts') ? 'giftCardAmounts' : field)

function ProductForm({ productId, initial, categories, hasVariants }) {
  const isNew = productId === undefined
  const navigate = useNavigate()
  const { can } = useAdminAuth()
  const queryClient = useQueryClient()
  // A product just created (real data) opens here for editing, with this note.
  const justCreated = useLocation().state?.created === true
  const [result, setResult] = useState(null)
  const {
    register,
    handleSubmit,
    setError,
    reset,
    control,
    formState: { errors, isDirty },
  } = useForm({ resolver: zodResolver(productSchema), defaultValues: initial, mode: 'onSubmit', reValidateMode: 'onChange' })

  const isGiftCard = useWatch({ control, name: 'type' }) === 'gift_card'
  const save = useMutation({
    mutationFn: (values) => {
      // The demo has no product status or SEO fields: don't send them.
      const sent = LIVE_DATA
        ? // Phase 10 §5: the gift card text fields become numbers (and only gift cards send amounts).
          { ...Object.fromEntries(Object.entries(values).filter(([field]) => !GIFT_CARD_FIELDS.includes(field))), ...toGiftCardValues(values) }
        : Object.fromEntries(Object.entries(values).filter(([field]) => !LIVE_ONLY_FIELDS.includes(field)))
      return isNew ? createProduct(sent) : updateProduct(productId, sent)
    },
    onSuccess: (response, values) => {
      if (response.live) {
        queryClient.invalidateQueries({ queryKey: ['products'] })
        queryClient.invalidateQueries({ queryKey: adminKeys.overview })
        // The saved product is the server's answer: show it without loading it again.
        queryClient.setQueryData(adminKeys.product(response.product.id), { ...response.product, live: true })
        if (isNew) {
          navigate(`/products/${response.product.id}`, { replace: true, state: { created: true } })
          return
        }
      }
      setResult(response)
      reset(values) // the form now matches what was saved
    },
    onError: (error) => {
      // Server-side validation (422): show each message on its field.
      for (const [field, messages] of Object.entries(error.fieldErrors ?? {})) {
        if (FIELDS_FROM_SERVER.includes(fieldOf(field))) setError(fieldOf(field), { message: messages[0] })
      }
    },
  })

  return (
    <form className="form" onSubmit={handleSubmit((values) => save.mutate(values))} noValidate>
      {result?.simulated && (
        <p className="notice notice--success" role="status">
          {isNew ? `Product created (demo, id #${result.product.id}). ` : 'Changes saved (demo). '}
          DummyJSON accepted {isNew ? 'it' : 'them'} but doesn't store changes, so the store still shows the original.
        </p>
      )}
      {(result?.live || (justCreated && !result)) && (
        <p className="notice notice--success" role="status">
          {justCreated && !result ? 'Product created.' : 'Changes saved.'}{' '}
          {(result?.product.status ?? initial.status) === 'active' ? 'It is live in the store.' : 'It is not shown in the store until its status is Active.'}
        </p>
      )}
      {save.error && !save.error.fieldErrors && (
        <p className="form-error" role="alert">
          {save.error.message}
        </p>
      )}

      <div className="form__grid">
        <Field label="Name" error={errors.title?.message} className="form__wide">
          {(a11y) => <input {...a11y} {...register('title')} />}
        </Field>
        <Field label="Brand" error={errors.brand?.message}>
          {(a11y) => <input {...a11y} {...register('brand')} />}
        </Field>
        <Field label="Category" error={errors.category?.message}>
          {(a11y) => (
          <select {...a11y} {...register('category')}>
            <option value="">Choose…</option>
            {withPaths(categories).map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.path}
              </option>
            ))}
          </select>
          )}
        </Field>
        <Field label="Price (USD)" error={errors.price?.message}>
          {(a11y) => <input {...a11y} type="number" inputMode="decimal" step="0.01" min="0" {...register('price', { valueAsNumber: true })} />}
        </Field>
        <Field label="Discount (%)" error={errors.discountPercentage?.message}>
          {(a11y) => (
            <input {...a11y} type="number" inputMode="decimal" step="0.01" min="0" max="90" {...register('discountPercentage', { valueAsNumber: true })} />
          )}
        </Field>
        <Field
          label="Units in stock"
          error={errors.stock?.message}
          hint={hasVariants ? 'This product sells through its variants: their stock counts, set below.' : isNew ? null : <StockHint stock={initial.stock} />}
        >
          {(a11y) => <input {...a11y} type="number" inputMode="numeric" step="1" min="0" {...register('stock', { valueAsNumber: true })} />}
        </Field>
        {LIVE_DATA && (
          <Field label="Status" error={errors.status?.message} hint="Only active products are shown in the store. Drafts and archived products stay here.">
            {(a11y) => (
              <select {...a11y} {...register('status')}>
                {Object.entries(PRODUCT_STATUSES).map(([value, { label }]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {LIVE_DATA && (
          <Field label="Weight (g, optional)" error={errors.weight?.message} hint="Used by the shipping table rates. Empty: the store's default weight.">
            {(a11y) => <input {...a11y} type="number" inputMode="numeric" min="0" step="1" {...register('weight')} />}
          </Field>
        )}
        {LIVE_DATA && (
          <Field label="Product type" error={errors.type?.message} hint="A gift card is emailed to the person the shopper names; it needs no shipping and isn't taxed.">
            {(a11y) => (
              <select {...a11y} {...register('type')}>
                <option value="simple">Simple product</option>
                <option value="gift_card">Gift card</option>
              </select>
            )}
          </Field>
        )}
        <Field label="Description" error={errors.description?.message} className="form__wide">
          {(a11y) => <textarea {...a11y} rows={5} {...register('description')} />}
        </Field>
      </div>
      {/* Phase 10 §5: the amounts a shopper can choose. */}
      {LIVE_DATA && isGiftCard && (
        <fieldset className="form__fieldset seo-fields">
          <legend>Gift card amounts</legend>
          <div className="form__grid">
            <Field label="Amount choices (USD)" error={errors.giftCardAmounts?.message} hint="Separated by commas, like 25, 50, 100." className="seo-fields__wide">
              {(a11y) => <input {...a11y} inputMode="decimal" autoComplete="off" {...register('giftCardAmounts')} />}
            </Field>
            <Field label="Custom amount from (optional)" error={errors.giftCardMinAmount?.message} hint="With both ends, shoppers can also type an amount in this range.">
              {(a11y) => <input {...a11y} type="number" inputMode="decimal" min="1" step="0.01" {...register('giftCardMinAmount')} />}
            </Field>
            <Field label="Custom amount up to (optional)" error={errors.giftCardMaxAmount?.message}>
              {(a11y) => <input {...a11y} type="number" inputMode="decimal" min="1" step="0.01" {...register('giftCardMaxAmount')} />}
            </Field>
          </div>
        </fieldset>
      )}
      {LIVE_DATA && (
        <fieldset className="form__fieldset seo-fields">
          <legend>Search engines</legend>
          <div className="form__grid">
            <Field label="Meta title (optional)" error={errors.metaTitle?.message} hint="The browser tab and search result title. Empty: the product name.">
              {(a11y) => <input {...a11y} maxLength={190} {...register('metaTitle')} />}
            </Field>
            <Field label="Meta description (optional)" error={errors.metaDescription?.message} hint="The search result snippet. Empty: the start of the description." className="seo-fields__wide">
              {(a11y) => <textarea {...a11y} rows={2} maxLength={500} {...register('metaDescription')} />}
            </Field>
          </div>
        </fieldset>
      )}

      <div className="form__actions">
        {can('products.edit') ? (
          <button type="submit" className="btn btn--primary" disabled={save.isPending || (!isNew && !isDirty)}>
            {save.isPending ? 'Saving…' : isNew ? 'Add product' : 'Save changes'}
          </button>
        ) : (
          <span className="muted">Your role can view this product but not change it.</span>
        )}
        <Link to="/products" className="btn btn--outline">
          Cancel
        </Link>
        {!isNew && <span className="muted">Current price {formatMoney(initial.price)}</span>}
      </div>
    </form>
  )
}

function StockAlertsNotice({ count }) {
  return (
    <p className="notice stock-alerts-notice">
      <LuBellRing aria-hidden="true" />
      <span>
        <strong>{count === 1 ? '1 shopper is' : `${formatCount(count)} shoppers are`} waiting</strong> for a back-in-stock email. They are emailed once,
        automatically, as soon as it can be ordered again. <Link to="/reports#stock-alerts">See all stock alerts</Link>
      </span>
    </p>
  )
}

function StockHint({ stock }) {
  return (
    <>
      Now: <StatusBadge stock={stock} />
    </>
  )
}

export default ProductFormPage
