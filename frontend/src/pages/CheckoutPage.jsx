import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router'
import { LuLock, LuShoppingBag, LuTriangleAlert } from 'react-icons/lu'
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { profileQuery } from '../queries/userQueries'
import { productKeys } from '../queries/productQueries'
import { useOrders } from '../hooks/useOrders'
import { createOrder, verifyCartWithServer } from '../services/orderService'
import { EMPTY_ADDRESS, checkoutSchema } from '../schemas/checkoutSchema'
import { COUNTRIES, PAYMENT_METHODS, SHIPPING_METHODS } from '../constants/store'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import { calculateCartTotals } from '../utils/cartTotals'
import { formatPrice } from '../utils/formatters'
import './CheckoutPage.css'

/**
 * /checkout (signed-in customers). Loads the profile to pre-fill contact and
 * address details, then renders the form. SIMULATED: no payment is taken.
 */
function CheckoutPage() {
  const cart = useCart()
  const { user, authorizedRequest } = useAuth()
  // Same cache entry as the profile page: visiting /account first makes this instant.
  const profileRequest = useQuery(profileQuery(user.id, authorizedRequest))

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

  if (profileRequest.isPending) {
    return (
      <div className="section container">
        <Loader label="Preparing checkout…" />
      </div>
    )
  }

  // If the profile can't be loaded, fall back to what we know from sign-in.
  const profile = profileRequest.data ?? user
  const address = profile.address
  const shippingDefaults = {
    ...EMPTY_ADDRESS,
    firstName: profile.firstName,
    lastName: profile.lastName,
    ...(address && {
      line1: address.line1,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: COUNTRIES.includes(address.country) ? address.country : EMPTY_ADDRESS.country,
    }),
  }

  return (
    <CheckoutForm
      defaultValues={{
        email: profile.email,
        phone: profile.phone ?? '',
        shipping: shippingDefaults,
        billingSameAsShipping: true,
        billing: EMPTY_ADDRESS,
        shippingMethod: 'standard',
        paymentMethod: 'card',
      }}
    />
  )
}

function CheckoutForm({ defaultValues }) {
  const cart = useCart()
  const { user } = useAuth()
  const { placeOrder } = useOrders()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // A MUTATION: a request that changes something on the server (here: the
  // server prices the cart). Unlike queries, mutations run only when called.
  const verifyMutation = useMutation({
    mutationFn: ({ items, userId }) => verifyCartWithServer(items, userId),
  })

  // React Hook Form keeps values in the inputs themselves (uncontrolled), so
  // typing doesn't re-render the whole page. zodResolver plugs in the schema.
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(checkoutSchema),
    defaultValues,
    // Errors appear after the first submit, then update live as you type.
    // (Validating on blur made error messages push the layout down while the
    // pointer was mid-click, so clicks on fields below were lost.)
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  })

  // useWatch subscribes to just these fields, for the live summary and cards.
  const [shippingMethod, billingSameAsShipping, paymentMethod] = useWatch({
    control,
    name: ['shippingMethod', 'billingSameAsShipping', 'paymentMethod'],
  })

  const totals = calculateCartTotals(cart.items, cart.couponCode, shippingMethod)
  const shippingOptions = SHIPPING_METHODS.map((method) => {
    const price = calculateCartTotals(cart.items, cart.couponCode, method.id).shipping
    return { ...method, description: method.eta, aside: price === 0 ? 'Free' : formatPrice(price) }
  })

  async function onSubmit(values) {
    try {
      // 1. The server prices the cart; stop if anything changed since it was added.
      const verification = await verifyMutation.mutateAsync({ items: cart.items, userId: user.id })
      if (verification.problems.length > 0) {
        setError('root.server', {
          message: `${verification.problems.join(' ')} Please review your cart before placing the order.`,
        })
        return
      }

      // 2. Record the (simulated) order, then empty the cart.
      const order = createOrder({
        userId: user.id,
        values,
        items: cart.items,
        totals,
        couponCode: cart.couponCode,
        verification,
      })
      placeOrder(order)
      // Stock changed on the server: mark every cached product query stale so
      // pages refetch fresh data the next time they're shown (INVALIDATION).
      queryClient.invalidateQueries({ queryKey: productKeys.all })
      navigate(ROUTES.orderConfirmation(order.id), { replace: true })
      cart.clearCart()
    } catch (error) {
      setError('root.server', { message: error.message })
    }
  }

  return (
    <div className="checkout section container">
      <title>{`Checkout | ${SITE.name}`}</title>
      <header className="checkout__header">
        <h1>Checkout</h1>
        <p className="checkout__secure">
          <LuLock aria-hidden="true" /> Demo checkout — no payment is taken and nothing ships.
        </p>
      </header>

      {/* The summary (with its own coupon <form>) sits OUTSIDE the checkout form:
          forms can't be nested in HTML. The "Place order" button joins the
          checkout form through its `form` attribute. */}
      <div className="checkout__layout">
        <form id="checkout-form" className="checkout__form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <section className="checkout__section" aria-labelledby="contact-title">
            <h2 id="contact-title">Contact details</h2>
            <div className="checkout__grid">
              <FormField label="Email" type="email" autoComplete="email" {...register('email')} error={errors.email?.message} />
              <FormField label="Phone" type="tel" autoComplete="tel" hint="For delivery updates only." {...register('phone')} error={errors.phone?.message} />
            </div>
          </section>

          <section className="checkout__section" aria-labelledby="shipping-title">
            <h2 id="shipping-title">Shipping address</h2>
            <AddressFields prefix="shipping" register={register} errors={errors.shipping} autoCompleteSection="shipping" />
          </section>

          <section className="checkout__section" aria-labelledby="billing-title">
            <h2 id="billing-title">Billing address</h2>
            <CheckboxField label="Same as shipping address" {...register('billingSameAsShipping')} />
            {!billingSameAsShipping && (
              <AddressFields prefix="billing" register={register} errors={errors.billing} autoCompleteSection="billing" />
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
              options={PAYMENT_METHODS}
              registration={register('paymentMethod')}
              selectedId={paymentMethod}
              error={errors.paymentMethod?.message}
            />
            <p className="checkout__note">
              BuyNest never asks for card numbers. A real payment would happen on the provider's secure page, and the
              order would only be confirmed after our server verifies the payment.
            </p>
          </section>
        </form>

        <aside className="checkout__summary cart-summary" aria-labelledby="checkout-summary-title">
          <h2 id="checkout-summary-title" className="cart-summary__title">
            Order summary
          </h2>
          <OrderItems items={cart.items} />
          <OrderTotals totals={totals} couponCode={cart.couponCode} shippingLabel={totals.shippingMethod.label} />
          <CouponForm
            appliedCode={cart.couponCode}
            coupon={totals.coupon}
            couponError={totals.couponError}
            onApply={cart.applyCoupon}
            onRemove={cart.removeCoupon}
          />

          {errors.root?.server && (
            <div className="checkout__error" role="alert">
              <p>{errors.root.server.message}</p>
              <Button to={ROUTES.cart} variant="outline" size="sm">
                Review cart
              </Button>
            </div>
          )}

          <Button type="submit" form="checkout-form" size="lg" fullWidth disabled={isSubmitting}>
            {isSubmitting ? 'Checking prices…' : `Place order · ${formatPrice(totals.total)}`}
          </Button>
          <p className="cart-summary__note">
            Prices are re-checked with the server before the order is recorded. Shipping, discounts, and taxes would be
            confirmed by the BuyNest backend.
          </p>
        </aside>
      </div>
    </div>
  )
}

export default CheckoutPage
