import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuArrowLeft } from 'react-icons/lu'
import { adminKeys, createProduct, getCategories, getProduct, updateProduct } from '../api/admin'
import DemoNotice from '../components/DemoNotice'
import Field from '../components/Field'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { ErrorState, Loading } from '../components/States'
import { EMPTY_PRODUCT, productSchema } from '../utils/productSchema'
import { formatMoney } from '../utils/format'
import { PRODUCT_STATUSES } from '../utils/orders'
import { LIVE_DATA } from '../api/mode'

/** /products/new and /products/:id: one form for adding and editing. */
function ProductFormPage() {
  const { productId } = useParams()
  const isNew = productId === undefined
  const product = useQuery({
    queryKey: adminKeys.product(productId),
    queryFn: ({ signal }) => getProduct(productId, { signal }),
    enabled: !isNew,
  })
  const categories = useQuery({ queryKey: adminKeys.categories, queryFn: ({ signal }) => getCategories({ signal }), staleTime: Infinity })

  if (!isNew && product.isPending) return <Loading label="Loading the product…" />
  if (!isNew && product.error) return <ErrorState error={product.error} onRetry={product.refetch} />

  const initial = isNew
    ? EMPTY_PRODUCT
    : Object.fromEntries(Object.keys(EMPTY_PRODUCT).map((key) => [key, product.data[key] ?? EMPTY_PRODUCT[key]]))

  return (
    <>
      <title>{`${isNew ? 'Add product' : product.data.title} | BuyNest Admin`}</title>
      <Link to="/products" className="back-link">
        <LuArrowLeft aria-hidden="true" /> Products
      </Link>
      <PageHeader title={isNew ? 'Add product' : product.data.title} description={isNew ? undefined : `Product #${productId}`} />
      {!LIVE_DATA && <DemoNotice />}
      {/* key: a fresh form (and default values) per product */}
      <ProductForm key={productId ?? 'new'} productId={productId} initial={initial} categories={categories.data ?? []} />
    </>
  )
}

const FIELDS_FROM_SERVER = Object.keys(EMPTY_PRODUCT)

function ProductForm({ productId, initial, categories }) {
  const isNew = productId === undefined
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // A product just created (real data) opens here for editing, with this note.
  const justCreated = useLocation().state?.created === true
  const [result, setResult] = useState(null)
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isDirty },
  } = useForm({ resolver: zodResolver(productSchema), defaultValues: initial, mode: 'onSubmit', reValidateMode: 'onChange' })

  const save = useMutation({
    mutationFn: (values) => {
      // The demo has no product status: don't send it.
      const sent = LIVE_DATA ? values : Object.fromEntries(Object.entries(values).filter(([field]) => field !== 'status'))
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
        if (FIELDS_FROM_SERVER.includes(field)) setError(field, { message: messages[0] })
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
            {categories.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.name}
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
        <Field label="Units in stock" error={errors.stock?.message} hint={isNew ? null : <StockHint stock={initial.stock} />}>
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
        <Field label="Description" error={errors.description?.message} className="form__wide">
          {(a11y) => <textarea {...a11y} rows={5} {...register('description')} />}
        </Field>
      </div>

      <div className="form__actions">
        <button type="submit" className="btn btn--primary" disabled={save.isPending || (!isNew && !isDirty)}>
          {save.isPending ? 'Saving…' : isNew ? 'Add product' : 'Save changes'}
        </button>
        <Link to="/products" className="btn btn--outline">
          Cancel
        </Link>
        {!isNew && <span className="muted">Current price {formatMoney(initial.price)}</span>}
      </div>
    </form>
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
