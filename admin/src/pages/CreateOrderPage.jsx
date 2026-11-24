import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuArrowLeft, LuPlus, LuSearch, LuTrash2, LuX } from 'react-icons/lu'
import { adminKeys, createOrder, getCustomer, getCustomers, getProduct, getProducts, getSettings, quoteOrder } from '../api/admin'
import { useAdminAuth } from '../auth/useAdminAuth'
import { AddressFields } from '../components/Address'
import Field from '../components/Field'
import PageHeader from '../components/PageHeader'
import { ErrorState, Loading } from '../components/States'
import { EMPTY_ADDRESS, addressErrors, addressValues } from '../utils/address'
import { isEmail } from '../utils/customers'
import { formatMoney, fullName } from '../utils/format'
import { ADMIN_ONLY_PAYMENT_METHODS, PAYMENT_METHODS } from '../utils/orders'
import { actionErrorMessage } from '../utils/permissions'
// Phase 14 §3 and §4: the address's delivery zone, delivery times, cash on delivery.
import { etaText } from '../utils/bangladesh'

const SHIPPING_FALLBACK = [
  { id: 'standard', label: 'Standard' },
  { id: 'express', label: 'Express' },
  { id: 'nextDay', label: 'Next day' },
]
const STORE_PAYMENT_METHODS = ['card', 'paypal', 'cod']
const EMPTY_GUEST = { email: '', phone: '', firstName: '', lastName: '' }

const err = (errors, field) => errors?.[field]?.[0]
const fromSaved = (address) => (address ? { ...EMPTY_ADDRESS, ...Object.fromEntries(Object.entries(address).filter(([key]) => key in EMPTY_ADDRESS).map(([key, value]) => [key, value ?? ''])) } : EMPTY_ADDRESS)
const lineKey = (productId, variantId) => `${productId}:${variantId ?? ''}`

/** A value that follows `value` after `delay` ms of quiet (live totals while typing). */
function useSettled(value, delay = 400) {
  const [settled, setSettled] = useState(value)
  const serialized = JSON.stringify(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(JSON.parse(serialized)), delay)
    return () => clearTimeout(timer)
  }, [serialized, delay])
  return settled
}

/**
 * Sales → Orders → Create order (Magento's "Create New Order", a phone
 * order): a customer (search) or a guest, products with their options and
 * quantities, addresses (the customer's saved ones offered), shipping,
 * payment (including bank transfer and cash, which only admins may choose),
 * a coupon, and a note. The totals are the server's (the same checkout as the
 * store, with the customer's group discount), refreshed as the order changes.
 * Needs orders.create.
 */
function CreateOrderPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { can } = useAdminAuth()
  const [mode, setMode] = useState('customer') // 'customer' | 'guest'
  const [customerId, setCustomerId] = useState(() => (/^\d+$/.test(params.get('customer') ?? '') ? Number(params.get('customer')) : null))
  const [guest, setGuest] = useState(EMPTY_GUEST)
  const [lines, setLines] = useState([]) // [{ key, productId, variantId, title, variantLabel, thumbnail, quantity }]
  const [shipping, setShipping] = useState(EMPTY_ADDRESS)
  const [sameAsShipping, setSameAsShipping] = useState(true)
  const [billing, setBilling] = useState(EMPTY_ADDRESS)
  const [shippingMethod, setShippingMethod] = useState('standard')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [couponDraft, setCouponDraft] = useState('')
  const [couponCode, setCouponCode] = useState('')
  const [note, setNote] = useState('')
  const [notify, setNotify] = useState(true)
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState(null)
  const messageRef = useRef(null)

  const customer = useQuery({ queryKey: adminKeys.customer(customerId), queryFn: ({ signal }) => getCustomer(customerId, { signal }), enabled: mode === 'customer' && customerId !== null })
  const settings = useQuery({ queryKey: adminKeys.settings, queryFn: ({ signal }) => getSettings({ signal }), enabled: can('settings.view'), staleTime: 60_000 })
  const countries = settings.data?.checkout?.allowedCountries
  // Phase 14 §2: a new address starts in the store's default country (Bangladesh: division, district, area).
  const defaultCountry = settings.data?.checkout?.defaultCountry
  const [countryFilled, setCountryFilled] = useState(false)
  if (defaultCountry && !countryFilled) {
    setCountryFilled(true)
    if (!shipping.country) setShipping((current) => ({ ...current, country: current.country || defaultCountry }))
    if (!billing.country) setBilling((current) => ({ ...current, country: current.country || defaultCountry }))
  }

  // A chosen customer: their name and default addresses fill the form (once per customer, while rendering).
  const [filledFor, setFilledFor] = useState(null)
  if (customer.data && filledFor !== customer.data.id) {
    const data = customer.data
    setFilledFor(data.id)
    const defaultShipping = data.addresses.find((address) => address.isDefaultShipping) ?? data.addresses[0]
    const defaultBilling = data.addresses.find((address) => address.isDefaultBilling)
    setShipping(defaultShipping ? fromSaved(defaultShipping) : { ...EMPTY_ADDRESS, firstName: data.firstName, lastName: data.lastName })
    if (defaultBilling && defaultShipping && defaultBilling.id !== defaultShipping.id) {
      setSameAsShipping(false)
      setBilling(fromSaved(defaultBilling))
    }
  }

  const who = mode === 'customer' ? (customerId ? { customerId } : null) : { guest: { email: guest.email.trim(), phone: guest.phone.trim(), firstName: guest.firstName.trim(), lastName: guest.lastName.trim() } }
  const items = lines.map((line) => ({ productId: line.productId, ...(line.variantId && { variantId: line.variantId }), quantity: Number(line.quantity) }))
  const validItems = items.every((item) => Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 999)
  const quoteBody = useSettled({
    ...(who ?? {}),
    items,
    ...(shipping.country && { shippingAddress: addressValues(shipping) }),
    shippingMethod,
    ...(paymentMethod && { paymentMethod }),
    ...(couponCode && { couponCode }),
    notifyCustomer: notify,
  })
  const quote = useQuery({
    queryKey: adminKeys.quote(quoteBody),
    queryFn: ({ signal }) => quoteOrder(quoteBody, { signal }),
    enabled: quoteBody.items.length > 0 && (Boolean(quoteBody.customerId) || Boolean(quoteBody.guest)) && quoteBody.items.every((item) => Number.isInteger(item.quantity) && item.quantity >= 1),
    placeholderData: keepPreviousData,
    retry: false,
  })

  const place = useMutation({
    mutationFn: (body) => createOrder(body),
    onSuccess: ({ order }) => {
      for (const key of [['orders'], adminKeys.overview, ['products'], ['product'], ['customer']]) queryClient.invalidateQueries({ queryKey: key })
      navigate(`/orders/${order.number}`, { state: { notice: `Order ${order.number} placed${notify ? '; the customer was emailed a confirmation' : ''}.` } })
    },
    onError: (error) => {
      setErrors(error.fieldErrors ?? {})
      setMessage({ text: error.fieldErrors ? 'Please check the highlighted fields.' : actionErrorMessage(error), problems: error.problems ?? [] })
    },
  })

  useEffect(() => {
    if (message) messageRef.current?.focus()
  }, [message])

  function addLine(product, variant) {
    const key = lineKey(product.id, variant?.id)
    setLines((current) =>
      current.some((line) => line.key === key)
        ? current.map((line) => (line.key === key ? { ...line, quantity: String(Number(line.quantity || 0) + 1) } : line))
        : [
            ...current,
            // Start at the product's minimum order quantity (the server refuses less).
            { key, productId: product.id, variantId: variant?.id ?? null, title: product.title, variantLabel: variant?.label ?? null, thumbnail: product.thumbnail, quantity: String(product.minimumOrderQuantity ?? 1) },
          ],
    )
  }

  function submit(event) {
    event.preventDefault()
    const found = {}
    if (mode === 'customer' && !customerId) found.customerId = ['Choose a customer, or switch to a guest order.']
    if (mode === 'guest') {
      if (!isEmail(guest.email)) found['guest.email'] = ['Enter a valid email address.']
      if (!guest.phone.trim()) found['guest.phone'] = ['Enter a phone number with its country code.']
      if (!guest.firstName.trim()) found['guest.firstName'] = ['Enter the first name.']
      if (!guest.lastName.trim()) found['guest.lastName'] = ['Enter the last name.']
    }
    if (lines.length === 0) found.items = ['Add at least one product.']
    else if (!validItems) found.items = ['Enter a quantity from 1 to 999 for each product.']
    for (const [field, messages] of Object.entries(addressErrors(shipping))) found[`shippingAddress.${field}`] = messages
    if (!sameAsShipping) for (const [field, messages] of Object.entries(addressErrors(billing))) found[`billingAddress.${field}`] = messages
    if (!paymentMethod) found.paymentMethod = ['Choose a payment method.']
    setErrors(found)
    if (Object.keys(found).length > 0) {
      setMessage({ text: 'Please check the highlighted fields.', problems: [] })
      return
    }
    place.mutate({
      ...who,
      items,
      shippingAddress: addressValues(shipping),
      ...(sameAsShipping ? { sameAsShipping: true } : { billingAddress: addressValues(billing) }),
      shippingMethod,
      paymentMethod,
      ...(couponCode && { couponCode }),
      ...(note.trim() && { note: note.trim() }),
      notifyCustomer: notify,
    })
  }

  const prefixed = (prefix) => Object.fromEntries(Object.entries(errors).filter(([field]) => field.startsWith(`${prefix}.`)).map(([field, messages]) => [field.slice(prefix.length + 1), messages]))
  const savedAddresses = mode === 'customer' ? (customer.data?.addresses ?? []) : []
  const shippingOptions = quote.data?.shippingOptions?.length ? quote.data.shippingOptions : SHIPPING_FALLBACK
  const storeMethods = quote.data?.paymentMethods ?? settings.data?.checkout?.enabledPaymentMethods ?? STORE_PAYMENT_METHODS
  // Phase 10: "Gift card" is only for a card that pays a whole storefront order, never a choice here.
  const paymentChoices = [...new Set([...storeMethods.filter((id) => PAYMENT_METHODS[id] && id !== 'gift_card' && id !== 'reward_points'), ...ADMIN_ONLY_PAYMENT_METHODS])]

  return (
    <>
      <title>Create order | BuyNest Admin</title>
      <Link to="/orders" className="back-link">
        <LuArrowLeft aria-hidden="true" /> Orders
      </Link>
      <PageHeader title="Create order" description="An order placed for a customer, for example over the phone. Prices, discounts, tax, and stock are the store's." />
      <div role={message ? 'alert' : undefined}>
        {message && (
          <div ref={messageRef} tabIndex={-1} className="form-error">
            <p>{message.text}</p>
            {message.problems?.length > 0 && (
              <ul>
                {message.problems.map((problem, index) => (
                  <li key={`${problem.productId}-${index}`}>{problem.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <form className="create-order" noValidate onSubmit={submit}>
        <div className="create-order__main">
          <section className="panel panel--padded" aria-labelledby="co-customer">
            <h2 id="co-customer" className="panel__title">
              Customer
            </h2>
            <fieldset className="form__fieldset segmented">
              <legend className="visually-hidden">Who is the order for?</legend>
              <label className="checkbox">
                <input type="radio" name="co-mode" checked={mode === 'customer'} onChange={() => setMode('customer')} /> A customer account
              </label>
              <label className="checkbox">
                <input type="radio" name="co-mode" checked={mode === 'guest'} onChange={() => setMode('guest')} /> A guest
              </label>
            </fieldset>
            {mode === 'customer' ? (
              customerId ? (
                <ChosenCustomer
                  customer={customer}
                  onClear={() => {
                    setCustomerId(null)
                    setFilledFor(null)
                  }}
                />
              ) : (
                <CustomerSearch error={err(errors, 'customerId')} onPick={(picked) => setCustomerId(picked.id)} />
              )
            ) : (
              <div className="form__grid">
                <Field label="Email" error={err(errors, 'guest.email')}>
                  {(a11y) => <input {...a11y} type="email" value={guest.email} maxLength={190} autoComplete="off" onChange={(event) => setGuest({ ...guest, email: event.target.value })} />}
                </Field>
                <Field label="Phone" error={err(errors, 'guest.phone')} hint="With the country code, for example +1 555 010 0100.">
                  {(a11y) => <input {...a11y} type="tel" value={guest.phone} maxLength={40} autoComplete="off" onChange={(event) => setGuest({ ...guest, phone: event.target.value })} />}
                </Field>
                <Field label="First name" error={err(errors, 'guest.firstName')}>
                  {(a11y) => (
                    <input
                      {...a11y}
                      value={guest.firstName}
                      maxLength={60}
                      autoComplete="off"
                      onChange={(event) => {
                        setGuest({ ...guest, firstName: event.target.value })
                        if (!shipping.firstName || shipping.firstName === guest.firstName) setShipping({ ...shipping, firstName: event.target.value })
                      }}
                    />
                  )}
                </Field>
                <Field label="Last name" error={err(errors, 'guest.lastName')}>
                  {(a11y) => (
                    <input
                      {...a11y}
                      value={guest.lastName}
                      maxLength={60}
                      autoComplete="off"
                      onChange={(event) => {
                        setGuest({ ...guest, lastName: event.target.value })
                        if (!shipping.lastName || shipping.lastName === guest.lastName) setShipping({ ...shipping, lastName: event.target.value })
                      }}
                    />
                  )}
                </Field>
              </div>
            )}
          </section>

          <section className="panel panel--padded" aria-labelledby="co-items">
            <h2 id="co-items" className="panel__title">
              Products
            </h2>
            <ProductSearch onAdd={addLine} />
            {err(errors, 'items') && (
              <p className="field__error" role="alert">
                {err(errors, 'items')}
              </p>
            )}
            {lines.length > 0 && (
              <Lines
                lines={lines}
                quote={quote.data}
                errors={errors}
                onQuantity={(key, quantity) => setLines((current) => current.map((line) => (line.key === key ? { ...line, quantity } : line)))}
                onRemove={(key) => setLines((current) => current.filter((line) => line.key !== key))}
              />
            )}
          </section>

          <section className="panel panel--padded" aria-labelledby="co-shipping">
            <h2 id="co-shipping" className="panel__title">
              Shipping address
            </h2>
            {savedAddresses.length > 0 && <SavedAddressPicker id="co-saved-shipping" label="Use a saved address" addresses={savedAddresses} onPick={(address) => setShipping(fromSaved(address))} />}
            <AddressFields value={shipping} onChange={setShipping} errors={prefixed('shippingAddress')} countries={countries} autoCompletePrefix="shipping" />
          </section>

          <section className="panel panel--padded" aria-labelledby="co-billing">
            <h2 id="co-billing" className="panel__title">
              Billing address
            </h2>
            <label className="checkbox">
              <input type="checkbox" checked={sameAsShipping} onChange={(event) => setSameAsShipping(event.target.checked)} />
              Same as the shipping address
            </label>
            {!sameAsShipping && (
              <>
                {savedAddresses.length > 0 && <SavedAddressPicker id="co-saved-billing" label="Use a saved address" addresses={savedAddresses} onPick={(address) => setBilling(fromSaved(address))} />}
                <AddressFields value={billing} onChange={setBilling} errors={prefixed('billingAddress')} countries={countries} autoCompletePrefix="billing" />
              </>
            )}
          </section>

          <section className="panel panel--padded" aria-labelledby="co-methods">
            <h2 id="co-methods" className="panel__title">
              Shipping and payment
            </h2>
            <fieldset className="form__fieldset">
              <legend>Shipping method</legend>
              {/* Phase 14 §3: the zone the Bangladesh address falls in prices the delivery. */}
              {quote.data?.deliveryZone && <p className="field__hint">Delivery zone: {quote.data.deliveryZone.name ?? quote.data.deliveryZone.code}</p>}
              {shippingOptions.map((option) => (
                <label key={option.id} className="checkbox">
                  <input type="radio" name="co-shipping-method" value={option.id} checked={shippingMethod === option.id} onChange={() => setShippingMethod(option.id)} />
                  {option.label}
                  {option.price !== undefined && <span className="muted"> · {option.price === 0 ? 'Free' : formatMoney(option.price)}</span>}
                  {(etaText(option.etaDaysMin, option.etaDaysMax) || option.eta) && <span className="muted"> · {etaText(option.etaDaysMin, option.etaDaysMax) || option.eta}</span>}
                </label>
              ))}
              {err(errors, 'shippingMethod') && <span className="field__error">{err(errors, 'shippingMethod')}</span>}
            </fieldset>
            <Field label="Payment method" error={err(errors, 'paymentMethod')} hint="Bank transfer and cash are for orders taken by staff; the store's checkout doesn't offer them.">
              {(a11y) => (
                <select {...a11y} value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                  <option value="">Choose…</option>
                  {paymentChoices.map((id) => (
                    <option key={id} value={id}>
                      {PAYMENT_METHODS[id]}
                      {ADMIN_ONLY_PAYMENT_METHODS.includes(id) ? ' (staff only)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {/* Phase 14 §4: cash on delivery's limit and zones, and its fee, for this order. */}
            {paymentMethod === 'cod' && quote.data?.cod && (
              <p className={quote.data.cod.available ? 'field__hint' : 'field__error'} role={quote.data.cod.available ? undefined : 'alert'}>
                {quote.data.cod.available
                  ? quote.data.cod.fee > 0
                    ? `A cash on delivery fee of ${formatMoney(quote.data.cod.fee)} is added.`
                    : 'Paid in cash on delivery.'
                  : (quote.data.cod.message ?? "Cash on delivery isn't offered for this order.")}
              </p>
            )}
            <div className="coupon-row">
              <Field label="Coupon code (optional)" error={err(errors, 'couponCode') ?? (couponCode && quote.data?.couponError) ?? undefined}>
                {(a11y) => (
                  <input
                    {...a11y}
                    value={couponDraft}
                    maxLength={40}
                    autoComplete="off"
                    onChange={(event) => setCouponDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      setCouponCode(couponDraft.trim().toUpperCase())
                    }}
                  />
                )}
              </Field>
              <button type="button" className="btn btn--outline" onClick={() => setCouponCode(couponDraft.trim().toUpperCase())}>
                Apply
              </button>
              {couponCode && (
                <button
                  type="button"
                  className="btn btn--outline"
                  onClick={() => {
                    setCouponCode('')
                    setCouponDraft('')
                  }}
                >
                  Remove
                </button>
              )}
            </div>
            <Field label="Order note (optional)" error={err(errors, 'note')} hint="Added to the order's history.">
              {(a11y) => <textarea {...a11y} rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />}
            </Field>
            <label className="checkbox">
              <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} />
              Email the customer an order confirmation
            </label>
          </section>
        </div>

        <aside className="create-order__summary panel panel--padded" aria-labelledby="co-totals">
          <h2 id="co-totals" className="panel__title">
            Totals
          </h2>
          <Totals quote={quote} hasLines={lines.length > 0} hasCustomer={Boolean(who)} couponCode={couponCode} />
          <button type="submit" className="btn btn--primary btn--full" disabled={place.isPending}>
            {place.isPending ? 'Placing the order…' : 'Place order'}
          </button>
        </aside>
      </form>
    </>
  )
}

function ChosenCustomer({ customer, onClear }) {
  if (customer.isPending) return <Loading label="Loading the customer…" />
  if (customer.error) return <ErrorState error={customer.error} onRetry={customer.refetch} />
  const data = customer.data
  return (
    <div className="chosen-customer">
      <p>
        <strong>{fullName(data)}</strong> · {data.email}
        {data.phone && ` · ${data.phone}`}
        <br />
        <span className="muted">
          {data.group ? `${data.group.name}${data.group.discountPercent > 0 ? `: ${data.group.discountPercent}% off every product` : ''}` : 'Default group'}
          {!data.isActive && ' · blocked account'}
        </span>
      </p>
      <button type="button" className="btn btn--outline btn--sm" onClick={onClear}>
        <LuX aria-hidden="true" /> Choose another customer
      </button>
    </div>
  )
}

/** Search customers by name, email, or phone, and pick one. */
function CustomerSearch({ onPick, error }) {
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const results = useQuery({ queryKey: adminKeys.customers({ q, picker: true }), queryFn: ({ signal }) => getCustomers({ q, limit: 8 }, { signal }), enabled: q.length > 0 })
  const search = () => setQ(draft.trim())
  return (
    <div className="picker">
      <div className="picker__search">
        <Field label="Find a customer" error={error} hint="Name, email, or phone.">
          {(a11y) => (
            <input
              {...a11y}
              type="search"
              value={draft}
              autoComplete="off"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                search()
              }}
            />
          )}
        </Field>
        <button type="button" className="btn btn--outline" onClick={search}>
          <LuSearch aria-hidden="true" /> Search
        </button>
      </div>
      <div role="status" className="visually-hidden">
        {results.data && `${results.data.customers.length} ${results.data.customers.length === 1 ? 'customer' : 'customers'} found.`}
      </div>
      {results.isFetching && <Loading label="Searching…" />}
      {results.error && <ErrorState error={results.error} onRetry={results.refetch} />}
      {results.data && results.data.customers.length === 0 && <p className="muted">No customers match “{q}”.</p>}
      {results.data && results.data.customers.length > 0 && (
        <ul className="picker-list" aria-label="Matching customers">
          {results.data.customers.map((customer) => (
            <li key={customer.id}>
              <span>
                {fullName(customer)} <span className="muted">· {customer.email}</span>
                {!customer.isActive && <span className="muted"> · blocked</span>}
              </span>
              <button type="button" className="btn btn--outline btn--sm" onClick={() => onPick(customer)}>
                Choose <span className="visually-hidden">{fullName(customer)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Search active products; a product with options asks which variant. */
function ProductSearch({ onAdd }) {
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const [choosing, setChoosing] = useState(null) // a product with variants
  const results = useQuery({ queryKey: adminKeys.products({ q, status: 'active', picker: true }), queryFn: ({ signal }) => getProducts({ q, status: 'active', limit: 8 }, { signal }), enabled: q.length > 0 })
  const search = () => setQ(draft.trim())
  return (
    <div className="picker">
      <div className="picker__search">
        <Field label="Find a product" hint="Name, brand, or SKU.">
          {(a11y) => (
            <input
              {...a11y}
              type="search"
              value={draft}
              autoComplete="off"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                search()
              }}
            />
          )}
        </Field>
        <button type="button" className="btn btn--outline" onClick={search}>
          <LuSearch aria-hidden="true" /> Search
        </button>
      </div>
      <div role="status" className="visually-hidden">
        {results.data && `${results.data.products.length} ${results.data.products.length === 1 ? 'product' : 'products'} found.`}
      </div>
      {results.isFetching && <Loading label="Searching…" />}
      {results.error && <ErrorState error={results.error} onRetry={results.refetch} />}
      {results.data && results.data.products.length === 0 && <p className="muted">No products for sale match “{q}”.</p>}
      {results.data && results.data.products.length > 0 && (
        <ul className="picker-list" aria-label="Matching products">
          {results.data.products.map((product) => (
            <li key={product.id}>
              <span className="table__product">
                {product.thumbnail && <img src={product.thumbnail} alt="" width="32" height="32" loading="lazy" />}
                <span>
                  {product.title}
                  <small>
                    {formatMoney(product.price)} · {product.stock} in stock{product.hasVariants ? ' · has options' : ''}
                  </small>
                </span>
              </span>
              {choosing?.id === product.id ? null : (
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  disabled={product.stock < 1}
                  onClick={() => (product.hasVariants ? setChoosing(product) : onAdd(product))}
                >
                  <LuPlus aria-hidden="true" /> {product.hasVariants ? 'Choose options' : 'Add'} <span className="visually-hidden">{product.title}</span>
                </button>
              )}
              {choosing?.id === product.id && (
                <VariantPicker
                  product={product}
                  onAdd={(variant) => {
                    onAdd(product, variant)
                    setChoosing(null)
                  }}
                  onCancel={() => setChoosing(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function VariantPicker({ product, onAdd, onCancel }) {
  const detail = useQuery({ queryKey: adminKeys.product(product.id), queryFn: ({ signal }) => getProduct(product.id, { signal }) })
  const [variantId, setVariantId] = useState('')
  const [error, setError] = useState(null)
  if (detail.isPending) return <Loading label="Loading the options…" />
  if (detail.error) return <ErrorState error={detail.error} onRetry={detail.refetch} />
  const variants = (detail.data.variants ?? []).filter((variant) => variant.isActive && variant.isCurrent !== false)
  return (
    <div className="variant-picker">
      <Field label={`Options for ${product.title}`} error={error}>
        {(a11y) => (
          <select {...a11y} value={variantId} onChange={(event) => setVariantId(event.target.value)}>
            <option value="">Choose…</option>
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id} disabled={variant.stock < 1}>
                {variant.label} · {formatMoney(variant.finalPrice ?? variant.effectivePrice ?? product.price)} · {variant.stock < 1 ? 'out of stock' : `${variant.stock} in stock`}
              </option>
            ))}
          </select>
        )}
      </Field>
      <button
        type="button"
        className="btn btn--primary btn--sm"
        onClick={() => {
          const variant = variants.find((item) => String(item.id) === variantId)
          if (!variant) return setError('Choose the options.')
          onAdd(variant)
        }}
      >
        Add to order
      </button>
      <button type="button" className="btn btn--outline btn--sm" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

/** The order's lines: quantity inputs, and the server's price and any problem for each. */
function Lines({ lines, quote, errors, onQuantity, onRemove }) {
  const priced = (line) => quote?.lines?.find((item) => item.productId === line.productId && (item.variantId ?? null) === (line.variantId ?? null))
  const problem = (line) => quote?.problems?.find((item) => item.productId === line.productId && (item.variantId ?? null) === (line.variantId ?? null))
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="visually-hidden">Products in this order</caption>
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col" className="num">
              Price
            </th>
            <th scope="col" className="num">
              Qty
            </th>
            <th scope="col" className="num">
              Total
            </th>
            <th scope="col">
              <span className="visually-hidden">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => {
            const price = priced(line)
            const issue = problem(line)
            const qtyError = err(errors, `items.${index}.quantity`) ?? (issue ? issue.message : null)
            const name = line.variantLabel ? `${line.title} (${line.variantLabel})` : line.title
            const inputId = `co-qty-${line.key}`
            return (
              <tr key={line.key}>
                <th scope="row">
                  {line.title}
                  {line.variantLabel && <small className="muted"> · {line.variantLabel}</small>}
                  {qtyError && (
                    <span id={`${inputId}-error`} className="field__error">
                      {qtyError}
                    </span>
                  )}
                </th>
                <td className="num">
                  {price ? (
                    <>
                      {formatMoney(price.salePrice)}
                      {price.salePrice < price.price && <small className="muted"> was {formatMoney(price.price)}</small>}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="num">
                  <label htmlFor={inputId} className="visually-hidden">
                    Quantity of {name}
                  </label>
                  <input
                    id={inputId}
                    className="qty-input"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="999"
                    step="1"
                    value={line.quantity}
                    aria-invalid={qtyError ? true : undefined}
                    aria-describedby={qtyError ? `${inputId}-error` : undefined}
                    onChange={(event) => onQuantity(line.key, event.target.value)}
                  />
                </td>
                <td className="num">{price ? formatMoney(price.lineTotal) : '—'}</td>
                <td className="table__actions">
                  <button type="button" className="icon-button icon-button--danger" aria-label={`Remove ${name}`} onClick={() => onRemove(line.key)}>
                    <LuTrash2 aria-hidden="true" />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SavedAddressPicker({ id, label, addresses, onPick }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        defaultValue=""
        onChange={(event) => {
          const address = addresses.find((item) => String(item.id) === event.target.value)
          if (address) onPick(address)
        }}
      >
        <option value="">Choose a saved address…</option>
        {addresses.map((address) => (
          <option key={address.id} value={address.id}>
            {[fullName(address), address.line1, address.city, address.country].filter(Boolean).join(', ')}
            {address.isDefaultShipping ? ' (default shipping)' : address.isDefaultBilling ? ' (default billing)' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

/** The server's totals for the order as it stands (announced politely as they change). */
function Totals({ quote, hasLines, hasCustomer, couponCode }) {
  if (!hasLines || !hasCustomer) return <p className="muted">Choose the customer and add products to see the totals.</p>
  if (quote.isPending) return <Loading label="Pricing the order…" />
  if (quote.error && !quote.data) {
    if (quote.error.code === 'permission_denied') return <ErrorState error={quote.error} />
    return (
      <p className="muted" role="status">
        The totals appear once the order can be priced: {Object.values(quote.error.fieldErrors ?? {})[0]?.[0] ?? quote.error.message}
      </p>
    )
  }
  const data = quote.data
  const { totals } = data
  return (
    <div aria-live="polite" aria-busy={quote.isFetching}>
      {data.customerGroup && data.groupDiscountPercent > 0 && (
        <p className="field__hint">
          {data.customerGroup} price: {data.groupDiscountPercent}% off every product
          {totals.groupDiscount > 0 ? ` (${formatMoney(totals.groupDiscount)}, already in the subtotal)` : ''}.
        </p>
      )}
      <dl className="details totals">
        <dt>Subtotal</dt>
        <dd>{formatMoney(totals.subtotal)}</dd>
        {totals.discount > 0 && (
          <>
            <dt>Discount{data.coupon?.code ? ` (${data.coupon.code})` : ''}</dt>
            <dd>−{formatMoney(totals.discount)}</dd>
          </>
        )}
        <dt>Shipping</dt>
        <dd>{formatMoney(totals.shipping)}</dd>
        <dt>Tax{data.taxEstimated ? ' (estimate)' : ''}</dt>
        <dd>{formatMoney(totals.tax)}</dd>
        <dt>
          <strong>Total</strong>
        </dt>
        <dd>
          <strong>{formatMoney(totals.total)}</strong>
        </dd>
      </dl>
      {couponCode && data.couponError && <p className="field__error">{data.couponError}</p>}
      {couponCode && data.coupon && !data.couponError && <p className="field__hint">Coupon {data.coupon.code} applied{data.coupon.description ? `: ${data.coupon.description}` : ''}.</p>}
      {data.problems?.length > 0 && (
        <ul className="field__error">
          {data.problems.map((problem, index) => (
            <li key={`${problem.productId}-${index}`}>{problem.message}</li>
          ))}
        </ul>
      )}
      {quote.error && <p className="field__error">{actionErrorMessage(quote.error)}</p>}
    </div>
  )
}

export default CreateOrderPage
