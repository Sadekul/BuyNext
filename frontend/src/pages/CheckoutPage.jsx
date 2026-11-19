import { useEffect, useRef, useState } from 'react'
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
import { addressesQuery, customerKeys } from '../queries/customerQueries'
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
import { formatBasePrice } from '../utils/formatters'
import { applyServerFieldErrors } from '../utils/serverErrors'
import { cartLineKey } from '../reducers/cartReducer'
import { MAX_SAVED_ADDRESSES, defaultAddress, isSameAddress, toOrderAddress } from '../utils/addresses'
import { rememberGuestPayment } from '../utils/payment'
import SavedAddressPicker from '../components/checkout/SavedAddressPicker'
import GroupDiscountNote from '../components/cart/GroupDiscountNote'
import GiftCardRedeem from '../components/checkout/GiftCardRedeem'
import RewardPointsRedeem from '../components/checkout/RewardPointsRedeem'
import ChargedInBaseNote from '../components/cart/ChargedInBaseNote'
import { trackBeginCheckout } from '../utils/analytics'
import './CheckoutPage.css'

// API field names → checkout form fields. The shop service (server/shop/laravel.js)
// already turns the API's snake_case into these camelCase paths.
const ADDRESS_FIELDS = ['firstName', 'lastName', 'line1', 'line2', 'city', 'state', 'postalCode', 'country']
// Phase 10: gift cards only: the one address on the form is the billing address (sent as both).
const GIFT_CARD_ONLY_FIELD_MAP = {
  shippingAddress: 'billing.line1',
  ...Object.fromEntries(ADDRESS_FIELDS.map((field) => [`shippingAddress.${field}`, `billing.${field}`])),
}
const SERVER_FIELD_MAP = {
  email: 'email',
  phone: 'phone',
  shippingMethod: 'shippingMethod',
  paymentMethod: 'paymentMethod',
  shippingAddress: 'shipping.line1',
  billingAddress: 'billing.line1',
  // Phase 12: SSLCommerz needs a phone; the API may name the address's phone.
  'shippingAddress.phone': 'phone',
  'billingAddress.phone': 'phone',
  ...Object.fromEntries(ADDRESS_FIELDS.map((field) => [`shippingAddress.${field}`, `shipping.${field}`])),
  ...Object.fromEntries(ADDRESS_FIELDS.map((field) => [`billingAddress.${field}`, `billing.${field}`])),
}

// Good enough to send to cart/validate; the order itself is validated properly.
const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)

const GUEST_CHECKOUT_OFF = "Please sign in to place your order: guest checkout isn't available right now."

// Phase 11: the payment method sent when reward points alone pay the whole order (a gift card's path otherwise).
const FULLY_COVERED_BY_POINTS = 'reward_points'

const PRICES_CHANGED = 'Prices changed since you added these items. The order summary now shows the new total: please check it, then place your order again.'

// What the shopper is told about paying, per method (REAL_SHOP). `stripe`: card
// payments through Stripe Checkout (phase 8); `online`: no provider for this method.
const PAYMENT_NOTES = {
  cod: 'Your order is confirmed straight away. Pay the courier when it arrives.',
  stripe:
    "Next you'll pay on Stripe's secure payment page (it also offers Apple Pay and Google Pay where available). BuyNest never sees your card number. Your order is saved first, so you can pay later from your order page if you leave.",
  // Phase 10: PayPal orders are approved on PayPal's site (a redirect, no PayPal script on this page).
  paypal:
    "Next you'll approve the payment on PayPal's site, then come back here. Your order is saved first, so you can pay later from your order page if you leave.",
  // Phase 12: bKash, Nagad, Rocket, cards, and internet banking on SSLCommerz's hosted page (a redirect, no script here).
  sslcommerz:
    "You'll finish paying on SSLCommerz's secure page (bKash, Nagad, Rocket, cards, or internet banking), then come back here. Your order is saved first, so you can pay later from your order page if you leave.",
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
  // REAL_SHOP: the address book fills in the defaults and offers the saved addresses.
  const addressRequest = useQuery({ ...addressesQuery(user?.id, authorizedRequest), enabled: REAL_SHOP && Boolean(user) })
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
  if (status === 'checking' || (user && profileRequest.isPending) || (REAL_SHOP && user && addressRequest.isPending) || store.isPending) {
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

  // Phase 10: a cart of gift cards only is emailed: no delivery address or method.
  const requiresShipping = cart.totals.requiresShipping !== false

  // Nothing the shopper could choose (a misconfigured store): say so instead of a form that can't be sent.
  if ((requiresShipping && settings.shippingMethods.length === 0) || settings.paymentMethods.length === 0 || settings.countries.length === 0) {
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
  // Saved addresses whose country the store no longer ships to can't be used.
  const savedAddresses = REAL_SHOP && user ? (addressRequest.data ?? []).filter((saved) => countries.includes(saved.country)) : []
  const savedShipping = defaultAddress(savedAddresses, 'shipping')
  const savedBilling = defaultAddress(savedAddresses, 'billing')
  const shippingDefaults = savedShipping
    ? toOrderAddress(savedShipping)
    : {
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
  // A default billing address that differs from the shipping one is filled in separately.
  const separateBilling = savedBilling && !isSameAddress(savedBilling, shippingDefaults) ? toOrderAddress(savedBilling) : null

  return (
    // A new form when the cart starts or stops needing delivery (e.g. changed in another tab): other fields apply.
    <CheckoutForm
      key={requiresShipping ? 'delivery' : 'email-only'}
      requiresShipping={requiresShipping}
      isCheckingPrices={refresh.isFetching}
      refreshProducts={refresh.refetch}
      settings={settings}
      savedAddresses={savedAddresses}
      addressBookFull={(addressRequest.data?.length ?? 0) >= MAX_SAVED_ADDRESSES}
      group={profile?.group ?? null}
      defaultValues={{
        email: profile?.email ?? '',
        phone: profile?.phone || savedShipping?.phone || '',
        shipping: shippingDefaults,
        billingSameAsShipping: !separateBilling,
        // Gift cards only: the billing address is the one asked for, so it starts from what we know.
        billing: separateBilling ?? (requiresShipping ? emptyAddress : shippingDefaults),
        saveAddress: false,
        shippingMethod: defaultShippingMethodId(settings),
        // Cash on delivery is the one real order that needs no payment provider (when the store offers it).
        paymentMethod: REAL_SHOP ? (paymentMethods.find((method) => method.id === 'cod') ?? paymentMethods[0]).id : 'card',
      }}
    />
  )
}

/** Server lines name their variant; the cart's own label fills in if the answer has none. */
function withVariantLabels(lines, items) {
  return lines.map((line) => {
    if (!line.variantId || line.variantLabel) return line
    const item = items.find((candidate) => cartLineKey(candidate) === cartLineKey(line))
    return { ...line, variantLabel: item?.variantLabel ?? null }
  })
}

function CheckoutForm({ defaultValues, isCheckingPrices, refreshProducts, settings, savedAddresses = [], addressBookFull = false, group = null, requiresShipping = true }) {
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
          // "gift_card": set on submit when a gift card pays everything (phase 10).
          paymentMethodIds: [...settings.paymentMethods.map((method) => method.id), 'gift_card'],
          requiresShipping,
        })
      : checkoutSchema,
  )
  // Phase 10: the gift card applied at checkout (one per order). The server decides what it pays.
  const [giftCardCode, setGiftCardCode] = useState(null)
  // Phase 11: reward points to spend (signed in, when the store has points on). The server decides what they pay.
  const [rewardPoints, setRewardPoints] = useState(0)

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
    setValue,
    trigger,
    formState: { errors, isSubmitting, isSubmitted },
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
  const [shippingMethod, billingSameAsShipping, paymentMethod, email, shippingCountry, shippingAddress, billingAddress] = useWatch({
    control,
    name: ['shippingMethod', 'billingSameAsShipping', 'paymentMethod', 'email', 'shipping.country', 'shipping', 'billing'],
  })

  // Phase 12: the phone's message depends on the payment method (SSLCommerz says why it needs one):
  // after a first submit, check it again when the method changes.
  useEffect(() => {
    if (isSubmitted) trigger('phone')
  }, [paymentMethod, isSubmitted, trigger])

  // Signed-in customers (REAL_SHOP): which saved address the fields match (if any), and the address-book option.
  const canUseAddressBook = REAL_SHOP && isAuthenticated
  const shippingIsSaved = savedAddresses.some((saved) => isSameAddress(saved, shippingAddress))
  const offerToSave = canUseAddressBook && !addressBookFull && !shippingIsSaved
  /** Copies a saved address into the shipping or billing fields. */
  function fillFromSaved(prefix, saved) {
    const options = { shouldDirty: true, shouldValidate: isSubmitted }
    for (const [field, value] of Object.entries(toOrderAddress(saved))) setValue(`${prefix}.${field}`, value, options)
  }

  // A guest's email goes with the pricing request, so "one use per customer"
  // codes are checked before the order (signed-in customers: the session).
  // Debounced: one request after typing stops, not one per keystroke.
  const guestEmail = useDebouncedValue(REAL_SHOP && !isAuthenticated ? (email ?? '').trim().toLowerCase() : '', 600)

  // REAL_SHOP: the server's prices are the ones shown and charged. The local
  // calculation (same rules, but no coupon: the server decides about those)
  // fills in until the first answer arrives.
  // The shipping country goes along too: the tax and (phase 10) the delivery prices depend on it.
  // A cart of gift cards only has neither: no method, no country.
  const pricingInput = {
    items: cart.items,
    couponCode: cart.couponCode,
    shippingMethod: requiresShipping ? shippingMethod : null,
    email: looksLikeEmail(guestEmail) ? guestEmail : undefined,
    country: REAL_SHOP && requiresShipping ? shippingCountry : undefined,
    giftCardCode: REAL_SHOP ? (giftCardCode ?? undefined) : undefined,
    rewardPoints: REAL_SHOP && isAuthenticated && rewardPoints > 0 ? rewardPoints : undefined,
  }
  const pricing = useQuery({ ...cartPricingQuery(pricingInput), enabled: REAL_SHOP })
  const serverCart = REAL_SHOP ? pricing.data : null

  const localCoupon = REAL_SHOP ? null : cart.couponCode
  const localTotals = calculateCartTotals(cart.items, localCoupon, shippingMethod, settings)
  const totals = serverCart ? serverCart.totals : localTotals
  const coupon = serverCart ? serverCart.coupon : localTotals.coupon
  const couponError = serverCart ? serverCart.couponError : localTotals.couponError
  const problems = serverCart?.problems ?? []
  const changedCount = cart.items.filter((item) => item.notice).length
  // Phase 10: exactly the delivery methods the server offers for this cart (table rates by country,
  // weight, and subtotal), with its prices. Methods it doesn't offer aren't shown. Until its first
  // answer, the store's methods with the local estimate fill in.
  const offered = serverCart ? serverCart.shippingOptions : null
  const shippingOptions = (offered ?? settings.shippingMethods.map((method) => ({ ...method, price: calculateCartTotals(cart.items, localCoupon, method.id, settings).shipping }))).map((option) => {
    const known = settings.shippingMethods.find((method) => method.id === option.id)
    const price = option.price ?? 0
    return { id: option.id, label: option.label ?? known?.label ?? option.id, description: option.eta ?? known?.eta, aside: price === 0 ? 'Free' : formatBasePrice(price) }
  })
  const shippingLabel = shippingOptions.find((option) => option.id === shippingMethod)?.label ?? localTotals.shippingMethod.label
  // The chosen method isn't offered for this cart (any more): switch to the first that is.
  const firstOffered = offered?.[0]?.id
  const chosenIsOffered = !requiresShipping || !offered || offered.some((option) => option.id === shippingMethod)
  useEffect(() => {
    if (requiresShipping && !chosenIsOffered && firstOffered) setValue('shippingMethod', firstOffered, { shouldValidate: isSubmitted })
  }, [requiresShipping, chosenIsOffered, firstOffered, setValue, isSubmitted])
  const noDelivery = REAL_SHOP && requiresShipping && offered !== null && offered.length === 0
  const isPricing = REAL_SHOP && (pricing.isPending || pricing.isFetching)
  const isBusy = isSubmitting || isCheckingPrices || isPricing
  // Phase 10: what the gift card pays, and whether it pays everything (no other payment needed).
  const giftCardError = giftCardCode ? (serverCart?.giftCardError ?? null) : null
  const giftCardPays = giftCardCode && !giftCardError ? (serverCart?.totals.giftCard ?? 0) : 0
  // Phase 11: what reward points pay (after tax, before the gift card), and why they can't be used.
  const rewardPointsError = rewardPoints > 0 ? (serverCart?.rewardPointsError ?? null) : null
  const pointsPay = rewardPoints > 0 && !rewardPointsError ? (serverCart?.totals.rewardPoints ?? 0) : 0
  const pointsSpent = pointsPay > 0 ? (serverCart?.rewardPoints?.points ?? rewardPoints) : 0
  const prepaid = giftCardPays + pointsPay
  const amountDue = serverCart?.totals.amountDue ?? Math.max(0, Math.round((totals.total - prepaid) * 100) / 100)
  const fullyCovered = REAL_SHOP && prepaid > 0 && amountDue === 0
  const cannotPlace = REAL_SHOP && (!serverCart || problems.length > 0 || noDelivery || !chosenIsOffered || Boolean(giftCardError) || Boolean(rewardPointsError))
  // Phase 8: a card order is paid on Stripe's page right after it is created.
  const payByStripe = REAL_SHOP && !fullyCovered && settings.cardPayments === 'stripe' && paymentMethod === 'card'
  // Phase 10: a PayPal order is approved on PayPal's site right after it is created.
  const payByPaypal = REAL_SHOP && !fullyCovered && settings.paypalPayments === 'paypal' && paymentMethod === 'paypal'
  // Phase 12: an SSLCommerz order is paid on SSLCommerz's page right after it is created.
  const payBySslcommerz = REAL_SHOP && !fullyCovered && settings.sslcommerzPayments === 'sslcommerz' && paymentMethod === 'sslcommerz'

  // Phase 10 statistics: the shopper started checking out (once; only with their consent, no personal data).
  const beganCheckout = useRef(false)
  useEffect(() => {
    if (beganCheckout.current) return
    beganCheckout.current = true
    trackBeginCheckout(cart.items, totals.total)
  }, [cart.items, totals.total])

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
    cart.removeOrderedItems(order.items.map(cartLineKey))
  }

  async function placeRealOrder(values) {
    // Only ids, quantities, and choices are sent; `expectedTotal` is the total
    // the shopper saw, so the server refuses (409) if its own total differs.
    // "Save this address" only when it is offered (an address already in the book isn't saved twice).
    const saveAddress = requiresShipping && offerToSave && values.saveAddress === true
    // Phase 10: a gift card that pays everything is the payment method; otherwise the chosen one pays the rest.
    // Phase 11: points (and/or a gift card) that pay everything take the same path ("gift_card" without a card: "reward_points").
    const coveredBy = giftCardPays > 0 ? 'gift_card' : FULLY_COVERED_BY_POINTS
    const paymentChoice = fullyCovered ? coveredBy : ['gift_card', FULLY_COVERED_BY_POINTS].includes(values.paymentMethod) ? defaultValues.paymentMethod : values.paymentMethod
    const order = await orderMutation.mutateAsync({
      items: cart.items,
      couponCode: cart.couponCode,
      values: { ...values, paymentMethod: paymentChoice, saveAddress },
      expectedTotal: totals.total,
      giftCardCode: giftCardCode && !giftCardError ? giftCardCode : undefined,
      rewardPoints: pointsSpent > 0 ? pointsSpent : undefined,
      requiresShipping,
    })
    queryClient.invalidateQueries({ queryKey: productKeys.all }) // stock changed
    queryClient.invalidateQueries({ queryKey: orderKeys.all })
    if (saveAddress) queryClient.invalidateQueries({ queryKey: customerKeys.addresses(user.id) })
    // Phase 8, card through Stripe: the order exists now (stock reserved), so
    // the cart is emptied exactly as for any other order. The confirmation page
    // then leaves for Stripe's page (`payNow`), or shows why it couldn't with
    // "Pay now" to retry. A guest's number and email are kept in this tab for
    // the way back from Stripe.
    // Phase 10: PayPal works the same way (its approval page instead of Stripe's); phase 12: SSLCommerz too
    // (its GatewayPageURL; it sends the shopper back with a form POST to the sign-in service, then a 303 here).
    const payNow = ['stripe', 'paypal', 'sslcommerz'].includes(order.payment?.provider) && order.paymentStatus !== 'paid' ? true : undefined
    if (payNow && !isAuthenticated) rememberGuestPayment(order.number, order.email)
    // The confirmation page shows the order the server returned (guests can't fetch it again by number alone).
    navigate(ROUTES.orderConfirmation(order.number), { replace: true, state: { order, ...(payNow && { payNow }) } })
    cart.removeOrderedItems(cart.items.filter((item) => !item.isUnavailable).map(cartLineKey))
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
      if (applyServerFieldErrors(error, setError, requiresShipping ? SERVER_FIELD_MAP : { ...SERVER_FIELD_MAP, ...GIFT_CARD_ONLY_FIELD_MAP })) return
      // The code stopped applying (phase 7 messages say why: "Spend $20.00 more
      // to use this code", "This code applies to Shoes only"): re-price, so the
      // summary and the code box show the server's answer too.
      // Phase 10: the gift card stopped working (spent elsewhere, disabled, expired): re-price and say why.
      // Phase 11: the points can't be used any more (spent elsewhere, the total changed): re-price and say why.
      const pointsMessage = error.fieldErrors?.rewardPoints?.[0]
      if (pointsMessage) {
        pricing.refetch()
        setError('root.server', { message: `Reward points: ${pointsMessage}` })
        return
      }
      const giftCardMessage = error.fieldErrors?.giftCardCode?.[0]
      if (giftCardMessage) {
        pricing.refetch()
        setError('root.server', { message: `Gift card: ${giftCardMessage} Remove it or try another card.` })
        return
      }
      const couponMessage = error.fieldErrors?.couponCode?.[0]
      if (couponMessage) {
        pricing.refetch()
        setError('root.server', { message: `${cart.couponCode ? `${cart.couponCode}: ` : ''}${couponMessage} Remove the code or change your cart to continue.` })
        return
      }
      // Stock problems (422 on the items) explain themselves; so does a coupon
      // the server refused (couponCode), which has no field in this form.
      const stockProblems = error.data?.problems?.map((problem) => problem.message).join(' ')
      const otherField = Object.values(error.fieldErrors ?? {})[0]?.[0]
      if (stockProblems) setError('root.server', { message: `${stockProblems} Please review your cart.` })
      else setError('root.server', { message: otherField ?? error.message })
    }
  }

  const placeLabel = isBusy
    ? 'Checking prices…'
    : payByStripe
      ? 'Continue to secure payment'
      : payByPaypal
        ? 'Continue to PayPal'
        : payBySslcommerz
          ? 'Continue to SSLCommerz'
          : `Place order · ${formatBasePrice(prepaid > 0 ? amountDue : totals.total)}`
  let paymentNote = null
  if (REAL_SHOP) {
    paymentNote =
      paymentMethod === 'cod'
        ? PAYMENT_NOTES.cod
        : payByStripe
          ? PAYMENT_NOTES.stripe
          : payByPaypal
            ? PAYMENT_NOTES.paypal
            : payBySslcommerz
              ? PAYMENT_NOTES.sslcommerz
              : PAYMENT_NOTES.online
    if (giftCardPays > 0) paymentNote = `Your gift card pays ${formatBasePrice(giftCardPays)}; the remaining ${formatBasePrice(amountDue)} is paid as chosen above. ${paymentNote}`
    else if (pointsPay > 0) paymentNote = `Your reward points pay ${formatBasePrice(pointsPay)}; the remaining ${formatBasePrice(amountDue)} is paid as chosen above. ${paymentNote}`
  }

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
              {/* Phase 12: SSLCommerz needs a phone number for the payment page: the hint says so when it's chosen. */}
              <FormField
                label="Phone"
                type="tel"
                autoComplete="tel"
                hint={paymentMethod === 'sslcommerz' && !fullyCovered ? 'Needed for paying through SSLCommerz, and for delivery updates.' : 'For delivery updates only.'}
                {...register('phone')}
                error={errors.phone?.message}
              />
            </div>
          </section>

          {requiresShipping ? (
          <section className="checkout__section" aria-labelledby="shipping-title">
            <h2 id="shipping-title">Shipping address</h2>
            {canUseAddressBook && savedAddresses.length > 0 && (
              <SavedAddressPicker label="Saved shipping addresses" addresses={savedAddresses} current={shippingAddress} onChoose={(saved) => fillFromSaved('shipping', saved)} />
            )}
            <AddressFields prefix="shipping" register={register} errors={errors.shipping} autoCompleteSection="shipping" countries={settings.countries} />
            {offerToSave && <CheckboxField label="Save this address to my address book" {...register('saveAddress')} />}
          </section>
          ) : (
            // Phase 10: gift cards only: nothing ships, so only the billing address is asked for.
            <section className="checkout__section" aria-labelledby="billing-title">
              <h2 id="billing-title">Billing address</h2>
              <p className="checkout__note">Gift cards are sent by email, so there's no delivery address or shipping charge.</p>
              {canUseAddressBook && savedAddresses.length > 0 && (
                <SavedAddressPicker label="Saved addresses" addresses={savedAddresses} current={billingAddress} onChoose={(saved) => fillFromSaved('billing', saved)} />
              )}
              <AddressFields prefix="billing" register={register} errors={errors.billing} autoCompleteSection="billing" countries={settings.countries} />
            </section>
          )}

          {requiresShipping && (
          <section className="checkout__section" aria-labelledby="billing-title">
            <h2 id="billing-title">Billing address</h2>
            <CheckboxField label="Same as shipping address" {...register('billingSameAsShipping')} />
            {!billingSameAsShipping && canUseAddressBook && savedAddresses.length > 0 && (
              <SavedAddressPicker label="Saved billing addresses" addresses={savedAddresses} current={billingAddress} onChoose={(saved) => fillFromSaved('billing', saved)} />
            )}
            {!billingSameAsShipping && (
              <AddressFields prefix="billing" register={register} errors={errors.billing} autoCompleteSection="billing" countries={settings.countries} />
            )}
          </section>

          )}

          {requiresShipping && (
            <section className="checkout__section">
              <ChoiceCards
                legend="Delivery"
                options={shippingOptions}
                registration={register('shippingMethod')}
                selectedId={shippingMethod}
                error={errors.shippingMethod?.message}
              />
              {noDelivery && (
                <p className="checkout__error" role="alert">
                  {serverCart?.shippingError ?? `We can't deliver this order to ${shippingCountry}.`} Choose another country, or contact us at{' '}
                  {settings.supportEmail ?? SITE.supportEmail}.
                </p>
              )}
            </section>
          )}

          <section className="checkout__section">
            {fullyCovered ? (
              <fieldset className="choice-cards">
                <legend className="choice-cards__legend">Payment</legend>
                <p className="checkout__note">
                  {giftCardPays > 0 ? 'Your gift card pays for the whole order: no other payment is needed.' : 'Your reward points pay for the whole order: no other payment is needed.'}
                </p>
              </fieldset>
            ) : (
              <ChoiceCards
                legend="Payment"
                options={settings.paymentMethods}
                registration={register('paymentMethod')}
                selectedId={paymentMethod}
                error={errors.paymentMethod?.message}
              />
            )}
            {fullyCovered ? null : REAL_SHOP ? (
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
          <OrderItems items={serverCart ? withVariantLabels(serverCart.lines.filter((line) => line.available), cart.items) : cart.items} />
          {REAL_SHOP && <GroupDiscountNote group={serverCart?.customerGroup ?? group} amount={serverCart?.totals.groupDiscount} format={formatBasePrice} />}
          <OrderTotals
            totals={prepaid > 0 ? { ...totals, giftCard: giftCardPays, rewardPoints: pointsPay, amountDue } : totals}
            rewardPointsSpent={pointsSpent}
            couponCode={cart.couponCode}
            appliedRules={serverCart?.appliedRules}
            shippingLabel={shippingLabel}
            showTax={!REAL_SHOP || settings.taxEnabled}
            requiresShipping={requiresShipping}
          />
          <CouponForm
            appliedCode={cart.couponCode}
            coupon={coupon}
            couponError={couponError}
            onApply={cart.applyCoupon}
            onRemove={cart.removeCoupon}
            disabled={isSubmitting}
            checking={isPricing}
          />
          {/* Phase 11: reward points (signed in, when the store has them on); paid before a gift card. */}
          {REAL_SHOP && isAuthenticated && (
            <RewardPointsRedeem
              rewards={serverCart?.rewards}
              appliedPoints={rewardPoints}
              applied={rewardPoints > 0 && !rewardPointsError ? serverCart?.rewardPoints : null}
              error={rewardPointsError}
              onApply={setRewardPoints}
              onRemove={() => setRewardPoints(0)}
              disabled={isSubmitting}
              checking={isPricing}
            />
          )}
          {REAL_SHOP && (
            <GiftCardRedeem
              appliedCode={giftCardCode}
              applied={giftCardCode && !giftCardError ? serverCart?.giftCard : null}
              error={giftCardError}
              onApply={setGiftCardCode}
              onRemove={() => setGiftCardCode(null)}
              disabled={isSubmitting}
              checking={isPricing}
            />
          )}

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
          {/* Phase 11: prices shown in another currency elsewhere; the order is charged in the store currency. */}
          <ChargedInBaseNote amount={prepaid > 0 ? amountDue : totals.total} />
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
