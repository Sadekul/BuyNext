import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuArrowDown, LuArrowUp, LuEye, LuEyeOff, LuFolderPlus, LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu'
import { adminKeys, createCategory, deleteCategory, getCategories, reorderCategories, updateCategory } from '../api/admin'
import { useAdminAuth } from '../auth/useAdminAuth'
import ConfirmDialog from '../components/ConfirmDialog'
import Field from '../components/Field'
import FormDialog from '../components/FormDialog'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { MAX_DEPTH, descendantIds, siblingsOf, slugify, withPaths } from '../utils/categories'
import { formatCount } from '../utils/format'

const ACTIVE = { tone: 'success', label: 'Active' }
const HIDDEN = { tone: 'neutral', label: 'Inactive' }

/**
 * Catalog → Categories (Magento's category tree, phase 5): up to three
 * levels. Add a child, edit in a dialog, turn on/off, delete (the server
 * refuses while there are subcategories or products, and says how many), and
 * move up/down among siblings with buttons, no dragging. Reading needs
 * products.view; every change categories.edit.
 */
function CategoriesPage() {
  const queryClient = useQueryClient()
  const { can } = useAdminAuth()
  const editable = can('categories.edit')
  const [dialog, setDialog] = useState(null) // { category? , parentId? }
  const [toDelete, setToDelete] = useState(null)
  const [notice, setNotice] = useState(null)
  const [announcement, setAnnouncement] = useState('')
  const noticeRef = useRef(null)
  const opener = useRef(null)
  const buttons = useRef(new Map())

  const categories = useQuery({ queryKey: adminKeys.categories, queryFn: ({ signal }) => getCategories({ signal }) })
  const list = withPaths(categories.data ?? [])

  function say(text, tone = 'success') {
    setNotice({ text, tone })
    requestAnimationFrame(() => noticeRef.current?.focus())
  }
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.categories })

  function open(state, event) {
    opener.current = event.currentTarget
    setNotice(null)
    setDialog(state)
  }
  function close() {
    setDialog(null)
    opener.current?.focus()
  }

  const toggle = useMutation({
    mutationFn: (category) => updateCategory(category.id, { isActive: !category.isActive }),
    onSuccess: async (_, category) => {
      await refresh()
      say(category.isActive ? `${category.name} is now inactive: it and everything in it are hidden from the store.` : `${category.name} is active again.`)
    },
    onError: (error) => say(error.message, 'error'),
  })

  const remove = useMutation({
    mutationFn: (category) => deleteCategory(category.id),
    onSuccess: async (_, category) => {
      setToDelete(null)
      await refresh()
      say(`${category.name} was deleted.`)
    },
    // Still has subcategories or products: the server's message says how many.
    onError: (error) => {
      setToDelete(null)
      say(error.message, 'error')
    },
  })

  const move = useMutation({
    mutationFn: ({ category, step }) => {
      const ids = siblingsOf(list, category).map((item) => item.id)
      const from = ids.indexOf(category.id)
      ids.splice(from, 1)
      ids.splice(from + step, 0, category.id)
      return reorderCategories(category.parentId ?? null, ids).then(() => ({ ids, position: from + step }))
    },
    onSuccess: async ({ ids, position }, { category, step }) => {
      await refresh()
      setAnnouncement(`${category.name} moved to position ${position + 1} of ${ids.length}.`)
      // Keep focus on the same arrow, or the other one at either end.
      const atEnd = step < 0 ? position === 0 : position === ids.length - 1
      const key = `${category.id}-${(step < 0) !== atEnd ? 'up' : 'down'}`
      requestAnimationFrame(() => buttons.current.get(key)?.focus())
    },
    onError: (error) => say(error.message, 'error'),
  })

  const children = new Map()
  for (const category of list) children.set(category.parentId ?? null, [...(children.get(category.parentId ?? null) ?? []), category])

  function renderLevel(parentId) {
    const level = children.get(parentId) ?? []
    if (level.length === 0) return null
    return (
      <ul className="category-tree" role="list">
        {level.map((category, index) => (
          <li key={category.id}>
            <div className={`category-tree__row${category.isActive ? '' : ' category-tree__row--inactive'}`}>
              <div className="category-tree__name">
                <strong>{category.name}</strong>
                <small className="muted">
                  /{category.slug} · {formatCount(category.productCount)} {category.productCount === 1 ? 'product' : 'products'}
                </small>
              </div>
              <StatusBadge icon={category.isActive ? LuEye : LuEyeOff} {...(category.isActive ? ACTIVE : HIDDEN)} />
              {editable && (
                <div className="category-tree__tools">
                  <button
                    type="button"
                    ref={(node) => buttons.current.set(`${category.id}-up`, node)}
                    className="icon-button"
                    aria-label={`Move ${category.name} up`}
                    disabled={index === 0 || move.isPending}
                    onClick={() => move.mutate({ category, step: -1 })}
                  >
                    <LuArrowUp aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    ref={(node) => buttons.current.set(`${category.id}-down`, node)}
                    className="icon-button"
                    aria-label={`Move ${category.name} down`}
                    disabled={index === level.length - 1 || move.isPending}
                    onClick={() => move.mutate({ category, step: 1 })}
                  >
                    <LuArrowDown aria-hidden="true" />
                  </button>
                  {category.depth < MAX_DEPTH - 1 && (
                    <button type="button" className="icon-button" aria-label={`Add a subcategory to ${category.name}`} onClick={(event) => open({ parentId: category.id }, event)}>
                      <LuFolderPlus aria-hidden="true" />
                    </button>
                  )}
                  <button type="button" className="icon-button" aria-label={`Edit ${category.name}`} onClick={(event) => open({ category }, event)}>
                    <LuPencil aria-hidden="true" />
                  </button>
                  <button type="button" className="btn btn--outline btn--sm" disabled={toggle.isPending} onClick={() => toggle.mutate(category)} aria-label={`${category.isActive ? 'Deactivate' : 'Activate'} ${category.name}`}>
                    {category.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button--danger"
                    aria-label={`Delete ${category.name}`}
                    onClick={(event) => {
                      opener.current = event.currentTarget
                      setToDelete(category)
                    }}
                  >
                    <LuTrash2 aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
            {renderLevel(category.id)}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <>
      <title>Categories | BuyNest Admin</title>
      <PageHeader
        title="Categories"
        description="Up to three levels. A category is shown in the store only when it and every category above it are active."
        actions={
          editable && (
            <button type="button" className="btn btn--primary" onClick={(event) => open({ parentId: null }, event)}>
              <LuPlus aria-hidden="true" /> Add category
            </button>
          )
        }
      />
      <div role={notice?.tone === 'error' ? 'alert' : 'status'}>
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className={notice.tone === 'success' ? 'notice notice--success' : 'form-error'}>
            {notice.text}
          </p>
        )}
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>

      {categories.isPending && <Loading label="Loading categories…" />}
      {categories.error && <ErrorState error={categories.error} onRetry={categories.refetch} />}
      {categories.data && list.length === 0 && <Empty>No categories yet.</Empty>}
      {categories.data && list.length > 0 && (
        <section className="panel category-panel" aria-label="Category tree" aria-busy={categories.isFetching || move.isPending}>
          {renderLevel(null)}
        </section>
      )}

      <CategoryDialog key={dialog ? (dialog.category?.id ?? `new-${dialog.parentId}`) : 'closed'} state={dialog} categories={list} onClose={close} onSaved={async (text) => {
        setDialog(null)
        await refresh()
        say(text)
      }} />

      <ConfirmDialog
        isOpen={toDelete !== null}
        title={`Delete ${toDelete?.name ?? 'this category'}?`}
        message="Only an empty category can be deleted: move its subcategories and products elsewhere first."
        confirmLabel="Delete category"
        busy={remove.isPending}
        onConfirm={() => remove.mutate(toDelete)}
        onCancel={() => {
          setToDelete(null)
          opener.current?.focus()
        }}
      />
    </>
  )
}

const EMPTY = { name: '', slug: '', parentId: '', isActive: true, description: '', imageUrl: '', metaTitle: '', metaDescription: '' }
const err = (errors, key) => errors[key]?.[0]

/** How many levels a category's subtree has (1 = no children). */
function height(categories, id) {
  const below = categories.filter((category) => category.parentId === id)
  return 1 + Math.max(0, ...below.map((category) => height(categories, category.id)))
}

/** Add (state.parentId) or edit (state.category) a category. */
function CategoryDialog({ state, categories, onClose, onSaved }) {
  const editing = state?.category ?? null
  const [values, setValues] = useState(() =>
    editing
      ? Object.fromEntries(Object.keys(EMPTY).map((key) => [key, key === 'parentId' ? (editing.parentId ?? '') : (editing[key] ?? EMPTY[key])]))
      : { ...EMPTY, parentId: state?.parentId ?? '' },
  )
  const [slugTouched, setSlugTouched] = useState(Boolean(editing))
  const [errors, setErrors] = useState({})
  const set = (key) => (event) => setValues({ ...values, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value })

  // Parents that keep the tree at most MAX_DEPTH deep, never the category itself or one below it.
  const excluded = editing ? descendantIds(categories, editing.id) : new Set()
  const levels = editing ? height(categories, editing.id) : 1
  const parents = categories.filter((category) => !excluded.has(category.id) && category.depth + 1 + levels <= MAX_DEPTH)

  const save = useMutation({
    mutationFn: (body) => (editing ? updateCategory(editing.id, body) : createCategory(body)),
    onSuccess: (_, body) => onSaved(editing ? `${body.name ?? editing.name} saved.` : `${body.name} added.`),
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  })

  function submit() {
    const found = {}
    if (values.name.trim().length < 2) found.name = ['Enter a name of 2 to 120 characters.']
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(values.slug) || values.slug.length < 2 || values.slug.length > 40) found.slug = ['Use 2 to 40 lower-case letters, digits, and dashes.']
    if (values.imageUrl.trim() && !/^(https:\/\/|\/media\/)\S+$/i.test(values.imageUrl.trim())) found.imageUrl = ['Use an https:// address or an uploaded image (/media/…).']
    setErrors(found)
    if (Object.keys(found).length > 0) return
    const body = {
      name: values.name.trim(),
      slug: values.slug,
      parentId: values.parentId === '' ? null : Number(values.parentId),
      isActive: values.isActive,
      description: values.description.trim() || null,
      imageUrl: values.imageUrl.trim() || null,
      metaTitle: values.metaTitle.trim() || null,
      metaDescription: values.metaDescription.trim() || null,
    }
    save.mutate(body)
  }

  const parentName = categories.find((category) => category.id === state?.parentId)?.path
  return (
    <FormDialog
      isOpen={state !== null}
      title={editing ? `Edit ${editing.name}` : parentName ? `Add a subcategory to ${parentName}` : 'Add a category'}
      submitLabel={editing ? 'Save category' : 'Add category'}
      busy={save.isPending}
      error={save.error && !save.error.fieldErrors ? save.error.message : Object.keys(errors).length > 0 ? 'Please check the highlighted fields.' : null}
      onSubmit={submit}
      onCancel={onClose}
      wide
    >
      <div className="form__grid">
        <Field label="Name" error={err(errors, 'name')}>
          {(a11y) => (
            <input
              {...a11y}
              value={values.name}
              maxLength={120}
              onChange={(event) => setValues({ ...values, name: event.target.value, ...(!slugTouched && { slug: slugify(event.target.value) }) })}
            />
          )}
        </Field>
        <Field label="URL key (slug)" error={err(errors, 'slug')} hint="Used in the store's address: /category/your-slug.">
          {(a11y) => (
            <input
              {...a11y}
              value={values.slug}
              maxLength={40}
              onChange={(event) => {
                setSlugTouched(true)
                setValues({ ...values, slug: event.target.value.toLowerCase() })
              }}
            />
          )}
        </Field>
        <Field label="Parent category" error={err(errors, 'parentId')} hint={`Categories go at most ${MAX_DEPTH} levels deep.`}>
          {(a11y) => (
            <select {...a11y} value={values.parentId} onChange={set('parentId')}>
              <option value="">None (top level)</option>
              {parents.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.path}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Image address" error={err(errors, 'imageUrl')} hint="Optional: an https:// address.">
          {(a11y) => <input {...a11y} value={values.imageUrl} maxLength={500} onChange={set('imageUrl')} />}
        </Field>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={values.isActive} onChange={set('isActive')} />
        Active (shown in the store)
      </label>
      <Field label="Description" error={err(errors, 'description')}>
        {(a11y) => <textarea {...a11y} rows={3} value={values.description} maxLength={5000} onChange={set('description')} />}
      </Field>
      <div className="form__grid">
        <Field label="Meta title" error={err(errors, 'metaTitle')}>
          {(a11y) => <input {...a11y} value={values.metaTitle} maxLength={190} onChange={set('metaTitle')} />}
        </Field>
        <Field label="Meta description" error={err(errors, 'metaDescription')}>
          {(a11y) => <input {...a11y} value={values.metaDescription} maxLength={500} onChange={set('metaDescription')} />}
        </Field>
      </div>
    </FormDialog>
  )
}

export default CategoriesPage
