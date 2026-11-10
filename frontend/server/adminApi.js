import { json, pick, readBody, upstream } from './http.js'
import { accounts } from './accounts/index.js'
import { laravelAdminData } from './shop/admin.js'
import { ADMIN, clearedCookies, notSignedIn, sessionCookies } from './session.js'

/*
 * BuyNest admin service, at /api/admin/* (used by the admin app in buynest/admin).
 *
 * ADMINS HAVE THEIR OWN SESSION: separate sign-in (/api/admin/auth/*) and
 * separate HttpOnly cookies (session.js ADMIN), never the storefront's. With
 * Laravel accounts, admins are a separate table: a customer can't sign in here
 * even with the right password. With the DummyJSON demo users, only users
 * whose role is "admin" can.
 *
 * PERMISSIONS ARE CHECKED HERE, ON THE SERVER: every request looks up the
 * admin session with the accounts backend and refuses anything else (401/403),
 * whatever the browser shows or hides. Responses are allow-listed: customer
 * records never include passwords, bank, or SSN data.
 *
 * DATA: customers come from Laravel when VITE_ACCOUNTS_BACKEND=laravel (real,
 * and admins can block them). Products, orders, and the overview come from
 * Laravel too when VITE_API_PROVIDER=laravel as well (shop/admin.js; answers
 * say `live: true`). Otherwise they are DummyJSON's demo data: DummyJSON
 * accepts product changes and answers as if it saved them, but it doesn't.
 * Those writes say `simulated: true`.
 *
 *   POST   /api/admin/auth/login         { email | username, password, remember } → the admin's profile
 *   POST   /api/admin/auth/refresh       → renews the admin session
 *   POST   /api/admin/auth/logout        → ends the admin session
 *   GET    /api/admin/me                 → the admin's profile
 *   GET    /api/admin/overview           → store totals, low stock, latest orders
 *   GET    /api/admin/products?q&category&status&limit&skip&sortBy&order
 *   GET    /api/admin/products/:id
 *   POST   /api/admin/products           → create (validated)
 *   PUT    /api/admin/products/:id       → update (validated, partial)
 *   DELETE /api/admin/products/:id
 *   GET    /api/admin/categories
 *   GET    /api/admin/orders?q&status&paymentStatus&limit&skip   (filters: Laravel only)
 *   GET    /api/admin/orders/:id          (Laravel: the order number, e.g. BN-100001)
 *   PATCH  /api/admin/orders/:number      { status?, paymentStatus?, note?, notifyCustomer? } (Laravel only)
 *   GET    /api/admin/customers?q&status&limit&skip
 *   PATCH  /api/admin/customers/:id      { isActive } → block or unblock (Laravel accounts only)
 */

const PRODUCT_LIST_FIELDS = ['id', 'title', 'category', 'brand', 'price', 'discountPercentage', 'stock', 'rating', 'thumbnail', 'availabilityStatus']
const PRODUCT_DETAIL_FIELDS = [...PRODUCT_LIST_FIELDS, 'description', 'sku', 'minimumOrderQuantity', 'images', 'tags']
const CUSTOMER_FIELDS = ['id', 'firstName', 'lastName', 'username', 'email', 'phone', 'role', 'image']
const LOW_STOCK = 10
const MAX_PAGE = 100
const SORTABLE = ['title', 'price', 'stock', 'rating']
const PRODUCT_STATUSES = ['active', 'draft', 'archived']
const ORDER_STATUSES = ['pending_payment', 'processing', 'shipped', 'delivered', 'cancelled']

/** Real products and orders need both the Laravel catalog and Laravel admin accounts (its token). */
const realData = () => process.env.VITE_API_PROVIDER === 'laravel' && process.env.VITE_ACCOUNTS_BACKEND === 'laravel'
const fromLaravel = (result, status) => (result.ok ? json(result.data, status ?? result.status) : json(result.body, result.status))
const oneOf = (value, allowed) => (allowed.includes(value) ? value : undefined)

const toProduct = (raw, fields = PRODUCT_LIST_FIELDS) => pick(raw, fields)
const toCustomer = (raw) => ({ ...pick(raw, CUSTOMER_FIELDS), ...(raw.address && { city: raw.address.city, country: raw.address.country }) })
const fullName = (user) => [user?.firstName, user?.lastName].filter(Boolean).join(' ')

function pageParams(url) {
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), MAX_PAGE)
  const skip = Math.max(Number.parseInt(url.searchParams.get('skip') ?? '0', 10) || 0, 0)
  return { limit, skip }
}

const isId = (value) => /^\d{1,9}$/.test(value ?? '')
const isOrderNumber = (value) => /^BN-\d{1,12}$/.test(value ?? '')
const notFound = (what = 'That item') => json({ message: `${what} was not found.` }, 404)
const passThrough = ({ status, data }) => json({ message: data?.message ?? 'The request failed.' }, status)

/*
 * Server-side validation for product writes. Same shape as Laravel's 422
 * response ({ message, errors: { field: [messages] } }), so the admin form
 * shows field errors the same way now and after the switch.
 */
// At most 2 decimals, with a tolerance: in floating point 19.99 * 100 is 1998.9999999999998.
const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6

const PRODUCT_RULES = {
  title: (value) => (typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 120 ? null : 'Enter a name of 2 to 120 characters.'),
  description: (value) => (typeof value === 'string' && value.length <= 2000 ? null : 'Keep the description under 2000 characters.'),
  category: (value) => (typeof value === 'string' && /^[a-z0-9-]{2,40}$/.test(value) ? null : 'Choose a category.'),
  brand: (value) => (typeof value === 'string' && value.length <= 60 ? null : 'Keep the brand under 60 characters.'),
  price: (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000 && hasCents(value) ? null : 'Enter a price from 0 to 1,000,000 with at most 2 decimals.'),
  discountPercentage: (value) => (typeof value === 'number' && value >= 0 && value <= 90 ? null : 'Enter a discount from 0 to 90%.'),
  stock: (value) => (Number.isInteger(value) && value >= 0 && value <= 100_000 ? null : 'Enter a whole number of units from 0 to 100,000.'),
  status: (value) => (PRODUCT_STATUSES.includes(value) ? null : 'Choose active, draft, or archived.'),
}
const REQUIRED_ON_CREATE = ['title', 'category', 'price', 'stock']

export function validateProduct(body, { partial }) {
  const errors = {}
  const values = {}
  for (const [field, rule] of Object.entries(PRODUCT_RULES)) {
    if (body[field] === undefined) {
      if (!partial && REQUIRED_ON_CREATE.includes(field)) errors[field] = [rule(undefined)]
      continue
    }
    const problem = rule(body[field])
    if (problem) errors[field] = [problem]
    else values[field] = typeof body[field] === 'string' ? body[field].trim() : body[field]
  }
  if (partial && Object.keys(values).length === 0 && Object.keys(errors).length === 0) {
    errors.title = ['Change at least one field.']
  }
  return Object.keys(errors).length > 0 ? { errors } : { values }
}

const invalid = (errors) => json({ message: 'Please check the highlighted fields.', errors }, 422)
// An empty brand means "no brand" (the API creates brands by name).
const withoutBlankBrand = (values) => (values.brand === '' ? { ...values, brand: null } : values)

const ROUTES = {
  async 'GET me'(ctx) {
    return json(ctx.admin)
  },

  async 'GET overview'(ctx) {
    if (realData()) return fromLaravel(await laravelAdminData.overview(ctx.token, ctx.request))
    const [products, orders, customers] = await Promise.all([
      upstream('/products?limit=0&select=title,price,stock,category,thumbnail,discountPercentage'),
      upstream('/carts?limit=0'),
      upstream('/users?limit=0&select=firstName,lastName'),
    ])
    for (const result of [products, orders, customers]) if (result.status !== 200) return passThrough(result)

    const items = products.data.products
    const carts = orders.data.carts
    const names = new Map(customers.data.users.map((user) => [user.id, fullName(user)]))
    const inStock = items.filter((item) => item.stock > 0)
    // Money in cents to avoid floating-point drift, then back to dollars.
    const cents = (dollars) => Math.round(dollars * 100)
    const sum = (list, value) => list.reduce((total, entry) => total + cents(value(entry)), 0) / 100

    return json({
      products: {
        total: products.data.total,
        outOfStock: items.length - inStock.length,
        lowStock: inStock.filter((item) => item.stock < LOW_STOCK).length,
        inventoryValue: sum(items, (item) => item.price * item.stock),
      },
      orders: {
        total: orders.data.total,
        revenue: sum(carts, (cart) => cart.discountedTotal),
        unitsSold: carts.reduce((total, cart) => total + cart.totalQuantity, 0),
      },
      customers: { total: customers.data.total },
      lowStockProducts: items
        .filter((item) => item.stock < LOW_STOCK)
        .sort((a, b) => a.stock - b.stock || a.title.localeCompare(b.title))
        .slice(0, 6)
        .map((item) => toProduct(item)),
      // DummyJSON carts have no dates: the highest ids stand in for "latest".
      latestOrders: [...carts]
        .sort((a, b) => b.id - a.id)
        .slice(0, 6)
        .map((cart) => ({ id: cart.id, customer: names.get(cart.userId) ?? `Customer #${cart.userId}`, items: cart.totalQuantity, total: cart.discountedTotal })),
      lowStockThreshold: LOW_STOCK,
    })
  },

  async 'GET products'(ctx) {
    const { url } = ctx
    const { limit, skip } = pageParams(url)
    const q = url.searchParams.get('q')?.trim()
    const category = url.searchParams.get('category')
    const sortBy = url.searchParams.get('sortBy')
    const order = url.searchParams.get('order') === 'desc' ? 'desc' : 'asc'
    if (realData()) {
      const status = oneOf(url.searchParams.get('status'), PRODUCT_STATUSES)
      const filters = { q: q?.slice(0, 100), category: /^[a-z0-9-]{2,40}$/.test(category ?? '') ? category : undefined, status, sortBy, order, limit, skip }
      return fromLaravel(await laravelAdminData.listProducts(ctx.token, filters, ctx.request))
    }
    const params = new URLSearchParams({ limit, skip, select: PRODUCT_LIST_FIELDS.join(',') })
    if (SORTABLE.includes(sortBy)) {
      params.set('sortBy', sortBy)
      params.set('order', order)
    }
    let path = `/products?${params}`
    if (q) path = `/products/search?q=${encodeURIComponent(q)}&${params}`
    else if (category && /^[a-z0-9-]{2,40}$/.test(category)) path = `/products/category/${category}?${params}`
    const result = await upstream(path)
    if (result.status !== 200) return passThrough(result)
    return json({ products: result.data.products.map((item) => toProduct(item)), total: result.data.total, limit, skip })
  },

  async 'GET products/:id'(ctx) {
    if (realData()) return fromLaravel(await laravelAdminData.getProduct(ctx.token, ctx.id, ctx.request))
    const result = await upstream(`/products/${ctx.id}`)
    if (result.status === 404) return notFound('That product')
    if (result.status !== 200) return passThrough(result)
    return json(toProduct(result.data, PRODUCT_DETAIL_FIELDS))
  },

  async 'POST products'(ctx) {
    const { values, errors } = validateProduct(await readBody(ctx.request), { partial: false })
    if (errors) return invalid(errors)
    if (realData()) return fromLaravel(await laravelAdminData.createProduct(ctx.token, withoutBlankBrand(values), ctx.request), 201)
    const result = await upstream('/products/add', { method: 'POST', body: values })
    if (![200, 201].includes(result.status)) return passThrough(result)
    return json({ product: toProduct(result.data, PRODUCT_DETAIL_FIELDS), simulated: true }, 201)
  },

  async 'PUT products/:id'(ctx) {
    const { values, errors } = validateProduct(await readBody(ctx.request), { partial: true })
    if (errors) return invalid(errors)
    if (realData()) return fromLaravel(await laravelAdminData.updateProduct(ctx.token, ctx.id, withoutBlankBrand(values), ctx.request))
    const result = await upstream(`/products/${ctx.id}`, { method: 'PUT', body: values })
    if (result.status === 404) return notFound('That product')
    if (result.status !== 200) return passThrough(result)
    return json({ product: toProduct(result.data, PRODUCT_DETAIL_FIELDS), simulated: true })
  },

  async 'DELETE products/:id'(ctx) {
    if (realData()) return fromLaravel(await laravelAdminData.deleteProduct(ctx.token, ctx.id, ctx.request), 200)
    const result = await upstream(`/products/${ctx.id}`, { method: 'DELETE' })
    if (result.status === 404) return notFound('That product')
    if (result.status !== 200) return passThrough(result)
    return json({ id: result.data.id, deleted: true, simulated: true })
  },

  async 'GET categories'(ctx) {
    if (realData()) return fromLaravel(await laravelAdminData.categories(ctx.token, ctx.request))
    const result = await upstream('/products/categories')
    if (result.status !== 200) return passThrough(result)
    return json(result.data.map((category) => pick(category, ['slug', 'name'])))
  },

  async 'GET orders'(ctx) {
    const { limit, skip } = pageParams(ctx.url)
    if (realData()) {
      const { searchParams } = ctx.url
      const filters = {
        q: searchParams.get('q')?.trim().slice(0, 100),
        status: oneOf(searchParams.get('status'), ORDER_STATUSES),
        paymentStatus: oneOf(searchParams.get('paymentStatus'), ['paid', 'unpaid']),
        limit,
        skip,
      }
      return fromLaravel(await laravelAdminData.listOrders(ctx.token, filters, ctx.request))
    }
    const [orders, customers] = await Promise.all([upstream(`/carts?limit=${limit}&skip=${skip}`), upstream('/users?limit=0&select=firstName,lastName')])
    if (orders.status !== 200) return passThrough(orders)
    const names = new Map((customers.data.users ?? []).map((user) => [user.id, fullName(user)]))
    return json({
      orders: orders.data.carts.map((cart) => ({
        id: cart.id,
        customerId: cart.userId,
        customer: names.get(cart.userId) ?? `Customer #${cart.userId}`,
        products: cart.totalProducts,
        items: cart.totalQuantity,
        subtotal: cart.total,
        total: cart.discountedTotal,
      })),
      total: orders.data.total,
      limit,
      skip,
    })
  },

  async 'GET orders/:id'(ctx) {
    if (realData()) return isOrderNumber(ctx.id) ? fromLaravel(await laravelAdminData.getOrder(ctx.token, ctx.id, ctx.request)) : notFound('That order')
    if (!isId(ctx.id)) return notFound('That order')
    const order = await upstream(`/carts/${ctx.id}`)
    if (order.status === 404) return notFound('That order')
    if (order.status !== 200) return passThrough(order)
    const customer = await upstream(`/users/${order.data.userId}`)
    return json({
      id: order.data.id,
      customer: customer.status === 200 ? toCustomer(customer.data) : { id: order.data.userId },
      lines: order.data.products.map((line) =>
        pick(line, ['id', 'title', 'price', 'quantity', 'total', 'discountPercentage', 'discountedTotal', 'thumbnail']),
      ),
      subtotal: order.data.total,
      total: order.data.discountedTotal,
      items: order.data.totalQuantity,
    })
  },

  /*
   * Order status and payment (Laravel only). The API enforces which status
   * changes are allowed (422 otherwise); this only checks the shape.
   */
  async 'PATCH orders/:id'(ctx) {
    if (!realData()) return json({ message: 'Managing orders needs the BuyNest backend; the demo orders cannot change.' }, 404)
    if (!isOrderNumber(ctx.id)) return notFound('That order')
    const body = await readBody(ctx.request)
    const errors = {}
    if (body.status !== undefined && !ORDER_STATUSES.includes(body.status)) errors.status = ['Choose a valid status.']
    if (body.paymentStatus !== undefined && body.paymentStatus !== 'paid') errors.paymentStatus = ['Payment can only be marked as paid.']
    if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 1000)) errors.note = ['Keep the note under 1000 characters.']
    if (body.status === undefined && body.paymentStatus === undefined) errors.status = ['Choose a new status or mark the order as paid.']
    if (Object.keys(errors).length > 0) return invalid(errors)
    const changes = { status: body.status, paymentStatus: body.paymentStatus, note: body.note?.trim() || undefined, notifyCustomer: body.notifyCustomer !== false }
    return fromLaravel(await laravelAdminData.updateOrder(ctx.token, ctx.id, changes, ctx.request))
  },

  async 'GET customers'(ctx) {
    const { url } = ctx
    const { limit, skip } = pageParams(url)
    const q = url.searchParams.get('q')?.trim()
    const backend = accounts()
    if (backend.admin.listCustomers) {
      const status = ['verified', 'unverified', 'blocked'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : undefined
      // The API pages by page number; this service by limit/skip.
      const result = await backend.admin.listCustomers(ctx.token, { search: q?.slice(0, 100), status, page: Math.floor(skip / limit) + 1, perPage: limit }, ctx.request)
      if (!result.ok) return json(result.body, result.status)
      return json({ ...result.data, limit, skip, manageable: true })
    }
    const select = 'firstName,lastName,username,email,phone,role,image,address'
    const path = q
      ? `/users/search?q=${encodeURIComponent(q)}&limit=${limit}&skip=${skip}&select=${select}`
      : `/users?limit=${limit}&skip=${skip}&select=${select}`
    const result = await upstream(path)
    if (result.status !== 200) return passThrough(result)
    return json({ customers: result.data.users.map(toCustomer), total: result.data.total, limit, skip, manageable: false })
  },

  async 'PATCH customers/:id'(ctx) {
    const backend = accounts()
    if (!backend.admin.updateCustomer) return json({ message: 'Blocking customers needs the BuyNest backend; the demo accounts cannot do it.' }, 404)
    const body = await readBody(ctx.request)
    if (typeof body.isActive !== 'boolean') return invalid({ isActive: ['Choose whether the account is active.'] })
    const result = await backend.admin.updateCustomer(ctx.token, ctx.id, { isActive: body.isActive }, ctx.request)
    return result.ok ? json(result.data) : json(result.body, result.status)
  },
}

/** /api/admin/<resource>[/<id>] → route key like "PUT products/:id". Orders also go by number (BN-100001). */
function matchRoute(method, segments) {
  const [resource, id, ...rest] = segments
  if (rest.length > 0) return null
  if (id === undefined) return { route: ROUTES[`${method} ${resource}`] }
  if (!isId(id) && !(resource === 'orders' && isOrderNumber(id))) return null
  return { route: ROUTES[`${method} ${resource}/:id`], id }
}

/** The admin session routes: no permission check (they create or end the session). */
const SESSION_ROUTES = {
  async 'POST login'(request) {
    const body = await readBody(request)
    const remember = body.remember === true
    const result = await accounts().admin.login(body, remember, request)
    return result.ok ? json(result.profile, 200, sessionCookies(result.tokens, remember, ADMIN)) : json(result.body, result.status)
  },

  async 'POST refresh'(request, cookies) {
    if (!cookies[ADMIN.refresh]) return json({ message: 'Your session has expired.' }, 401, clearedCookies(ADMIN))
    const remember = cookies[ADMIN.remember] === '1'
    const result = await accounts().admin.refresh(cookies[ADMIN.refresh], remember, request)
    if (!result.ok) {
      const ended = [400, 401, 403].includes(result.status)
      return json(result.body, result.status, ended ? clearedCookies(ADMIN) : [])
    }
    return json({ ok: true }, 200, sessionCookies(result.tokens, remember, ADMIN))
  },

  async 'POST logout'(request, cookies) {
    await accounts().admin.logout(cookies[ADMIN.access], request)
    return json({ ok: true }, 200, clearedCookies(ADMIN))
  },
}

export async function handleAdminRequest(request, segments, cookies) {
  if (segments[0] === 'auth' && segments.length === 2) {
    const route = SESSION_ROUTES[`${request.method} ${segments[1]}`]
    return route ? route(request, cookies) : json({ message: 'Not found.' }, 404)
  }

  const match = matchRoute(request.method, segments)
  if (!match?.route) return json({ message: 'Not found.' }, 404)

  // The permission check, on every request: a valid ADMIN session.
  const token = cookies[ADMIN.access]
  if (!token) return notSignedIn()
  const session = await accounts().admin.me(token, request)
  if (!session.ok) return json(session.body, session.status, session.status === 403 ? clearedCookies(ADMIN) : [])

  return match.route({ request, url: new URL(request.url), id: match.id, admin: session.profile, token })
}
