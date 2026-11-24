// Phase 16 in a real browser: configurable products like Magento's product page (docs/backend/PHASE16_CONTRACT.md).
// The demo shirt (Color swatches × Size) and iPhone (Storage × Color, prices per storage): listing cards ("From",
// colour dots, "Choose options"), the product page (nothing pre-selected, "Please select Size.", swatches with
// "Color: Blue", sold-out values crossed, price / stock / SKU / photo / URL following the choice, a shared link
// pre-selecting, the same link in Bangla), two variants → two cart lines with their labels, a guest order with the
// variant labels and the variants' stock reduced; then the admin making a product configurable (Color swatches +
// Size, generate, prices / stock, an image for one colour) shown in the store. axe and 390px throughout.
//
// Runs against the usual servers (the store on :5173, the API on :8000). Variant stock of the demo products is read at
// the start and put back at the end; the admin's test product is deleted; the guest order stays (like other suites).
import { ADMIN_USER, BASE, LARAVEL_URL, adminSignIn, axeViolations, fillEmptyAddress, launch, reporter, sidewaysOverflow, visible, watchErrors } from './lib.mjs'

const report = reporter('configurable: products with colours, sizes and configurations (swatches, choices, cart, order, admin)')
const { log } = report
const errors = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const run = Date.now().toString(36)
const SHIRT = 83 // Blue & Black Check Shirt: Color (Blue, Black, Grey) × Size (S–XL); Black/S sold out
const PHONE = 123 // iPhone 13 Pro: Storage (128 / 256 / 512 GB) × Color (Graphite, Sierra Blue); 512/Sierra Blue sold out

const api = async (path, { method = 'GET', token, body, headers = {} } = {}) => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${LARAVEL_URL}${path}`, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers },
      body: body && JSON.stringify(body),
    })
    if (response.status === 429 && attempt < 4) {
      await sleep((Number(response.headers.get('retry-after')) || 5) * 1000)
      continue
    }
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }
}

let owner = null
let browser = null
const made = { products: [], orders: [] }
const savedStock = new Map() // `${productId}:${variantId}` → stock
const admin$ = (path, options = {}) => api(`/api/admin/v1${path}`, { token: owner, ...options })
const productOf = async (id) => (await admin$(`/products/${id}`)).body?.data
const publicProduct = async (id, lang) => (await api(`/api/v1/products/${id}`, lang ? { headers: { 'Accept-Language': lang } } : {})).body?.data
const variantOf = (product, labels) => {
  const ids = product.options.map((option, index) => option.values.find((value) => value.value === labels[index])?.id)
  return product.variants.find((variant) => [...variant.option_value_ids].sort().join() === [...ids].sort().join())
}

try {
  owner = (await api('/api/admin/v1/auth/login', { method: 'POST', body: { email: ADMIN_USER.email, password: ADMIN_USER.password } })).body?.data?.tokens?.access_token
  if (!owner) throw new Error('the demo Owner could not sign in to the API')
  for (const id of [SHIRT, PHONE]) {
    const product = await productOf(id)
    if (!product?.options?.length) throw new Error(`demo product ${id} is not configurable (phase 16 demo migration not run?)`)
    for (const variant of product.variants) savedStock.set(`${id}:${variant.id}`, variant.stock_quantity)
  }
  browser = await launch()
  await runChecks()
} catch (error) {
  log(false, `suite stopped early: ${error.message.split('\n')[0]}`)
} finally {
  await cleanup().catch((error) => log(false, `cleanup failed: ${error.message.split('\n')[0]}`))
  await browser?.close().catch(() => {})
  log(errors.length === 0, `no page errors ${JSON.stringify(errors)}`)
  report.done()
}

async function cleanup() {
  if (!owner) return
  let restored = 0
  for (const [key, stock] of savedStock) {
    const [productId, variantId] = key.split(':')
    const now = (await productOf(productId))?.variants?.find((variant) => String(variant.id) === variantId)
    if (now && now.stock_quantity !== stock) {
      await admin$(`/products/${productId}/variants/${variantId}`, { method: 'PATCH', body: { stock_quantity: stock } })
      restored++
    }
  }
  for (const id of made.products) await admin$(`/products/${id}`, { method: 'DELETE' })
  const left = []
  for (const [key, stock] of savedStock) {
    const [productId, variantId] = key.split(':')
    const now = (await productOf(productId))?.variants?.find((variant) => String(variant.id) === variantId)
    if (now?.stock_quantity !== stock) left.push(key)
  }
  log(left.length === 0, `cleanup: variant stock put back (${restored} changed), test products deleted (${made.products.length})${left.length ? ` — left: ${left.join(', ')}` : ''}`)
}

async function runChecks() {
  const axe = async (page, name) => {
    const violations = await axeViolations(page)
    log(violations.length === 0, `axe ${name}: ${violations.join(', ') || 'no violations'}`)
  }
  const phone = async (page, name) => {
    const size = page.viewportSize()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(300)
    const overflow = await sidewaysOverflow(page)
    log(overflow <= 0, `390px: ${name} fits (overflow ${overflow}px)`)
    await page.setViewportSize(size)
  }
  async function part(name, body) {
    try {
      await body()
    } catch (error) {
      log(false, `${name} stopped early: ${error.message.split('\n')[0]}`)
    }
  }
  async function newPage({ viewport = { width: 1280, height: 900 }, cookie } = {}) {
    const context = await browser.newContext({ viewport, bypassCSP: true })
    context.setDefaultTimeout(15000)
    if (cookie) await context.addCookies([{ name: 'buynest_lang', value: cookie, url: BASE }])
    return watchErrors(await context.newPage(), errors)
  }
  const shirt = await publicProduct(SHIRT)
  const iphone = await publicProduct(PHONE)
  const query = (page) => new URL(page.url()).searchParams
  // The radios are visually hidden behind their swatch / button (still real inputs): click what the shopper sees.
  const choose = async (radio) => {
    const id = await radio.getAttribute('id')
    await radio.page().locator(`label[for="${id}"]`).click()
    await radio.page().waitForFunction((inputId) => document.getElementById(inputId)?.checked, id, { timeout: 5000 })
  }

  // ---------- 1. API ----------
  await part('API', async () => {
    const color = shirt.options.find((option) => option.type === 'color')
    log(color?.code === 'color' && color.values.every((value) => /^#[0-9A-F]{6}$/.test(value.swatch ?? '')), `shirt: a color option with swatches (${color?.values.map((value) => `${value.value} ${value.swatch}`).join(', ')})`)
    log(shirt.images.some((image) => image.option_value_id !== null), 'shirt: some images are for one colour (option_value_id)')
    log(iphone.price_range && iphone.price_range.min !== iphone.price_range.max, `iPhone: price_range ${iphone.price_range?.min}–${iphone.price_range?.max}`)
    const bn = await publicProduct(SHIRT, 'bn')
    log(bn.options[0].code === 'color' && bn.options[0].name !== 'Color', `Bangla: option name "${bn.options[0].name}", code still "${bn.options[0].code}"`)
  })

  // ---------- 2. Listing cards ----------
  await part('listing', async () => {
    const page = await newPage()
    await page.goto(`${BASE}/categories/smartphones`, { waitUntil: 'networkidle' })
    const card = page.locator('.product-card').filter({ hasText: iphone.name }).first()
    await card.waitFor()
    log(/From/.test(await card.innerText()), `iPhone card: "From" price ("${(await card.locator('.product-card__price').innerText()).replace(/\s+/g, ' ')}")`)
    log((await card.locator('.product-card__swatch').count()) === 2, 'iPhone card: 2 colour dots')
    const choose = card.getByRole('link', { name: `Choose options for ${iphone.name}` })
    log(await visible(choose), 'iPhone card: "Choose options" instead of Add to cart')
    await axe(page, 'smartphones listing with swatches')
    await phone(page, 'listing with swatches')
    await choose.click()
    await page.waitForURL(new RegExp(`/products/${PHONE}`))
    log(true, 'Choose options opens the product page')
    await page.context().close()
  })

  // ---------- 3. Product page ----------
  let cartPage = null
  await part('product page', async () => {
    const page = await newPage()
    cartPage = page
    await page.goto(`${BASE}/products/${SHIRT}`, { waitUntil: 'networkidle' })
    const colorGroup = page.getByRole('group', { name: 'Color', exact: true })
    const sizeGroup = page.getByRole('group', { name: 'Size', exact: true })
    log((await visible(colorGroup)) && (await visible(sizeGroup)), 'nothing pre-selected: groups "Color" and "Size"')
    const radios = page.locator('.variant-selector input[type="radio"]:checked')
    log((await radios.count()) === 0, 'no choice is ticked')
    const add = page.locator('.product-details').getByRole('button', { name: 'Add to cart' }).first()
    await add.click()
    log(await visible(page.getByText('Please select Color.').first()) && (await visible(page.getByText('Please select Size.').first())), 'Add to cart first: "Please select Color." and "Please select Size."')
    const focused = await page.evaluate(() => document.activeElement?.closest('fieldset')?.querySelector('legend')?.textContent ?? '')
    log(/Color/.test(focused), `focus moves to the first missing option (${focused.trim()})`)
    await axe(page, 'product page with the please-select messages')

    await choose(page.getByRole('radio', { name: 'Blue', exact: true }))
    log(await visible(page.getByRole('group', { name: 'Color: Blue' })), 'the legend says "Color: Blue"')
    log(!(await page.getByText('Please select Color.').isVisible()), 'choosing a colour clears its message')
    const blueImages = shirt.images.filter((image) => image.option_value_id === shirt.options[0].values[0].id).map((image) => image.url)
    const main = await page.locator('.gallery__main img').getAttribute('src')
    log(blueImages.length === 0 || blueImages.some((url) => main?.includes(url.split('/').pop())), `the gallery shows a Blue photo (${main?.split('/').slice(-2).join('/')})`)
    await choose(page.getByRole('radio', { name: 'M', exact: true }))
    const blueM = variantOf(shirt, ['Blue', 'M'])
    log(query(page).get('color') === 'blue' && query(page).get('size') === 'm', `the URL follows the choice (${new URL(page.url()).search})`)
    log(await visible(page.getByText(blueM.sku).first()), `the SKU follows the variant (${blueM.sku})`)
    log(await visible(page.getByText(/In stock|only \d+ left/i).first()), 'the stock line shows for the variant')
    log(await page.getByRole('radio', { name: /^S( \(sold out\))?$/ }).isEnabled(), 'S stays selectable')
    await choose(page.getByRole('radio', { name: 'Black', exact: true }))
    log(await visible(page.getByRole('radio', { name: 'S (sold out)' })), 'Black: "S (sold out)" (crossed)')
    await choose(page.getByRole('radio', { name: 'Blue', exact: true }))
    await phone(page, 'the product page with swatches')
    await add.click()
    const miniCart = page.getByRole('dialog', { name: /Your cart/ })
    if (await visible(miniCart, 5000)) await page.keyboard.press('Escape')
    await choose(page.getByRole('radio', { name: 'L', exact: true }))
    await add.click()
    if (await visible(miniCart, 5000)) await page.keyboard.press('Escape')
  })

  // ---------- 4. Shared link, Bangla ----------
  await part('shared link and Bangla', async () => {
    let page = await newPage()
    await page.goto(`${BASE}/products/${PHONE}?storage=256-gb&color=sierra-blue`, { waitUntil: 'networkidle' })
    const v256 = variantOf(iphone, ['256 GB', 'Sierra Blue'])
    log((await page.getByRole('radio', { name: '256 GB', exact: true }).isChecked()) && (await page.getByRole('radio', { name: 'Sierra Blue', exact: true }).isChecked()), 'a shared link pre-selects 256 GB + Sierra Blue')
    log(await visible(page.getByText(v256.sku).first()), `…with its SKU (${v256.sku})`)
    const price256 = (await page.locator('.product-details .price, .product-details [class*="price"]').first().innerText()).replace(/\s+/g, ' ')
    await choose(page.getByRole('radio', { name: '128 GB', exact: true }))
    const price128 = (await page.locator('.product-details .price, .product-details [class*="price"]').first().innerText()).replace(/\s+/g, ' ')
    log(price256 !== price128, `the price follows the storage (256 GB ${price256} → 128 GB ${price128})`)
    await page.context().close()

    page = await newPage({ cookie: 'bn' })
    await page.goto(`${BASE}/products/${SHIRT}?color=blue&size=m`, { waitUntil: 'networkidle' })
    const bn = await publicProduct(SHIRT, 'bn')
    const colorBn = bn.options[0]
    const blueBn = colorBn.values.find((value) => value.code === 'blue')
    log(await visible(page.getByRole('group', { name: `${colorBn.name}: ${blueBn.value}` })), `Bangla: an English link pre-selects "${colorBn.name}: ${blueBn.value}"`)
    await choose(page.getByRole('radio', { name: 'L', exact: true }))
    log(query(page).get('color') === 'blue' && query(page).get('size') === 'l', `Bangla: the URL keeps the same codes (${new URL(page.url()).search})`)
    await axe(page, 'product page in Bangla')
    await page.context().close()
  })

  // ---------- 5. Cart and order ----------
  await part('cart and order', async () => {
    const page = cartPage
    await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
    const lines = page.locator('main').getByText(shirt.name)
    log((await lines.count()) >= 2, `cart: ${await lines.count()} lines for the shirt (one per variant)`)
    const text = await page.locator('main').innerText()
    log(/Color: Blue \/ Size: M/.test(text) && /Color: Blue \/ Size: L/.test(text), 'cart: the variant labels ("Color: Blue / Size: M", "… L")')
    await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    const place = page.getByRole('button', { name: /^Place order · / })
    await place.waitFor({ timeout: 20000 })
    await page.locator('[name="email"]').fill(`configurable.${run}@example.com`)
    await page.locator('[name="phone"]').fill('+1 555 010 2030')
    for (const [name, value] of [['firstName', 'Cora'], ['lastName', 'Config']]) await page.locator(`[name="shipping.${name}"]`).fill(value)
    await fillEmptyAddress(page)
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => /Checking prices/.test(b.textContent)), null, { timeout: 20000 }).catch(() => {})
    await place.click()
    await page.waitForURL(/\/order-confirmation\/BN-/, { timeout: 30000 })
    const number = new URL(page.url()).pathname.split('/').pop()
    made.orders.push(number)
    const order = (await admin$(`/orders/${number}`)).body?.data
    const labels = (order?.items ?? []).map((item) => item.variant_label).sort()
    log(labels.join(' | ') === 'Color: Blue / Size: L | Color: Blue / Size: M', `order ${number}: items "${labels.join('", "')}"`)
    const blueM = variantOf(shirt, ['Blue', 'M'])
    const now = (await productOf(SHIRT)).variants.find((variant) => variant.id === blueM.id)
    log(now.stock_quantity === savedStock.get(`${SHIRT}:${blueM.id}`) - 1, `the Blue / M variant's stock went down by 1 (${savedStock.get(`${SHIRT}:${blueM.id}`)} → ${now.stock_quantity})`)
    await page.context().close()
  })

  // ---------- 6. Admin: a product made configurable (Color swatches + Size), shown in the store ----------
  await part('admin', async () => {
    const images = shirt.images.slice(0, 3).map((image) => image.url)
    const name = `E2E Configurable Tee ${run}`
    const created = await admin$('/products', { method: 'POST', body: { name, category: 'mens-shirts', price: 30, stock_quantity: 0, status: 'active', sku: `E2E-CFG-${run}`.toUpperCase(), brand: 'NestWorks', images } })
    const id = created.body?.data?.id
    if (!id) throw new Error(`the test product could not be made (${created.status})`)
    made.products.push(id)

    const admin = await newPage({ viewport: { width: 1440, height: 900 } })
    await adminSignIn(admin, ADMIN_USER)
    await admin.getByRole('heading', { name: 'Overview' }).waitFor()
    await admin.goto(`${BASE}/admin/products/${id}`, { waitUntil: 'networkidle' })
    const panel = admin.getByRole('region', { name: 'Options and variants' })
    await panel.waitFor()
    await panel.getByRole('button', { name: 'Add option' }).click()
    await panel.getByLabel('Option 1 name').fill('Color')
    await panel.getByLabel('Option 1 values').fill('Red, Navy')
    await panel.getByLabel('Option 1 type').selectOption({ label: 'Color swatches' })
    const colours = panel.getByRole('group', { name: 'Colours of option 1' })
    await colours.waitFor()
    await colours.getByLabel('Color value Red: hex code').fill('#zz0000')
    await panel.getByRole('button', { name: 'Add option' }).click()
    await panel.getByLabel('Option 2 name').fill('Size')
    await panel.getByLabel('Option 2 values').fill('S, M')
    await panel.getByRole('button', { name: 'Save options' }).click()
    log(await visible(panel.getByText(/Pick a colour for Red as #RRGGBB/).first(), 5000), 'admin: a wrong hex is refused on the field ("Pick a colour for Red as #RRGGBB …")')
    await colours.getByLabel('Color value Red: hex code').fill('#C0392B')
    await colours.getByLabel('Color value Navy: swatch colour').fill('#1b2a4a')
    log((await colours.getByLabel('Color value Navy: hex code').inputValue()).toUpperCase() === '#1B2A4A', 'admin: the colour picker fills the hex field')
    await axe(admin, 'admin options with colour swatches')
    await panel.getByRole('button', { name: 'Save options' }).click()
    await panel.getByRole('status').filter({ hasText: 'Options saved.' }).waitFor({ timeout: 15000 }).catch(() => {})
    await panel.getByRole('button', { name: /Generate combinations/ }).click()
    await panel.getByRole('status').filter({ hasText: /4 new variants/ }).waitFor({ timeout: 15000 }).catch(() => {})
    const plan = [
      { label: 'Color: Red / Size: S', price: '', stock: '4' },
      { label: 'Color: Red / Size: M', price: '', stock: '0' },
      { label: 'Color: Navy / Size: S', price: '34', stock: '6' },
      { label: 'Color: Navy / Size: M', price: '34', stock: '6' },
    ]
    for (const { label, price, stock } of plan) {
      await panel.getByLabel(`Price for ${label}`).fill(price)
      await panel.getByLabel(`Units in stock for ${label}`).fill(stock)
      await panel.getByLabel(`Sell ${label}`).check({ force: true })
      await panel.getByRole('button', { name: `Save ${label}` }).click()
      await panel.getByRole('row', { name: new RegExp(label) }).getByText('Saved').waitFor({ timeout: 15000 }).catch(() => {})
    }
    const imagesPanel = admin.getByRole('region', { name: 'Images' })
    await imagesPanel.getByLabel('Shown for image 2').selectOption({ label: 'Navy' })
    log(await visible(imagesPanel.getByText('Image 2 is shown for Navy.')), 'admin: "Image 2 is shown for Navy."')
    const saved = await productOf(id)
    const color = saved.options.find((option) => option.type === 'color')
    const navy = color?.values.find((value) => value.value === 'Navy')
    log(color?.values.map((value) => value.swatch).join() === '#C0392B,#1B2A4A', `API: Color is a swatch option (${color?.values.map((value) => value.swatch).join(', ')})`)
    log(saved.variants.filter((variant) => variant.is_active).length === 4 && saved.images[1]?.option_value_id === navy?.id, 'API: 4 active variants, image 2 for Navy')
    await admin.context().close()

    const page = await newPage()
    await page.goto(`${BASE}/products/${id}`, { waitUntil: 'networkidle' })
    log(/From/.test(await page.locator('.product-details').innerText()), 'store: "From" price (Navy costs more)')
    await choose(page.getByRole('radio', { name: 'Navy', exact: true }))
    const main = await page.locator('.gallery__main img').getAttribute('src')
    log(main?.includes(images[1].split('/').pop()), `store: choosing Navy shows its photo (${main?.split('/').slice(-2).join('/')})`)
    await choose(page.getByRole('radio', { name: 'Red', exact: true }))
    log(await visible(page.getByRole('radio', { name: 'M (sold out)' })), 'store: Red / M is sold out')
    await page.context().close()
  })
}
