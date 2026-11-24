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
import { localizedPaymentMethod, rememberGuestPayment, shippingMethodText } from '../utils/payment'
import SavedAddressPicker from '../components/checkout/SavedAddressPicker'
import GroupDiscountNote from '../components/cart/GroupDiscountNote'
import GiftCardRedeem from '../components/checkout/GiftCardRedeem'
import RewardPointsRedeem from '../components/checkout/RewardPointsRedeem'
import ChargedInBaseNote from '../components/cart/ChargedInBaseNote'
import { trackBeginCheckout } from '../utils/analytics'
import { codRefused, codUnavailableText, usesBangladeshForm, zoneDeliveryText, zoneName } from '../utils/bangladesh'
import './CheckoutPage.css'
import { Trans, useTranslation } from 'react-i18next'

// API field names → checkout form fields. The shop service (server/shop/laravel.js)
// already turns the API's snake_case into these camelCase paths.
// Phase 14: a Bangladesh address's division, district and area too.
const ADDRESS_FIELDS = ['firstName', 'lastName', 'line1', 'line2', 'city', 'state', 'postalCode', 'country', 'divisionId', 'districtId', 'areaId']
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

// Phase 13: shopper-facing texts are in locales/<lang>/checkout.json (`page.*`).

// Phase 11: the payment method sent when reward points alone pay the whole order (a gift card's path otherwise).
const FULLY_COVERED_BY_POINTS = 'reward_points'

// What the shopper is told about paying, per method (REAL_SHOP): checkout:page.notes.<cod|stripe|paypal|sslcommerz|online>.
// `stripe`: card payments through Stripe Checkout (phase 8); paypal (phase 10) and sslcommerz (phase 12) are
// redirects to the provider's page (no provider script on this page); `online`: no provider for this method.

/**
 * /checkout. Signed-in customers get their details pre-filled from the
 * profile. With BuyNest's API (REAL_SHOP) guests can check out too: the
 * server prices the cart and stores the order. In the demo, checkout needs a
 * sign-in (AppRoutes) and no payment is taken.
 */
function CheckoutPage() {
  const { t } = useTranslation('checkout')
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
        <EmptyState icon={LuShoppingBag} title={t('page.emptyTitle')} message={t('page.emptyMessage')}>
          <Button to={ROUTES.products}>{t('page.startShopping')}</Button>
        </EmptyState>
      </div>
    )
  }

  if (!cart.totals.canCheckout) {
    return (
      <div className="section container">
        <EmptyState icon={LuTriangleAlert} title={t('page.attentionTitle')} message={t('page.attentionMessage')}>
          <Button to={ROUTES.cart}>{t('page.reviewCart')}</Button>
        </EmptyState>
      </div>
    )
  }

  // Guests can check out (REAL_SHOP), but a session being checked may still turn out to be a customer.
  if (status === 'checking' || (user && profileRequest.isPending) || (REAL_SHOP && user && addressRequest.isPending) || store.isPending) {
    return (
      <div className="section container">
        <Loader label={t('page.preparing')} />
      </div>
    )
  }

  // The store can turn guest checkout off (the server refuses guest orders then): ask for a sign-in up front.
  if (REAL_SHOP && !user && !settings.guestCheckout) {
    return (
      <div className="section container">
        <title>{`${t('page.tabTitle')} | ${SITE.name}`}</title>
        <EmptyState icon={LuUserRound} title={t('page.signInTitle')} message={t('page.signInMessage')}>
          <Button to={ROUTES.login} state={{ from: location }}>
            {t('page.signIn')}
          </Button>
          <Button to={ROUTES.register} state={{ from: location }} variant="outline">
            {t('page.createAccount')}
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
        <EmptyState icon={LuTriangleAlert} title={t('page.unavailableTitle')} message={t('page.unavailableMessage', { email: settings.supportEmail ?? SITE.supportEmail })}>
          <Button to={ROUTES.cart}>{t('page.backToCart')}</Button>
        </EmptyState>
      </div>
    )
  }

  // If the profile can't be loaded, fall back to what we know from sign-in.
  const profile = profileRequest.data ?? user
  const address = profile?.address
  const { countries, paymentMethods } = settings
  // Phase 14: new addresses start in the store's default country (a Bangladeshi store: Bangladesh).
  const startCountry = settings.defaultCountry && countries.includes(settings.defaultCountry) ? settings.defaultCountry : countries.includes(EMPTY_ADDRESS.country) ? EMPTY_ADDRESS.country : countries[0]
  const emptyAddress = { ...EMPTY_ADDRESS, country: startCountry }
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
  const { t } = useTranslation('checkout')
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
          // Phase 14: Bangladesh addresses (Division → District → Area) and mobile numbers.
          bangladesh: settings.bangladeshAddresses === true,
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
  // Phase 14: a Bangladesh address (the store's API knows its places): its area prices delivery (zone rates).
  const bangladeshStore = REAL_SHOP && settings.bangladeshAddresses === true
  const bdShipping = requiresShipping && usesBangladeshForm(shippingCountry, settings)
  const bdContact = usesBangladeshForm(requiresShipping ? shippingCountry : billingAddress?.country, settings)
  const shippingAreaId = bdShipping && shippingAddress?.areaId ? String(shippingAddress.areaId) : null
  const place = shippingAreaId ? { divisionId: String(shippingAddress.divisionId ?? ''), districtId: String(shippingAddress.districtId ?? ''), areaId: shippingAreaId } : undefined

  // Phase 12: the phone's message depends on the payment method (SSLCommerz says why it needs one):
  // after a first submit, check it again when the method changes.
  useEffect(() => {
    if (isSubmitted) trigger('phone')
  }, [paymentMethod, isSubmitted, trigger])

  // Phase 14: what the address fields need for Bangladesh's cascading places.
  const addressForm = { control, setValue }

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
    // Phase 14: the Bangladesh area (its delivery zone), and the payment method when the store has cash on
    // delivery rules (its fee and limits change the total). Left out otherwise: the request stays as before.
    place: REAL_SHOP ? place : undefined,
    paymentMethod: REAL_SHOP && settings.cod && paymentMethod ? paymentMethod : undefined,
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
    const text = shippingMethodText({ id: option.id, label: option.label ?? known?.label, eta: option.eta ?? known?.eta })
    // Phase 14: a zone rate says its zone and delivery time ("Inside Dhaka · Delivery in 1–2 days").
    const zoneText = bdShipping || option.zone || Number.isInteger(option.etaDaysMin) || Number.isInteger(option.etaDaysMax) ? zoneDeliveryText(option, serverCart?.deliveryZone) : null
    return { id: option.id, label: text.label || option.id, description: zoneText ?? text.eta, aside: price === 0 ? t('page.free') : formatBasePrice(price) }
  })
  const shippingLabel = shippingOptions.find((option) => option.id === shippingMethod)?.label ?? shippingMethodText(localTotals.shippingMethod).label
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
  const cannotPlace = REAL_SHOP && (!serverCart || problems.length > 0 || noDelivery || !chosenIsOffered || Boolean(giftCardError) || Boolean(rewardPointsError) || (paymentMethod === 'cod' && codRefused(serverCart?.cod)))
  // Phase 14: cash on delivery for this cart: whether it can be chosen (zone, limit), its fee, and the advance.
  const cod = serverCart?.cod ?? null
  // Refused (zone, limit): shown but not choosable. Waiting for the area (zones set): said, still choosable.
  const codUnavailable = REAL_SHOP && codRefused(cod)
  const codReason = REAL_SHOP && cod?.available === false ? codUnavailableText(cod, { format: formatBasePrice, zone: serverCart?.deliveryZone }) : null
  const otherMethod = settings.paymentMethods.find((method) => method.id !== 'cod')?.id ?? null
  // Cash on delivery stopped being offered (the area or the total changed): switch to another method.
  useEffect(() => {
    if (codUnavailable && paymentMethod === 'cod' && otherMethod) setValue('paymentMethod', otherMethod, { shouldValidate: isSubmitted })
  }, [codUnavailable, paymentMethod, otherMethod, setValue, isSubmitted])
  const codFee = paymentMethod === 'cod' ? (totals.codFee ?? 0) : 0
  const advanceAmount = cod?.advanceAmount ?? Math.round(((totals.shipping ?? 0) + codFee) * 100) / 100
  const payAdvance = REAL_SHOP && !fullyCovered && paymentMethod === 'cod' && !codUnavailable && cod?.advance === 'delivery_charge' && advanceAmount > 0
  const dueOnDelivery = payAdvance ? (cod?.dueOnDelivery ?? Math.max(0, Math.round((amountDue - advanceAmount) * 100) / 100)) : null

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
        message: t('page.reviewBeforePlacing', { problems: verification.problems.join(' ') }),
      })
      return
    }

    // 2. Record the (simulated) order, then empty the cart.
    const order = createOrder({ userId: user.id, values, items: cart.items, totals: localTotals, couponCode: cart.couponCode, verification })
    placeOrder(order)
    // Stock changed on the server: mark every cached product query stale so
    // pages refetch fresh data the next time they're shown (INVALIDATION).
    queryClient.invalidateQueries({ queryKey: ['products'] }) // every language
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
    queryClient.invalidateQueries({ queryKey: ['products'] }) // stock changed, in every language
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
        setError('root.server', { message: t('page.pricesChanged') })
        return
      }
      // Invalid fields (422) come back with per-field messages: show them on the fields.
      // Guest checkout was turned off after the page loaded.
      if (error.status === 403 && !isAuthenticated) {
        setError('root.server', { message: error.data?.code === 'guest_checkout_disabled' ? t('page.guestOff') : error.message })
        return
      }
      // Phase 14: cash on delivery was refused (zone, limit): re-price, so the payment choices say why.
      if (error.fieldErrors?.paymentMethod) pricing.refetch()
      if (applyServerFieldErrors(error, setError, requiresShipping ? SERVER_FIELD_MAP : { ...SERVER_FIELD_MAP, ...GIFT_CARD_ONLY_FIELD_MAP })) return
      // The code stopped applying (phase 7 messages say why: "Spend $20.00 more
      // to use this code", "This code applies to Shoes only"): re-price, so the
      // summary and the code box show the server's answer too.
      // Phase 10: the gift card stopped working (spent elsewhere, disabled, expired): re-price and say why.
      // Phase 11: the points can't be used any more (spent elsewhere, the total changed): re-price and say why.
      const pointsMessage = error.fieldErrors?.rewardPoints?.[0]
      if (pointsMessage) {
        pricing.refetch()
        setError('root.server', { message: t('page.pointsError', { message: pointsMessage }) })
        return
      }
      const giftCardMessage = error.fieldErrors?.giftCardCode?.[0]
      if (giftCardMessage) {
        pricing.refetch()
        setError('root.server', { message: t('page.giftCardError', { message: giftCardMessage }) })
        return
      }
      const couponMessage = error.fieldErrors?.couponCode?.[0]
      if (couponMessage) {
        pricing.refetch()
        setError('root.server', { message: `${cart.couponCode ? `${cart.couponCode}: ` : ''}${t('page.couponError', { message: couponMessage })}` })
        return
      }
      // Stock problems (422 on the items) explain themselves; so does a coupon
      // the server refused (couponCode), which has no field in this form.
      const stockProblems = error.data?.problems?.map((problem) => problem.message).join(' ')
      const otherField = Object.values(error.fieldErrors ?? {})[0]?.[0]
      if (stockProblems) setError('root.server', { message: t('page.stockError', { problems: stockProblems }) })
      else setError('root.server', { message: otherField ?? error.message })
    }
  }

  const placeLabel = isBusy
    ? t('page.checkingPrices')
    : payAdvance
      ? t('cod.payAdvance', { amount: formatBasePrice(advanceAmount) })
      : payByStripe
      ? t('page.continueSecure')
      : payByPaypal
        ? t('page.continuePaypal')
        : payBySslcommerz
          ? t('page.continueSslcommerz')
          : t('page.placeOrder', { amount: formatBasePrice(prepaid > 0 ? amountDue : totals.total) })
  let paymentNote = null
  if (REAL_SHOP) {
    const noteKey = paymentMethod === 'cod' ? 'cod' : payByStripe ? 'stripe' : payByPaypal ? 'paypal' : payBySslcommerz ? 'sslcommerz' : 'online'
    paymentNote = t(`page.notes.${noteKey}`)
    // Phase 14: cash on delivery's fee, the delivery charge paid first, and the store's phone call.
    if (paymentMethod === 'cod') {
      if (codReason) paymentNote = codReason
      if (payAdvance) paymentNote = t('cod.advanceNote', { advance: formatBasePrice(advanceAmount), due: formatBasePrice(dueOnDelivery) })
      if (codFee > 0) paymentNote = `${paymentNote} ${t('cod.fee', { fee: formatBasePrice(codFee) })}`
      if (settings.cod?.requireConfirmation || cod?.requiresConfirmation) paymentNote = `${paymentNote} ${t('cod.callToConfirm')}`
    } else if (codReason) {
      paymentNote = `${codReason} ${paymentNote}`
    }
    if (giftCardPays > 0) paymentNote = t('page.giftCardPays', { paid: formatBasePrice(giftCardPays), due: formatBasePrice(amountDue), note: paymentNote })
    else if (pointsPay > 0) paymentNote = t('page.pointsPay', { paid: formatBasePrice(pointsPay), due: formatBasePrice(amountDue), note: paymentNote })
  }

  return (
    <div className="checkout section container">
      <title>{`${t('page.tabTitle')} | ${SITE.name}`}</title>
      <header className="checkout__header">
        <h1>{t('page.title')}</h1>
        <p className="checkout__secure">
          <LuLock aria-hidden="true" />{' '}
          {t(REAL_SHOP ? 'page.secure' : 'page.demo')}
        </p>
        {REAL_SHOP && !isAuthenticated && settings.guestCheckout && (
          <p className="checkout__note">
            <Trans t={t} i18nKey="page.haveAccount" components={{ signin: <Link to={ROUTES.login} state={{ from: location }} /> }} />
          </p>
        )}
      </header>

      {/* The summary (with its own coupon <form>) sits OUTSIDE the checkout form:
          forms can't be nested in HTML. The "Place order" button joins the
          checkout form through its `form` attribute. */}
      <div className="checkout__layout">
        <form id="checkout-form" className="checkout__form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <section className="checkout__section" aria-labelledby="contact-title">
            <h2 id="contact-title">{t('page.contact')}</h2>
            <div className="checkout__grid">
              <FormField
                label={t('page.email')}
                type="email"
                autoComplete="email"
                hint={REAL_SHOP ? t('page.emailHint') : undefined}
                {...register('email')}
                error={errors.email?.message}
              />
              {/* Phase 12: SSLCommerz needs a phone number for the payment page: the hint says so when it's chosen. */}
              <FormField
                label={t('page.phone')}
                type="tel"
                autoComplete="tel"
                hint={bdContact ? t('common:bdAddress.mobileHint') : t(paymentMethod === 'sslcommerz' && !fullyCovered ? 'page.phoneHintSslcommerz' : 'page.phoneHint')}
                {...register('phone')}
                error={errors.phone?.message}
              />
            </div>
          </section>

          {requiresShipping ? (
          <section className="checkout__section" aria-labelledby="shipping-title">
            <h2 id="shipping-title">{t('page.shippingAddress')}</h2>
            {canUseAddressBook && savedAddresses.length > 0 && (
              <SavedAddressPicker label={t('page.savedShipping')} addresses={savedAddresses} current={shippingAddress} onChoose={(saved) => fillFromSaved('shipping', saved)} />
            )}
            <AddressFields prefix="shipping" register={register} errors={errors.shipping} autoCompleteSection="shipping" countries={settings.countries} form={addressForm} bangladesh={bangladeshStore} />
            {offerToSave && <CheckboxField label={t('page.saveAddress')} {...register('saveAddress')} />}
          </section>
          ) : (
            // Phase 10: gift cards only: nothing ships, so only the billing address is asked for.
            <section className="checkout__section" aria-labelledby="billing-title">
              <h2 id="billing-title">{t('page.billingAddress')}</h2>
              <p className="checkout__note">{t('page.giftCardsByEmail')}</p>
              {canUseAddressBook && savedAddresses.length > 0 && (
                <SavedAddressPicker label={t('page.savedAddresses')} addresses={savedAddresses} current={billingAddress} onChoose={(saved) => fillFromSaved('billing', saved)} />
              )}
              <AddressFields prefix="billing" register={register} errors={errors.billing} autoCompleteSection="billing" countries={settings.countries} form={addressForm} bangladesh={bangladeshStore} />
            </section>
          )}

          {requiresShipping && (
          <section className="checkout__section" aria-labelledby="billing-title">
            <h2 id="billing-title">{t('page.billingAddress')}</h2>
            <CheckboxField label={t('page.sameAsShipping')} {...register('billingSameAsShipping')} />
            {!billingSameAsShipping && canUseAddressBook && savedAddresses.length > 0 && (
              <SavedAddressPicker label={t('page.savedBilling')} addresses={savedAddresses} current={billingAddress} onChoose={(saved) => fillFromSaved('billing', saved)} />
            )}
            {!billingSameAsShipping && (
              <AddressFields prefix="billing" register={register} errors={errors.billing} autoCompleteSection="billing" countries={settings.countries} form={addressForm} bangladesh={bangladeshStore} />
            )}
          </section>

          )}

          {requiresShipping && (
            <section className="checkout__section">
              <ChoiceCards
                legend={t('page.delivery')}
                options={shippingOptions}
                registration={register('shippingMethod')}
                selectedId={shippingMethod}
                error={errors.shippingMethod?.message}
              />
              {/* Phase 14: the delivery charge follows the Bangladesh area (its delivery zone). */}
              {bdShipping && (
                <p className="checkout__note" aria-live="polite">
                  {shippingAreaId ? (serverCart?.deliveryZone && zoneName(serverCart.deliveryZone) ? t('delivery.zone', { zone: zoneName(serverCart.deliveryZone) }) : null) : t('delivery.chooseArea')}
                </p>
              )}
              {noDelivery && (
                <p className="checkout__error" role="alert">
                  {t('page.chooseCountry', { reason: serverCart?.shippingError ?? t('page.cantDeliver', { country: t(`common:countries.${shippingCountry}`, { defaultValue: shippingCountry }) }), email: settings.supportEmail ?? SITE.supportEmail })}
                </p>
              )}
            </section>
          )}

          <section className="checkout__section">
            {fullyCovered ? (
              <fieldset className="choice-cards">
                <legend className="choice-cards__legend">{t('page.payment')}</legend>
                <p className="checkout__note">
                  {t(giftCardPays > 0 ? 'page.giftCardCovers' : 'page.pointsCover')}
                </p>
              </fieldset>
            ) : (
              <ChoiceCards
                legend={t('page.payment')}
                options={settings.paymentMethods.map(localizedPaymentMethod).map((method) => (method.id === 'cod' && codUnavailable ? { ...method, disabled: true, description: codReason } : method))}
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
                {t('page.demoPayment')}
              </p>
            )}
          </section>
        </form>

        <aside className="checkout__summary cart-summary" aria-labelledby="checkout-summary-title">
          <h2 id="checkout-summary-title" className="cart-summary__title">
            {t('page.summary')}
          </h2>
          <OrderItems items={serverCart ? withVariantLabels(serverCart.lines.filter((line) => line.available), cart.items) : cart.items} />
          {REAL_SHOP && <GroupDiscountNote group={serverCart?.customerGroup ?? group} amount={serverCart?.totals.groupDiscount} format={formatBasePrice} />}
          <OrderTotals
            totals={{
              ...(prepaid > 0 ? { ...totals, giftCard: giftCardPays, rewardPoints: pointsPay, amountDue } : totals),
              // Phase 14: the delivery charge paid online first, the rest in cash.
              ...(payAdvance && { advanceDue: advanceAmount, codDue: dueOnDelivery }),
            }}
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
              {t('page.changed', { count: changedCount })}
            </p>
          )}

          {problems.length > 0 && (
            <div className="checkout__error" role="alert">
              <p>{problems.map((problem) => problem.message).join(' ')}</p>
              <Button to={ROUTES.cart} variant="outline" size="sm">
                {t('page.reviewCart')}
              </Button>
            </div>
          )}

          {REAL_SHOP && pricing.error && !serverCart && (
            <div className="checkout__error" role="alert">
              <p>{t('page.pricesFailed', { reason: pricing.error.message })}</p>
              <Button variant="outline" size="sm" onClick={() => pricing.refetch()}>
                {t('page.tryAgain')}
              </Button>
            </div>
          )}

          {errors.root?.server && (
            <div className="checkout__error" role="alert">
              <p>{errors.root.server.message}</p>
              <Button to={ROUTES.cart} variant="outline" size="sm">
                {t('page.reviewCart')}
              </Button>
            </div>
          )}

          <Button type="submit" form="checkout-form" size="lg" fullWidth disabled={isBusy || cannotPlace}>
            {placeLabel}
          </Button>
          {/* Phase 11: prices shown in another currency elsewhere; the order is charged in the store currency. */}
          <ChargedInBaseNote amount={prepaid > 0 ? amountDue : totals.total} />
          {bdShipping && !shippingAreaId && <p className="cart-summary__note">{t('delivery.areaNote')}</p>}
          <p className="cart-summary__note">
            {t(REAL_SHOP ? 'page.serverNote' : 'page.demoNote')}
          </p>
        </aside>
      </div>
    </div>
  )
}

export default CheckoutPage
