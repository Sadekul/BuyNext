// Phase 5: Magento-style catalog management. The category tree, product images (upload), options and
// variants bought in the store, refunds that restock a variant, moderated reviews, mass actions on the
// product grid, CSV import/export, and what a Viewer admin may do.
// Needs the BuyNest API (E2E_ACCOUNTS=laravel). It works only on categories, products, and reviews it
// creates itself, and removes them at the end (orders stay, like in the other suites).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import {
  ADMIN_USER,
  BASE,
  LARAVEL,
  LARAVEL_URL,
  SHOPPER,
  adminSignIn,
  axeViolations,
  fillEmptyAddress,
  launch,
  preserveStock,
  reporter,
  sidewaysOverflow,
  storefrontSignIn,
  visible,
  watchErrors,
} from './lib.mjs'

const report = reporter('catalog: categories, images, variants, reviews, bulk, import')
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
const adminProduct = async (id) => (await api(`/api/admin/v1/products/${id}`, { token: owner })).body?.data
const variantOf = (product, label) => product?.variants?.find((variant) => variant.label === label)

/** A small valid PNG (8×8, one color), built by hand: signature, IHDR, IDAT, IEND. */
function png(width = 8, height = 8, [r, g, b] = [220, 60, 40]) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8) // 8 bits, RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())])
  const pixels = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}

const run = Date.now().toString(36)
const marker = `e2e${run}`
const parentName = `E2E Catalog ${run}`
const childName = `E2E Tees ${run}`
const siblingName = `E2E Mugs ${run}`
const productName = `E2E Tee ${marker}`
const secondName = `E2E Mug ${marker}`
const reviewText = `Soft fabric and true to size, ${marker}.`
const files = mkdtempSync(join(tmpdir(), 'buynest-catalog-'))
const pngPath = join(files, 'tee-front.png')
const fakePath = join(files, 'not-a-photo.jpg')
writeFileSync(pngPath, png())
writeFileSync(fakePath, 'Hello, this is plain text pretending to be a JPEG photo.\n')

// What this suite changes, recorded first so it can be put back
const restoreStock = await preserveStock()
const settingsBefore = (await api('/api/admin/v1/settings', { token: owner })).body.data
const made = { categories: [], products: [], admin: null } // categories child first, so they delete in order

const browser = await launch()
const errors = []
const axe = async (page, name) => {
  const violations = await axeViolations(page)
  log(violations.length === 0, `axe ${name}: ${violations.join(', ') || 'no violations'}`)
}
const categoryBySlug = async (slug) => {
  const walk = (list) => list.flatMap((category) => [category, ...walk(category.children ?? [])])
  return walk((await api('/api/admin/v1/categories', { token: owner })).body.data).find((category) => category.slug === slug)
}

try {
  // Reviews wait for approval in this suite (the default)
  if (settingsBefore.catalog?.reviews_require_approval !== true) {
    await api('/api/admin/v1/settings', { method: 'PATCH', token: owner, body: { catalog: { reviews_require_approval: true } } })
  }

  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true, acceptDownloads: true })
  const admin = watchErrors(await adminCtx.newPage(), errors)
  await adminSignIn(admin, ADMIN_USER)
  await admin.getByRole('heading', { name: 'Overview' }).waitFor()

  // ---------- 1. Categories: a test category with two subcategories ----------
  await admin.goto(`${BASE}/admin/categories`, { waitUntil: 'networkidle' })
  log(await visible(admin.getByRole('heading', { name: 'Categories' })), 'categories page: the tree is shown')
  const addCategory = async (name, parent) => {
    await (parent ? admin.getByRole('button', { name: `Add a subcategory to ${parent}` }) : admin.getByRole('button', { name: 'Add category' })).click()
    const dialog = admin.getByRole('dialog')
    await dialog.getByLabel('Name', { exact: true }).fill(name)
    if (!parent) await dialog.getByLabel('Description', { exact: true }).fill('Things the catalog browser check creates and removes.')
    await dialog.getByRole('button', { name: 'Add category' }).click()
    await admin.getByRole('status').filter({ hasText: `${name} added.` }).waitFor({ timeout: 15000 }).catch(() => {})
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const category = await categoryBySlug(slug)
    if (category) made.categories.unshift(category)
    return category
  }
  const parent = await addCategory(parentName)
  log(parent?.parent_id === null && parent.is_active, `add category: "${parentName}" saved at the top level (/${parent?.slug})`)
  const child = await addCategory(childName, parentName)
  log(child?.parent_id === parent?.id, `add subcategory: "${childName}" under the test category`)
  const sibling = await addCategory(siblingName, parentName)
  log(sibling?.parent_id === parent?.id, `add subcategory: "${siblingName}" (a sibling to move)`)
  await axe(admin, 'categories')

  // Edit in the dialog
  await admin.getByRole('button', { name: `Edit ${childName}` }).click()
  await admin.getByRole('dialog').getByLabel('Meta title', { exact: true }).fill(`Tees ${run} | BuyNest`)
  await admin.getByRole('dialog').getByLabel('Description', { exact: true }).fill('Soft cotton tees in every size.')
  await axe(admin, 'category dialog')
  await admin.getByRole('dialog').getByRole('button', { name: 'Save category' }).click()
  await admin.getByRole('status').filter({ hasText: `${childName} saved.` }).waitFor({ timeout: 15000 }).catch(() => {})
  const edited = await categoryBySlug(child.slug)
  log(edited?.meta_title === `Tees ${run} | BuyNest` && edited.description === 'Soft cotton tees in every size.', 'edit category: description and meta title saved')

  // Move: the newest subcategory goes last, so it can move up, then down again
  const order = async () => (await categoryBySlug(parent.slug)).children.map((category) => category.name)
  log(JSON.stringify(await order()) === JSON.stringify([childName, siblingName]), 'new subcategories go last among their siblings')
  await admin.getByRole('button', { name: `Move ${siblingName} up` }).click()
  await admin.getByText(`${siblingName} moved to position 1 of 2.`).waitFor({ timeout: 15000 }).catch(() => {})
  log(JSON.stringify(await order()) === JSON.stringify([siblingName, childName]), 'move up: the sibling is now first')
  log(await admin.evaluate((name) => document.activeElement?.getAttribute('aria-label') === `Move ${name} down`, siblingName), 'move up at the top: focus goes to its "down" button')
  await admin.getByRole('button', { name: `Move ${siblingName} down` }).click()
  await admin.getByText(`${siblingName} moved to position 2 of 2.`).waitFor({ timeout: 15000 }).catch(() => {})
  log(JSON.stringify(await order()) === JSON.stringify([childName, siblingName]), 'move down: back in the first order')

  // Deactivate and activate again
  await admin.getByRole('button', { name: `Deactivate ${childName}` }).click()
  await admin.getByRole('status').filter({ hasText: 'is now inactive' }).waitFor({ timeout: 15000 }).catch(() => {})
  log((await categoryBySlug(child.slug))?.is_active === false && (await visible(admin.getByRole('button', { name: `Activate ${childName}` }))), 'deactivate: the subcategory is inactive (button now says Activate)')
  await admin.getByRole('button', { name: `Activate ${childName}` }).click()
  await admin.getByRole('status').filter({ hasText: `${childName} is active again.` }).waitFor({ timeout: 15000 }).catch(() => {})
  log((await categoryBySlug(child.slug))?.is_active === true, 'activate: active again')

  // ---------- 2. A Draft product in the subcategory: images, options, variants ----------
  await admin.goto(`${BASE}/admin/products/new`, { waitUntil: 'networkidle' })
  await admin.getByLabel('Name', { exact: true }).fill(productName)
  await admin.getByLabel('Brand').fill('NestWorks')
  await admin.getByLabel('Category').selectOption(child.slug)
  await admin.getByLabel('Price (USD)').fill('20')
  await admin.getByLabel('Units in stock').fill('0')
  await admin.getByLabel('Status').selectOption('draft')
  await admin.getByRole('button', { name: 'Add product' }).click()
  await admin.waitForURL(/\/admin\/products\/\d+$/, { timeout: 15000 }).catch(() => {})
  const productId = Number(admin.url().split('/').pop())
  if (Number.isInteger(productId)) made.products.push(productId)
  log(Number.isInteger(productId) && (await adminProduct(productId))?.status === 'draft', `product created as a Draft in "${childName}" (#${productId})`)
  const images = admin.locator('section[aria-labelledby="images-title"]')
  await images.waitFor()

  // A text file named .jpg: the browser calls it image/jpeg, the server looks inside and refuses it
  await images.locator('input[type="file"]').setInputFiles(fakePath)
  await images.getByRole('button', { name: 'Upload 1 image' }).click()
  const refusedUpload = images.getByRole('alert').filter({ hasText: /Only JPEG, PNG, or WebP|isn't a valid image/ })
  log(await visible(refusedUpload), `a fake .jpg (text inside) is refused: "${(await refusedUpload.innerText().catch(() => '')).trim()}"`)
  log(((await adminProduct(productId))?.images ?? []).length === 0, 'and nothing was stored')
  await images.getByRole('button', { name: 'Clear' }).click()

  await images.locator('input[type="file"]').setInputFiles(pngPath)
  log(await visible(images.getByRole('list', { name: 'Chosen images' }).getByText('tee-front.png')), 'the chosen PNG is previewed before uploading')
  await images.getByRole('button', { name: 'Upload 1 image' }).click()
  log(await visible(images.getByRole('status').filter({ hasText: '1 image uploaded.' })), 'PNG uploaded')
  let saved = await adminProduct(productId)
  const uploaded = saved?.images?.[0]
  log(/^\/media\/products\/\d+\/[a-f0-9]{32}\.png$/.test(uploaded?.url ?? '') && !uploaded.url.includes('tee-front') && saved.thumbnail_url === uploaded.url, `stored under a random name, and it is the thumbnail (${uploaded?.url})`)
  log(await visible(images.getByText('Main image')), 'the first image is marked "Main image"')
  await images.getByLabel('Alt text for image 1').fill(`Red ${productName}, front`)
  await images.locator('.image-item__alt').getByRole('button', { name: 'Save' }).click()
  await images.getByRole('status').filter({ hasText: 'Description of image 1 saved.' }).waitFor({ timeout: 15000 }).catch(() => {})
  log((await adminProduct(productId))?.images?.[0]?.alt === `Red ${productName}, front`, 'alt text saved')

  // Options: Size S/M, Color Red/Blue → 4 combinations
  const variantsPanel = admin.locator('section.product-section').filter({ has: admin.getByRole('heading', { name: 'Options and variants' }) })
  await variantsPanel.getByRole('button', { name: 'Add option' }).click()
  await variantsPanel.getByLabel('Option 1 name').fill('Size')
  await variantsPanel.getByLabel('Option 1 values').fill('S, M')
  await variantsPanel.getByRole('button', { name: 'Add option' }).click()
  await variantsPanel.getByLabel('Option 2 name').fill('Color')
  await variantsPanel.getByLabel('Option 2 values').fill('Red, Blue')
  log(await variantsPanel.getByRole('button', { name: /Generate combinations/ }).isDisabled(), 'generate waits until the options are saved')
  await variantsPanel.getByRole('button', { name: 'Save options' }).click()
  await variantsPanel.getByRole('status').filter({ hasText: 'Options saved.' }).waitFor({ timeout: 15000 }).catch(() => {})
  await variantsPanel.getByRole('button', { name: /Generate combinations/ }).click()
  log(await visible(variantsPanel.getByRole('status').filter({ hasText: '4 new variants added' })), 'generate: 4 variants added (inactive, 0 in stock)')
  saved = await adminProduct(productId)
  log(saved?.has_variants === true && saved.variants.length === 4 && saved.variants.every((variant) => !variant.is_active && variant.stock_quantity === 0), 'the product has 4 inactive variants')

  // Price, stock, sold: S/Red 5 at the product's price, S/Blue 5 at $25, M/Red 3, M/Blue sold out (0)
  const plan = [
    { label: 'Size: S / Color: Red', price: '', stock: '5' },
    { label: 'Size: S / Color: Blue', price: '25', stock: '5' },
    { label: 'Size: M / Color: Red', price: '', stock: '3' },
    { label: 'Size: M / Color: Blue', price: '', stock: '0' },
  ]
  for (const { label, price, stock } of plan) {
    await variantsPanel.getByLabel(`Price for ${label}`).fill(price)
    await variantsPanel.getByLabel(`Units in stock for ${label}`).fill(stock)
    await variantsPanel.getByLabel(`Sell ${label}`).check({ force: true })
    await variantsPanel.getByRole('button', { name: `Save ${label}` }).click()
    await variantsPanel.getByRole('row', { name: new RegExp(label) }).getByText('Saved').waitFor({ timeout: 15000 }).catch(() => {})
  }
  saved = await adminProduct(productId)
  const skuOf = (label) => variantOf(saved, label)?.sku
  log(
    plan.every(({ label, stock }) => variantOf(saved, label)?.is_active && variantOf(saved, label).stock_quantity === Number(stock)) &&
      variantOf(saved, 'Size: S / Color: Blue').price === '25.00' &&
      variantOf(saved, 'Size: S / Color: Red').price === null,
    `variants saved: SKU ${skuOf('Size: S / Color: Red')}, own price for S/Blue, stock 5/5/3/0`,
  )
  log(saved?.stock_quantity === 13, `the product's stock is the sum of its variants (${saved?.stock_quantity})`)
  await axe(admin, 'product form with images and variants')

  // Active: now in the store
  await admin.getByLabel('Status').selectOption('active')
  await admin.getByRole('button', { name: 'Save changes' }).click()
  log(await visible(admin.getByRole('status').filter({ hasText: 'It is live in the store.' })), 'product set Active')

  // Categories that still hold something can't be deleted; an empty one can
  await admin.goto(`${BASE}/admin/categories`, { waitUntil: 'networkidle' })
  await admin.getByRole('button', { name: `Delete ${childName}` }).click()
  await admin.getByRole('dialog').getByRole('button', { name: 'Delete category' }).click()
  log(await visible(admin.getByRole('alert').filter({ hasText: 'This category has 1 product' })), 'delete refused: the subcategory has a product (the message says how many)')
  await admin.getByRole('button', { name: `Delete ${parentName}` }).click()
  await admin.getByRole('dialog').getByRole('button', { name: 'Delete category' }).click()
  log(await visible(admin.getByRole('alert').filter({ hasText: 'This category has 2 subcategories' })), 'delete refused: the top category has 2 subcategories')
  await admin.getByRole('button', { name: `Delete ${siblingName}` }).click()
  await admin.getByRole('dialog').getByRole('button', { name: 'Delete category' }).click()
  log(await visible(admin.getByRole('status').filter({ hasText: `${siblingName} was deleted.` })), 'an empty subcategory is deleted')
  if (!(await categoryBySlug(sibling.slug))) made.categories = made.categories.filter((category) => category.id !== sibling.id)

  // ---------- 3. The store: category tree, product page, variants in the cart and the order ----------
  const shopCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true })
  const shop = watchErrors(await shopCtx.newPage(), errors)
  await storefrontSignIn(shop, SHOPPER)
  await shop.goto(`${BASE}/categories/${parent.slug}`, { waitUntil: 'networkidle' })
  const subcategories = shop.getByRole('navigation', { name: `${parentName} subcategories` })
  log(await visible(subcategories.getByRole('link', { name: childName })), 'parent category page links to the subcategory')
  log(await visible(shop.locator('main').getByText(productName)), "parent category page includes the subcategory's product")
  log(!(await shop.locator('main').getByText(siblingName).isVisible()), 'the deleted subcategory is gone')
  const mainNav = shop.getByRole('navigation', { name: 'Main' })
  const navLink = mainNav.getByRole('link', { name: childName })
  if (!(await navLink.isVisible())) {
    // The test category is the newest, so it may sit under "More"; open whichever menu holds it.
    const holder = mainNav.locator('li.main-nav__item').filter({ has: shop.locator(`a[href="/categories/${child.slug}"]`) })
    await holder.locator('button.main-nav__toggle').first().click()
  }
  log(await visible(navLink), 'the main navigation shows the subcategory')

  await shop.goto(`${BASE}/products/${productId}`, { waitUntil: 'networkidle' })
  const details = shop.locator('.product-details')
  const gallery = details.locator(`img[src="${uploaded?.url}"]`)
  log(await visible(gallery), 'product page shows the uploaded image from /media/…')
  const media = await shop.evaluate(async (url) => {
    const response = await fetch(url)
    return { status: response.status, type: response.headers.get('content-type'), cache: response.headers.get('cache-control') }
  }, uploaded?.url)
  log(media.status === 200 && /image\/png/.test(media.type ?? '') && /immutable/.test(media.cache ?? ''), `the image is served by the store itself (${media.status} ${media.type}, ${media.cache})`)
  log((await details.locator(`img[alt="Red ${productName}, front"]`).count()) > 0, 'with its alt text')
  const sizes = shop.getByRole('group', { name: 'Size' })
  const colors = shop.getByRole('group', { name: 'Color' })
  log((await sizes.getByRole('radio').count()) === 2 && (await colors.getByRole('radio').count()) === 2, 'option radio groups: Size (S, M) and Color (Red, Blue)')
  const addButton = details.getByRole('button', { name: /add to cart/i }).first()
  const price = details.locator('.product-details__price-current')
  log((await addButton.isDisabled()) && (await visible(shop.getByText('Choose size and color to add this to your cart'))), 'add to cart disabled until size and color are chosen')
  log(/From\s*\$20\.00/.test(await price.innerText()), `before a choice: "${(await price.innerText()).trim()}"`)
  await sizes.getByText('M', { exact: true }).click()
  // Phase 9: a sold-out combination can be chosen (to ask for a back-in-stock email) but not added to the cart.
  // Its label reads "Blue (sold out)" for screen readers, so match the start.
  await colors.locator('label').filter({ hasText: /^Blue/ }).click()
  log(
    (await visible(details.getByRole('button', { name: "Email me when it's back" }))) &&
      ((await addButton.count()) === 0 || (await addButton.isDisabled())),
    "M / Blue (sold out): can't be added to the cart, offers \"Email me when it's back\"",
  )
  await colors.getByText('Red', { exact: true }).click()
  log(!(await addButton.isDisabled()), 'M / Red: add to cart enabled')
  await sizes.getByText('S', { exact: true }).click()
  log(!(await addButton.isDisabled()) && (await colors.getByRole('radio', { name: 'Red' }).isChecked()) && !(await colors.getByRole('radio', { name: /^Blue/ }).isDisabled()), 'switching to S keeps Red (S / Red exists) and makes Blue available')
  await colors.getByText('Blue', { exact: true }).click()
  log((await price.innerText()).includes('$25.00'), `S / Blue: its own price (${(await price.innerText()).trim()})`)
  // Adding opens the mini cart over the page: close it (Escape) before choosing again.
  const addToCart = async () => {
    await addButton.click()
    const miniCart = shop.getByRole('dialog')
    if (await visible(miniCart, 3000)) {
      await shop.keyboard.press('Escape')
      await miniCart.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    }
  }
  await addToCart()
  await colors.getByText('Red', { exact: true }).click()
  log((await price.innerText()).includes('$20.00'), `S / Red: the product's price (${(await price.innerText()).trim()})`)
  await addToCart()
  await axe(shop, 'product page with options')

  // Cart: only the two variants (anything left from earlier runs is cleared first)
  await shop.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
  const cartLines = shop.locator('.cart-page__list .cart-line')
  await cartLines.first().waitFor({ timeout: 15000 }).catch(() => {})
  const cartText = await shop.locator('main').innerText()
  log(cartText.includes('Size: S / Color: Blue') && cartText.includes('Size: S / Color: Red'), 'cart shows both variant labels')
  const variantLines = await cartLines.filter({ hasText: productName }).count()
  log(variantLines === 2, `the same product with two variants is two cart lines (${variantLines})`)
  for (let guard = 0; guard < 10; guard++) {
    const other = cartLines.filter({ hasNotText: productName }).first()
    if ((await other.count()) === 0) break
    await other.getByRole('button', { name: /^Remove / }).click()
    await shop.waitForTimeout(300)
  }

  // Checkout as the customer
  const stockBefore = await adminProduct(productId)
  await shop.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
  const placeOrder = shop.getByRole('button', { name: /^Place order · / })
  await placeOrder.waitFor({ timeout: 20000 })
  const phone = shop.locator('[name="phone"]')
  if (!(await phone.inputValue())) await phone.fill('+1 555 010 2030')
  for (const [name, value] of [['firstName', 'Ava'], ['lastName', 'Customer']]) {
    const input = shop.locator(`[name="shipping.${name}"]`)
    if (!(await input.inputValue())) await input.fill(value)
  }
  await fillEmptyAddress(shop)
  log((await shop.locator('main').innerText()).includes('Size: S / Color: Red'), 'checkout summary shows the variant label')
  await placeOrder.click()
  await shop.waitForURL(/\/order-confirmation\/BN-/, { timeout: 30000 }).catch(() => {})
  const orderNumber = shop.url().split('/').pop()
  log(/^BN-/.test(orderNumber), `order placed: ${orderNumber}`)
  await shop.locator('main').getByText('Size: S / Color: Blue').first().waitFor({ timeout: 15000 }).catch(() => {})
  const confirmation = await shop.locator('main').innerText()
  log(confirmation.includes('Size: S / Color: Blue') && confirmation.includes('Size: S / Color: Red'), 'order confirmation shows the variant labels')
  await shop.goto(`${BASE}/account/orders/${orderNumber}`, { waitUntil: 'networkidle' })
  await shop.locator('main').getByText('Size: S / Color: Red').first().waitFor({ timeout: 15000 }).catch(() => {})
  const accountOrder = await shop.locator('main').innerText()
  log(accountOrder.includes('Size: S / Color: Blue') && accountOrder.includes('Size: S / Color: Red'), 'account order page shows the variant labels')
  const ordered = (await api(`/api/admin/v1/orders/${orderNumber}`, { token: owner })).body?.data
  const lineFor = (label) => ordered?.items?.find((item) => item.variant_label === label)
  log(lineFor('Size: S / Color: Blue')?.sku === variantOf(stockBefore, 'Size: S / Color: Blue')?.sku, `order lines keep the variant's SKU (${lineFor('Size: S / Color: Blue')?.sku})`)
  const qty = (label) => lineFor(label)?.quantity ?? 0
  let after = await adminProduct(productId)
  const stockOk = (label) => variantOf(after, label)?.stock_quantity === variantOf(stockBefore, label).stock_quantity - qty(label)
  log(
    stockOk('Size: S / Color: Red') && stockOk('Size: S / Color: Blue') && variantOf(after, 'Size: M / Color: Red')?.stock_quantity === 3,
    `variant stock went down by the ordered units (S/Red ${variantOf(after, 'Size: S / Color: Red')?.stock_quantity}, S/Blue ${variantOf(after, 'Size: S / Color: Blue')?.stock_quantity}, M/Red untouched)`,
  )

  // ---------- 4. The admin order: variant labels, a credit memo that restocks one variant ----------
  await admin.goto(`${BASE}/admin/orders/${orderNumber}`, { waitUntil: 'networkidle' })
  const items = admin.locator('section[aria-labelledby="lines-title"]')
  await items.waitFor()
  log((await items.getByText(/Size: S \/ Color: Blue/).count()) > 0 && (await items.getByText(/Size: S \/ Color: Red/).count()) > 0, 'admin order shows the variant labels')
  await admin.getByRole('button', { name: 'Invoice', exact: true }).click()
  await admin.getByRole('dialog').getByRole('button', { name: 'Create invoice' }).click()
  await admin.getByRole('button', { name: 'Refund', exact: true }).waitFor({ timeout: 15000 })
  const blueBefore = variantOf(await adminProduct(productId), 'Size: S / Color: Blue').stock_quantity
  const redBefore = variantOf(await adminProduct(productId), 'Size: S / Color: Red').stock_quantity
  await admin.getByRole('button', { name: 'Refund', exact: true }).click()
  const refund = admin.getByRole('dialog')
  const blueQuantity = refund.getByLabel(`Quantity of ${productName} (Size: S / Color: Blue) to refund`, { exact: false })
  log(await visible(blueQuantity, 5000), 'refund form names each variant line')
  await blueQuantity.fill('1')
  await refund.getByLabel('Return the refunded items to stock').check()
  await refund.getByRole('button', { name: /^Refund \$/ }).click()
  await admin.waitForTimeout(1500)
  after = await adminProduct(productId)
  const memo = (await api(`/api/admin/v1/orders/${orderNumber}`, { token: owner })).body?.data?.credit_memos?.[0]
  log(memo?.items?.length === 1 && memo.items[0].variant_label === 'Size: S / Color: Blue', `credit memo ${memo?.number} refunds the S / Blue line`)
  log(
    variantOf(after, 'Size: S / Color: Blue')?.stock_quantity === blueBefore + 1 && variantOf(after, 'Size: S / Color: Red')?.stock_quantity === redBefore,
    `restock: S / Blue back to ${variantOf(after, 'Size: S / Color: Blue')?.stock_quantity}, S / Red unchanged`,
  )

  // ---------- 5. Reviews: written by the customer, approved in the admin ----------
  await shop.goto(`${BASE}/products/${productId}`, { waitUntil: 'networkidle' })
  const reviewForm = shop.locator('form.review-form')
  const writeReview = async () => {
    await reviewForm.locator('label[for$="-rating-5"]').click()
    await reviewForm.getByLabel('Title (optional)').fill('Great tee')
    await reviewForm.getByLabel('Your review').fill(reviewText)
    await reviewForm.getByRole('button', { name: 'Submit review' }).click()
  }
  await writeReview()
  log(await visible(shop.getByRole('status').filter({ hasText: 'Thanks — your review will appear after approval.' })), 'review sent: "will appear after approval"')
  // A visitor in a fresh browser: the store's catalog answers may be cached for a minute in one browser.
  const visitorPage = async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true })
    const page = watchErrors(await context.newPage(), errors)
    await page.goto(`${BASE}/products/${productId}`, { waitUntil: 'networkidle' })
    await page.locator('#reviews').waitFor({ timeout: 15000 }).catch(() => {})
    return page
  }
  const pendingView = await visitorPage()
  log(!(await pendingView.getByText(reviewText).isVisible()), 'a pending review is not shown in the store')
  await pendingView.context().close()
  await shop.reload({ waitUntil: 'networkidle' })
  await writeReview()
  // The store also allows 10 review attempts per customer per hour, so many runs in a row may hit that limit first.
  const secondRefusal = shop.getByRole('alert').filter({ hasText: /You've already reviewed this product|too many|try again/i })
  const refusalText = (await visible(secondRefusal)) ? (await secondRefusal.first().innerText()).trim() : ''
  log(refusalText !== '', `a second review by the same customer is refused ("${refusalText}")`)
  const pending = (await api(`/api/admin/v1/reviews?search=${marker}`, { token: owner })).body?.data ?? []
  log(pending.length === 1 && pending[0].status === 'pending' && pending[0].verified_purchase === true, `one pending review, marked as a verified purchase (${pending[0]?.author_name})`)

  await admin.goto(`${BASE}/admin/reviews?q=${marker}`, { waitUntil: 'networkidle' })
  const reviewRow = admin.locator('tbody tr').filter({ hasText: reviewText })
  log(await visible(reviewRow.getByText('Pending')), 'admin Reviews: the review is listed as Pending')
  log(await visible(reviewRow.getByText('Verified purchase')), 'admin Reviews: with the Verified purchase badge')
  await axe(admin, 'reviews')
  await reviewRow.getByRole('button', { name: /^Approve the review by / }).click()
  log(await visible(admin.getByRole('status').filter({ hasText: 'was approved' })), 'approve: notice')
  log(await visible(reviewRow.getByText('Approved')), 'the review is now Approved')
  const approvedView = await visitorPage()
  const publicReview = approvedView.locator('#reviews li, #reviews article').filter({ hasText: reviewText })
  log(await visible(approvedView.locator('#reviews').getByText(reviewText)), 'the approved review is shown in the store')
  log(await visible(publicReview.getByText('Verified purchase')), 'with the "Verified purchase" badge')
  await axe(approvedView, 'product reviews')
  await approvedView.context().close()
  const rated = (await api(`/api/v1/products/${productId}`)).body?.data
  log(Number(rated?.rating_average) === 5 && rated?.review_count === 1, `rating recounted from approved reviews (${rated?.rating_average}, ${rated?.review_count} review)`)

  // ---------- 6. Mass actions, on this suite's two products only ----------
  const second = await api('/api/admin/v1/products', {
    method: 'POST',
    token: owner,
    body: { name: secondName, category: child.slug, price: 10, stock_quantity: 4, status: 'draft', sku: `E2E-MUG-${run}`.toUpperCase(), brand: 'NestWorks' },
  })
  const secondId = second.body?.data?.id
  if (secondId) made.products.push(secondId)
  log(second.status === 201, `a second Draft product for the grid (#${secondId})`)
  await admin.goto(`${BASE}/admin/products?q=${marker}`, { waitUntil: 'networkidle' })
  await admin.locator('tbody tr').filter({ hasText: secondName }).waitFor({ timeout: 15000 }).catch(() => {})
  log((await admin.locator('tbody tr').count()) === 2, 'grid filtered to the two test products')
  await axe(admin, 'products grid')
  const bulk = async (action, fill) => {
    await admin.getByRole('checkbox', { name: 'Select all products on this page' }).check()
    const bar = admin.locator('form.bulk-bar')
    await bar.getByLabel('Action').selectOption(action)
    if (fill) await fill(bar)
    await bar.getByRole('button', { name: 'Apply' }).click()
  }
  const summary = admin.locator('.bulk-summary')
  await admin.getByRole('checkbox', { name: 'Select all products on this page' }).check()
  log(await visible(admin.locator('form.bulk-bar').getByText(/2\s*selected/)), 'select all: the bar shows "2 selected"')
  await admin.getByRole('checkbox', { name: 'Select all products on this page' }).uncheck()
  await bulk('disable')
  log(await visible(summary.filter({ hasText: '2 products set to draft.' })), 'bulk disable: "2 products set to draft."')
  log((await adminProduct(productId))?.status === 'draft' && (await adminProduct(secondId))?.status === 'draft', 'both are Drafts')
  await bulk('enable')
  log(await visible(summary.filter({ hasText: '2 products enabled.' })), 'bulk enable: "2 products enabled."')
  log((await adminProduct(productId))?.status === 'active' && (await adminProduct(secondId))?.status === 'active', 'both are Active')
  await bulk('adjust_price', async (bar) => {
    await bar.getByLabel('Change by').selectOption('percent')
    await bar.getByLabel('Percent (negative lowers)').fill('10')
  })
  const confirmPrice = admin.getByRole('dialog', { name: 'Change the price of 2 products?' })
  log(await visible(confirmPrice), 'price change asks for confirmation')
  await confirmPrice.getByRole('button', { name: 'Change prices' }).click()
  log(await visible(summary.filter({ hasText: '2 products repriced.' })), 'bulk price +10%: "2 products repriced."')
  const repriced = await adminProduct(productId)
  log(
    repriced?.price === '22.00' && (await adminProduct(secondId))?.price === '11.00' && variantOf(repriced, 'Size: S / Color: Blue')?.price === '27.50',
    `prices +10%: $22.00 and $11.00, the variant's own price $27.50 (${variantOf(repriced, 'Size: S / Color: Blue')?.price})`,
  )
  await bulk('set_stock', async (bar) => bar.getByLabel('Units in stock').fill('7'))
  log(await visible(summary.filter({ hasText: '1 product restocked. 1 skipped:' })), 'bulk set stock: 1 restocked, 1 skipped')
  log(await visible(summary.getByRole('listitem').filter({ hasText: productName })), `the skipped product is named, with the reason ("${(await summary.getByRole('listitem').first().innerText().catch(() => '')).trim()}")`)
  log((await adminProduct(secondId))?.stock_quantity === 7, 'the simple product now has 7 in stock')

  // ---------- 7. Import / Export ----------
  await admin.goto(`${BASE}/admin/import-export`, { waitUntil: 'networkidle' })
  await admin.getByLabel('Search').fill(marker)
  const [download] = await Promise.all([admin.waitForEvent('download', { timeout: 20000 }), admin.getByRole('link', { name: 'Download CSV' }).click()])
  const csvPath = join(files, 'export.csv')
  await download.saveAs(csvPath)
  const csv = readFileSync(csvPath, 'utf8').replace(/^﻿/, '')
  const [header, ...csvRows] = csv.trim().split(/\r?\n/)
  log(/^products-\d{4}-\d{2}-\d{2}\.csv$/.test(download.suggestedFilename()), `export downloads ${download.suggestedFilename()}`)
  log(header.startsWith('sku,name,category_slug') && csvRows.length === 2 && csv.includes(secondName) && csv.includes(uploaded?.url ?? '?'), `export: header and the 2 filtered products (with the /media image URL)`)
  await axe(admin, 'import / export')

  const mainSku = (await adminProduct(productId)).sku
  const newName = `E2E Tee renamed ${marker}`
  const importFile = join(files, 'import.csv')
  writeFileSync(importFile, `sku,name,price\n${mainSku},${newName},\n${`E2E-MUG-${run}`.toUpperCase()},${secondName},not-a-price\n`)
  await admin.getByLabel('CSV file').setInputFiles(importFile)
  await admin.getByRole('button', { name: 'Check file' }).click()
  const errorTable = admin.getByRole('table', { name: 'Rows with errors' })
  log(await visible(errorTable.getByRole('row').filter({ hasText: 'price' }).filter({ hasText: '3' })), 'dry run: the bad row is reported (row 3, price)')
  log(!(await admin.getByRole('button', { name: 'Import now' }).isVisible()), 'with an error row, "Import now" is not offered')
  log((await adminProduct(productId))?.name === productName, 'and nothing was saved')

  writeFileSync(importFile, `sku,name\n${mainSku},${newName}\n`)
  await admin.getByLabel('CSV file').setInputFiles(importFile)
  await admin.getByRole('button', { name: 'Check file' }).click()
  log(await visible(admin.getByText(/1 row: 0 to create, 1 to update/)), 'clean dry run: 1 row to update, nothing saved yet')
  log((await adminProduct(productId))?.name === productName, 'the dry run changed nothing')
  await admin.getByRole('button', { name: 'Import now' }).click()
  log(await visible(admin.getByText('Import finished.')), 'Import now: "Import finished."')
  log((await adminProduct(productId))?.name === newName, `the product is renamed by the import ("${newName}")`)

  // ---------- 8. A Viewer admin: reads, never changes ----------
  const viewerRole = (await api('/api/admin/v1/roles', { token: owner })).body.data.find((role) => role.name === 'Viewer')
  const viewerEmail = `viewer.${run}@buynest.test`
  const viewerPassword = 'ViewerCheck2026pass'
  const viewer = await api('/api/admin/v1/admins', { method: 'POST', token: owner, body: { name: 'Vera Viewer', email: viewerEmail, password: viewerPassword, role_id: viewerRole?.id } })
  made.admin = viewer.body?.data?.id ?? null
  log(viewer.status === 201, `a Viewer admin is created (${viewer.status})`)
  const viewerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true })
  const view = watchErrors(await viewerCtx.newPage(), errors)
  await adminSignIn(view, { email: viewerEmail, password: viewerPassword })
  await view.waitForURL(/\/admin\/(?!login)/, { timeout: 15000 }).catch(() => {})
  const viewNav = view.getByRole('navigation').first()
  await viewNav.getByRole('link', { name: 'Reviews' }).waitFor({ timeout: 15000 }).catch(() => {})
  log((await viewNav.getByRole('link', { name: 'Reviews' }).isVisible()) && (await viewNav.getByRole('link', { name: 'Categories' }).isVisible()), 'Viewer: Reviews and Categories in the menu')
  log(!(await viewNav.getByRole('link', { name: 'Import / Export' }).isVisible()), 'Viewer: no Import / Export in the menu')
  await view.goto(`${BASE}/admin/reviews?q=${marker}`, { waitUntil: 'networkidle' })
  await view.locator('tbody tr').first().waitFor({ timeout: 15000 }).catch(() => {})
  log((await view.locator('tbody tr').filter({ hasText: reviewText }).count()) === 1, 'Viewer: sees the review')
  log(
    (await view.getByRole('button', { name: /^(Approve|Reject|Delete) the review/ }).count()) === 0 && (await view.getByRole('checkbox').count()) === 0,
    'Viewer: Reviews is read-only (no approve, reject, delete, or checkboxes)',
  )
  await view.goto(`${BASE}/admin/products?q=${marker}`, { waitUntil: 'networkidle' })
  await view.locator('tbody tr').first().waitFor({ timeout: 15000 }).catch(() => {})
  log((await view.getByRole('checkbox').count()) === 0 && !(await view.getByRole('link', { name: 'Export CSV' }).isVisible()), 'Viewer: no bulk checkboxes and no Export CSV on the products grid')
  await view.goto(`${BASE}/admin/categories`, { waitUntil: 'networkidle' })
  await view.getByRole('heading', { name: 'Categories' }).waitFor({ timeout: 15000 }).catch(() => {})
  log((await view.getByRole('button', { name: /^(Add category|Delete |Edit )/ }).count()) === 0, 'Viewer: Categories without add, edit, or delete')
  await view.goto(`${BASE}/admin/import-export`, { waitUntil: 'networkidle' })
  log(await visible(view.getByRole('heading', { name: "You don't have access" })), 'Viewer opening Import / Export directly: "You don\'t have access"')
  const refused = await view.evaluate(async (ids) => {
    const response = await fetch('/api/admin/products/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, action: 'disable' }) })
    return { status: response.status, body: await response.json().catch(() => ({})) }
  }, [productId])
  log(refused.status === 403 && refused.body.code === 'permission_denied', `the API refuses a bulk action by a Viewer (${refused.status} ${refused.body.permission})`)
  const moderation = await view.evaluate(async (id) => (await fetch(`/api/admin/reviews/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'rejected' }) })).status, pending[0]?.id)
  log(moderation === 403, `and a review change (${moderation})`)
  await viewerCtx.close()

  // ---------- 9. Phone-sized layout ----------
  await admin.setViewportSize({ width: 390, height: 844 })
  for (const path of ['/admin/categories', `/admin/products/${productId}`, `/admin/products?q=${marker}`, '/admin/reviews', '/admin/import-export']) {
    await admin.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
    await admin.waitForTimeout(300)
    const overflow = await sidewaysOverflow(admin)
    log(overflow <= 0, `390px ${path}: no sideways page scroll (${overflow}px)`)
  }
  await admin.getByRole('checkbox', { name: 'Select all products on this page' }).check().catch(() => {})
  await shop.setViewportSize({ width: 390, height: 844 })
  await shop.goto(`${BASE}/products/${productId}`, { waitUntil: 'networkidle' })
  await shop.getByRole('group', { name: 'Size' }).waitFor()
  log((await sidewaysOverflow(shop)) <= 0, `390px store product page: no sideways page scroll (${await sidewaysOverflow(shop)}px)`)
  const box = await shop.getByRole('group', { name: 'Color' }).boundingBox()
  log(box && box.x >= 0 && box.x + box.width <= 390, 'the option selector fits the phone screen')
  await shop.getByRole('group', { name: 'Size' }).getByText('M', { exact: true }).click()
  await shop.getByRole('group', { name: 'Color' }).getByText('Red', { exact: true }).click()
  log(!(await shop.locator('.product-details').getByRole('button', { name: /add to cart/i }).first().isDisabled()), 'on a phone, choosing M / Red enables add to cart')
  await shopCtx.close()
  await adminCtx.close()
} catch (error) {
  log(false, `the suite stopped early: ${error.message.split('\n')[0]}`)
} finally {
  // Put everything back: reviews, images, products, categories, the test admin, settings, stock
  for (const review of (await api(`/api/admin/v1/reviews?search=${marker}`, { token: owner })).body?.data ?? []) {
    await api(`/api/admin/v1/reviews/${review.id}`, { method: 'DELETE', token: owner })
  }
  for (const id of made.products) {
    for (const image of (await adminProduct(id))?.images ?? []) await api(`/api/admin/v1/products/${id}/images/${image.id}`, { method: 'DELETE', token: owner })
    // Deleted products keep their category for past orders: move them out so the test categories can go.
    await api(`/api/admin/v1/products/${id}`, { method: 'PATCH', token: owner, body: { category: 'home-decoration', status: 'draft' } })
    await api(`/api/admin/v1/products/${id}`, { method: 'DELETE', token: owner })
  }
  for (const category of made.categories) await api(`/api/admin/v1/categories/${category.id}`, { method: 'DELETE', token: owner })
  if (made.admin) await api(`/api/admin/v1/admins/${made.admin}`, { method: 'PATCH', token: owner, body: { is_active: false } })
  await api('/api/admin/v1/settings', { method: 'PATCH', token: owner, body: { catalog: settingsBefore.catalog } })
  await restoreStock()
  rmSync(files, { recursive: true, force: true })

  const left = await Promise.all(made.categories.map((category) => categoryBySlug(category.slug)))
  const leftReviews = (await api(`/api/admin/v1/reviews?search=${marker}`, { token: owner })).body?.data ?? []
  const leftProducts = (await api(`/api/admin/v1/products?search=${marker}`, { token: owner })).body?.data ?? []
  const settingsAfter = (await api('/api/admin/v1/settings', { token: owner })).body.data
  log(
    left.every((category) => !category) && leftReviews.length === 0 && leftProducts.length === 0 && JSON.stringify(settingsAfter.catalog) === JSON.stringify(settingsBefore.catalog),
    'cleanup: test products (and images), reviews, and categories removed; settings put back',
  )
}

log(errors.length === 0, `no page errors ${JSON.stringify(errors)}`)
report.done()
await browser.close()
