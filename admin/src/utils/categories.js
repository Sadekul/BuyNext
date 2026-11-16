/*
 * The category tree (phase 5). The admin service sends it as a flat list in
 * tree order (each parent before its children) with `parentId` and `depth`;
 * the demo data is a flat list of { slug, name } without either.
 */

/** "Beauty › Lipstick": a category's name with its ancestors, for dropdowns. */
export function withPaths(categories = []) {
  const byId = new Map(categories.filter((category) => category.id !== undefined).map((category) => [category.id, category]))
  return categories.map((category) => {
    const names = [category.name]
    let parent = byId.get(category.parentId)
    for (let guard = 0; parent && guard < 10; guard += 1) {
      names.unshift(parent.name)
      parent = byId.get(parent.parentId)
    }
    return { ...category, path: names.join(' › ') }
  })
}

/** The siblings of `category` (same parent), in their current order. */
export const siblingsOf = (categories, category) => categories.filter((item) => (item.parentId ?? null) === (category.parentId ?? null))

/** `id` and every category below it (to keep a category from moving under itself). */
export function descendantIds(categories, id) {
  const found = new Set([id])
  for (const category of categories) if (found.has(category.parentId)) found.add(category.id)
  return found
}

export const MAX_DEPTH = 3

/** Lower-case a-z0-9 and dashes, from a name ("Skin Care & More" → "skin-care-more"). */
export const slugify = (name) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
