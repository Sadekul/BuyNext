import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useLocation, useNavigate } from 'react-router'
import { LuLock, LuShoppingBag, LuTriangleAlert, LuUserRound } from 'react-icons/lu'
import AddressFields from '../components/checkout/AddressFields'
import CouponForm from '../components/cart/CouponForm'
import ChoiceCards from '../components/forms/ChoiceCards'
import FormField, { CheckboxField } from '../components/forms/FormField'
import OrderItems from '../components/orders/OrderItems'
import OrderTotals from '../components/orders/OrderTotals'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import Loader from '../components/ui/Loader'
import { useAuth } from '../hooks/useAuth'
import { useCart } from '../hooks/useCart'
import { useProductRefresh } from '../hooks/useProductRefresh'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { defaultShippingMethodId, useStoreSettings } from '../hooks/useStoreSettings'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { profileQuery } from '../queries/userQueries'
import { productKeys } from '../queries/productQueries'
import { cartPricingKey, cartPricingQuery, orderKeys } from '../queries/orderQueries'
import { useOrders } from '../hooks/useOrders'
import { createOrder, verifyCartWithServer } from '../services/orderService'
import { placeOrder as placeServerOrder } from '../services/shopService'
import { EMPTY_ADDRESS, checkoutSchema, createCheckoutSchema } from '../schemas/checkoutSchema'
import { REAL_SHOP } from '../constants/shop'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import { calculateCartTotals } from '../utils/cartTotals'
import { formatPrice } from '../utils/formatters'
import { applyServerFieldErrors } from '../utils/serverErrors'
import './CheckoutPage.css'

// API field names → checkout form fields. The shop service (server/shop/laravel.js)
// already turns the API's snake_case into these camelCase paths.
const ADDRESS_FIELDS = ['firstName', 'lastName', 'line1', 'line2', 'city', 'state', 'postalCode', 'country']
const SERVER_FIELD_MAP = {
  email: 'email',
  phone: 'phone',
  shippingMethod: 'shippingMethod',
  paymentMethod: 'paymentMethod',
  ...Object.fromEntries(ADDRESS_FIELDS.map((field) => [`shippingAddress.${field}`, `shipping.${field}`])),
  ...Object.fromEntries(ADDRESS_FIELDS.map((field) => [`billingAddress.${field}`, `billing.${field}`])),
}

// Good enough to send to cart/validate; the order itself is validated properly.
const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)

const GUEST_CHECKOUT_OFF = "Please sign in to place your order: guest checkout isn't available right now."

const PRICES_CHANGED = 'Prices changed since you added these items. The order summary now shows the new total: please check it, then place your order again.'

// What the shopper is told about paying, per method (REAL_SHOP). No payment provider is connected yet.
const PAYMENT_NOTES = {
  cod: 'Your order is confirmed straight away. Pay the courier when it arrives.',
  online:
    "No payment provider is connected yet, so nothing is charged now: your order is saved as awaiting payment and we'll email you about paying. BuyNest never asks for card numbers.",
}

/**
 * /checkout. Signed-in customers get their details pre-filled from the
 * profile. With BuyNest's API (REAL_SHOP) guests can check out too: the
 * server prices the cart and stores the order. In the demo, checkout needs a
 * sign-in (AppRoutes) and no payment is taken.
 */
function CheckoutPage() {
  const cart = useCart()
  const { user, status, authorizedRequest } = useAuth()
  // Same cache entry as the profile page: visiting /account first makes this instant.
  const profileRequest = useQuery({ ...profileQuery(user?.id, authorizedRequest), enabled: Boolean(user) })
  // Re-check prices and stock on arrival, like the cart page: the cart holds
  // snapshots taken when each product was added. Items that sold out make
  // canCheckout false (the "needs your attention" screen below).
  const refresh = useProductRefresh({ hasItems: cart.items.length > 0, onProducts: cart.refreshProducts })
  // REAL_SHOP: the server's countries, delivery and payment options, and guest checkout rule.
  const store = useStoreSettings()
  const { settings } = store
  const location = useLocation()

  if (cart.items.length === 0) {
    return (
      <div className="section container">
        <EmptyState icon={LuShoppingBag} title="Your cart is empty" message="Add some products before checking out.">
          <Button to={ROUTES.products}>Start shopping</Button>
        </EmptyState>
      </div>
    )
  }

  if (!cart.totals.canCheckout) {
    return (
      <div className="section container">
        <EmptyState icon={LuTriangleAlert} title="Some items need your attention" message="Remove unavailable items from your cart to continue.">
          <Button to={ROUTES.cart}>Review cart</Button>
        </EmptyState>
      </div>
    )
  }

  // Guests can check out (REAL_SHOP), but a session being checked may still turn out to be a customer.
  if (status === 'checking' || (user && profileRequest.isPending) || store.isPending) {
    return (
      <div className="section container">
        <Loader label="Preparing checkout…" />
      </div>
    )
  }

  // The store can turn guest checkout off (the server refuses guest orders then): ask for a sign-in up front.
  if (REAL_SHOP && !user && !settings.guestCheckout) {
    return (
      <div className="section container">
        <title>{`Checkout | ${SITE.name}`}</title>
        <EmptyState
          icon={LuUserRound}
          title="Sign in to check out"
          message="Guest checkout isn't available right now. Sign in or create an account to place your order; your cart will be waiting."
        >
          <Button to={ROUTES.login} state={{ from: location }}>
            Sign in
          </Button>
          <Button to={ROUTES.register} state={{ from: location }} variant="outline">
            Create an account
          </Button>
        </EmptyState>
      </div>
    )
  }

  // Nothing the shopper could choose (a misconfigured store): say so instead of a form that can't be sent.
  if (settings.shippingMethods.length === 0 || settings.paymentMethods.length === 0 || settings.countries.length === 0) {
    return (
      <div className="section container">
        <EmptyState icon={LuTriangleAlert} title="Checkout is unavailable right now" message={`Please try again later, or contact us at ${settings.supportEmail ?? SITE.supportEmail}.`}>
          <Button to={ROUTES.cart}>Back to cart</Button>
        </EmptyState>
      </div>
    )
  }

  // If the profile can't be loaded, fall back to what we know from sign-in.
  const profile = profileRequest.data ?? user
  const address = profile?.address
  const { countries, paymentMethods } = settings
  const emptyAddress = { ...EMPTY_ADDRESS, country: countries.includes(EMPTY_ADDRESS.country) ? EMPTY_ADDRESS.country : countries[0] }
  const shippingDefaults = {
    ...emptyAddress,
    firstName: profile?.firstName ?? '',
    lastName: profile?.lastName ?? '',
    ...(address && {
      line1: address.line1,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: countries.includes(address.country) ? address.country : emptyAddress.country,
    }),
  }

  return (
    <CheckoutForm
      isCheckingPrices={refresh.isFetching}
      refreshProducts={refresh.refetch}
      settings={settings}
      defaultValues={{
        email: profile?.email ?? '',
        phone: profile?.phone ?? '',
        shipping: shippingDefaults,
        billingSameAsShipping: true,
        billing: emptyAddress,
        shippingMethod: defaultShippingMethodId(settings),
        // Cash on delivery is the one real order that needs no payment provider (when the store offers it).
        paymentMethod: REAL_SHOP ? (paymentMethods.find((method) => method.id === 'cod') ?? paymentMethods[0]).id : 'card',
      }}
    />
  )
}

function CheckoutForm({ defaultValues, isCheckingPrices, refreshProducts, settings }) {
  const cart = useCart()
  const { user, isAuthenticated, authorizedRequest } = useAuth()
  const { placeOrder } = useOrders()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  // REAL_SHOP: only what the store offers is accepted (the demo keeps its fixed rules).
  const [schema] = useState(() =>
    REAL_SHOP
      ? createCheckoutSchema({
          countries: settings.countries,
          shippingMethodIds: settings.shippingMethods.map((method) => method.id),
          paymentMethodIds: settings.paymentMethods.map((method) => method.id),
        })
      : checkoutSchema,
  )

  // A MUTATION: a request that changes something on the server (here: the
  // server prices the cart). Unlike queries, mutations run only when called.
  const verifyMutation = useMutation({
    mutationFn: ({ items, userId }) => verifyCartWithServer(items, userId),
  })
  // REAL_SHOP: the server creates the order. A signed-in customer's request
  // renews the session once if it expired, so the order lands in their account.
  const orderMutation = useMutation({
    mutationFn: (input) => (isAuthenticated ? authorizedRequest(() => placeServerOrder(input)) : placeServerOrder(input)),
  })

  // React Hook Form keeps values in the inputs themselves (uncontrolled), so
  // typing doesn't re-render the whole page. zodResolver plugs in the schema.
  const {
    register,
    handleSubmit,
    control,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues,
    // Errors appear after the first submit, then update live as you type.
    // (Validating on blur made error messages push the layout down while the
    // pointer was mid-click, so clicks on fields below were lost.)
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  })

  // useWatch subscribes to just these fields, for the live summary and cards.
  const [shippingMethod, billingSameAsShipping, paymentMethod, email, shippingCountry] = useWatch({
    control,
    name: ['shippingMethod', 'billingSameAsShipping', 'paymentMethod', 'email', 'shipping.country'],
  })

  // A guest's email goes with the pricing request, so "one use per customer"
  // codes are checked before the order (signed-in customers: the session).
  // Debounced: one request after typing stops, not one per keystroke.
  const guestEmail = useDebouncedValue(REAL_SHOP && !isAuthenticated ? (email ?? '').trim().toLowerCase() : '', 600)

  // REAL_SHOP: the server's prices are the ones shown and charged. The local
  // calculation (same rules, but no coupon: the server decides about those)
  // fills in until the first answer arrives.
  // With tax on, the shipping country goes along too: the server's tax depends on it.
  const pricingInput = {
    items: cart.items,
    couponCode: cart.couponCode,
    shippingMethod,
    email: looksLikeEmail(guestEmail) ? guestEmail : undefined,
    country: REAL_SHOP && settings.taxEnabled ? shippingCountry : undefined,
  }
  const pricing = useQuery({ ...cartPricingQuery(pricingInput), enabled: REAL_SHOP })
  const serverCart = REAL_SHOP ? pricing.data : null

  const localCoupon = REAL_SHOP ? null : cart.couponCode
  const localTotals = calculateCartTotals(cart.items, localCoupon, shippingMethod, settings)
  const totals = serverCart ? serverCart.totals : localTotals
  const coupon = serverCart ? serverCart.coupon : localTotals.coupon
  const couponError = serverCart ? serverCart.couponError : localTotals.couponError
  const problems = serverCart?.problems ?? []
  const shippingLabel = settings.shippingMethods.find((method) => method.id === shippingMethod)?.label ?? localTotals.shippingMethod.label
  const changedCount = cart.items.filter((item) => item.notice).length
  const shippingOptions = settings.shippingMethods.map((method) => {
    const serverPrice = serverCart?.shippingOptions.find((option) => option.id === method.id)?.price
    const price = serverPrice ?? calculateCartTotals(cart.items, localCoupon, method.id, settings).shipping
    return { ...method, description: method.eta, aside: price === 0 ? 'Free' : formatPrice(price) }
  })
  const isPricing = REAL_SHOP && (pricing.isPending || pricing.isFetching)
  const isBusy = isSubmitting || isCheckingPrices || isPricing
  const cannotPlace = REAL_SHOP && (!serverCart || problems.length > 0)

  async function placeDemoOrder(values) {
    // 1. The server prices the cart; stop if anything changed since it was added.
    const verification = await verifyMutation.mutateAsync({ items: cart.items, userId: user.id })
    if (verification.problems.length > 0) {
      setError('root.server', {
        message: `${verification.problems.join(' ')} Please review your cart before placing the order.`,
      })
      return
    }

    // 2. Record the (simulated) order, then empty the cart.
    const order = createOrder({ userId: user.id, values, items: cart.items, totals: localTotals, couponCode: cart.couponCode, verification })
    placeOrder(order)
    // Stock changed on the server: mark every cached product query stale so
    // pages refetch fresh data the next time they're shown (INVALIDATION).
    queryClient.invalidateQueries({ queryKey: productKeys.all })
    navigate(ROUTES.orderConfirmation(order.id), { replace: true })
    cart.removeOrderedItems(order.items.map((item) => item.productId))
  }

  async function placeRealOrder(values) {
    // Only ids, quantities, and choices are sent; `expectedTotal` is the total
    // the shopper saw, so the server refuses (409) if its own total differs.
    const order = await orderMutation.mutateAsync({ items: cart.items, couponCode: cart.couponCode, values, expectedTotal: totals.total })
    queryClient.invalidateQueries({ queryKey: productKeys.all }) // stock changed
    queryClient.invalidateQueries({ queryKey: orderKeys.all })
    // The confirmation page shows the order the server returned (guests can't fetch it again by number alone).
    navigate(ROUTES.orderConfirmation(order.number), { replace: true, state: { order } })
    cart.removeOrderedItems(cart.items.filter((item) => !item.isUnavailable).map((item) => item.productId))
  }

  async function onSubmit(values) {
    clearErrors('root.server')
    try {
      if (REAL_SHOP) await placeRealOrder(values)
      else await placeDemoOrder(values)
    } catch (error) {
      if (error.status === 409) {
        // Show the server's new prices, and refresh the cart's product snapshots too.
        if (error.data?.cart) queryClient.setQueryData(cartPricingKey(pricingInput), error.data.cart)
        else pricing.refetch()
        refreshProducts()
        setError('root.server', { message: PRICES_CHANGED })
        return
      }
      // Invalid fields (422) come back with per-field messages: show them on the fields.
      // Guest checkout was turned off after the page loaded.
      if (error.status === 403 && !isAuthenticated) {
        setError('root.server', { message: error.data?.code === 'guest_checkout_disabled' ? GUEST_CHECKOUT_OFF : error.message })
        return
      }
      if (applyServerFieldErrors(error, setError, SERVER_FIELD_MAP)) return
      // Stock problems (422 on the items) explain themselves; so does a coupon
      // the server refused (couponCode), which has no field in this form.
      const stockProblems = error.data?.problems?.map((problem) => problem.message).join(' ')
      const otherField = Object.values(error.fieldErrors ?? {})[0]?.[0]
      if (stockProblems) setError('root.server', { message: `${stockProblems} Please review your cart.` })
      else setError('root.server', { message: otherField ?? error.message })
    }
  }

  const placeLabel = isBusy ? 'Checking prices…' : `Place order · ${formatPrice(totals.total)}`
  const paymentNote = REAL_SHOP ? (paymentMethod === 'cod' ? PAYMENT_NOTES.cod : PAYMENT_NOTES.online) : null

  return (
    <div className="checkout section container">
      <title>{`Checkout | ${SITE.name}`}</title>
      <header className="checkout__header">
        <h1>Checkout</h1>
        <p className="checkout__secure">
          <LuLock aria-hidden="true" />{' '}
          {REAL_SHOP ? 'Secure checkout — our server confirms every price before your order is placed.' : 'Demo checkout — no payment is taken and nothing ships.'}
        </p>
        {REAL_SHOP && !isAuthenticated && settings.guestCheckout && (
          <p className="checkout__note">
            Have an account?{' '}
            <Link to={ROUTES.login} state={{ from: location }}>
              Sign in
            </Link>{' '}
            to keep this order in your order history. Or continue as a guest.
          </p>
        )}
      </header>

      {/* The summary (with its own coupon <form>) sits OUTSIDE the checkout form:
          forms can't be nested in HTML. The "Place order" button joins the
          checkout form through its `form` attribute. */}
      <div className="checkout__layout">
        <form id="checkout-form" className="checkout__form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <section className="checkout__section" aria-labelledby="contact-title">
            <h2 id="contact-title">Contact details</h2>
            <div className="checkout__grid">
              <FormField
                label="Email"
                type="email"
                autoComplete="email"
                hint={REAL_SHOP ? "We'll send your order confirmation here." : undefined}
                {...register('email')}
                error={errors.email?.message}
              />
              <FormField label="Phone" type="tel" autoComplete="tel" hint="For delivery updates only." {...register('phone')} error={errors.phone?.message} />
            </div>
          </section>

          <section className="checkout__section" aria-labelledby="shipping-title">
            <h2 id="shipping-title">Shipping address</h2>
            <AddressFields prefix="shipping" register={register} errors={errors.shipping} autoCompleteSection="shipping" countries={settings.countries} />
          </section>

          <section className="checkout__section" aria-labelledby="billing-title">
            <h2 id="billing-title">Billing address</h2>
            <CheckboxField label="Same as shipping address" {...register('billingSameAsShipping')} />
            {!billingSameAsShipping && (
              <AddressFields prefix="billing" register={register} errors={errors.billing} autoCompleteSection="billing" countries={settings.countries} />
            )}
          </section>

          <section className="checkout__section">
            <ChoiceCards
              legend="Delivery"
              options={shippingOptions}
              registration={register('shippingMethod')}
              selectedId={shippingMethod}
              error={errors.shippingMethod?.message}
            />
          </section>

          <section className="checkout__section">
            <ChoiceCards
              legend="Payment"
              options={settings.paymentMethods}
              registration={register('paymentMethod')}
              selectedId={paymentMethod}
              error={errors.paymentMethod?.message}
            />
            {REAL_SHOP ? (
              <p className="checkout__note" aria-live="polite">
                {paymentNote}
              </p>
            ) : (
              <p className="checkout__note">
                BuyNest never asks for card numbers. A real payment would happen on the provider's secure page, and the
                order would only be confirmed after our server verifies the payment.
              </p>
            )}
          </section>
        </form>

        <aside className="checkout__summary cart-summary" aria-labelledby="checkout-summary-title">
          <h2 id="checkout-summary-title" className="cart-summary__title">
            Order summary
          </h2>
          <OrderItems items={serverCart ? serverCart.lines.filter((line) => line.available) : cart.items} />
          <OrderTotals totals={totals} couponCode={cart.couponCode} shippingLabel={shippingLabel} showTax={!REAL_SHOP || settings.taxEnabled} />
          <CouponForm
            appliedCode={cart.couponCode}
            coupon={coupon}
            couponError={couponError}
            onApply={cart.applyCoupon}
            onRemove={cart.removeCoupon}
            disabled={isSubmitting}
            checking={isPricing}
          />

          {changedCount > 0 && (
            <p className="checkout__notice" role="status">
              {changedCount === 1 ? 'An item has' : `${changedCount} items have`} changed since you added{' '}
              {changedCount === 1 ? 'it' : 'them'} (price or available quantity). The total above is up to date.
            </p>
          )}

          {problems.length > 0 && (
            <div className="checkout__error" role="alert">
              <p>{problems.map((problem) => problem.message).join(' ')}</p>
              <Button to={ROUTES.cart} variant="outline" size="sm">
                Review cart
              </Button>
            </div>
          )}

          {REAL_SHOP && pricing.error && !serverCart && (
            <div className="checkout__error" role="alert">
              <p>We couldn't check the prices: {pricing.error.message}</p>
              <Button variant="outline" size="sm" onClick={() => pricing.refetch()}>
                Try again
              </Button>
            </div>
          )}

          {errors.root?.server && (
            <div className="checkout__error" role="alert">
              <p>{errors.root.server.message}</p>
              <Button to={ROUTES.cart} variant="outline" size="sm">
                Review cart
              </Button>
            </div>
          )}

          <Button type="submit" form="checkout-form" size="lg" fullWidth disabled={isBusy || cannotPlace}>
            {placeLabel}
          </Button>
          <p className="cart-summary__note">
            {REAL_SHOP
              ? 'Prices, stock, discounts, and shipping are checked again by our server when you place the order.'
              : 'Prices are re-checked with the server before the order is recorded. Shipping, discounts, and taxes would be confirmed by the BuyNest backend.'}
          </p>
        </aside>
      </div>
    </div>
  )
}

export default CheckoutPage
