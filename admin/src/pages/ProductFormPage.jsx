import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuArrowLeft, LuBellRing, LuCopy } from 'react-icons/lu'
import { adminKeys, createProduct, getCategories, getProduct, saveProductOptions, updateProduct } from '../api/admin'
import DemoNotice from '../components/DemoNotice'
import Field from '../components/Field'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { ErrorState, Loading } from '../components/States'
import { useAdminAuth } from '../auth/useAdminAuth'
import { EMPTY_PRODUCT, GIFT_CARD_FIELDS, LIVE_ONLY_FIELDS, giftCardFormFields, productSchema, toGiftCardValues } from '../utils/productSchema'
import { formatCount, formatMoney, storeCode } from '../utils/format'
import { PRODUCT_STATUSES } from '../utils/orders'
import { LIVE_DATA } from '../api/mode'
import ProductImages from '../components/ProductImages'
import ProductVariants from '../components/ProductVariants'
import { withPaths } from '../utils/categories'
// Phase 11 §2 and §3: specifications, and related products, up-sells and cross-sells.
import ProductSpecifications from '../components/ProductSpecifications'
import ProductLinks from '../components/ProductLinks'
import { duplicateProduct } from '../api/phase11'
import { EMPTY_LINKS, changed, linkLists, specRow, specificationErrors, toLinkIds, toSpecifications } from '../utils/productLinks'
// Phase 13 §4: the product's Bangla texts, option names and specification rows.
import ProductBangla from '../components/ProductBangla'
import { PRODUCT_BANGLA_FIELDS, banglaChanged, banglaValues, toBangla } from '../utils/bangla'

/**
 * /products/new and /products/:id: one form for adding and editing. With real
 * data, a saved product also has Images and Options and variants (phase 5),
 * each saved on its own.
 */
function ProductFormPage() {
  const { productId } = useParams()
  const { can } = useAdminAuth()
  const location = useLocation()
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
      <PageHeader
        title={isNew ? 'Add product' : product.data.title}
        description={isNew ? undefined : `Product #${productId}`}
        actions={LIVE_DATA && !isNew && product.data.live && can('products.edit') ? <DuplicateProductButton productId={productId} title={product.data.title} /> : undefined}
      />
      {!LIVE_DATA && <DemoNotice />}
      {/* Phase 11: arrived here from "Duplicate" on another product. */}
      {!isNew && location.state?.duplicatedFrom && (
        <p className="notice notice--success" role="status">
          Copy of “{location.state.duplicatedFrom}” created as a draft. Its options, variants and uploaded photos weren't copied: add them below, then set the
          status to Active when it's ready.
        </p>
      )}
      {/* Phase 9 §7: shoppers who asked to be emailed when it's back in stock. */}
      {!isNew && product.data.stockAlertsWaiting > 0 && <StockAlertsNotice count={product.data.stockAlertsWaiting} />}
      {/* key: a fresh form (and default values) per product */}
      <ProductForm
        key={productId ?? 'new'}
        productId={productId}
        initial={initial}
        extras={
          isNew
            ? { specifications: [], links: EMPTY_LINKS, bangla: LIVE_DATA, bn: null, options: [] }
            : {
                specifications: product.data.specifications ?? [],
                links: linkLists(product.data.links),
                // Phase 13: only when the API has the Bangla texts (older answers: no Bangla section).
                bangla: product.data.bn !== undefined,
                bn: product.data.bn ?? null,
                options: banglaOptions(product.data.options),
              }
        }
        categories={categories.data ?? []}
        hasVariants={!isNew && product.data.hasVariants === true}
      />
      {LIVE_DATA && !isNew && product.data.live && (
        <>
          <ProductImages productId={productId} images={product.data.imageList ?? []} options={product.data.options ?? []} editable={can('products.edit')} />
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

/** Phase 11: copies the product into a new draft (POST products/:id/duplicate) and opens the copy. */
function DuplicateProductButton({ productId, title }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const duplicate = useMutation({
    mutationFn: () => duplicateProduct(productId),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      navigate(`/products/${response.product.id}`, { state: { duplicatedFrom: title } })
    },
  })
  return (
    <div className="duplicate-product">
      <button type="button" className="btn btn--outline" onClick={() => duplicate.mutate()} disabled={duplicate.isPending}>
        <LuCopy aria-hidden="true" /> {duplicate.isPending ? 'Duplicating…' : 'Duplicate'}
      </button>
      {duplicate.error && (
        <p className="form-error" role="alert">
          {duplicate.error.message}
        </p>
      )}
    </div>
  )
}

/** Phase 13: the saved options (with ids) and their Bangla names, for the Bangla section. */
const banglaOptions = (options) =>
  (options ?? [])
    .filter((option) => Number.isInteger(option.id))
    .map((option) => ({
      id: option.id,
      name: option.name,
      // Phase 16: kept so saving the Bangla names doesn't change the option's type or colours.
      ...(option.type !== undefined && { type: option.type }),
      nameBn: option.nameBn ?? '',
      values: option.values.filter((entry) => Number.isInteger(entry.id)).map((entry) => ({ id: entry.id, value: entry.value, swatch: entry.swatch ?? null, valueBn: entry.valueBn ?? '' })),
    }))
/** Phase 13: what is sent for the options' Bangla names. */
const toOptionTranslations = (options) => options.map((option) => ({ id: option.id, nameBn: option.nameBn.trim(), values: option.values.map((entry) => ({ id: entry.id, valueBn: entry.valueBn.trim() })) }))
/** Phase 13: the saved options with their Bangla names, as PUT products/:id/options takes them (valuesBn in the values' order). */
const toOptionsWithBangla = (options) =>
  options.map((option) => ({
    name: option.name,
    // Phase 16: the type and colours as saved (only when the API has them).
    ...(option.type !== undefined && { type: option.type }),
    values: option.values.map((entry) => (option.type === 'color' ? { value: entry.value, swatch: entry.swatch } : entry.value)),
    nameBn: option.nameBn.trim(),
    valuesBn: option.values.map((entry) => entry.valueBn.trim()),
  }))
/** Phase 13: server errors of the Bangla section ("bn.name", "options.0.nameBn"). */
const banglaErrorsFrom = (fieldErrors) =>
  Object.fromEntries(
    Object.entries(fieldErrors ?? {})
      .filter(([field]) => field.startsWith('bn.') || /^options\.\d+\.(nameBn|valuesBn)/.test(field))
      .map(([field, messages]) => [field.startsWith('options.') ? 'optionTranslations' : field, messages[0]]),
  )

const FIELDS_FROM_SERVER = Object.keys(EMPTY_PRODUCT)
// Phase 10 §5: the server's names for the gift card fields' errors ("giftCardAmounts.1" → the amounts field).
const fieldOf = (field) => (field.startsWith('giftCardAmounts') ? 'giftCardAmounts' : field)

/** Server errors of the phase 11 sections ("specifications.2.label", "links.upsell.0") → { specifications: { list, rows }, links: { [type] } }. */
function extraErrorsFrom(fieldErrors) {
  const found = { specifications: {}, links: {} }
  for (const [field, messages] of Object.entries(fieldErrors ?? {})) {
    const spec = /^specifications(?:\.(\d+)\.(label|value))?/.exec(field)
    const link = /^links(?:\.(related|upsell|crosssell))?/.exec(field)
    if (spec?.[1] !== undefined) found.specifications.rows = { ...found.specifications.rows, [spec[1]]: { ...found.specifications.rows?.[spec[1]], [spec[2]]: messages[0] } }
    else if (spec) found.specifications.list = messages[0]
    else if (link) found.links[link[1] ?? 'general'] = messages[0]
  }
  return found
}

function ProductForm({ productId, initial, extras, categories, hasVariants }) {
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
  // Phase 13: the English texts, shown where a Bangla one is empty (falls back to English).
  const [title, description, metaTitle, metaDescription] = useWatch({ control, name: ['title', 'description', 'metaTitle', 'metaDescription'] })
  const bangla = LIVE_DATA && extras.bangla
  // Phase 11 §2 and §3 (real data): kept here, sent only when they changed ("omitted = unchanged").
  const [saved, setSaved] = useState(() => ({
    specifications: toSpecifications(extras.specifications, { bangla }),
    links: toLinkIds(extras.links),
    bn: toBangla(banglaValues(extras.bn, PRODUCT_BANGLA_FIELDS), PRODUCT_BANGLA_FIELDS),
  }))
  const [specs, setSpecs] = useState(() => extras.specifications.map(specRow))
  const [links, setLinks] = useState(extras.links)
  const [bn, setBn] = useState(() => banglaValues(extras.bn, PRODUCT_BANGLA_FIELDS))
  // The saved options come from the product (they are saved in their own section): new or removed ones start over here.
  const optionsKey = JSON.stringify(extras.options.map((option) => [option.id, option.values.map((entry) => entry.id)]))
  const [optionState, setOptionState] = useState({ key: optionsKey, list: extras.options })
  const optionNames = optionState.key === optionsKey ? optionState.list : extras.options
  const setOptionNames = (list) => setOptionState({ key: optionsKey, list })
  const [extraErrors, setExtraErrors] = useState({ specifications: {}, links: {}, bangla: {} })
  const specsChanged = LIVE_DATA && changed(toSpecifications(specs, { bangla }), saved.specifications)
  const linksChanged = LIVE_DATA && changed(toLinkIds(links), saved.links)
  const bnChanged = bangla && banglaChanged(toBangla(bn, PRODUCT_BANGLA_FIELDS), saved.bn)
  const optionsChanged = bangla && banglaChanged(toOptionTranslations(optionNames), toOptionTranslations(extras.options))
  const save = useMutation({
    mutationFn: async (values) => {
      // The demo has no product status or SEO fields: don't send them.
      const sent = LIVE_DATA
        ? // Phase 10 §5: the gift card text fields become numbers (and only gift cards send amounts).
          {
            ...Object.fromEntries(Object.entries(values).filter(([field]) => !GIFT_CARD_FIELDS.includes(field))),
            ...toGiftCardValues(values),
            // Phase 11: only when changed, so a save never replaces them by accident.
            ...(specsChanged && { specifications: toSpecifications(specs, { bangla }) }),
            ...(linksChanged && { links: toLinkIds(links) }),
            // Phase 13: only when changed, like the specifications.
            ...(bnChanged && { bn: toBangla(bn, PRODUCT_BANGLA_FIELDS) }),
          }
        : Object.fromEntries(Object.entries(values).filter(([field]) => !LIVE_ONLY_FIELDS.includes(field)))
      const response = await (isNew ? createProduct(sent) : updateProduct(productId, sent))
      // Phase 13: the options' Bangla names are saved with the options (their own route), right after.
      if (!isNew && optionsChanged && response.live) {
        const parts = await saveProductOptions(productId, toOptionsWithBangla(optionNames))
        return { ...response, product: { ...response.product, ...parts } }
      }
      return response
    },
    onSuccess: (response, values) => {
      setExtraErrors({ specifications: {}, links: {}, bangla: {} })
      if (LIVE_DATA) setSaved({ specifications: toSpecifications(specs, { bangla }), links: toLinkIds(links), bn: toBangla(bn, PRODUCT_BANGLA_FIELDS) })
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
      setExtraErrors({ ...extraErrorsFrom(error.fieldErrors), bangla: banglaErrorsFrom(error.fieldErrors) })
    },
  })

  return (
    <form
      className="form"
      onSubmit={handleSubmit((values) => {
        // Phase 11: the specification rows are checked here first, like the other fields.
        const rows = LIVE_DATA ? specificationErrors(specs) : {}
        setExtraErrors({ specifications: rows, links: {}, bangla: {} })
        if (rows.list || rows.rows) return
        save.mutate(values)
      })}
      noValidate
    >
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
        <Field label={`Price (${storeCode()})`} error={errors.price?.message}>
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
            <Field label={`Amount choices (${storeCode()})`} error={errors.giftCardAmounts?.message} hint="Separated by commas, like 25, 50, 100." className="seo-fields__wide">
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

      {LIVE_DATA && (
        <>
          <ProductSpecifications rows={specs} onChange={setSpecs} errors={extraErrors.specifications} disabled={!can('products.edit')} />
          <ProductLinks productId={productId} lists={links} onChange={setLinks} errors={extraErrors.links} disabled={!can('products.edit')} />
        </>
      )}
      {bangla && (
        <ProductBangla
          values={bn}
          onChange={setBn}
          english={{ title, description, metaTitle, metaDescription }}
          specs={specs}
          onSpecsChange={setSpecs}
          options={optionNames}
          onOptionsChange={setOptionNames}
          errors={extraErrors.bangla}
          disabled={!can('products.edit')}
        />
      )}

      <div className="form__actions">
        {can('products.edit') ? (
          <button type="submit" className="btn btn--primary" disabled={save.isPending || (!isNew && !isDirty && !specsChanged && !linksChanged && !bnChanged && !optionsChanged)}>
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
