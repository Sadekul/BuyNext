import { useId, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { LuArrowLeft } from 'react-icons/lu'
import { adminKeys, createProduct, getCategories, getProduct, updateProduct } from '../api/admin'
import DemoNotice from '../components/DemoNotice'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { ErrorState, Loading } from '../components/States'
import { EMPTY_PRODUCT, productSchema } from '../utils/productSchema'
import { formatMoney } from '../utils/format'

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
      <DemoNotice />
      {/* key: a fresh form (and default values) per product */}
      <ProductForm key={productId ?? 'new'} productId={productId} initial={initial} categories={categories.data ?? []} />
    </>
  )
}

const FIELDS_FROM_SERVER = Object.keys(EMPTY_PRODUCT)

function ProductForm({ productId, initial, categories }) {
  const isNew = productId === undefined
  const [result, setResult] = useState(null)
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isDirty },
  } = useForm({ resolver: zodResolver(productSchema), defaultValues: initial, mode: 'onSubmit', reValidateMode: 'onChange' })

  const save = useMutation({
    mutationFn: (values) => (isNew ? createProduct(values) : updateProduct(productId, values)),
    onSuccess: (response, values) => {
      setResult(response.product)
      reset(values) // the form now matches what was "saved"
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
      {result && (
        <p className="notice notice--success" role="status">
          {isNew ? `Product created (demo, id #${result.id}). ` : 'Changes saved (demo). '}
          DummyJSON accepted {isNew ? 'it' : 'them'} but doesn't store changes, so the store still shows the original.
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

/**
 * Label + control + hint + error. `children` is a function that receives the
 * id and aria attributes for the control, so the label and messages are wired up.
 */
function Field({ label, error, hint, className = '', children }) {
  const id = useId()
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && (
        <span id={`${id}-hint`} className="field__hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} className="field__error">
          {error}
        </span>
      )}
    </div>
  )
}

export default ProductFormPage
