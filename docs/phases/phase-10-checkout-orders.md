# Phase 10 — Checkout and order management

**Goal:** a complete checkout experience, ready for a real orders API, without pretending to take real orders.

> **Simulated.** DummyJSON has no orders or payments API. BuyNest asks the server to price the cart, then records a **demo** order in this browser. No payment is taken, nothing ships, and every screen says so.

## What was built

| # | Feature | Where |
| --- | --- | --- |
| 1 | Checkout page (signed-in customers) | `pages/CheckoutPage.jsx` (`/checkout`, behind `ProtectedRoute`) |
| 2 | Contact details | email + phone, pre-filled from `GET /auth/me` |
| 3 | Shipping address | `components/checkout/AddressFields.jsx` (pre-filled) |
| 4 | Billing address | "Same as shipping" checkbox; separate fields when unticked |
| 5 | Shipping method selector | `ChoiceCards` + `SHIPPING_METHODS` (Standard / Express $12.99 / Next day $24.99) |
| 6 | Order summary | `OrderItems` + `OrderTotals`, live as options change |
| 7 | Discount code | `CouponForm` (same rules as the cart) |
| 8 | Payment method selection | Card (via provider), PayPal, cash on delivery — **no card inputs** |
| 9 | Form validation | React Hook Form + Zod (`schemas/checkoutSchema.js`) |
| 10 | Place order | `verifyCartWithServer` (`POST /carts/add`) → `createOrder` → `OrdersProvider` |
| 11 | Order confirmation | `pages/OrderConfirmationPage.jsx` (`/order-confirmation/:orderId`) |
| 12 | Order history | `pages/OrdersPage.jsx` (`/account/orders`) |
| 13 | Order details | `pages/OrderDetailsPage.jsx` (`/account/orders/:orderId`) |
| 14 | Order status | `components/orders/OrderStatus.jsx` (Placed → Processing → Shipped → Delivered) |

## New packages
| Package | Why |
| --- | --- |
| `react-hook-form` | Form state without re-rendering the page on every keystroke (inputs are *uncontrolled*: the DOM holds the values), plus submit handling and focus-on-error |
| `zod` | A declarative **schema** for valid data (types, formats, conditional rules) |
| `@hookform/resolvers` | Connects the Zod schema to React Hook Form (`zodResolver`) |

## React Hook Form + Zod

```js
const { register, handleSubmit, control, setError, formState: { errors, isSubmitting } } = useForm({
  resolver: zodResolver(checkoutSchema),
  defaultValues,              // pre-filled from the profile
  mode: 'onSubmit',           // first validation on submit…
  reValidateMode: 'onChange', // …then live while correcting
})

<FormField label="Email" {...register('email')} error={errors.email?.message} />
```

- `register('shipping.city')` returns `{ name, onChange, onBlur, ref }`. In React 19, `ref` is a normal prop, so `FormField` passes it straight to the `<input>`.
- `useWatch({ control, name: [...] })` subscribes to only the fields the summary needs.
- `setError('root.server', …)` shows errors that come from the server, not from a field.
- `isSubmitting` is true while the async `onSubmit` runs (button: "Checking prices…").
- Focus moves to the first invalid field automatically (`shouldFocusError`).

### Conditional validation
```js
.superRefine((data, ctx) => {
  if (data.billingSameAsShipping) return
  const result = addressSchema.safeParse(data.billing)
  for (const issue of result.error?.issues ?? [])
    ctx.addIssue({ code: 'custom', message: issue.message, path: ['billing', ...issue.path] })
})
```
Errors land on nested paths (`errors.billing.city`), exactly where `AddressFields` reads them.

### Compare: Phase 9 (hand-written) vs Phase 10 (RHF + Zod)
| | Login/Register (Phase 9) | Checkout (Phase 10) |
| --- | --- | --- |
| Values | `useState` (controlled) | DOM (uncontrolled), read by RHF |
| Rules | `validateLogin()` functions | `checkoutSchema` |
| Re-renders while typing | Whole form | Only what's watched |
| Best for | Small forms, learning | Large forms, nested and conditional data |

## Two real bugs the browser tests found

1. **Errors on blur swallowed clicks.** With `mode: 'onTouched'`, clicking a checkbox lower on the page blurred the field above. Its error message appeared and pushed the page down *between mouse-down and mouse-up*, so the click missed. Errors now appear after the first submit and then update live. The login and registration forms were changed the same way.
2. **Nested forms.** The discount-code `<form>` was inside the checkout `<form>`, which HTML doesn't allow. Pressing "Apply" submitted the whole checkout. The summary now sits outside the form, and "Place order" joins it with `form="checkout-form"`.

## What the backend must validate (and why)

| Item | Why the browser can't be trusted |
| --- | --- |
| **Prices** | The cart lives in localStorage; anyone can set a price to $0.01. The server looks up prices by product ID. (Test: tampering with the stored price → "The price of 'iPhone 13 Pro' has changed", and no order is created.) |
| **Stock** | Other customers buy at the same time; reserve stock in a database transaction when the order is created. |
| **Discounts** | Codes, expiry dates, and usage limits live on the server. Codes in frontend JavaScript are public. |
| **Shipping** | Depends on the address, weight, and carrier rates. |
| **Taxes** | Depend on the destination and product type; use a tax service. BuyNest shows "Calculated by our servers". |
| **Order total** | Recomputed from the above. The client's total is only a preview. |

The demo applies the same idea: `POST /carts/add` makes DummyJSON look up each product's real list price. Its own discounted total is shown on the confirmation, rounded to whole dollars by DummyJSON.

## Payments: never touch card numbers
- BuyNest has **no card fields** (the test checks there's no `cc-*` input).
- A real flow: server creates a payment (e.g. Stripe Checkout Session / PaymentIntent) → customer pays on the provider's page or in its embedded, isolated fields → provider calls your server's **webhook** → only then is the order marked *paid*.
- Card data never touches your servers, which keeps you out of most PCI-DSS scope.
- A "success" redirect alone is not proof of payment; the webhook (server-side verification) is.

## Orders and privacy
`OrdersProvider` stores demo orders in localStorage and **only exposes the signed-in customer's orders** (the test signs in as a second customer and gets "Order not found" for the first customer's order URL). A real API enforces this on the server: `GET /api/orders/{id}` must check that the order belongs to the authenticated user (otherwise it's an IDOR vulnerability).

## Real orders API (Phase 12)
```
POST /api/orders           { items: [{ productId, quantity }], shippingAddress, billingAddress,
                             shippingMethod, couponCode, paymentIntentId }
→ 201 { id, status: "pending_payment", totals: { subtotal, discount, shipping, tax, total } }
GET  /api/orders           → the customer's orders (paginated)
GET  /api/orders/{id}      → one order (403/404 if it isn't yours)
```
Only `orderService.js` changes; the pages already render `order.totals`, `order.status`, and so on.

## Verify it
1. Add an item → drawer "Checkout" → sign in → back on checkout with your details pre-filled.
2. Switch Standard → Express → Next day: the total changes by $12.99 / $24.99.
3. Clear City, untick "Same as shipping", click Place order → errors appear and focus moves to the first one. Type in City → its error disappears.
4. Apply `NEST10` → 10% off. Place order → DevTools → Network shows `POST /carts/add`; you land on the confirmation, the cart is empty.
5. `/account/orders` → your order; open it for details and status.
6. Sign in as `michaelw` / `michaelwpass` → no orders; Emily's order URL → "Order not found".

## Practice
Add a "Gift message" textarea (max 200 characters, only when a "This is a gift" checkbox is ticked). Express both rules in the Zod schema and show the remaining characters with `useWatch`.

## Interview questions
1. **Controlled vs uncontrolled inputs, and why does React Hook Form prefer uncontrolled?** Controlled inputs re-render on every keystroke; uncontrolled ones keep the value in the DOM and are read when needed, so big forms stay fast.
2. **Why validate with a schema?** One source of truth for the rules; the same schema can run on the server (e.g. in a Node backend), and it handles nested and conditional data cleanly.
3. **Why can't the frontend calculate the final order total?** Every input (prices, coupons, stock, shipping, tax) can be tampered with or be out of date; only the server's numbers are authoritative.
4. **How should card payments be integrated?** Through a PCI-compliant provider (hosted page or isolated fields), with the order confirmed by a server-side webhook, never by the client.
5. **What's an IDOR and how do you prevent it?** Insecure Direct Object Reference: accessing another user's resource by changing an ID in the URL. The server must check ownership on every request.
