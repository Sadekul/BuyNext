import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuArrowLeft, LuMail, LuPencil, LuPlus, LuShoppingCart, LuTrash2 } from 'react-icons/lu'
import {
  addCustomerNote,
  adminKeys,
  createCustomerAddress,
  deleteCustomer,
  deleteCustomerAddress,
  getCustomer,
  getCustomerGroups,
  getSettings,
  sendCustomerPasswordReset,
  updateCustomer,
  updateCustomerAddress,
} from '../api/admin'
import { useAdminAuth } from '../auth/useAdminAuth'
import { Address, AddressFields } from '../components/Address'
import ConfirmDialog from '../components/ConfirmDialog'
import Field from '../components/Field'
import FormDialog from '../components/FormDialog'
import PageHeader from '../components/PageHeader'
import StatTile from '../components/StatTile'
import StatusBadge from '../components/StatusBadge'
import Tabs from '../components/Tabs'
import { Empty, ErrorState, Loading } from '../components/States'
import { EMPTY_ADDRESS, addressErrors, addressValues } from '../utils/address'
import { accountStatus, isEmail } from '../utils/customers'
import { formatCount, formatDate, formatDateTime, formatMoney, fullName } from '../utils/format'
import { orderSource, orderStatus, paymentStatus } from '../utils/orders'
import { actionErrorMessage } from '../utils/permissions'

const TABS = [
  { id: 'account', label: 'Account' },
  { id: 'addresses', label: 'Addresses' },
  { id: 'orders', label: 'Orders' },
  { id: 'notes', label: 'Notes' },
]

/**
 * One customer (Magento's Customers → Edit): account details and group,
 * address book, recent orders, and internal notes in tabs; actions to send a
 * password reset, block or unblock, and delete. Each action needs its own
 * permission (customers.edit, customers.delete); the API refuses the same.
 */
function CustomerDetailPage() {
  const { customerId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { can } = useAdminAuth()
  const [tab, setTab] = useState('account')
  const [notice, setNotice] = useState(() => (location.state?.notice ? { tone: 'success', text: location.state.notice } : null))
  const [dialog, setDialog] = useState(null) // 'block' | 'delete'
  const noticeRef = useRef(null)
  const customer = useQuery({ queryKey: adminKeys.customer(customerId), queryFn: ({ signal }) => getCustomer(customerId, { signal }) })

  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: adminKeys.customer(customerId) })
    queryClient.invalidateQueries({ queryKey: ['customers'] })
  }
  const say = (text, tone = 'success') => setNotice({ text, tone })

  const reset = useMutation({
    mutationFn: () => sendCustomerPasswordReset(customerId),
    onSuccess: () => say(`A password reset email is on its way to ${customer.data.email}.`),
    onError: (error) => say(actionErrorMessage(error), 'error'),
  })
  const setActive = useMutation({
    mutationFn: (isActive) => updateCustomer(customerId, { isActive }),
    onSuccess: (updated) => {
      setDialog(null)
      refresh()
      say(updated.isActive ? `${fullName(updated)} can sign in again.` : `${fullName(updated)} is blocked and has been signed out everywhere.`)
    },
    onError: (error) => {
      setDialog(null)
      say(actionErrorMessage(error), 'error')
    },
  })
  const remove = useMutation({
    mutationFn: () => deleteCustomer(customerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      queryClient.removeQueries({ queryKey: adminKeys.customer(customerId) })
      navigate('/customers', { state: { notice: `${fullName(customer.data)}'s account was deleted. Their orders and reviews are kept.` } })
    },
  })

  if (customer.isPending) return <Loading label="Loading the customer…" />
  if (customer.error) return <ErrorState error={customer.error} onRetry={customer.refetch} />

  const data = customer.data
  const name = fullName(data) || data.email
  return (
    <>
      <title>{`${name} | BuyNest Admin`}</title>
      <Link to="/customers" className="back-link">
        <LuArrowLeft aria-hidden="true" /> Customers
      </Link>
      <PageHeader
        title={name}
        description={`${data.email}${data.group ? ` · ${data.group.name}${data.group.discountPercent > 0 ? ` (${data.group.discountPercent}% off)` : ''}` : ''}`}
        actions={<StatusBadge {...accountStatus(data)} />}
      />
      <div role={notice?.tone === 'error' ? 'alert' : 'status'}>
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className={notice.tone === 'error' ? 'form-error' : 'notice notice--success'}>
            {notice.text}
          </p>
        )}
      </div>

      <div className="customer-actions">
        {can('orders.create') && (
          <Link to={`/orders/new?customer=${data.id}`} className="btn btn--primary btn--sm">
            <LuShoppingCart aria-hidden="true" /> Create order
          </Link>
        )}
        {can('customers.edit') && (
          <>
            <button type="button" className="btn btn--outline btn--sm" disabled={reset.isPending} onClick={() => reset.mutate()}>
              <LuMail aria-hidden="true" /> {reset.isPending ? 'Sending…' : 'Send password reset'}
            </button>
            {data.isActive ? (
              <button type="button" className="btn btn--outline btn--sm" onClick={() => setDialog('block')}>
                Block
              </button>
            ) : (
              <button type="button" className="btn btn--outline btn--sm" disabled={setActive.isPending} onClick={() => setActive.mutate(true)}>
                Unblock
              </button>
            )}
          </>
        )}
        {can('customers.delete') && (
          <button type="button" className="btn btn--danger btn--sm" onClick={() => setDialog('delete')}>
            <LuTrash2 aria-hidden="true" /> Delete
          </button>
        )}
      </div>

      <dl className="stats stats--customer">
        <StatTile label="Orders" value={formatCount(data.ordersCount)} />
        <StatTile label="Lifetime spent" value={formatMoney(data.lifetimeSpent)} note="Orders not cancelled, minus refunds" />
        <StatTile label="Reviews" value={formatCount(data.reviewsCount)} />
        <StatTile label="Last sign-in" value={formatDate(data.lastLoginAt, 'Never')} note={`Joined ${formatDate(data.createdAt)}`} />
      </dl>

      <Tabs label={`${name}'s details`} tabs={TABS} selected={tab} onSelect={setTab}>
        {(selected) =>
          ({
            account: <AccountTab customer={data} onSaved={(text) => (refresh(), say(text))} />,
            addresses: <AddressesTab customer={data} onChanged={(text) => (refresh(), say(text))} />,
            orders: <OrdersTab customer={data} />,
            notes: <NotesTab customer={data} onAdded={(text) => (refresh(), say(text))} />,
          })[selected]
        }
      </Tabs>

      <ConfirmDialog
        isOpen={dialog === 'block'}
        title={`Block ${name}?`}
        message="They are signed out on every device and can't sign in until you unblock the account. Their orders are kept."
        confirmLabel="Block account"
        busy={setActive.isPending}
        onConfirm={() => setActive.mutate(false)}
        onCancel={() => setDialog(null)}
      />
      {dialog === 'delete' && (
        <FormDialog
          isOpen
          danger
          title={`Delete ${name}?`}
          description="The account, its addresses, notes, and sign-ins are deleted for good. Their orders and reviews stay for the books, without the account. Customers with an open order can't be deleted."
          submitLabel="Delete customer"
          busy={remove.isPending}
          error={remove.error ? actionErrorMessage(remove.error.fieldErrors ? { message: Object.values(remove.error.fieldErrors)[0][0] } : remove.error) : null}
          onSubmit={() => remove.mutate()}
          onCancel={() => {
            remove.reset()
            setDialog(null)
          }}
        />
      )}
    </>
  )
}

const err = (errors, field) => errors?.[field]?.[0]

/** Account: name, email, phone, group. Changing the email signs them out and asks them to confirm the new one. */
function AccountTab({ customer, onSaved }) {
  const { can } = useAdminAuth()
  const editable = can('customers.edit')
  const groups = useQuery({ queryKey: adminKeys.customerGroups, queryFn: ({ signal }) => getCustomerGroups({ signal }), staleTime: 60_000 })
  const [values, setValues] = useState(() => ({
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    phone: customer.phone ?? '',
    groupId: customer.groupId ? String(customer.groupId) : '',
  }))
  const [errors, setErrors] = useState({})
  const save = useMutation({
    mutationFn: (changes) => updateCustomer(customer.id, changes),
    onSuccess: (updated, changes) => {
      setErrors({})
      onSaved(changes.email ? `Saved. ${updated.email} must confirm the new address; they were signed out everywhere.` : 'Account saved.')
    },
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  })
  const set = (field) => (event) => setValues({ ...values, [field]: event.target.value })

  function submit(event) {
    event.preventDefault()
    const found = {}
    if (!values.firstName.trim()) found.firstName = ['Enter the first name.']
    if (!values.lastName.trim()) found.lastName = ['Enter the last name.']
    if (!isEmail(values.email)) found.email = ['Enter a valid email address.']
    setErrors(found)
    if (Object.keys(found).length > 0) return
    // Only what changed: an unchanged email must not sign the customer out.
    const next = { firstName: values.firstName.trim(), lastName: values.lastName.trim(), email: values.email.trim().toLowerCase(), phone: values.phone.trim() || null, groupId: values.groupId ? Number(values.groupId) : null }
    const before = { firstName: customer.firstName, lastName: customer.lastName, email: customer.email, phone: customer.phone || null, groupId: customer.groupId ?? null }
    const changes = Object.fromEntries(Object.entries(next).filter(([field, value]) => value !== before[field]))
    if (Object.keys(changes).length === 0) return onSaved('Nothing to save: no changes.')
    save.mutate(changes)
  }

  const emailChanged = values.email.trim().toLowerCase() !== customer.email
  const other = save.error && !save.error.fieldErrors ? actionErrorMessage(save.error) : null
  return (
    <form className="form" noValidate onSubmit={submit} aria-label="Account">
      <fieldset disabled={!editable} className="form__fieldset">
        <legend className="visually-hidden">Account details</legend>
        <div className="form__grid">
          <Field label="First name" error={err(errors, 'firstName')}>
            {(a11y) => <input {...a11y} value={values.firstName} maxLength={60} autoComplete="off" onChange={set('firstName')} />}
          </Field>
          <Field label="Last name" error={err(errors, 'lastName')}>
            {(a11y) => <input {...a11y} value={values.lastName} maxLength={60} autoComplete="off" onChange={set('lastName')} />}
          </Field>
          <Field label="Email" error={err(errors, 'email')} hint={emailChanged ? 'Saving signs the customer out everywhere; they confirm the new address with a code on their next sign-in.' : customer.emailVerified ? 'Confirmed.' : 'Not confirmed yet.'}>
            {(a11y) => <input {...a11y} type="email" value={values.email} maxLength={190} autoComplete="off" onChange={set('email')} />}
          </Field>
          <Field label="Phone" error={err(errors, 'phone')}>
            {(a11y) => <input {...a11y} type="tel" value={values.phone} maxLength={40} autoComplete="off" onChange={set('phone')} />}
          </Field>
          <Field label="Customer group" error={err(errors, 'groupId')} hint="The group's discount applies to every product price in the cart, checkout, and orders you create.">
            {(a11y) => (
              <select {...a11y} value={values.groupId} onChange={set('groupId')}>
                {!values.groupId && <option value="">Default group</option>}
                {(groups.data?.groups ?? (customer.group ? [customer.group] : [])).map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                    {group.discountPercent > 0 ? ` (${group.discountPercent}% off)` : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </fieldset>
      {other && (
        <p className="form-error" role="alert">
          {other}
        </p>
      )}
      {editable && (
        <div className="form__actions">
          <button type="submit" className="btn btn--primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save account'}
          </button>
        </div>
      )}
    </form>
  )
}

/** The address book (at most 20): add, edit, delete, and the default shipping and billing addresses. */
function AddressesTab({ customer, onChanged }) {
  const { can } = useAdminAuth()
  const editable = can('customers.edit')
  const [editing, setEditing] = useState(null) // an address, or {} for a new one
  const [removing, setRemoving] = useState(null)
  const remove = useMutation({
    mutationFn: (address) => deleteCustomerAddress(customer.id, address.id),
    onSuccess: () => {
      setRemoving(null)
      onChanged('Address deleted.')
    },
    onError: (error) => {
      setRemoving(null)
      onChanged(actionErrorMessage(error))
    },
  })
  const setDefault = useMutation({
    mutationFn: ({ address, kind }) => updateCustomerAddress(customer.id, address.id, { [kind === 'shipping' ? 'isDefaultShipping' : 'isDefaultBilling']: true }),
    onSuccess: (_, { kind }) => onChanged(`Default ${kind} address changed.`),
    onError: (error) => onChanged(actionErrorMessage(error)),
  })

  const addresses = customer.addresses ?? []
  const label = (address) => `${address.line1}, ${address.city}`
  return (
    <section aria-label="Addresses">
      {editable && (
        <p>
          <button type="button" className="btn btn--outline btn--sm" disabled={addresses.length >= 20} onClick={() => setEditing({})}>
            <LuPlus aria-hidden="true" /> Add address
          </button>
          {addresses.length >= 20 && <span className="field__hint"> The address book is full (20 addresses).</span>}
        </p>
      )}
      {addresses.length === 0 ? (
        <Empty>No saved addresses yet.</Empty>
      ) : (
        <ul className="address-cards">
          {addresses.map((address) => (
            <li key={address.id} className="address-card">
              <Address address={address} />
              <p className="address-card__badges">
                {address.isDefaultShipping && <span className="status status--info">Default shipping</span>}
                {address.isDefaultBilling && <span className="status status--info">Default billing</span>}
              </p>
              {editable && (
                <div className="address-card__tools">
                  <button type="button" className="btn btn--outline btn--sm" aria-label={`Edit ${label(address)}`} onClick={() => setEditing(address)}>
                    <LuPencil aria-hidden="true" /> Edit
                  </button>
                  {!address.isDefaultShipping && (
                    <button type="button" className="btn btn--outline btn--sm" disabled={setDefault.isPending} onClick={() => setDefault.mutate({ address, kind: 'shipping' })}>
                      Make default shipping<span className="visually-hidden">: {label(address)}</span>
                    </button>
                  )}
                  {!address.isDefaultBilling && (
                    <button type="button" className="btn btn--outline btn--sm" disabled={setDefault.isPending} onClick={() => setDefault.mutate({ address, kind: 'billing' })}>
                      Make default billing<span className="visually-hidden">: {label(address)}</span>
                    </button>
                  )}
                  <button type="button" className="icon-button icon-button--danger" aria-label={`Delete ${label(address)}`} onClick={() => setRemoving(address)}>
                    <LuTrash2 aria-hidden="true" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <AddressDialog
          customer={customer}
          address={editing.id ? editing : null}
          onDone={(text) => {
            setEditing(null)
            onChanged(text)
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {/* Mounted only while open: its Cancel button takes focus when it appears. */}
      {removing && (
      <ConfirmDialog
        isOpen
        title="Delete this address?"
        message={`${label(removing)} is removed from ${fullName(customer)}'s address book. Past orders keep their copy.`}
        confirmLabel="Delete address"
        busy={remove.isPending}
        onConfirm={() => remove.mutate(removing)}
        onCancel={() => setRemoving(null)}
      />
      )}
    </section>
  )
}

function AddressDialog({ customer, address, onDone, onCancel }) {
  const { can } = useAdminAuth()
  // The store's countries make the country a list (settings.view); otherwise free text, checked by the API.
  const settings = useQuery({ queryKey: adminKeys.settings, queryFn: ({ signal }) => getSettings({ signal }), enabled: can('settings.view'), staleTime: 60_000 })
  const [value, setValue] = useState(() => ({ ...EMPTY_ADDRESS, ...(address ?? { firstName: customer.firstName, lastName: customer.lastName, phone: customer.phone ?? '' }) }))
  const [defaults, setDefaults] = useState({ shipping: address?.isDefaultShipping ?? customer.addresses.length === 0, billing: address?.isDefaultBilling ?? customer.addresses.length === 0 })
  const [errors, setErrors] = useState({})
  const save = useMutation({
    mutationFn: (values) => (address ? updateCustomerAddress(customer.id, address.id, values) : createCustomerAddress(customer.id, values)),
    onSuccess: () => onDone(address ? 'Address saved.' : 'Address added.'),
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  })

  function submit() {
    const found = addressErrors(value, { withContact: true })
    setErrors(found)
    if (Object.keys(found).length > 0) return
    save.mutate({ ...addressValues(value, { withContact: true }), isDefaultShipping: defaults.shipping, isDefaultBilling: defaults.billing })
  }
  const other = save.error && !save.error.fieldErrors ? actionErrorMessage(save.error) : null
  return (
    <FormDialog isOpen wide title={address ? 'Edit address' : 'Add address'} submitLabel={address ? 'Save address' : 'Add address'} busy={save.isPending} error={other} onSubmit={submit} onCancel={onCancel}>
      <AddressFields value={value} onChange={setValue} errors={errors} countries={settings.data?.checkout?.allowedCountries} withContact />
      <label className="checkbox">
        <input type="checkbox" checked={defaults.shipping} onChange={(event) => setDefaults({ ...defaults, shipping: event.target.checked })} />
        Default shipping address
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={defaults.billing} onChange={(event) => setDefaults({ ...defaults, billing: event.target.checked })} />
        Default billing address
      </label>
    </FormDialog>
  )
}

/** The last 10 orders; the order grid has the rest. */
function OrdersTab({ customer }) {
  const orders = customer.recentOrders ?? []
  if (orders.length === 0) return <Empty>No orders yet.</Empty>
  return (
    <section aria-label="Orders">
      <div className="table-wrap">
        <table className="table">
          <caption className="visually-hidden">{`${fullName(customer)}'s latest orders`}</caption>
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Placed</th>
              <th scope="col">Status</th>
              <th scope="col">Payment</th>
              <th scope="col">Source</th>
              <th scope="col" className="num">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.number}>
                <td>
                  <Link to={`/orders/${order.number}`}>{order.number}</Link>
                </td>
                <td>{formatDate(order.placedAt)}</td>
                <td>
                  <StatusBadge {...orderStatus(order.status)} />
                </td>
                <td>{order.paymentStatus && <StatusBadge {...paymentStatus(order.paymentStatus)} />}</td>
                <td>{orderSource(order.source).label}</td>
                <td className="num">{formatMoney(order.total ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {customer.ordersCount > orders.length && (
        <p className="page-note">
          Showing the latest {orders.length} of {formatCount(customer.ordersCount)}.{' '}
          <Link to={`/orders?q=${encodeURIComponent(customer.email)}`}>See all their orders</Link>
        </p>
      )}
    </section>
  )
}

/** Internal notes: staff only, never shown to the customer. */
function NotesTab({ customer, onAdded }) {
  const { can } = useAdminAuth()
  const [body, setBody] = useState('')
  const [error, setError] = useState(null)
  const add = useMutation({
    mutationFn: () => addCustomerNote(customer.id, body.trim()),
    onSuccess: () => {
      setBody('')
      setError(null)
      onAdded('Note added.')
    },
    onError: (failure) => setError(failure.fieldErrors?.body?.[0] ?? actionErrorMessage(failure)),
  })
  const notes = customer.notes ?? []
  return (
    <section aria-label="Notes">
      {can('customers.edit') && (
        <form
          className="form note-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            if (!body.trim()) return setError('Write the note first.')
            add.mutate()
          }}
        >
          <Field label="New note" error={error} hint="Only staff see notes. Up to 2000 characters.">
            {(a11y) => <textarea {...a11y} rows={3} maxLength={2000} value={body} onChange={(event) => setBody(event.target.value)} />}
          </Field>
          <div className="form__actions">
            <button type="submit" className="btn btn--primary btn--sm" disabled={add.isPending}>
              {add.isPending ? 'Adding…' : 'Add note'}
            </button>
          </div>
        </form>
      )}
      {notes.length === 0 ? (
        <Empty>No notes yet.</Empty>
      ) : (
        <ol className="history notes">
          {notes.map((note) => (
            <li key={note.id}>
              <p className="muted">
                <time dateTime={note.createdAt}>{formatDateTime(note.createdAt)}</time>
                {note.adminName && ` · by ${note.adminName}`}
              </p>
              <p className="note-body">{note.body}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export default CustomerDetailPage
