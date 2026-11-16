/*
 * The category tree, from the flat list the adapters return
 * (`[{ slug, name, parentSlug?, depth? }]`, in tree order). DummyJSON's
 * categories have no parent, so they are all top-level and nothing here
 * changes for the demo.
 */

/** Top-level categories, in the API's order. */
export function topLevelCategories(categories) {
  return categories.filter((category) => !category.parentSlug)
}

/** The direct children of a category, in the API's order. */
export function childCategories(categories, slug) {
  return categories.filter((category) => category.parentSlug === slug)
}

/** The category's parents, top-level first (not the category itself). */
export function categoryAncestors(categories, slug) {
  const bySlug = new Map(categories.map((category) => [category.slug, category]))
  const ancestors = []
  let current = bySlug.get(slug)
  while (current?.parentSlug && ancestors.length < 5) {
    current = bySlug.get(current.parentSlug)
    if (!current) break
    ancestors.unshift(current)
  }
  return ancestors
}
