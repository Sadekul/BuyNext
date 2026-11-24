// Phase 4: admin roles and permissions, audit log, content pages, the home page editor, store settings, reports.
// Needs the BuyNest API (E2E_ACCOUNTS=laravel). Everything it changes is put back at the end.
import {
  ADMIN_USER,
  BASE,
  LARAVEL,
  LARAVEL_URL,
  adminSignIn,
  axeViolations,
  launch,
  reporter,
  sidewaysOverflow,
  visible,
  watchErrors,
} from './lib.mjs'

const report = reporter('roles, content, settings, reports')
const { log } = report
if (!LARAVEL) {
  console.log('(Skipped: needs the BuyNest API, E2E_ACCOUNTS=laravel)')
  report.done()
  process.exit(0)
}

const api = async (path, { method = 'GET', token, body } = {}) => {
  const response = await fetch(`${LARAVEL_URL}${path}`, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}
const signInApi = async (email, password) => (await api('/api/admin/v1/auth/login', { method: 'POST', body: { email, password } })).body?.data?.tokens?.access_token
const owner = await signInApi(ADMIN_USER.email, ADMIN_USER.password)

// What this suite changes, recorded first so it can be put back
const settingsBefore = (await api('/api/admin/v1/settings', { token: owner })).body.data
const about = (await api('/api/admin/v1/pages?search=about', { token: owner })).body.data.find((page) => page.slug === 'about')
const homeBefore = (await api('/api/admin/v1/home', { token: owner })).body.data

const browser = await launch()
const errors = []
const axe = async (page, name) => {
  const violations = await axeViolations(page)
  log(violations.length === 0, `axe ${name}: ${violations.join(', ') || 'no violations'}`)
}
const run = Date.now()

try {
  // ---------- An Owner sees everything ----------
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true })
  const admin = watchErrors(await adminCtx.newPage(), errors)
  await adminSignIn(admin, ADMIN_USER)
  await admin.getByRole('heading', { name: 'Overview' }).waitFor()
  const nav = admin.getByRole('navigation').first()
  for (const item of ['Products', 'Orders', 'Coupons', 'Reports', 'Settings', 'Admin users', 'Audit log']) {
    if (!(await nav.getByRole('link', { name: item }).isVisible())) log(false, `owner nav is missing "${item}"`)
  }
  log(await nav.getByRole('link', { name: 'Admin users' }).isVisible(), 'Owner: every section in the menu, including System')

  // ---------- A Sales staff admin, created by the Owner ----------
  const roles = (await api('/api/admin/v1/roles', { token: owner })).body.data
  const sales = roles.find((role) => role.name === 'Sales staff')
  const staffEmail = `sales.${run}@buynest.test`
  const staffPassword = 'SalesStaff2026pass'
  const created = await api('/api/admin/v1/admins', { method: 'POST', token: owner, body: { name: 'Sam Sales', email: staffEmail, password: staffPassword, role_id: sales.id } })
  log(created.status === 201, `Owner creates a Sales staff admin (${created.status})`)
  await admin.goto(`${BASE}/admin/admins`, { waitUntil: 'networkidle' })
  // Earlier runs leave deactivated test admins behind, so find the new one with the search box.
  await admin.getByLabel('Search admin users').fill(staffEmail)
  await admin.getByRole('button', { name: 'Search', exact: true }).click()
  log(await visible(admin.locator('tbody').getByText(staffEmail)), 'Admin users list shows the new admin (found with the search box)')
  await axe(admin, 'admin users')
  await admin.goto(`${BASE}/admin/roles`, { waitUntil: 'networkidle' })
  log(await visible(admin.getByText('Sales staff').first()), 'Roles page lists the roles')
  await axe(admin, 'roles')

  const staffCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true })
  const staff = watchErrors(await staffCtx.newPage(), errors)
  await adminSignIn(staff, { email: staffEmail, password: staffPassword })
  await staff.waitForURL(/\/admin\/(?!login)/, { timeout: 15000 }).catch(() => {})
  const staffNav = staff.getByRole('navigation').first()
  await staffNav.getByRole('link', { name: 'Orders' }).waitFor({ timeout: 15000 }).catch(() => {})
  log(await staffNav.getByRole('link', { name: 'Orders' }).isVisible(), 'Sales staff: Orders in the menu')
  log(!(await staffNav.getByRole('link', { name: 'Settings' }).isVisible()) && !(await staffNav.getByRole('link', { name: 'Admin users' }).isVisible()), 'Sales staff: no Settings or Admin users in the menu')
  await staff.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' })
  log(await visible(staff.getByRole('heading', { name: "You don't have access" })), 'Sales staff opening Settings directly: "You don\'t have access"')
  await axe(staff, 'no access')
  const write = await staff.evaluate(async () => {
    const response = await fetch('/api/admin/products/1', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ price: 1 }) })
    return { status: response.status, body: await response.json() }
  })
  log(write.status === 403 && write.body.code === 'permission_denied' && write.body.permission === 'products.edit', `the API refuses a product change by Sales staff (${write.status} ${write.body.permission})`)
  const ordersRead = await staff.evaluate(async () => (await fetch('/api/admin/orders')).status)
  log(ordersRead === 200, 'the API lets Sales staff read orders')

  // ---------- Audit log ----------
  await admin.goto(`${BASE}/admin/audit`, { waitUntil: 'networkidle' })
  // In the table (the Admin filter's options also list names such as "UI Staff").
  log(await visible(admin.locator('tbody').getByText(staffEmail).first()), 'Audit log records the new admin')
  const audit = (await api('/api/admin/v1/audit?action=admin', { token: owner })).body.data
  log(audit.some((entry) => entry.action === 'admin.created') && audit.some((entry) => entry.action === 'admin.signed_in'), 'audit has admin.created and admin.signed_in')
  log(!JSON.stringify(audit).includes(staffPassword), 'the audit log never contains the password')
  await axe(admin, 'audit log')

  // ---------- Content page: edited in the admin, cleaned by the server, shown in the store ----------
  const marker = `Our story continues ${run}.`
  await admin.goto(`${BASE}/admin/pages/${about.id}`, { waitUntil: 'networkidle' })
  const bodyField = admin.getByLabel('Content (HTML)')
  await bodyField.fill(`${about.body}<p>${marker}</p><script>window.__pwned = true</script><p onclick="window.__pwned = true">Click</p><a href="javascript:window.__pwned=true">bad link</a>`)
  await admin.getByRole('button', { name: 'Save page' }).click()
  await admin.waitForTimeout(1200)
  const savedBody = (await api(`/api/admin/v1/pages/${about.id}`, { token: owner })).body.data.body
  log(savedBody.includes(marker) && !/<script|onclick|javascript:/i.test(savedBody), 'the server removed the script, the event attribute, and the javascript: link')
  await axe(admin, 'page editor')
  // bypassCSP: lets axe in, and proves the cleaned HTML is safe on its own, without the CSP's help
  const shopper = watchErrors(await (await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true })).newPage(), errors)
  await shopper.goto(`${BASE}/pages/about`, { waitUntil: 'networkidle' })
  log(await visible(shopper.getByText(marker)), 'the store shows the edited About page')
  log(!(await shopper.evaluate(() => window.__pwned === true)), 'nothing from the attempted script ran in the store')
  await axe(shopper, 'store content page')
  log(await visible(shopper.getByRole('contentinfo').getByRole('link', { name: /Shipping/i })), 'footer links to the content pages')

  // ---------- Home page editor ----------
  const headline = `Fresh finds for every nest ${run}`
  await admin.goto(`${BASE}/admin/home-page`, { waitUntil: 'networkidle' })
  await admin.getByLabel('Headline', { exact: true }).fill(headline)
  await admin.getByRole('button', { name: 'Save home page' }).click()
  await admin.waitForTimeout(1200)
  await axe(admin, 'home editor')
  const homeShopper = watchErrors(await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(), errors)
  await homeShopper.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  log(await visible(homeShopper.getByRole('heading', { name: headline })), 'the store home page shows the new headline')

  // ---------- Store settings change what the store does ----------
  await api('/api/admin/v1/settings', {
    method: 'PATCH',
    token: owner,
    body: { checkout: { guest_checkout: false }, tax: { tax_enabled: true, tax_rates: [{ country: 'United States', rate: '10.00' }] } },
  })
  const guest = watchErrors(await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(), errors)
  const product = (await api('/api/v1/products?per_page=50&available=1')).body.data.find((item) => item.min_order_quantity === 1 && item.stock_quantity > 10)
  await guest.goto(`${BASE}/products/${product.id}`, { waitUntil: 'networkidle' })
  await guest.locator('.product-details').getByRole('button', { name: /add to cart/i }).first().click()
  await guest.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
  log(await visible(guest.getByText(/Sign in to check out/)), 'guest checkout turned off in Settings: the store asks guests to sign in')
  const blocked = await guest.evaluate(async (id) => {
    const response = await fetch('/api/shop/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ productId: id, quantity: 1 }], email: 'x@example.com' }) })
    return { status: response.status, code: (await response.json()).code }
  }, product.id)
  log(blocked.status === 403 && blocked.code === 'guest_checkout_disabled', `and the API refuses guest orders (${blocked.status} ${blocked.code})`)
  const taxed = await guest.evaluate(async (id) => {
    const response = await fetch('/api/shop/cart/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ productId: id, quantity: 1 }], shippingMethod: 'standard', country: 'United States' }) })
    return (await response.json()).totals
  }, product.id)
  const expectedTax = Math.round((taxed.subtotal - taxed.discount + taxed.shipping) * 10) / 100
  log(Math.abs(taxed.tax - expectedTax) < 0.011 && Math.abs(taxed.total - (taxed.subtotal - taxed.discount + taxed.shipping + taxed.tax)) < 0.011, `10% tax for the United States: $${taxed.tax} on $${(taxed.subtotal - taxed.discount + taxed.shipping).toFixed(2)}`)
  await admin.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' })
  log(await visible(admin.getByLabel('Store name')), 'Settings page shows the grouped forms')
  await axe(admin, 'settings')

  // ---------- Reports ----------
  await admin.goto(`${BASE}/admin/reports`, { waitUntil: 'networkidle' })
  log(await visible(admin.getByText('Net revenue').first()), 'Reports: net revenue headline')
  log((await admin.locator('table').count()) > 0, 'Reports: data tables next to the chart')
  await axe(admin, 'reports')
  const csv = await admin.evaluate(async () => {
    const response = await fetch('/api/admin/reports/sales.csv')
    return { type: response.headers.get('content-type'), disposition: response.headers.get('content-disposition'), first: (await response.text()).split('\n')[0] }
  })
  log(/text\/csv/.test(csv.type) && /attachment/.test(csv.disposition ?? '') && /period/.test(csv.first), `CSV export (${csv.first})`)
  await admin.setViewportSize({ width: 390, height: 844 })
  for (const path of ['/admin/reports', '/admin/settings', '/admin/home-page', '/admin/admins']) {
    await admin.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
    const overflow = await sidewaysOverflow(admin)
    log(overflow <= 0, `390px ${path}: no sideways page scroll (${overflow}px)`)
  }

  // The staff admin is deactivated: signed out everywhere
  await api(`/api/admin/v1/admins/${created.body.data.id}`, { method: 'PATCH', token: owner, body: { is_active: false } })
  await staff.goto(`${BASE}/admin/orders`, { waitUntil: 'networkidle' })
  log(/\/admin\/login/.test(staff.url()) || (await visible(staff.getByRole('heading', { name: /No admin access|BuyNest Admin/ }), 5000)), 'a deactivated admin is signed out')
} finally {
  // Put everything back
  await api('/api/admin/v1/settings', { method: 'PATCH', token: owner, body: { checkout: settingsBefore.checkout, tax: settingsBefore.tax } })
  await api(`/api/admin/v1/pages/${about.id}`, { method: 'PATCH', token: owner, body: { body: about.body } })
  await api('/api/admin/v1/home', { method: 'PUT', token: owner, body: { hero_mode: homeBefore.hero_mode, hero: homeBefore.hero, banners: homeBefore.banners, slides: homeBefore.slides, slider: homeBefore.slider, featured_product_ids: homeBefore.featured_product_ids } })
  const restored = (await api('/api/admin/v1/settings', { token: owner })).body.data
  log(JSON.stringify(restored.checkout) === JSON.stringify(settingsBefore.checkout) && JSON.stringify(restored.tax) === JSON.stringify(settingsBefore.tax), 'settings, page, and home content put back')
}

log(errors.length === 0, `no page errors ${JSON.stringify(errors)}`)
report.done()
await browser.close()
