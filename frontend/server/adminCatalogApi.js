import { json, laravelFile, multipartType, readBody, readLimitedBody } from './http.js'
import { failed } from './shop/adminSystem.js'
import { laravelCatalogData } from './shop/adminCatalog.js'
// Phase 13: the Bangla texts of a category.
import { checkBangla, optionBangla } from './adminPhase13Api.js'

/*
 * Phase 5 admin routes (docs/backend/PHASE5_CONTRACT.md), Laravel only:
 * Magento-style catalog management. Merged into adminApi.js's route table,
 * so the admin session check there runs first; the API then checks the
 * role's permission (products.edit, products.delete, categories.edit,
 * products.import, reviews.view, reviews.moderate) and answers
 * 403 { code: "permission_denied", permission }, passed on unchanged.
 *
 * JSON bodies are allow-listed and checked for shape here (Laravel-style
 * 422s). Uploads (images, CSV) are passed through as multipart, unparsed,
 * with their Content-Type and boundary, after a size cap: the API sniffs
 * the file types and has the final word on every rule.
 *
 *   GET    /api/admin/categories                    → [{ id, name, slug, parentId, position, isActive, imageUrl, description,
 *                                                       metaTitle, metaDescription, productCount, childCount, depth }] (tree order)
 *   POST   /api/admin/categories                    { name, slug, parentId?, isActive?, imageUrl?, description?, metaTitle?, metaDescription? } → 201 { category }
 *   PATCH  /api/admin/categories/:id                (the same fields, and position) → { category }
 *   DELETE /api/admin/categories/:id                → { deleted: true } (422 with the API's message if it has children or products)
 *   POST   /api/admin/categories/reorder            { parentId: id | null, ids: [...] } → { ok: true, categories }
 *   POST   /api/admin/products/:id/images           multipart images[] (1–10 files, request ≤ 60 MB) → { images: [{ id, url, alt, position, isUpload }] }
 *   PATCH  /api/admin/products/:id/images/:imageId  { alt?, optionValueId? (phase 16; null = every choice) } → { images }
 *          image: { id, url, alt, position, isUpload, optionValueId? (phase 16, when the API sends it) }
 *   DELETE /api/admin/products/:id/images/:imageId  → { deleted: true, images }
 *   POST   /api/admin/products/:id/images/reorder   { ids } → { images }
 *   PUT    /api/admin/products/:id/options          { options: [{ name, values: [text] }] } → { options, variants, imageList, hasVariants }
 *          phase 16: + type? (text | color) and values as { value, swatch } (swatch #RRGGBB, required for color)
 *          option (read): { id, name, type?, values: [{ id, value, swatch? }] } (type/swatch when the API sends them)
 *   POST   /api/admin/products/:id/variants/generate → { options, variants, imageList, hasVariants, created? }
 *   PATCH  /api/admin/products/:id/variants/:variantId { sku?, price? (null = the product's), stock?, isActive? } → { options, variants, … }
 *          variant: { id, sku, optionValueIds, label, price, effectivePrice, finalPrice, stock, isActive, isCurrent }
 *   POST   /api/admin/products/bulk                 { ids (1–200), action, value? } → { updated, skipped: [{ id, reason }] }
 *          action: enable | disable | archive | delete | set_category (value: category id)
 *                  | adjust_price (value: { mode: percent | fixed, amount }) | set_stock (value: units)
 *   GET    /api/admin/products/export.csv?q&category&status → the CSV file, with the API's Content-Type and Content-Disposition
 *   POST   /api/admin/products/import?dryRun=true|false  multipart file (CSV, ≤ 2 MB)
 *                                                    → { dryRun, rows, created, updated, unchanged, errors: [{ row, column, message }] }
 *   GET    /api/admin/reviews?status&productId&rating&q&hasPhotos&limit&skip → { reviews, total, counts: { pending, approved, rejected }, limit, skip }
 *          review: { id, productId, productName, productSku, productThumbnail, authorName, authorEmail, rating, title, comment,
 *                    status, verifiedPurchase, createdAt, updatedAt,
 *                    photos (phase 22): [{ id, hidden, width, height, sizeBytes, position, url: '/api/admin/reviews/:id/photos/:photoId' }] }
 *          hasPhotos=true|1 (phase 22): only reviews with at least one photo (hidden or not)
 *   PATCH  /api/admin/reviews/:id                   { status } → { review }
 *   POST   /api/admin/reviews/bulk                  { ids, status } → { updated, skipped }
 *   DELETE /api/admin/reviews/:id                   → { deleted: true }
 *
 * Phase 22 (docs/backend/PHASE22_CONTRACT.md §3), a review's photos:
 *   GET    /api/admin/reviews/:id/photos/:photoId   → the photo (image/jpeg | png | webp only, ≤ 10 MB), never cached, sandboxed
 *   PATCH  /api/admin/reviews/:id/photos/:photoId   { hidden } → { review }
 */

const realData = () => process.env.VITE_API_PROVIDER === 'laravel' && process.env.VITE_ACCOUNTS_BACKEND === 'laravel'
const fromLaravel = (result, status) => (result.ok ? json(result.data, status ?? result.status) : json(result.body, result.status))
const invalid = (errors, message = 'Please check the highlighted fields.') => json({ message, errors }, 422)
const LIVE_ONLY = 'This needs the BuyNest backend; the demo catalog has no category tree, uploads, variants, import, or reviews.'
const liveOnly = () => json({ message: LIVE_ONLY }, 404)
const live = (handler) => (ctx) => (realData() ? handler(ctx) : liveOnly())

// Upload caps (the contract's): images 10 × 5 MB per request, plus room for the multipart framing; CSV 2 MB.
export const IMAGE_REQUEST_LIMIT = 60 * 1024 * 1024
export const IMPORT_REQUEST_LIMIT = 2 * 1024 * 1024 + 64 * 1024

const MAX_PAGE = 100
function pageParams(url) {
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), MAX_PAGE)
  const skip = Math.max(Number.parseInt(url.searchParams.get('skip') ?? '0', 10) || 0, 0)
  return { limit, skip }
}

// ---- rules (Laravel-style errors: { field: [message] }) ----

const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
const isId = (value) => Number.isInteger(value) && value > 0 && value < 1e9
const isText = (value, { min = 0, max }) => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max
const nullable = (rule) => (value) => (value === null ? null : rule(value))
const idList = (value, max) => Array.isArray(value) && value.length >= 1 && value.length <= max && value.every(isId) && new Set(value).size === value.length
export const isSlug = (value) => typeof value === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value) && value.length >= 2 && value.length <= 40
// The API's rule: an uploaded file on the store (/media/…) or an https:// address.
const isImageLink = (value) => typeof value === 'string' && value.length <= 2048 && /^(https:\/\/|\/media\/)[^\s]+$/i.test(value)

function check(body, rules, required = []) {
  const errors = {}
  const values = {}
  for (const [field, rule] of Object.entries(rules)) {
    if (body[field] === undefined) {
      if (required.includes(field)) errors[field] = [rule(undefined) ?? 'This field is required.']
      continue
    }
    const problem = rule(body[field])
    if (problem) errors[field] = [problem]
    else values[field] = typeof body[field] === 'string' ? body[field].trim() : body[field]
  }
  return { errors, values }
}
const result = ({ errors, values }) => (Object.keys(errors).length > 0 ? { errors } : { values })

const CATEGORY_RULES = {
  name: (value) => (isText(value, { min: 2, max: 120 }) ? null : 'Enter a name of 2 to 120 characters.'),
  slug: (value) => (isSlug(value) ? null : 'Use 2 to 40 lower-case letters, digits, and dashes.'),
  parentId: nullable((value) => (isId(value) ? null : 'Choose a parent category, or none for a top-level one.')),
  position: (value) => (Number.isInteger(value) && value >= 0 && value <= 100_000 ? null : 'Enter a position of 0 or more.'),
  isActive: (value) => (typeof value === 'boolean' ? null : 'Choose whether the category is active.'),
  imageUrl: nullable((value) => (value === '' || isImageLink(value) ? null : 'Use an https:// address or an uploaded image (/media/…).')),
  description: nullable((value) => (typeof value === 'string' && value.length <= 5000 ? null : 'Keep the description under 5000 characters.')),
  metaTitle: nullable((value) => (isText(value, { max: 190 }) ? null : 'Keep the meta title under 190 characters.')),
  metaDescription: nullable((value) => (isText(value, { max: 500 }) ? null : 'Keep the meta description under 500 characters.')),
}

export function validateCategory(body, { partial }) {
  const { errors, values } = check(body, CATEGORY_RULES, partial ? [] : ['name', 'slug'])
  for (const field of ['imageUrl', 'description', 'metaTitle', 'metaDescription']) if (values[field] === '') values[field] = null
  // Phase 13: bn: { name, description, metaTitle, metaDescription } (optional; '' = not translated).
  if (body.bn !== undefined) {
    const bangla = checkBangla(body.bn, 'category')
    Object.assign(errors, bangla.errors)
    if (Object.keys(bangla.values).length > 0) values.bn = bangla.values
  }
  if (partial && Object.keys(values).length === 0 && Object.keys(errors).length === 0) errors.name = ['Change at least one field.']
  return result({ errors, values })
}

export function validateReorder(body, max) {
  const errors = {}
  if (body.parentId !== undefined && body.parentId !== null && !isId(body.parentId)) errors.parentId = ['Choose a parent category, or none.']
  if (!idList(body.ids, max)) errors.ids = ['Send the ids in their new order, each once.']
  return Object.keys(errors).length > 0 ? { errors } : { values: { parentId: body.parentId ?? null, ids: body.ids } }
}

/** { options: [{ name, values: [text] }] }: up to 3 options of up to 20 distinct values. */
export function validateOptions(body) {
  const errors = {}
  if (!Array.isArray(body.options) || body.options.length > 3) return { errors: { options: ['Use up to 3 options (for example Size and Color).'] } }
  const names = new Set()
  const options = body.options.map((option, index) => {
    const name = typeof option?.name === 'string' ? option.name.trim() : ''
    if (!isText(name, { min: 1, max: 40 })) errors[`options.${index}.name`] = ['Name the option (up to 40 characters).']
    else if (names.has(name.toLowerCase())) errors[`options.${index}.name`] = ['Each option needs its own name.']
    names.add(name.toLowerCase())
    const raw = Array.isArray(option?.values) ? option.values : null
    // Phase 16: a value is text, or { value, swatch } (swatch: #RRGGBB for color options).
    const values = (raw ?? []).map((value) => (typeof value === 'string' ? value.trim() : typeof value?.value === 'string' ? value.value.trim() : ''))
    const seen = new Set(values.map((value) => value.toLowerCase()))
    if (!raw || values.length < 1 || values.length > 20) errors[`options.${index}.values`] = ['Give the option 1 to 20 values.']
    else if (values.some((value) => !isText(value, { min: 1, max: 40 }))) errors[`options.${index}.values`] = ['Each value needs 1 to 40 characters.']
    else if (seen.size !== values.length) errors[`options.${index}.values`] = ['Each value can appear once.']
    // Phase 16: the option's type (text buttons | color swatches) and each value's swatch.
    const look = optionLook(option, raw ?? [], index, errors)
    // Phase 13: the Bangla names (optional; left out = the saved ones stay): nameBn, and valuesBn in the values' order.
    return { name, values, ...look, ...optionBangla(option, index, values.length, errors) }
  })
  // Phase 16: at most one color option per product (the API's rule).
  const colors = options.map((option, index) => (option.type === 'color' ? index : -1)).filter((index) => index >= 0)
  for (const index of colors.slice(1)) errors[`options.${index}.type`] ??= ['Only one option can use colour swatches.']
  return Object.keys(errors).length > 0 ? { errors } : { values: { options } }
}

export const OPTION_TYPES = ['text', 'color']
export const isSwatch = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)

/*
 * Phase 16 §1: { type?, swatches? } of one option. `type` is text (default) or
 * color; a color option needs a #RRGGBB swatch per value, a text option has
 * none (null). Left out entirely (no type, plain text values) = nothing sent,
 * exactly as before. Problems go into `errors` as options.N.type and
 * options.N.values.M.swatch.
 */
function optionLook(option, raw, index, errors) {
  const hasObjects = raw.some((value) => value !== null && typeof value === 'object')
  if (option?.type === undefined && !hasObjects) return {}
  const type = option?.type ?? 'text'
  if (!OPTION_TYPES.includes(type)) {
    errors[`options.${index}.type`] = ['Choose text buttons or color swatches.']
    return {}
  }
  const swatches = raw.map((value, position) => {
    const swatch = value !== null && typeof value === 'object' && value.swatch !== undefined && value.swatch !== '' ? value.swatch : null
    if (type === 'text') return null
    if (!isSwatch(swatch)) errors[`options.${index}.values.${position}.swatch`] = ['Pick a colour as #RRGGBB (for example #1E40AF).']
    return isSwatch(swatch) ? swatch.toUpperCase() : null
  })
  return { type, swatches }
}

const VARIANT_RULES = {
  sku: (value) => (typeof value === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(value.trim()) ? null : 'Use up to 64 letters, digits, and dashes.'),
  price: nullable((value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0.01 && value <= 1_000_000 && hasCents(value) ? null : "Enter a price from 0.01 with at most 2 decimals, or leave it empty for the product's price.")),
  stock: (value) => (Number.isInteger(value) && value >= 0 && value <= 100_000 ? null : 'Enter a whole number of units from 0 to 100,000.'),
  isActive: (value) => (typeof value === 'boolean' ? null : 'Choose whether the variant is sold.'),
}
export function validateVariant(body) {
  const { errors, values } = check(body, VARIANT_RULES)
  if (Object.keys(values).length === 0 && Object.keys(errors).length === 0) errors.sku = ['Change at least one field.']
  return result({ errors, values })
}

/*
 * PATCH products/:id/images/:imageId: { alt?, optionValueId? } (at least one).
 * alt: up to 190 characters ('' / null = none). Phase 16 §2: optionValueId =
 * the option value the image is shown for (null = every choice); the API checks
 * that it belongs to the product.
 */
export function validateImage(body) {
  const errors = {}
  const values = {}
  const sentAlt = body.alt !== undefined
  const sentValue = body.optionValueId !== undefined
  if (sentAlt || !sentValue) {
    if (body.alt !== null && (typeof body.alt !== 'string' || body.alt.trim().length > 190)) errors.alt = ['Keep the description under 190 characters.']
    else values.alt = body.alt?.trim() || null
  }
  if (sentValue) {
    if (body.optionValueId !== null && !isId(body.optionValueId)) errors.optionValueId = ['Choose a value of one of the product’s options, or all of them.']
    else values.optionValueId = body.optionValueId
  }
  return result({ errors, values })
}

export const BULK_ACTIONS = ['enable', 'disable', 'archive', 'delete', 'set_category', 'adjust_price', 'set_stock']
export const MAX_BULK = 200

/** { ids, action, value? }: the value each action needs, in the API's shape. */
export function validateBulk(body) {
  const errors = {}
  if (!idList(body.ids, MAX_BULK)) errors.ids = [`Choose 1 to ${MAX_BULK} products.`]
  if (!BULK_ACTIONS.includes(body.action)) errors.action = ['Choose an action.']
  let value
  if (body.action === 'set_category') {
    if (!isId(body.value)) errors.value = ['Choose a category.']
    else value = body.value
  } else if (body.action === 'set_stock') {
    if (!Number.isInteger(body.value) || body.value < 0 || body.value > 100_000) errors.value = ['Enter a whole number of units from 0 to 100,000.']
    else value = body.value
  } else if (body.action === 'adjust_price') {
    const mode = body.value?.mode
    const amount = body.value?.amount
    if (!['percent', 'fixed'].includes(mode)) errors.value = ['Choose a percentage or a fixed amount.']
    else if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0 || !hasCents(amount)) errors.value = ['Enter a change other than 0, with at most 2 decimals (negative to lower prices).']
    else if (mode === 'percent' && (amount <= -100 || amount > 1000)) errors.value = ['Enter a percentage above -100 and up to 1000.']
    else if (mode === 'fixed' && Math.abs(amount) > 1_000_000) errors.value = ['Enter an amount up to 1,000,000.']
    else value = { mode, amount: amount.toFixed(2) }
  }
  return Object.keys(errors).length > 0 ? { errors } : { values: { ids: body.ids, action: body.action, ...(value !== undefined && { value }) } }
}

export const REVIEW_STATUSES = ['pending', 'approved', 'rejected']

// ---- uploads ----

/** A multipart upload, size-capped, as { contentType, bytes } or a Response to send back. */
async function upload(request, limit, what) {
  const contentType = multipartType(request)
  if (!contentType) return { response: invalid({ [what]: ['Send the file as a form upload (multipart/form-data).'] }) }
  const { bytes, tooLarge } = await readLimitedBody(request, limit)
  if (tooLarge) return { response: json({ message: `The upload is too large (at most ${Math.round(limit / 1024 / 1024)} MB at a time).`, errors: { [what]: ['The upload is too large.'] } }, 413) }
  if (bytes.byteLength === 0) return { response: invalid({ [what]: ['Choose a file.'] }) }
  return { upload: { contentType, bytes } }
}

// The file name from the API's Content-Disposition, if it's a plain one; else ours.
function downloadName(disposition) {
  const name = /filename="?([A-Za-z0-9._-]{1,100})"?/.exec(disposition ?? '')?.[1]
  return name && name.endsWith('.csv') ? name : 'buynest-products.csv'
}

/** ?q&category&status of the product list, well-formed values only, in the API's names. */
function productFilters(url) {
  const params = new URLSearchParams()
  const q = url.searchParams.get('q')?.trim().slice(0, 100)
  const category = url.searchParams.get('category')
  const status = url.searchParams.get('status')
  if (q) params.set('search', q)
  if (isSlug(category)) params.set('category', category)
  if (['active', 'draft', 'archived'].includes(status)) params.set('status', status)
  return params
}

const ctxIds = (ctx) => [ctx.id, ctx.sub]

export const CATALOG_ROUTES = {
  'POST categories': live(async (ctx) => {
    const { values, errors } = validateCategory(await readBody(ctx.request), { partial: false })
    if (errors) return invalid(errors)
    return fromLaravel(await laravelCatalogData.createCategory(ctx.token, values, ctx.request), 201)
  }),
  'PATCH categories/:id': live(async (ctx) => {
    const { values, errors } = validateCategory(await readBody(ctx.request), { partial: true })
    if (errors) return invalid(errors)
    if (values.parentId === Number(ctx.id)) return invalid({ parentId: ["A category can't be inside itself."] })
    return fromLaravel(await laravelCatalogData.updateCategory(ctx.token, ctx.id, values, ctx.request))
  }),
  'DELETE categories/:id': live(async (ctx) => fromLaravel(await laravelCatalogData.deleteCategory(ctx.token, ctx.id, ctx.request), 200)),
  'POST categories/reorder': live(async (ctx) => {
    const { values, errors } = validateReorder(await readBody(ctx.request), 500)
    if (errors) return invalid(errors)
    return fromLaravel(await laravelCatalogData.reorderCategories(ctx.token, values, ctx.request), 200)
  }),

  'POST products/:id/images': live(async (ctx) => {
    const sent = await upload(ctx.request, IMAGE_REQUEST_LIMIT, 'images')
    if (sent.response) return sent.response
    return fromLaravel(await laravelCatalogData.uploadImages(ctx.token, ctx.id, sent.upload, ctx.request), 201)
  }),
  'PATCH products/:id/images/:sub': live(async (ctx) => {
    const { values, errors } = validateImage(await readBody(ctx.request))
    if (errors) return invalid(errors)
    const [id, imageId] = ctxIds(ctx)
    return fromLaravel(await laravelCatalogData.updateImage(ctx.token, id, imageId, values, ctx.request))
  }),
  'DELETE products/:id/images/:sub': live(async (ctx) => fromLaravel(await laravelCatalogData.deleteImage(ctx.token, ...ctxIds(ctx), ctx.request), 200)),
  'POST products/:id/images/reorder': live(async (ctx) => {
    const { values, errors } = validateReorder(await readBody(ctx.request), 50)
    if (errors) return invalid(errors)
    return fromLaravel(await laravelCatalogData.reorderImages(ctx.token, ctx.id, { ids: values.ids }, ctx.request), 200)
  }),

  'PUT products/:id/options': live(async (ctx) => {
    const { values, errors } = validateOptions(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelCatalogData.saveOptions(ctx.token, ctx.id, values, ctx.request))
  }),
  'POST products/:id/variants/generate': live(async (ctx) => fromLaravel(await laravelCatalogData.generateVariants(ctx.token, ctx.id, ctx.request), 200)),
  'PATCH products/:id/variants/:sub': live(async (ctx) => {
    const { values, errors } = validateVariant(await readBody(ctx.request))
    if (errors) return invalid(errors)
    const [id, variantId] = ctxIds(ctx)
    return fromLaravel(await laravelCatalogData.updateVariant(ctx.token, id, variantId, values, ctx.request))
  }),

  'POST products/bulk': live(async (ctx) => {
    const { values, errors } = validateBulk(await readBody(ctx.request))
    if (errors) return invalid(errors)
    return fromLaravel(await laravelCatalogData.bulk(ctx.token, values, ctx.request))
  }),

  'GET products/export.csv': live(async (ctx) => {
    const file = await laravelFile(`/api/admin/v1/products/export.csv?${productFilters(ctx.url)}`, { token: ctx.token, request: ctx.request })
    if (file.text === undefined) return json(failed(file).body, file.status)
    return new Response(file.text, {
      status: 200,
      headers: {
        'Content-Type': file.contentType.startsWith('text/csv') ? file.contentType : 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${downloadName(file.disposition)}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }),
  'POST products/import': live(async (ctx) => {
    const sent = await upload(ctx.request, IMPORT_REQUEST_LIMIT, 'file')
    if (sent.response) return sent.response
    // A dry run unless the admin says "import now" (dryRun=false).
    const dryRun = ctx.url.searchParams.get('dryRun') !== 'false'
    return fromLaravel(await laravelCatalogData.importProducts(ctx.token, { dryRun, ...sent.upload }, ctx.request))
  }),

  'GET reviews': live(async (ctx) => {
    const { searchParams } = ctx.url
    const rating = Number(searchParams.get('rating'))
    const filters = {
      status: REVIEW_STATUSES.includes(searchParams.get('status')) ? searchParams.get('status') : undefined,
      productId: /^\d{1,9}$/.test(searchParams.get('productId') ?? '') ? searchParams.get('productId') : undefined,
      rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : undefined,
      q: searchParams.get('q')?.trim().slice(0, 100) || undefined,
      // Phase 22.
      hasPhotos: ['1', 'true'].includes(searchParams.get('hasPhotos')) || undefined,
      ...pageParams(ctx.url),
    }
    return fromLaravel(await laravelCatalogData.listReviews(ctx.token, filters, ctx.request))
  }),
  'PATCH reviews/:id': live(async (ctx) => {
    const { status } = await readBody(ctx.request)
    if (!REVIEW_STATUSES.includes(status)) return invalid({ status: ['Choose approved, rejected, or pending.'] })
    return fromLaravel(await laravelCatalogData.updateReview(ctx.token, ctx.id, { status }, ctx.request))
  }),
  'POST reviews/bulk': live(async (ctx) => {
    const body = await readBody(ctx.request)
    const errors = {}
    if (!idList(body.ids, MAX_BULK)) errors.ids = [`Choose 1 to ${MAX_BULK} reviews.`]
    if (!REVIEW_STATUSES.includes(body.status)) errors.status = ['Choose approved, rejected, or pending.']
    if (Object.keys(errors).length > 0) return invalid(errors)
    return fromLaravel(await laravelCatalogData.bulkReviews(ctx.token, { ids: body.ids, status: body.status }, ctx.request))
  }),
  'DELETE reviews/:id': live(async (ctx) => fromLaravel(await laravelCatalogData.deleteReview(ctx.token, ctx.id, ctx.request), 200)),

  // Phase 22: a review's photo for staff (any status, hidden too). Never cached, and sandboxed like the store's photos.
  'GET reviews/:id/photos/:sub': live(async (ctx) => {
    const photo = await laravelCatalogData.reviewPhoto(ctx.token, ...ctxIds(ctx), ctx.request)
    if (!photo.bytes) return json(failed(photo).body, photo.status)
    return new Response(photo.bytes, {
      status: 200,
      headers: {
        'Content-Type': photo.contentType,
        'Content-Length': String(photo.bytes.byteLength),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    })
  }),
  'PATCH reviews/:id/photos/:sub': live(async (ctx) => {
    const { hidden } = await readBody(ctx.request)
    if (typeof hidden !== 'boolean') return invalid({ hidden: ['Choose whether the photo is hidden from the store.'] })
    const [id, photoId] = ctxIds(ctx)
    return fromLaravel(await laravelCatalogData.updateReviewPhoto(ctx.token, id, photoId, { hidden }, ctx.request))
  }),
}

/** /api/admin/<resource>/<action> without an id (products/bulk, categories/reorder…). */
export const NAMED_ACTIONS = ['products/bulk', 'products/import', 'products/export.csv', 'categories/reorder', 'reviews/bulk']
/** /api/admin/products/:id/<part>[/<sub>]: sub-resources of a product. */
export const PRODUCT_PARTS = { images: ['reorder'], options: [], variants: ['generate'] }
/** Phase 22: /api/admin/reviews/:id/photos/:photoId, a review's photo. */
export const REVIEW_PARTS = { photos: [] }
