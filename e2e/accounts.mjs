// Account separation: what one customer's session leaves behind for the next person on the device.
import {
  BASE,
  LARAVEL,
  LARAVEL_URL,
  SHOPPER,
  SHOPPER_2,
  headerCounts,
  launch,
  reporter,
  storefrontSignIn,
  storefrontSignOut,
  watchErrors,
} from './lib.mjs'

const report = reporter('account separation')
const { log } = report
const browser = await launch()
const errors = []
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = watchErrors(await ctx.newPage(), errors)

const wishlistTitles = async (p) => {
  await p.goto(`${BASE}/wishlist`, { waitUntil: 'networkidle' })
  return p.getByRole('button', { name: /Remove .* from wishlist/ }).count()
}
const addToCart = async (p, id) => {
  await p.goto(`${BASE}/products/${id}`, { waitUntil: 'networkidle' })
  await p.locator('.product-details').getByRole('button', { name: 'Add to cart' }).click()
  await p.keyboard.press('Escape')
}
const save = async (p, id) => {
  await p.goto(`${BASE}/products/${id}`, { waitUntil: 'networkidle' })
  await p.locator('.product-details .wishlist-button--button').click()
}

// 0. A guest saves one product and adds one to the cart
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await save(page, 2)
await addToCart(page, 123)

// 1. The first shopper signs in: her guest items come with her
await storefrontSignIn(page, SHOPPER)
// The guest items move into the account right after sign-in (and the saved cart is restored): give it a moment.
let counts = await headerCounts(page)
for (let waited = 0; waited < 5000 && !(counts.wishlist === 1 && counts.cart >= 1); waited += 250) {
  await page.waitForTimeout(250)
  counts = await headerCounts(page)
}
log(counts.wishlist === 1 && counts.cart >= 1, `guest items carried into the account on sign-in (${JSON.stringify(counts)})`)

// 2. The first shopper saves two more and adds to the cart
await save(page, 3)
await save(page, 4)
await addToCart(page, 121)
const emily = await headerCounts(page)

// 3. The first shopper signs out: the next person sees nothing of hers
await storefrontSignOut(page)
counts = await headerCounts(page)
log(counts.wishlist === 0, `after sign-out, header wishlist count is 0 (${counts.wishlist})`)
log(counts.cart === 0, `after sign-out, header cart count is 0 (${counts.cart})`)
log((await wishlistTitles(page)) === 0, 'after sign-out, /wishlist page is empty')
await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
log(await page.getByText('Your cart is empty').first().isVisible(), 'after sign-out, /cart page is empty')
await page.goto(`${BASE}/account/orders`, { waitUntil: 'networkidle' })
log(/\/login/.test(page.url()), 'after sign-out, account pages redirect to sign-in')
const leftovers = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
log(!/token|eyJ/i.test(leftovers) && !leftovers.includes('buynest.session'), 'after sign-out, no session or token left in browser storage')

// 4. A second shopper signs in on the same browser: none of the first account's data
await storefrontSignIn(page, SHOPPER_2)
counts = await headerCounts(page)
log(counts.wishlist === 0 && counts.cart === 0, `another account sees none of the first account's wishlist/cart (${JSON.stringify(counts)})`)
await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
log(await page.getByRole('heading', { name: new RegExp(`Hi, ${SHOPPER_2.firstName}`) }).isVisible(), 'profile shows the new account, not a cached one')
await page.goto(`${BASE}/account/orders`, { waitUntil: 'networkidle' })
if (LARAVEL) {
  // The second shopper may have orders of their own (other suites place some): check that none of the first shopper's appear.
  const call = async (path, init = {}) =>
    (await fetch(`${LARAVEL_URL}${path}`, { ...init, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...init.headers } })).json()
  const login = await call('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: SHOPPER.email, password: SHOPPER.password }) })
  const firstOrders = []
  for (let pageNumber = 1; ; pageNumber++) {
    const { data, meta } = await call(`/api/v1/orders?per_page=50&page=${pageNumber}`, { headers: { Authorization: `Bearer ${login.data.tokens.access_token}` } })
    firstOrders.push(...data.map((order) => order.number))
    if (pageNumber >= meta.last_page) break
  }
  const shown = await page.locator('.orders__item').allInnerTexts()
  const leaked = firstOrders.filter((number) => shown.some((text) => text.includes(number)))
  log(firstOrders.length > 0 && leaked.length === 0, `another account sees none of the first account's orders (${firstOrders.length} checked, leaked: ${leaked.join(', ') || 'none'})`)
} else {
  log((await page.locator('.orders__item').count()) === 0, "another account sees none of the first account's orders")
}
await storefrontSignOut(page)

// 5. The first shopper signs back in ("Keep me signed in" was on): her wishlist and cart are back
await storefrontSignIn(page, SHOPPER)
counts = await headerCounts(page)
log(counts.wishlist === emily.wishlist && counts.cart === emily.cart, `the first account's wishlist and cart return on sign-in (${JSON.stringify(counts)} vs ${JSON.stringify(emily)})`)

// 6. Sign-out in another tab clears this tab too
const tab2 = watchErrors(await ctx.newPage(), errors)
await tab2.goto(`${BASE}/wishlist`, { waitUntil: 'networkidle' })
await storefrontSignOut(page)
await tab2.waitForTimeout(800)
counts = await headerCounts(tab2)
log(counts.wishlist === 0 && counts.cart === 0, `sign-out in one tab empties the other tab's wishlist/cart (${JSON.stringify(counts)})`)
log((await tab2.getByRole('button', { name: /Remove .* from wishlist/ }).count()) === 0, 'the other tab no longer shows the wishlist items')

// 7. Sign-in in one tab signs the other tab in
await tab2.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await storefrontSignIn(page, SHOPPER)
log(await tab2.getByText(`Hi, ${SHOPPER.firstName}`).waitFor({ timeout: 10000 }).then(() => true, () => false), 'sign-in in one tab signs the other tab in')
await tab2.close()

// 8. An expired session (both HttpOnly cookies gone, the page's hint left) behaves like a sign-out
await ctx.clearCookies({ name: 'buynest_at' })
await ctx.clearCookies({ name: 'buynest_rt' })
await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
await page.waitForURL(/\/login/, { timeout: 15000 })
counts = await headerCounts(page)
log(counts.wishlist === 0 && counts.cart === 0, `expired session hides the account's wishlist/cart (${JSON.stringify(counts)})`)
log(await page.getByText(/session has expired/i).isVisible(), 'expired session explains why on the sign-in page')

// 9. Lists saved by the old version (one shared slot) move into the account, not back to the next visitor
await storefrontSignIn(page, SHOPPER)
await page.evaluate(() =>
  localStorage.setItem('buynest.wishlist.v1', JSON.stringify({ items: [{ productId: 9, title: 'Old shared item', price: 5, addedAt: Date.now() }] })),
)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const keys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('buynest.wishlist')))
log(!keys.includes('buynest.wishlist.v1'), `old shared wishlist moved into the account, guest slot cleared (${keys})`)
await storefrontSignOut(page)
log((await headerCounts(page)).wishlist === 0, 'after sign-out the old shared items are not shown')

log(errors.length === 0, `no page errors ${JSON.stringify(errors)}`)
report.done()
await browser.close()
