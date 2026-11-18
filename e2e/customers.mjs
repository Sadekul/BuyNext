// Phase 6: Magento-style customers and sales. The storefront address book and saved addresses at
// checkout, customer groups and their discount, the admin's customer page (tabs, account, addresses,
// notes, "Add customer" with the set-password email, block, delete), orders created by staff, mass
// actions on the order grid, packing slips, the shipments list, returns (RMA) end to end with a refund
// that restocks once, the Returns settings, and what a Viewer admin may do.
// Needs the BuyNest API (E2E_ACCOUNTS=laravel). It works on its own test group, customers, and
// addresses, and removes them at the end. Orders, returns, and credit memos can't be deleted, so they
// stay (like in the other suites); SHOPPER_2's group goes back to what it was.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ADMIN_USER,
  BASE,
  LARAVEL,
  LARAVEL_URL,
  SHOPPER_2,
  adminSignIn,
  axeViolations,
  latestCode,
  launch,
  preserveStock,
  reporter,
  sidewaysOverflow,
  storefrontSignIn,
  visible,
  watchErrors,
} from './lib.mjs'

const report = reporter('customers: address book, groups, customer page, staff orders, bulk, returns')
const { log } = report
if (!LARAVEL) {
  console.log('(Skipped: needs the BuyNest API, E2E_ACCOUNTS=laravel)')
  report.done()
  process.exit(0)
}

const api = async (path, { method = 'GET', token, body } = {}) => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${LARAVEL_URL}${path}`, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: body && JSON.stringify(body),
    })
    // A busy run can hit the API's per-minute limit: wait as asked, then retry.
    if (response.status === 429 && attempt < 4 && !path.includes('password-reset')) {
      await new Promise((resolve) => setTimeout(resolve, (Number(response.headers.get('retry-after')) || 5) * 1000))
      continue
    }
    return { status: response.status, body: await response.json().catch(() => null) }
  }
}
const signInApi = async (email, password) => (await api('/api/admin/v1/auth/login', { method: 'POST', body: { email, password } })).body?.data?.tokens?.access_token
const owner = await signInApi(ADMIN_USER.email, ADMIN_USER.password)
const admin$ = (path, options = {}) => api(`/api/admin/v1${path}`, { token: owner, ...options })
const customerOf = async (id) => (await admin$(`/customers/${id}`)).body?.data
const orderOf = async (number) => (await admin$(`/orders/${number}`)).body?.data
const returnOf = async (number) => (await admin$(`/returns/${number}`)).body?.data
const productOf = async (id) => (await admin$(`/products/${id}`)).body?.data
const groupsNow = async () => (await admin$('/customer-groups')).body?.data ?? []
const usd = (value) => `$${Number(value).toFixed(2)}`
const cents = (value) => Math.round(Number(value) * 100)

/** Subjects of the newest emails in the Laravel test inbox (local development only). */
async function inboxSubjects() {
  const html = await (await fetch(`${LARAVEL_URL}/dev/mailbox`)).text()
  const decode = (text) => text.replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim()
  return [...html.matchAll(/<span class="subject">([^<]*)<\/span>/g)].map((match) => decode(match[1]))
}
async function waitForEmail(subject) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await inboxSubjects()).includes(subject)) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

const run = Date.now().toString(36)
const marker = `e2e${run}`
const isTestLine = (address) => /\be2e[0-9a-z]+\b/.test(address.line1 ?? '')
const groupName = `E2E Group ${run}`
// SHOPPER_2's address book entries (marked, so they can be found and removed)
const home = { line1: `12 Juniper Lane ${marker}`, city: 'Portland', state: 'Oregon', postalCode: '97201' }
const work = { line1: `400 Market Street ${marker}`, city: 'Seattle', state: 'Washington', postalCode: '98101' }
const spare = { line1: `9 Spare Court ${marker}`, city: 'Boise', state: 'Idaho', postalCode: '83702' }
const fresh = { line1: `77 Harbor Road ${marker}`, city: 'Eugene', state: 'Oregon', postalCode: '97401' }
// Test customers: Cora is added in the admin; Yuri (API) has an open order, so he can't be deleted
const cora = { firstName: 'Cora', lastName: 'Lindqvist', email: `cora.${marker}@buynest.test`, phone: '+1 555 010 4477', password: 'CoraCheck2026' }
const yuri = { first_name: 'Yuri', last_name: 'Okafor', email: `yuri.${marker}@buynest.test`, phone: '+1 555 010 4499' }
// Products sold one at a time (minimum order 1)
const FOOTBALL = 137 // American Football: bought in the store (2), one returned
const DRESS = 166 // Tartan Dress: the staff order (2) and Yuri's open order (1)
const files = mkdtempSync(join(tmpdir(), 'buynest-customers-'))

// What this suite changes, recorded first so it can be put back
const restoreStock = await preserveStock()
const settingsBefore = (await admin$('/settings')).body.data
const shopper2 = (await admin$(`/customers?search=${encodeURIComponent(SHOPPER_2.email)}`)).body.data.find((customer) => customer.email === SHOPPER_2.email)
const shopper2Before = await customerOf(shopper2.id)
const general = (await groupsNow()).find((group) => group.is_system)
const made = { customers: [], group: null, admin: null, openOrder: null }

// Leftovers of an interrupted earlier run: marked addresses only
for (const id of [1, shopper2.id]) {
  for (const address of (await admin$(`/customers/${id}/addresses`)).body?.data ?? []) {
    if (isTestLine(address)) await admin$(`/customers/${id}/addresses/${address.id}`, { method: 'DELETE' })
  }
}

const browser = await launch()
const errors = []
const axe = async (page, name) => {
  const violations = await axeViolations(page)
  log(violations.length === 0, `axe ${name}: ${violations.join(', ') || 'no violations'}`)
}
const notice = (page, text) => page.getByRole('status').filter({ hasText: text })
/** A toolbar filter: a <label> holding its name and the <select> (the label's name includes the chosen option). */
/** Waits until the table shows `count` rows (lists keep the old rows while new ones load); answers the row count. */
const rowsSettle = async (page, count) => {
  await page.waitForFunction((n) => document.querySelectorAll('tbody tr').length === n, count, { timeout: 15000 }).catch(() => {})
  return page.locator('tbody tr').count()
}
const filterSelect = (page, name) => page.locator('label.toolbar__select').filter({ has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) }).locator('select')

try {
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true, acceptDownloads: true })
  const admin = watchErrors(await adminCtx.newPage(), errors)
  await adminSignIn(admin, ADMIN_USER)
  await admin.getByRole('heading', { name: 'Overview' }).waitFor()

  // A Viewer admin, for the read-only checks along the way
  const viewerRole = (await admin$('/roles')).body.data.find((role) => role.name === 'Viewer')
  const viewerEmail = `viewer.${run}@buynest.test`
  const viewerPassword = 'ViewerCheck2026pass'
  const viewerMade = await admin$('/admins', { method: 'POST', body: { name: 'Vera Viewer', email: viewerEmail, password: viewerPassword, role_id: viewerRole?.id } })
  made.admin = viewerMade.body?.data?.id ?? null
  log(viewerMade.status === 201, `a Viewer admin is created (${viewerMade.status})`)

  // ---------- 1. The storefront address book (SHOPPER_2) ----------
  const shopCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true })
  const shop = watchErrors(await shopCtx.newPage(), errors)
  await storefrontSignIn(shop, SHOPPER_2)
  await shop.goto(`${BASE}/account/addresses`, { waitUntil: 'networkidle' })
  const book = shop.locator('section.address-book')
  log(await visible(book.getByRole('heading', { name: 'Address book' })), 'account → Address book opens')
  const bookStatus = (text) => book.getByRole('status').filter({ hasText: text }).waitFor({ timeout: 15000 }).catch(() => {})
  const fillAddress = async (form, address) => {
    await form.getByLabel('Street address').fill(address.line1)
    await form.getByLabel('City').fill(address.city)
    await form.getByLabel('State / region').fill(address.state)
    await form.getByLabel('Postal code').fill(address.postalCode)
    await form.getByRole('combobox', { name: 'Country' }).selectOption('United States') // the list loads after the form opens (a text box until then)
  }
  const addAddress = async (address, { makeDefault = false } = {}) => {
    const first = book.getByRole('button', { name: 'Add your first address' })
    await ((await first.isVisible()) ? first : book.getByRole('button', { name: 'Add address' })).click()
    const form = shop.getByRole('form', { name: 'Add an address' })
    await fillAddress(form, address)
    if (makeDefault) {
      await form.getByLabel('Use as my default shipping address').check()
      await form.getByLabel('Use as my default billing address').check()
    }
    await form.getByRole('button', { name: 'Add address' }).click()
    await bookStatus('Address added to your address book.')
  }
  const myAddresses = async () => ((await admin$(`/customers/${shopper2.id}/addresses`)).body?.data ?? []).filter(isTestLine)
  const byLine = (list, address) => list.find((item) => item.line1 === address.line1)
  await addAddress(home, { makeDefault: true })
  await axe(shop, 'address book form')
  await addAddress(work)
  let saved = await myAddresses()
  log(saved.length === 2 && byLine(saved, home)?.is_default_shipping && byLine(saved, home)?.is_default_billing && !byLine(saved, work)?.is_default_shipping, 'two addresses added; the first is the default shipping and billing address')
  const cardOf = (address) => book.locator('li.address-book__card').filter({ hasText: address.line1 })
  log((await cardOf(home).getByText('Default shipping').count()) === 1 && (await cardOf(home).getByText('Default billing').count()) === 1, 'the default address shows both badges')

  // Edit the second one
  await book.getByRole('button', { name: new RegExp(`^Edit the address for .*${work.line1}`) }).click()
  const editForm = shop.getByRole('form', { name: 'Edit address' })
  work.city = 'Tacoma'
  work.postalCode = '98402'
  await editForm.getByLabel('City').fill(work.city)
  await editForm.getByLabel('Postal code').fill(work.postalCode)
  await editForm.getByRole('button', { name: 'Save changes' }).click()
  await bookStatus('Address updated.')
  saved = await myAddresses()
  log(byLine(saved, work)?.city === 'Tacoma' && byLine(saved, work)?.postal_code === '98402', 'edit: the city and postal code are saved')

  // Defaults: the second becomes the default shipping address (the first keeps billing)
  await cardOf(work).getByRole('button', { name: 'Set as default shipping' }).click()
  await bookStatus('Default shipping address changed.')
  saved = await myAddresses()
  log(byLine(saved, work)?.is_default_shipping && !byLine(saved, home)?.is_default_shipping && byLine(saved, home)?.is_default_billing, 'set as default shipping: moves the flag, billing stays on the first')
  log(await visible(cardOf(work).getByText('Default shipping')), 'the badge moved to the second address')

  // Delete one
  await addAddress(spare)
  await book.getByRole('button', { name: new RegExp(`^Delete the address for .*${spare.line1}`) }).click()
  await cardOf(spare).getByRole('button', { name: 'Yes, delete' }).click()
  await bookStatus('Address deleted.')
  saved = await myAddresses()
  log(saved.length === 2 && !byLine(saved, spare), 'delete: a third address is added and deleted again')
  await axe(shop, 'storefront address book')
  const homeId = byLine(saved, home)?.id
  const workId = byLine(saved, work)?.id

  // ---------- 2. A customer group with 15% off; SHOPPER_2 joins it ----------
  await admin.goto(`${BASE}/admin/customer-groups`, { waitUntil: 'networkidle' })
  log(await visible(admin.getByRole('heading', { name: 'Customer groups' })), 'admin Customer groups page')
  await admin.getByRole('button', { name: 'Add group' }).click()
  const groupDialog = admin.getByRole('dialog')
  await groupDialog.getByLabel('Name').fill(groupName)
  await groupDialog.getByLabel('Discount (%)').fill('15')
  await axe(admin, 'customer group dialog')
  await groupDialog.getByRole('button', { name: 'Add group' }).click()
  await notice(admin, `${groupName} added.`).waitFor({ timeout: 15000 }).catch(() => {})
  const group = (await groupsNow()).find((item) => item.name === groupName)
  made.group = group?.id ?? null
  log(group?.discount_percent === '15.00' && /^e2e_group_/.test(group.code), `group added: ${groupName}, code ${group?.code}, 15% off`)
  log(await visible(admin.getByRole('row', { name: new RegExp(groupName) }).getByText('15%')), 'the groups table shows its discount')
  await axe(admin, 'customer groups')

  await admin.goto(`${BASE}/admin/customers/${shopper2.id}`, { waitUntil: 'networkidle' })
  await admin.getByLabel('Customer group').selectOption(String(group.id))
  await admin.getByRole('button', { name: 'Save account' }).click()
  await notice(admin, 'Account saved.').waitFor({ timeout: 15000 }).catch(() => {})
  log((await customerOf(shopper2.id))?.group?.id === group.id, `SHOPPER_2 moved into ${groupName} on the customer page`)

  // Customer list filtered by the group: only SHOPPER_2
  await admin.goto(`${BASE}/admin/customers`, { waitUntil: 'networkidle' })
  await filterSelect(admin, 'Group').selectOption(String(group.id))
  await admin.waitForURL(/groupId=/)
  await rowsSettle(admin, 1)
  const groupRows = admin.locator('tbody tr')
  log((await groupRows.count()) === 1 && (await groupRows.first().innerText()).includes(SHOPPER_2.email), 'customer list: the group filter shows only SHOPPER_2')

  // The store: cart and checkout at the group price
  const football = await productOf(FOOTBALL)
  // SHOPPER_2's cart may hold lines from earlier runs: start empty
  await shop.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
  const cartLines = shop.locator('.cart-page__list .cart-line')
  for (let guard = 0; guard < 20 && (await cartLines.count()) > 0; guard++) {
    await cartLines.first().getByRole('button', { name: /^Remove / }).click()
    await shop.waitForTimeout(300)
  }
  const groupPrice = Math.round(cents(football.sale_price) * 0.85) / 100
  await shop.goto(`${BASE}/products/${FOOTBALL}`, { waitUntil: 'networkidle' })
  const details = shop.locator('.product-details')
  await details.getByRole('button', { name: 'Increase quantity' }).click()
  await details.getByRole('button', { name: /add to cart/i }).first().click()
  const miniCart = shop.getByRole('dialog')
  if (await visible(miniCart, 3000)) {
    await shop.keyboard.press('Escape')
    await miniCart.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  }
  await shop.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
  await cartLines.first().waitFor({ timeout: 15000 }).catch(() => {})
  for (let guard = 0; guard < 10; guard++) {
    const other = cartLines.filter({ hasNotText: football.name }).first()
    if ((await other.count()) === 0) break
    await other.getByRole('button', { name: /^Remove / }).click()
    await shop.waitForTimeout(300)
  }
  const cartNote = shop.locator('main .group-discount')
  log(await visible(cartNote.filter({ hasText: `${groupName} price: 15% off` })), `cart: "${(await cartNote.first().innerText().catch(() => '')).trim()}"`)
  await axe(shop, 'cart with a group discount')

  await shop.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
  const placeOrder = shop.getByRole('button', { name: /^Place order · / })
  await placeOrder.waitFor({ timeout: 20000 })
  const field = (name) => shop.locator(`[name="${name}"]`)
  await shop.waitForFunction((line) => document.querySelector('[name="shipping.line1"]')?.value === line, work.line1, { timeout: 15000 }).catch(() => {})
  log((await field('shipping.line1').inputValue()) === work.line1 && (await field('shipping.city').inputValue()) === 'Tacoma', 'checkout pre-fills the default shipping address')
  log(!(await shop.getByLabel('Same as shipping address').isChecked()) && (await field('billing.line1').inputValue()) === home.line1, 'and the default billing address (a different one) separately')
  const picker = shop.getByLabel('Saved shipping addresses')
  log((await picker.inputValue()) === String(workId), 'the saved-address picker shows which saved address is used')
  log(!(await shop.getByLabel('Save this address to my address book').isVisible()), 'a saved address is not offered to be saved again')
  await picker.selectOption(String(homeId))
  log((await field('shipping.line1').inputValue()) === home.line1 && (await field('shipping.city').inputValue()) === 'Portland', 'picking another saved address fills the fields with it')
  // A new address, saved to the book with the order
  await field('shipping.line1').fill(fresh.line1)
  await field('shipping.city').fill(fresh.city)
  await field('shipping.postalCode').fill(fresh.postalCode)
  log((await picker.inputValue()) === '', 'typing a new address: the picker says "A new address"')
  const saveBox = shop.getByLabel('Save this address to my address book')
  log(await visible(saveBox, 5000), '"Save this address to my address book" is offered')
  await saveBox.check()
  if (!(await field('phone').inputValue())) await field('phone').fill('+1 555 010 0101')
  const summaryNote = shop.locator('.checkout__summary .group-discount')
  log(await visible(summaryNote.filter({ hasText: `${groupName} price: 15% off` })), 'checkout summary shows the group discount')
  await axe(shop, 'checkout with saved addresses')
  await shop.waitForFunction(() => /^Place order · /.test(document.querySelector('button[form="checkout-form"]')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {})
  const shownTotal = (await placeOrder.innerText()).match(/\$[\d,.]+/)?.[0]
  await placeOrder.click()
  await shop.waitForURL(/\/order-confirmation\/BN-/, { timeout: 30000 }).catch(() => {})
  const orderA = shop.url().split('/').pop()
  log(/^BN-/.test(orderA), `store order placed: ${orderA}`)
  let order = await orderOf(orderA)
  const line = order?.items?.[0]
  log(
    order?.customer_group === groupName && line?.group_discount_percent === 15 && line.sale_price === groupPrice.toFixed(2) && line.quantity === 2,
    `the order line has the group price: ${usd(football.sale_price)} − 15% = ${line?.sale_price} × ${line?.quantity}`,
  )
  log(usd(order?.totals?.total) === shownTotal, `the total shown at checkout matches the server's order (${shownTotal} = ${order?.totals?.total})`)
  log(order?.shipping_address?.line1 === fresh.line1 && order?.billing_address?.line1 === home.line1, 'shipped to the new address, billed to the saved one')
  saved = await myAddresses()
  log(saved.length === 3 && Boolean(byLine(saved, fresh)), '"Save this address": the new address is in the book after the order')
  const footballAfterOrder = (await productOf(FOOTBALL)).stock_quantity

  // ---------- 4. An order created by staff (Create order) ----------
  await admin.goto(`${BASE}/admin/orders`, { waitUntil: 'networkidle' })
  await admin.getByRole('link', { name: 'Create order' }).click()
  await admin.waitForURL(/\/admin\/orders\/new/)
  log(await visible(admin.getByRole('heading', { name: 'Create order' })), 'Orders → Create order opens the form')
  const customerPanel = admin.locator('section[aria-labelledby="co-customer"]')
  await customerPanel.getByLabel('Find a customer').fill(SHOPPER_2.email)
  await customerPanel.getByRole('button', { name: 'Search' }).click()
  await customerPanel.getByRole('button', { name: /^Choose / }).first().click()
  log(await visible(customerPanel.getByText(`${groupName}: 15% off every product`)), 'customer search: SHOPPER_2 chosen, with the group discount')
  const itemsPanel = admin.locator('section[aria-labelledby="co-items"]')
  await itemsPanel.getByLabel('Find a product').fill('Tartan Dress')
  await itemsPanel.getByRole('button', { name: 'Search' }).click()
  await itemsPanel.getByRole('button', { name: 'Add Tartan Dress', exact: true }).click()
  await itemsPanel.getByLabel('Quantity of Tartan Dress').fill('2')
  log((await itemsPanel.getByLabel('Quantity of Tartan Dress').inputValue()) === '2', 'product search: Tartan Dress added, quantity 2')
  const shippingPanel = admin.locator('section[aria-labelledby="co-shipping"]')
  log((await shippingPanel.getByLabel('Address', { exact: true }).inputValue()) === work.line1, "the customer's default shipping address is filled in")
  await shippingPanel.getByLabel('Use a saved address').selectOption(String(homeId))
  log((await shippingPanel.getByLabel('Address', { exact: true }).inputValue()) === home.line1, 'a saved address is chosen from the list')
  const payment = admin.getByLabel('Payment method')
  const paymentOptions = await payment.locator('option').allInnerTexts()
  log(paymentOptions.some((text) => /Cash \(staff only\)/.test(text)) && paymentOptions.some((text) => /Bank transfer \(staff only\)/.test(text)), `payment offers the staff-only methods (${paymentOptions.filter((text) => /staff/.test(text)).join(', ')})`)
  await payment.selectOption('cash')
  await admin.getByLabel('Order note (optional)').fill(`Phone order, ${marker}`)
  const dress = await productOf(DRESS)
  const quoteBody = {
    customer_id: shopper2.id,
    items: [{ product_id: DRESS, quantity: 2 }],
    shipping_address: { first_name: 'Ben', last_name: 'Shopper', line1: home.line1, city: home.city, state: home.state, postal_code: home.postalCode, country: 'United States' },
    shipping_method: 'standard',
    payment_method: 'cash',
  }
  const quote = (await admin$('/orders/quote', { method: 'POST', body: quoteBody })).body?.data
  const totalsPanel = admin.locator('aside.create-order__summary')
  await totalsPanel.locator('.totals').getByText(usd(quote?.totals?.total), { exact: true }).waitFor({ timeout: 15000 }).catch(() => {})
  log(await visible(totalsPanel.locator('.totals strong').filter({ hasText: usd(quote?.totals?.total) }), 3000), `live totals from the server: ${usd(quote?.totals?.total)} (2 × ${usd(dress.sale_price)} − 15%, shipping, tax)`)
  log(await visible(totalsPanel.getByText(`${groupName} price: 15% off every product`)), 'the totals name the group discount')
  await axe(admin, 'create order')
  await admin.getByRole('button', { name: 'Place order' }).click()
  await admin.waitForURL(/\/admin\/orders\/BN-/, { timeout: 30000 }).catch(() => {})
  const orderB = admin.url().split('/').pop()
  log(/^BN-/.test(orderB) && (await visible(admin.getByText(`Order ${orderB} placed`))), `staff order placed: ${orderB}`)
  order = await orderOf(orderB)
  log(order?.source === 'admin' && order.payment_method === 'cash' && order.status === 'processing' && order.created_by_admin?.name === ADMIN_USER.name, `saved with source "admin", cash, processing, by ${order?.created_by_admin?.name}`)
  log(order?.totals?.total === quote?.totals?.total && order?.items?.[0]?.group_discount_percent === 15, `the order's total equals the live quote (${order?.totals?.total})`)
  log((order?.history ?? []).some((entry) => entry.note === `Phone order, ${marker}` && !entry.customer_notified), 'the staff note is in the history, not sent to the customer')

  await admin.goto(`${BASE}/admin/orders?q=${encodeURIComponent(SHOPPER_2.email)}`, { waitUntil: 'networkidle' })
  const rowOf = (number) => admin.locator('tbody tr').filter({ has: admin.getByRole('link', { name: number, exact: true }) })
  await rowOf(orderB).waitFor({ timeout: 15000 }).catch(() => {})
  log((await rowOf(orderB).innerText()).includes('Admin') && (await rowOf(orderA).innerText()).includes('Storefront'), 'order grid Source column: Admin for the staff order, Storefront for the store order')
  await shop.goto(`${BASE}/account/orders`, { waitUntil: 'networkidle' })
  log(await visible(shop.locator('main').getByText(orderB)), "the staff order is in the customer's order history")

  // The group can't go while in use; back to General, then it can
  await admin.goto(`${BASE}/admin/customer-groups`, { waitUntil: 'networkidle' })
  await admin.getByRole('button', { name: `Delete ${groupName}` }).click()
  await admin.getByRole('dialog').getByRole('button', { name: 'Delete group' }).click()
  const inUse = admin.getByRole('dialog').getByRole('alert')
  log(await visible(inUse.filter({ hasText: /1 customer/ })), `delete refused while in use: "${(await inUse.innerText().catch(() => '')).trim()}"`)
  await admin.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await admin.goto(`${BASE}/admin/customers/${shopper2.id}`, { waitUntil: 'networkidle' })
  await admin.getByLabel('Customer group').selectOption(String(general.id))
  await admin.getByRole('button', { name: 'Save account' }).click()
  await notice(admin, 'Account saved.').waitFor({ timeout: 15000 }).catch(() => {})
  log((await customerOf(shopper2.id))?.group?.id === general.id, 'SHOPPER_2 moved back to General')
  await admin.goto(`${BASE}/admin/customer-groups`, { waitUntil: 'networkidle' })
  await admin.getByRole('button', { name: `Delete ${groupName}` }).click()
  await admin.getByRole('dialog').getByRole('button', { name: 'Delete group' }).click()
  await admin.getByRole('row', { name: new RegExp(groupName) }).waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  const groupLeft = (await groupsNow()).some((item) => item.id === group.id)
  if (!groupLeft) made.group = null
  log(!groupLeft, 'the empty group is deleted')

  // ---------- 5. Mass actions on the order grid, packing slips, shipments ----------
  await admin.goto(`${BASE}/admin/orders?q=${encodeURIComponent(SHOPPER_2.email)}`, { waitUntil: 'networkidle' })
  await rowOf(orderA).waitFor({ timeout: 15000 }).catch(() => {})
  const bar = admin.locator('form.bulk-bar')
  const summary = admin.locator('.bulk-summary')
  const bulk = async (action, fill) => {
    await admin.getByRole('checkbox', { name: `Select order ${orderA}` }).check()
    await admin.getByRole('checkbox', { name: `Select order ${orderB}` }).check()
    await bar.getByLabel('Action').selectOption(action)
    if (fill) await fill()
    await bar.getByRole('button', { name: 'Apply' }).click()
  }
  await admin.getByRole('checkbox', { name: `Select order ${orderA}` }).check()
  await admin.getByRole('checkbox', { name: `Select order ${orderB}` }).check()
  log(await visible(bar.getByText(/2\s*selected/)), 'ticking the two suite orders shows the bulk bar ("2 selected")')
  await axe(admin, 'order grid with the bulk bar')
  await bar.getByRole('button', { name: 'Clear selection' }).click()
  await bulk('invoice')
  log(await visible(summary.filter({ hasText: '2 orders invoiced.' })), 'bulk invoice: "2 orders invoiced."')
  log((await orderOf(orderA))?.payment_status === 'paid' && (await orderOf(orderB))?.payment_status === 'paid', 'both orders are paid')
  await bulk('invoice')
  log(await visible(summary.filter({ hasText: '0 orders invoiced. 2 skipped:' })), 'bulk invoice again: "0 orders invoiced. 2 skipped:"')
  log((await summary.getByRole('listitem').count()) === 2 && /already been invoiced/.test(await summary.getByRole('listitem').first().innerText()), `each skipped order with its reason ("${(await summary.getByRole('listitem').first().innerText().catch(() => '')).trim()}")`)
  await bulk('ship', () => bar.getByLabel('Carrier').selectOption('ups'))
  log(await visible(summary.filter({ hasText: '2 orders shipped.' })), 'bulk ship (UPS): "2 orders shipped."')
  const shippedA = await orderOf(orderA)
  log(shippedA?.status === 'shipped' && (await orderOf(orderB))?.status === 'shipped' && shippedA.shipments?.length === 1, 'both orders are shipped, one shipment each')
  await bulk('print-packing-slips')
  await admin.waitForURL(/\/admin\/print\/packing-slips\?orders=/, { timeout: 15000 }).catch(() => {})
  const slips = admin.locator('article.print-doc')
  await slips.nth(1).waitFor({ timeout: 15000 }).catch(() => {})
  const slipText = await admin.locator('main').innerText()
  log((await slips.count()) === 2 && slipText.includes(football.name) && slipText.includes('Tartan Dress'), 'print packing slips: a page with both orders opens')
  log(!/\$\s?\d/.test(slipText), 'packing slips show no prices')
  log(await visible(admin.getByRole('button', { name: 'Print' })), 'with a Print button')
  await axe(admin, 'packing slips print page')

  const shipmentNumber = shippedA?.shipments?.[0]?.number
  await admin.goto(`${BASE}/admin/shipments`, { waitUntil: 'networkidle' })
  await admin.getByLabel('Search shipments').fill(orderA)
  await admin.getByRole('search').getByRole('button', { name: 'Search' }).click()
  await admin.waitForURL(/q=BN-/)
  await admin.waitForLoadState('networkidle')
  const shipmentRows = admin.locator('tbody tr')
  log((await rowsSettle(admin, 1)) === 1 && (await shipmentRows.first().innerText()).includes(shipmentNumber), `Shipments: searching ${orderA} finds ${shipmentNumber}`)
  await axe(admin, 'shipments')
  await shipmentRows.first().getByRole('link', { name: shipmentNumber }).click()
  log(await visible(admin.getByRole('heading', { name: `Shipment ${shipmentNumber}` })), 'shipment detail opens')
  const shipmentText = await admin.locator('main').innerText()
  log(shipmentText.includes(football.name) && shipmentText.includes('UPS') && shipmentText.includes(orderA), 'shipment detail: items, carrier, and order')
  await axe(admin, 'shipment detail')

  // ---------- 6. Returns end to end ----------
  await shop.goto(`${BASE}/account/orders/${orderA}`, { waitUntil: 'networkidle' })
  await shop.getByRole('button', { name: 'Request a return' }).click()
  await shop.getByLabel(`Quantity of ${football.name} to return`).selectOption('1')
  await shop.getByLabel('Reason').selectOption('Damaged')
  await shop.getByLabel('Comment (optional)').fill(`The box arrived crushed, ${marker}.`)
  await axe(shop, 'return request form')
  await shop.getByRole('button', { name: 'Send return request' }).click()
  const requested = shop.getByRole('status').filter({ hasText: /Return RMA-\d+ was requested/ })
  log(await visible(requested), 'customer: return requested from the account order page')
  const rma = (await requested.innerText().catch(() => '')).match(/RMA-\d+/)?.[0]
  let rmaData = rma && (await returnOf(rma))
  log(rmaData?.status === 'requested' && rmaData.order_number === orderA && rmaData.items?.[0]?.quantity === 1 && rmaData.reason === 'Damaged', `${rma}: requested, 1 × ${football.name}, Damaged`)
  log(await waitForEmail(`We received your return request (${rma})`), 'email: "We received your return request"')

  await admin.goto(`${BASE}/admin/returns`, { waitUntil: 'networkidle' })
  await admin.getByLabel('Search returns').fill(rma)
  await admin.getByRole('search').getByRole('button', { name: 'Search' }).click()
  await admin.waitForURL(/q=RMA-/)
  await admin.waitForLoadState('networkidle')
  const returnRow = admin.locator('tbody tr').filter({ hasText: rma })
  await rowsSettle(admin, 1)
  log((await returnRow.count()) === 1 && (await returnRow.innerText()).includes('Requested') && (await returnRow.innerText()).includes(orderA), 'admin Returns list shows it as Requested')
  await axe(admin, 'returns list')
  await returnRow.getByRole('link', { name: rma }).click()
  await admin.getByRole('heading', { name: `Return ${rma}` }).waitFor({ timeout: 15000 })
  await axe(admin, 'return detail')
  const approvalNote = `Please use the prepaid label in the email, ${marker}.`
  await admin.getByRole('button', { name: 'Approve' }).click()
  const statusDialog = admin.getByRole('dialog')
  await statusDialog.getByLabel('Note (optional)').fill(approvalNote)
  log(await statusDialog.getByLabel('Email the customer').isChecked(), 'approve dialog: emails the customer by default')
  await axe(admin, 'approve return dialog')
  await statusDialog.getByRole('button', { name: 'Approve' }).click()
  await notice(admin, `Return ${rma} approved.`).waitFor({ timeout: 15000 }).catch(() => {})
  rmaData = await returnOf(rma)
  log(rmaData?.status === 'approved' && rmaData.admin_note === approvalNote, 'approved with the note')
  log(await waitForEmail(`Your return was approved (${rma})`), 'email: "Your return was approved"')

  // The Viewer sees the approved return, read-only
  const viewerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true })
  const view = watchErrors(await viewerCtx.newPage(), errors)
  await adminSignIn(view, { email: viewerEmail, password: viewerPassword })
  await view.waitForURL(/\/admin\/(?!login)/, { timeout: 15000 }).catch(() => {})
  await view.goto(`${BASE}/admin/returns/${rma}`, { waitUntil: 'networkidle' })
  log(await visible(view.getByText('Your role can view this return but not change it.')), 'Viewer: the return is read-only ("Your role can view this return but not change it.")')
  log((await view.getByRole('button', { name: /^(Mark as received|Approve|Reject|Close|Refund this return)$/ }).count()) === 0, 'Viewer: no status or refund buttons')

  await shop.goto(`${BASE}/account/returns/${rma}`, { waitUntil: 'networkidle' })
  log(await visible(shop.getByText(approvalNote)), 'customer: the return page shows the note ("Message from us")')
  log(await visible(shop.locator('main').getByText('Approved', { exact: true })), 'customer: status Approved')

  const stockBeforeReceive = (await productOf(FOOTBALL)).stock_quantity
  await admin.getByRole('button', { name: 'Mark as received' }).click()
  await statusDialog.getByLabel(`Condition of ${football.name}`).selectOption('opened')
  log(await statusDialog.getByLabel('Put the returned items back into stock').isChecked(), 'receive dialog: restock is ticked')
  await axe(admin, 'receive return dialog')
  await statusDialog.getByRole('button', { name: 'Mark as received' }).click()
  await notice(admin, `Return ${rma} marked as received. The items are back in stock.`).waitFor({ timeout: 15000 }).catch(() => {})
  rmaData = await returnOf(rma)
  const stockAfterReceive = (await productOf(FOOTBALL)).stock_quantity
  log(rmaData?.status === 'received' && rmaData.restocked === true && rmaData.items?.[0]?.condition === 'opened', 'received: condition Opened, restocked')
  log(stockAfterReceive === stockBeforeReceive + 1, `stock +1 on receipt (${stockBeforeReceive} → ${stockAfterReceive})`)
  log(await waitForEmail(`We received your returned items (${rma})`), 'email: "We received your returned items"')

  await admin.getByRole('button', { name: 'Refund this return' }).click()
  const refund = admin.getByRole('dialog', { name: `Refund return ${rma}` })
  log(await visible(refund), '"Refund this return" opens the credit memo dialog for the return')
  const refundQuantity = refund.getByLabel(new RegExp(`^Quantity of ${football.name} to refund`))
  log((await refundQuantity.inputValue()) === '1', 'pre-filled with the returned quantity (1)')
  log(!(await refund.getByLabel('Return the refunded items to stock').isChecked()) && (await visible(refund.getByText("they won't be added twice"))), 'restock unticked, with "they won\'t be added twice"')
  await axe(admin, 'refund return dialog')
  await refund.getByRole('button', { name: /^Refund \$/ }).click()
  await notice(admin, `Return ${rma} is now refunded.`).waitFor({ timeout: 15000 }).catch(() => {})
  rmaData = await returnOf(rma)
  log(rmaData?.status === 'refunded' && rmaData.credit_memo?.number && rmaData.resolution === 'refund', `the credit memo ${rmaData?.credit_memo?.number} sets the return to refunded`)
  const memo = (await orderOf(orderA))?.credit_memos?.find((item) => item.number === rmaData?.credit_memo?.number)
  log(memo?.return_number === rma && memo.restocked === false, 'the memo is linked to the return and did not restock')
  log((await productOf(FOOTBALL)).stock_quantity === stockAfterReceive && stockAfterReceive === footballAfterOrder + 1, `stock restocked exactly once (${footballAfterOrder} after the order → ${(await productOf(FOOTBALL)).stock_quantity})`)
  log(await visible(admin.getByText(`Refunded with ${rmaData?.credit_memo?.number}`)), 'return detail links the credit memo')
  log(await waitForEmail(`Your return was refunded (${rma})`), 'email: "Your return was refunded"')

  await shop.goto(`${BASE}/account/returns`, { waitUntil: 'networkidle' })
  const myReturn = shop.locator('.orders__item').filter({ hasText: rma })
  log(await visible(myReturn.getByText('Refunded')), "customer's Returns page shows Refunded")
  await axe(shop, 'storefront returns')
  await myReturn.getByRole('link', { name: `Return ${rma}` }).click()
  await shop.getByRole('heading', { name: `Return ${rma}` }).waitFor({ timeout: 15000 }).catch(() => {})
  log(await visible(shop.getByText(rmaData?.credit_memo?.number ?? 'CM-?')), 'customer return detail shows the refund')
  await axe(shop, 'storefront return detail')

  // ---------- 3. Customer management in the admin ----------
  await admin.goto(`${BASE}/admin/customers`, { waitUntil: 'networkidle' })
  await admin.getByRole('button', { name: 'Add customer' }).click()
  const addDialog = admin.getByRole('dialog', { name: 'Add customer' })
  await addDialog.getByLabel('First name').fill(cora.firstName)
  await addDialog.getByLabel('Last name').fill(cora.lastName)
  await addDialog.getByLabel('Email').fill(cora.email)
  await addDialog.getByLabel('Phone').fill(cora.phone)
  await axe(admin, 'add customer dialog')
  await addDialog.getByRole('button', { name: 'Add customer' }).click()
  await admin.waitForURL(/\/admin\/customers\/\d+$/, { timeout: 15000 }).catch(() => {})
  const coraId = Number(admin.url().split('/').pop())
  if (Number.isInteger(coraId)) made.customers.push(coraId)
  log(Number.isInteger(coraId) && (await visible(admin.getByText(`${cora.firstName} ${cora.lastName} added.`))), `Add customer: ${cora.email} created, their page opens (#${coraId})`)
  let coraData = await customerOf(coraId)
  log(coraData?.created_by_admin === true && coraData.email_verified === false && coraData.group?.id === general.id, 'created by staff, email not confirmed yet, in General')
  const setPassword = await latestCode(cora.email)
  log(setPassword.subject === 'Set your BuyNest password', `"${setPassword.subject}" email in the dev inbox`)

  // Tabs: the keyboard moves between them
  const tab = (name) => admin.getByRole('tab', { name })
  await tab('Account').focus()
  await admin.keyboard.press('ArrowRight')
  log((await tab('Addresses').getAttribute('aria-selected')) === 'true' && (await tab('Addresses').evaluate((node) => node === document.activeElement)), 'tabs: → selects and focuses Addresses')
  await admin.keyboard.press('End')
  log((await tab('Notes').getAttribute('aria-selected')) === 'true', 'tabs: End selects Notes')
  await admin.keyboard.press('ArrowRight')
  log((await tab('Account').getAttribute('aria-selected')) === 'true', 'tabs: → on the last wraps to Account')
  await admin.keyboard.press('ArrowLeft')
  await admin.keyboard.press('Home')
  log((await tab('Account').getAttribute('aria-selected')) === 'true' && (await tab('Account').evaluate((node) => node === document.activeElement)), 'tabs: Home goes back to Account')

  // Account: name and phone
  const accountForm = admin.getByRole('form', { name: 'Account' })
  await accountForm.getByLabel('First name').fill('Corinne')
  await accountForm.getByLabel('Phone').fill('+1 555 010 4488')
  await accountForm.getByRole('button', { name: 'Save account' }).click()
  await notice(admin, 'Account saved.').waitFor({ timeout: 15000 }).catch(() => {})
  coraData = await customerOf(coraId)
  log(coraData?.first_name === 'Corinne' && coraData.phone === '+15550104488', `account edit: name and phone saved (${coraData?.first_name}, ${coraData?.phone})`)
  await axe(admin, 'customer page, Account tab')

  // Addresses
  await tab('Addresses').click()
  await admin.getByRole('button', { name: 'Add address' }).click()
  const addressDialog = admin.getByRole('dialog', { name: 'Add address' })
  await addressDialog.getByLabel('Address', { exact: true }).fill(`5 Birch Row ${marker}`)
  await addressDialog.getByLabel('City').fill('Albany')
  await addressDialog.getByLabel('State or region (optional)').fill('New York')
  await addressDialog.getByLabel('Postal code').fill('12207')
  await addressDialog.getByRole('combobox', { name: 'Country' }).selectOption('United States') // the list loads after the form opens (a text box until then)
  await axe(admin, 'customer address dialog')
  await addressDialog.getByRole('button', { name: 'Add address' }).click()
  await notice(admin, 'Address added.').waitFor({ timeout: 15000 }).catch(() => {})
  coraData = await customerOf(coraId)
  log(coraData?.addresses?.length === 1 && coraData.addresses[0].is_default_shipping && coraData.addresses[0].phone === '+15550104488', 'address added in the admin (the first is the default; phone from the account)')
  log(await visible(admin.getByRole('tabpanel').getByText(`5 Birch Row ${marker}`)), 'the Addresses tab lists it')
  await axe(admin, 'customer page, Addresses tab')

  // Orders and notes
  await tab('Orders').click()
  log(await visible(admin.getByRole('tabpanel').getByText('No orders yet.')), 'Orders tab: no orders yet')
  await tab('Notes').click()
  const noteText = `Prefers a call before delivery, ${marker}.`
  await admin.getByLabel('New note').fill(noteText)
  await admin.getByRole('button', { name: 'Add note' }).click()
  await notice(admin, 'Note added.').waitFor({ timeout: 15000 }).catch(() => {})
  coraData = await customerOf(coraId)
  log(coraData?.notes?.[0]?.body === noteText && coraData.notes[0].admin?.name === ADMIN_USER.name, `staff note added, by ${coraData?.notes?.[0]?.admin?.name}`)
  log(await visible(admin.getByRole('tabpanel').getByText(noteText)), 'Notes tab lists it')
  await axe(admin, 'customer page, Notes tab')

  // The customer sets a password with the emailed code, and signs in
  const coraCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true })
  const coraPage = watchErrors(await coraCtx.newPage(), errors)
  await coraPage.goto(`${BASE}/forgot-password`, { waitUntil: 'networkidle' })
  await coraPage.getByLabel('Email').fill(cora.email)
  await coraPage.getByRole('button', { name: 'Send code' }).click()
  await coraPage.getByRole('heading', { name: 'Choose a new password' }).waitFor({ timeout: 15000 })
  const code = await latestCode(cora.email)
  await coraPage.getByLabel('6-digit code').fill(code.code)
  await coraPage.getByLabel('New password', { exact: true }).fill(cora.password)
  await coraPage.getByLabel('Confirm new password').fill(cora.password)
  await coraPage.getByRole('button', { name: 'Save new password' }).click()
  log(await visible(coraPage.getByText('Your password has been changed')), `password set with the emailed code ("${code.subject}")`)
  await storefrontSignIn(coraPage, cora)
  log(await visible(coraPage.getByRole('heading', { name: /Hi, Corinne/ })), 'the new customer signs in to the store')
  log((await customerOf(coraId))?.email_verified === true, 'and the email now counts as confirmed')
  await coraCtx.close()

  // Customer list: search, email filter
  await admin.goto(`${BASE}/admin/customers`, { waitUntil: 'networkidle' })
  await admin.getByLabel('Search customers').fill(marker)
  await admin.getByRole('search').getByRole('button', { name: 'Search' }).click()
  await admin.waitForURL(/q=/)
  await admin.waitForLoadState('networkidle')
  log((await rowsSettle(admin, 1)) === 1 && (await admin.locator('tbody tr').first().innerText()).includes(cora.email), 'customer list: search finds the test customer')
  await filterSelect(admin, 'Email').selectOption('no')
  await admin.waitForURL(/verified=no/)
  await admin.waitForLoadState('networkidle')
  log(await visible(admin.getByText('No customers match.')), 'filter "Not confirmed": the (now confirmed) customer is not listed')
  await filterSelect(admin, 'Email').selectOption('yes')
  await admin.waitForURL(/verified=yes/)
  await admin.waitForLoadState('networkidle')
  log((await rowsSettle(admin, 1)) === 1, 'filter "Confirmed": listed')
  await filterSelect(admin, 'Email').selectOption('')
  await admin.waitForLoadState('networkidle')
  await axe(admin, 'customers list with filters')

  // CSV export with the filters
  const [download] = await Promise.all([admin.waitForEvent('download', { timeout: 20000 }), admin.getByRole('link', { name: 'Export CSV' }).click()])
  const csvPath = join(files, 'customers.csv')
  await download.saveAs(csvPath)
  const csv = readFileSync(csvPath, 'utf8').replace(/^﻿/, '')
  const [header, ...csvRows] = csv.trim().split(/\r?\n/)
  log(/^customers-\d{4}-\d{2}-\d{2}\.csv$/.test(download.suggestedFilename()), `export downloads ${download.suggestedFilename()}`)
  log(header.startsWith('id,first_name,last_name,email,phone,group,status') && csvRows.length === 1 && csvRows[0].includes(cora.email), 'export: the header and the one filtered customer')
  log(csvRows[0]?.includes("'+15550104488"), 'export: the phone number is guarded against spreadsheet formulas')

  // Block and unblock
  await admin.goto(`${BASE}/admin/customers/${coraId}`, { waitUntil: 'networkidle' })
  await admin.getByRole('button', { name: 'Block', exact: true }).click()
  await admin.getByRole('dialog').getByRole('button', { name: 'Block account' }).click()
  await notice(admin, 'is blocked and has been signed out everywhere').waitFor({ timeout: 15000 }).catch(() => {})
  log((await customerOf(coraId))?.status === 'blocked', 'block: the account is blocked')
  const blockedCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true })
  const blockedPage = await blockedCtx.newPage()
  await blockedPage.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await blockedPage.getByLabel('Email').fill(cora.email)
  await blockedPage.getByLabel('Password', { exact: true }).fill(cora.password)
  await blockedPage.getByRole('button', { name: /^sign in$/i }).click()
  const blockedAlert = blockedPage.getByRole('alert')
  log(await visible(blockedAlert), `a blocked customer can't sign in ("${(await blockedAlert.first().innerText().catch(() => '')).trim()}")`)
  log(new URL(blockedPage.url()).pathname === '/login', 'and stays on the sign-in page')
  await blockedCtx.close()
  await admin.goto(`${BASE}/admin/customers?status=blocked&q=${marker}`, { waitUntil: 'networkidle' })
  log((await admin.locator('tbody tr').filter({ hasText: cora.email }).count()) === 1, 'customer list: the Blocked filter lists them')
  await admin.goto(`${BASE}/admin/customers/${coraId}`, { waitUntil: 'networkidle' })
  await admin.getByRole('button', { name: 'Unblock' }).click()
  await notice(admin, 'can sign in again.').waitFor({ timeout: 15000 }).catch(() => {})
  log((await customerOf(coraId))?.is_active === true, 'unblock: active again')

  // Delete: refused with an open order, allowed without orders
  const yuriMade = await admin$('/customers', { method: 'POST', body: yuri })
  const yuriId = yuriMade.body?.data?.id
  if (yuriId) made.customers.push(yuriId)
  const openOrder = await admin$('/orders', {
    method: 'POST',
    body: {
      customer_id: yuriId,
      items: [{ product_id: DRESS, quantity: 1 }],
      shipping_address: { first_name: 'Yuri', last_name: 'Okafor', line1: '3 Elm Street', city: 'Austin', state: 'Texas', postal_code: '73301', country: 'United States' },
      same_as_shipping: true,
      shipping_method: 'standard',
      payment_method: 'cash',
      notify_customer: false,
    },
  })
  made.openOrder = openOrder.body?.data?.number ?? null
  log(yuriMade.status === 201 && openOrder.status === 201, `a second test customer with an open order (${made.openOrder})`)
  await admin.goto(`${BASE}/admin/customers/${yuriId}`, { waitUntil: 'networkidle' })
  await admin.getByRole('button', { name: 'Delete', exact: true }).click()
  const deleteDialog = admin.getByRole('dialog', { name: /^Delete Yuri/ })
  await deleteDialog.getByRole('button', { name: 'Delete customer' }).click()
  const refused = deleteDialog.getByRole('alert')
  log(await visible(refused.filter({ hasText: /open order/ })), `delete refused while an order is open: "${(await refused.innerText().catch(() => '')).trim().slice(0, 80)}…"`)
  log((await customerOf(yuriId))?.id === yuriId, 'and the customer is still there')
  await deleteDialog.getByRole('button', { name: 'Cancel' }).click()

  await admin.goto(`${BASE}/admin/customers/${coraId}`, { waitUntil: 'networkidle' })
  await admin.getByRole('button', { name: 'Delete', exact: true }).click()
  await axe(admin, 'delete customer dialog')
  await admin.getByRole('dialog', { name: /^Delete Corinne/ }).getByRole('button', { name: 'Delete customer' }).click()
  await admin.waitForURL(/\/admin\/customers$/, { timeout: 15000 }).catch(() => {})
  log(await visible(admin.getByText("account was deleted. Their orders and reviews are kept.")), 'delete: back to the list with "account was deleted"')
  const gone = await admin$(`/customers/${coraId}`)
  if (gone.status === 404) made.customers = made.customers.filter((id) => id !== coraId)
  log(gone.status === 404, 'the customer without orders is deleted (404)')

  // ---------- 7. Settings → Returns ----------
  await admin.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' })
  const windowField = admin.getByLabel('Return window (days)')
  // The "Returns saved." notice stays from the first save: wait for the server's answer instead.
  const saveReturns = () =>
    Promise.all([
      admin.waitForResponse((response) => response.url().includes('/api/admin/settings') && response.request().method() === 'PATCH', { timeout: 15000 }).catch(() => {}),
      admin.getByRole('button', { name: 'Save returns' }).click(),
    ])
  const windowBefore = settingsBefore.returns.return_window_days
  await windowField.fill(String(windowBefore === 45 ? 46 : 45))
  await saveReturns()
  const changedWindow = (await admin$('/settings')).body.data.returns.return_window_days
  const storeWindow = (await api('/api/v1/store')).body?.data?.return_window_days
  log(changedWindow === (windowBefore === 45 ? 46 : 45) && storeWindow === changedWindow, `Settings → Returns: window changed to ${changedWindow} days (the store says ${storeWindow})`)
  await axe(admin, 'settings with Returns')
  await windowField.fill(String(windowBefore))
  await saveReturns()
  log((await admin$('/settings')).body.data.returns.return_window_days === windowBefore, `and restored to ${windowBefore} days`)

  // ---------- 8. The Viewer admin ----------
  await view.goto(`${BASE}/admin/returns`, { waitUntil: 'networkidle' })
  const viewNav = view.getByRole('navigation').first()
  log(await visible(viewNav.getByRole('link', { name: 'Returns' })), 'Viewer: Returns in the menu')
  log(await visible(view.locator('tbody tr').filter({ hasText: rma })), 'Viewer: the returns list')
  await view.goto(`${BASE}/admin/orders?q=${encodeURIComponent(SHOPPER_2.email)}`, { waitUntil: 'networkidle' })
  await view.locator('tbody tr').first().waitFor({ timeout: 15000 }).catch(() => {})
  log(!(await view.getByRole('link', { name: 'Create order' }).isVisible()), 'Viewer: no Create order on the order grid')
  await view.getByRole('checkbox', { name: `Select order ${orderA}` }).check()
  const viewerActions = await view.locator('form.bulk-bar').getByLabel('Action').locator('option').allInnerTexts()
  log(!viewerActions.some((text) => /^(Invoice|Ship…|Cancel)$/.test(text)) && viewerActions.includes('Print packing slips'), `Viewer: bulk actions only print (${viewerActions.filter((text) => text !== 'Choose…').join(', ')})`)
  await view.goto(`${BASE}/admin/customers/${shopper2.id}`, { waitUntil: 'networkidle' })
  await view.getByRole('tab', { name: 'Account' }).waitFor({ timeout: 15000 }).catch(() => {})
  log(
    !(await view.getByRole('link', { name: 'Create order' }).isVisible()) && (await view.getByRole('button', { name: /^(Delete|Block|Send password reset|Save account)$/ }).count()) === 0,
    'Viewer: the customer page has no Create order, block, delete, or save',
  )
  await view.goto(`${BASE}/admin/orders/new`, { waitUntil: 'networkidle' })
  log(await visible(view.getByRole('heading', { name: "You don't have access" })), 'Viewer opening Create order directly: "You don\'t have access"')
  const bulkRefused = await view.evaluate(async (number) => {
    const response = await fetch('/api/admin/orders/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ numbers: [number], action: 'cancel' }) })
    return { status: response.status, body: await response.json().catch(() => ({})) }
  }, orderB)
  log(bulkRefused.status === 403 && bulkRefused.body.code === 'permission_denied', `the API refuses a bulk action by a Viewer (${bulkRefused.status} ${bulkRefused.body.permission ?? ''})`)
  const returnRefused = await view.evaluate(async (number) => (await fetch(`/api/admin/returns/${number}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'closed' }) })).status, rma)
  log(returnRefused === 403, `and a return change (${returnRefused})`)
  log((await orderOf(orderB))?.status === 'shipped' && (await returnOf(rma))?.status === 'refunded', 'nothing changed')
  await viewerCtx.close()

  // ---------- 9. Phone-sized layout ----------
  await admin.setViewportSize({ width: 390, height: 844 })
  for (const path of [`/admin/customers/${shopper2.id}`, '/admin/orders/new', `/admin/returns/${rma}`, '/admin/customer-groups', `/admin/shipments/${shipmentNumber}`]) {
    await admin.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
    await admin.waitForTimeout(300)
    const overflow = await sidewaysOverflow(admin)
    log(overflow <= 0, `390px ${path}: no sideways page scroll (${overflow}px)`)
  }
  await shop.setViewportSize({ width: 390, height: 844 })
  for (const path of ['/account/addresses', `/account/returns/${rma}`]) {
    await shop.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
    await shop.waitForTimeout(300)
    const overflow = await sidewaysOverflow(shop)
    log(overflow <= 0, `390px store ${path}: no sideways page scroll (${overflow}px)`)
  }
  await shopCtx.close()
  await adminCtx.close()
} catch (error) {
  log(false, `the suite stopped early: ${error.message.split('\n')[0]}`)
} finally {
  // Put everything back: the open test order, test customers, addresses, SHOPPER_2's group and profile,
  // the test group, settings, the test admin, stock
  if (made.openOrder) await admin$('/orders/bulk', { method: 'POST', body: { numbers: [made.openOrder], action: 'cancel', notify_customer: false } })
  for (const id of made.customers) await admin$(`/customers/${id}`, { method: 'DELETE' })
  for (const id of [1, shopper2.id]) {
    for (const address of (await admin$(`/customers/${id}/addresses`)).body?.data ?? []) {
      if (isTestLine(address)) await admin$(`/customers/${id}/addresses/${address.id}`, { method: 'DELETE' })
    }
  }
  const profile = await customerOf(shopper2.id)
  const changes = {}
  for (const key of ['first_name', 'last_name', 'phone']) if (profile?.[key] !== shopper2Before[key]) changes[key] = shopper2Before[key]
  if (profile?.group?.id !== shopper2Before.group?.id) changes.group_id = shopper2Before.group?.id
  if (Object.keys(changes).length > 0) await admin$(`/customers/${shopper2.id}`, { method: 'PATCH', body: changes })
  if (made.group) await admin$(`/customer-groups/${made.group}`, { method: 'DELETE' })
  if (made.admin) await admin$(`/admins/${made.admin}`, { method: 'PATCH', body: { is_active: false } })
  await admin$('/settings', { method: 'PATCH', body: { returns: settingsBefore.returns } })
  await restoreStock()
  rmSync(files, { recursive: true, force: true })

  const leftCustomers = (await admin$(`/customers?search=${marker}`)).body?.data ?? []
  const leftAddresses = [...((await admin$('/customers/1/addresses')).body?.data ?? []), ...((await admin$(`/customers/${shopper2.id}/addresses`)).body?.data ?? [])].filter(isTestLine)
  const leftGroup = (await groupsNow()).some((item) => item.name === groupName)
  const after = await customerOf(shopper2.id)
  const settingsAfter = (await admin$('/settings')).body.data
  const viewerLeft = made.admin && (await admin$('/admins')).body?.data?.find((item) => item.id === made.admin)?.is_active
  log(
    leftCustomers.length === 0 &&
      leftAddresses.length === 0 &&
      !leftGroup &&
      after?.group?.id === shopper2Before.group?.id &&
      after?.first_name === shopper2Before.first_name &&
      after?.phone === shopper2Before.phone &&
      JSON.stringify(settingsAfter.returns) === JSON.stringify(settingsBefore.returns) &&
      !viewerLeft,
    'cleanup: test customers, addresses, and group removed; SHOPPER_2 and the Returns settings as before; the Viewer deactivated',
  )
}

log(errors.length === 0, `no page errors ${JSON.stringify(errors)}`)
report.done()
await browser.close()
