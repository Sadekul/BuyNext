import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu'
import { adminKeys, createCustomerGroup, deleteCustomerGroup, getCustomerGroups, updateCustomerGroup } from '../api/admin'
import { useAdminAuth } from '../auth/useAdminAuth'
import Field from '../components/Field'
import FormDialog from '../components/FormDialog'
import PageHeader from '../components/PageHeader'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount } from '../utils/format'
import { actionErrorMessage } from '../utils/permissions'

const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
/** "Wholesale buyers" → "wholesale_buyers" (the API's code rule: a-z, 0-9, _). */
const toCode = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)

/**
 * Customer groups (Magento's Customers → Customer Groups): each has a
 * discount on every product price for its members. The system group
 * (General, for new sign-ups) can change its discount but can't be deleted;
 * a group with customers can't be deleted either (the API says how many).
 * Reading needs customers.view, changing customer_groups.manage.
 */
function CustomerGroupsPage() {
  const { can } = useAdminAuth()
  const queryClient = useQueryClient()
  const editable = can('customer_groups.manage')
  const groups = useQuery({ queryKey: adminKeys.customerGroups, queryFn: ({ signal }) => getCustomerGroups({ signal }) })
  const [editing, setEditing] = useState(null) // a group, or {} for a new one
  const [removing, setRemoving] = useState(null)
  const [notice, setNotice] = useState(null)
  const noticeRef = useRef(null)

  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  const changed = (text) => {
    queryClient.invalidateQueries({ queryKey: adminKeys.customerGroups })
    queryClient.invalidateQueries({ queryKey: ['customers'] })
    setNotice({ tone: 'success', text })
  }
  const remove = useMutation({
    mutationFn: (group) => deleteCustomerGroup(group.id),
    onSuccess: (_, group) => {
      setRemoving(null)
      changed(`${group.name} deleted.`)
    },
  })

  return (
    <>
      <title>Customer groups | BuyNest Admin</title>
      <PageHeader
        title="Customer groups"
        description="Each group's discount comes off every product price for its members, before coupons."
        actions={
          editable && (
            <button type="button" className="btn btn--primary" onClick={() => setEditing({})}>
              <LuPlus aria-hidden="true" /> Add group
            </button>
          )
        }
      />
      <div role="status">
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className="notice notice--success">
            {notice.text}
          </p>
        )}
      </div>
      {groups.isPending && <Loading label="Loading customer groups…" />}
      {groups.error && <ErrorState error={groups.error} onRetry={groups.refetch} />}
      {groups.data && groups.data.groups.length === 0 && <Empty>No customer groups.</Empty>}
      {groups.data && groups.data.groups.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <caption className="visually-hidden">Customer groups</caption>
            <thead>
              <tr>
                <th scope="col">Group</th>
                <th scope="col">Code</th>
                <th scope="col" className="num">
                  Discount
                </th>
                <th scope="col" className="num">
                  Customers
                </th>
                {editable && (
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {groups.data.groups.map((group) => (
                <tr key={group.id}>
                  <th scope="row">
                    {group.name}
                    {group.isSystem && <small className="muted"> · default for new sign-ups</small>}
                  </th>
                  <td>
                    <code>{group.code}</code>
                  </td>
                  <td className="num">{group.discountPercent > 0 ? `${group.discountPercent}%` : 'None'}</td>
                  <td className="num">{group.customerCount === null ? '—' : formatCount(group.customerCount)}</td>
                  {editable && (
                    <td className="table__actions">
                      <button type="button" className="icon-button" aria-label={`Edit ${group.name}`} onClick={() => setEditing(group)}>
                        <LuPencil aria-hidden="true" />
                      </button>
                      {!group.isSystem && (
                        <button
                          type="button"
                          className="icon-button icon-button--danger"
                          aria-label={`Delete ${group.name}`}
                          onClick={() => {
                            remove.reset()
                            setRemoving(group)
                          }}
                        >
                          <LuTrash2 aria-hidden="true" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <GroupDialog
          group={editing.id ? editing : null}
          onDone={(text) => {
            setEditing(null)
            changed(text)
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {removing && (
        <FormDialog
          isOpen
          danger
          title={`Delete ${removing.name}?`}
          description="Only a group without customers can be deleted. Past orders keep the group name they were placed with."
          submitLabel="Delete group"
          busy={remove.isPending}
          error={remove.error ? (Object.values(remove.error.fieldErrors ?? {})[0]?.[0] ?? actionErrorMessage(remove.error)) : null}
          onSubmit={() => remove.mutate(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </>
  )
}

function GroupDialog({ group, onDone, onCancel }) {
  const [name, setName] = useState(group?.name ?? '')
  const [code, setCode] = useState(group?.code ?? '')
  const [codeTouched, setCodeTouched] = useState(Boolean(group))
  const [discount, setDiscount] = useState(group ? String(group.discountPercent) : '0')
  const [errors, setErrors] = useState({})
  const save = useMutation({
    mutationFn: (values) => (group ? updateCustomerGroup(group.id, values) : createCustomerGroup(values)),
    onSuccess: ({ group: saved }) => onDone(group ? `${saved?.name ?? name} saved.` : `${saved?.name ?? name} added.`),
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  })

  function submit() {
    const found = {}
    const percent = Number(discount)
    if (!name.trim()) found.name = ['Enter a name.']
    if (!/^[a-z0-9_]{1,40}$/.test(code.trim())) found.code = ['Use up to 40 lower-case letters, digits, and underscores.']
    if (discount.trim() === '' || !Number.isFinite(percent) || percent < 0 || percent > 90 || !hasCents(percent)) found.discountPercent = ['Enter a discount from 0 to 90%, with at most 2 decimals.']
    setErrors(found)
    if (Object.keys(found).length > 0) return
    // The default (system) group keeps its code.
    save.mutate(group?.isSystem ? { name: name.trim(), discountPercent: percent } : { name: name.trim(), code: code.trim(), discountPercent: percent })
  }

  const system = group?.isSystem === true
  const other = save.error && !save.error.fieldErrors ? actionErrorMessage(save.error) : null
  return (
    <FormDialog isOpen title={group ? `Edit ${group.name}` : 'Add customer group'} submitLabel={group ? 'Save group' : 'Add group'} busy={save.isPending} error={other} onSubmit={submit} onCancel={onCancel}>
      <Field label="Name" error={errors.name?.[0]}>
        {(a11y) => (
          <input
            {...a11y}
            value={name}
            maxLength={60}
            onChange={(event) => {
              setName(event.target.value)
              if (!codeTouched) setCode(toCode(event.target.value))
            }}
          />
        )}
      </Field>
      <Field label="Code" error={errors.code?.[0]} hint={system ? "The default group's code can't change." : 'Lower-case letters, digits, and underscores; used in exports.'}>
        {(a11y) => (
          <input
            {...a11y}
            value={code}
            maxLength={40}
            readOnly={system}
            autoComplete="off"
            onChange={(event) => {
              setCodeTouched(true)
              setCode(event.target.value)
            }}
          />
        )}
      </Field>
      <Field label="Discount (%)" error={errors.discountPercent?.[0]} hint="0 to 90. Applied to each product's sale price, before coupons.">
        {(a11y) => <input {...a11y} type="number" inputMode="decimal" min="0" max="90" step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} />}
      </Field>
    </FormDialog>
  )
}

export default CustomerGroupsPage
