import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuKeyRound, LuPencil, LuPlus, LuSearch } from 'react-icons/lu'
import { adminKeys, createAdmin, getAdmins, getRoles, resetAdminPassword, updateAdmin } from '../api/admin'
import { useAdminAuth } from '../auth/useAdminAuth'
import ConfirmDialog from '../components/ConfirmDialog'
import Field from '../components/Field'
import FormDialog from '../components/FormDialog'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount, formatDate } from '../utils/format'

const LIMIT = 20
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Same rule as the server (contract §1): at least 12 characters, letters and numbers.
const passwordProblem = (value) => (value.length >= 12 && /[A-Za-z]/.test(value) && /\d/.test(value) ? null : 'Use at least 12 characters, with letters and numbers.')
const fieldError = (errors, field) => errors?.[field]?.[0]

/** Admin users (System → Admin users): list, add, edit, deactivate, reset a password. Needs admins.manage. */
function AdminUsersPage() {
  const queryClient = useQueryClient()
  const { user } = useAdminAuth()
  const [skip, setSkip] = useState(0)
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState('')
  const [dialog, setDialog] = useState(null) // { type: 'create' | 'edit' | 'password', admin? }
  const [confirming, setConfirming] = useState(null) // { admin, isActive }
  const [notice, setNotice] = useState(null)
  const noticeRef = useRef(null)
  const opener = useRef(null)

  const filters = { skip, ...(q && { q }), ...(status && { status }) }
  const admins = useQuery({ queryKey: adminKeys.admins(filters), queryFn: ({ signal }) => getAdmins({ limit: LIMIT, ...filters }, { signal }) })
  const roles = useQuery({ queryKey: adminKeys.roles, queryFn: ({ signal }) => getRoles({ signal }) })

  function done(text, tone = 'success') {
    setDialog(null)
    setConfirming(null)
    setNotice({ text, tone })
    queryClient.invalidateQueries({ queryKey: ['admins'] })
    // Focus the message so keyboard and screen-reader users hear the outcome.
    requestAnimationFrame(() => noticeRef.current?.focus())
  }
  function open(next, event) {
    opener.current = event.currentTarget
    setNotice(null)
    setDialog(next)
  }
  function close() {
    setDialog(null)
    opener.current?.focus()
  }

  const setActive = useMutation({
    mutationFn: ({ admin, isActive }) => updateAdmin(admin.id, { isActive }),
    onSuccess: ({ admin }) => done(admin.isActive ? `${admin.name} can sign in again.` : `${admin.name} was deactivated and signed out everywhere.`),
    onError: (error) => done(error.fieldErrors ? Object.values(error.fieldErrors)[0][0] : error.message, 'error'),
  })

  const isSelf = (admin) => admin.id === user?.id

  return (
    <>
      <title>Admin users | BuyNest Admin</title>
      <PageHeader
        title="Admin users"
        description={admins.data ? `${formatCount(admins.data.total)} staff accounts, separate from customers` : 'Staff accounts, separate from customers'}
        actions={
          <button type="button" className="btn btn--primary" onClick={(event) => open({ type: 'create' }, event)}>
            <LuPlus aria-hidden="true" /> Add admin
          </button>
        }
      />
      <div role={notice?.tone === 'error' ? 'alert' : 'status'}>
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className={notice.tone === 'success' ? 'notice notice--success' : 'form-error'}>
            {notice.text}
          </p>
        )}
      </div>

      <div className="toolbar">
        <form
          role="search"
          className="toolbar__search"
          onSubmit={(event) => {
            event.preventDefault()
            setQ(draft.trim())
            setSkip(0)
          }}
        >
          <label htmlFor="admin-search" className="visually-hidden">
            Search admin users
          </label>
          <input id="admin-search" type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Search by name or email" />
          <button type="submit" className="btn btn--outline">
            <LuSearch aria-hidden="true" /> Search
          </button>
        </form>
        <label className="toolbar__select">
          <span>Status</span>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value)
              setSkip(0)
            }}
          >
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="inactive">Deactivated</option>
          </select>
        </label>
      </div>

      {admins.isPending && <Loading label="Loading admin users…" />}
      {admins.error && <ErrorState error={admins.error} onRetry={admins.refetch} />}
      {admins.data && admins.data.admins.length === 0 && <Empty>No admin users yet.</Empty>}
      {admins.data && admins.data.admins.length > 0 && (
        <div className="table-wrap" aria-busy={admins.isFetching}>
          <table className="table">
            <caption className="visually-hidden">Admin users</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Last sign-in</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {admins.data.admins.map((admin) => (
                <tr key={admin.id}>
                  <th scope="row">
                    {admin.name}
                    {isSelf(admin) && <small className="muted"> (you)</small>}
                  </th>
                  <td>
                    <a href={`mailto:${admin.email}`}>{admin.email}</a>
                  </td>
                  <td>{admin.role?.name ?? '—'}</td>
                  <td>
                    <StatusBadge tone={admin.isActive ? 'success' : 'neutral'} label={admin.isActive ? 'Active' : 'Deactivated'} />
                  </td>
                  <td>{formatDate(admin.lastLoginAt, 'Never')}</td>
                  <td className="table__actions">
                    <button type="button" className="icon-button" aria-label={`Edit ${admin.name}`} onClick={(event) => open({ type: 'edit', admin }, event)}>
                      <LuPencil aria-hidden="true" />
                    </button>
                    <button type="button" className="icon-button" aria-label={`Set a new password for ${admin.name}`} onClick={(event) => open({ type: 'password', admin }, event)}>
                      <LuKeyRound aria-hidden="true" />
                    </button>
                    {/* You can't deactivate yourself (the server refuses too). */}
                    {!isSelf(admin) && (
                      <button
                        type="button"
                        className="btn btn--outline btn--sm"
                        aria-label={`${admin.isActive ? 'Deactivate' : 'Reactivate'} ${admin.name}`}
                        disabled={setActive.isPending}
                        onClick={() => (admin.isActive ? setConfirming({ admin, isActive: false }) : setActive.mutate({ admin, isActive: true }))}
                      >
                        {admin.isActive ? 'Deactivate' : 'Reactivate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={admins.data.total} limit={LIMIT} skip={skip} onChange={setSkip} />
        </div>
      )}

      {dialog?.type === 'create' && <AdminDialog roles={roles} onDone={(admin) => done(`${admin.name} can now sign in to the admin.`)} onCancel={close} />}
      {dialog?.type === 'edit' && <AdminDialog admin={dialog.admin} self={isSelf(dialog.admin)} roles={roles} onDone={(admin) => done(`${admin.name} was saved.`)} onCancel={close} />}
      {dialog?.type === 'password' && <PasswordDialog admin={dialog.admin} onDone={() => done(`New password set for ${dialog.admin.name}. They were signed out everywhere.`)} onCancel={close} />}
      <ConfirmDialog
        isOpen={confirming !== null}
        title={`Deactivate ${confirming?.admin.name}?`}
        message="They are signed out everywhere and can't sign in until reactivated. Their past actions stay in the audit log."
        confirmLabel="Deactivate"
        busy={setActive.isPending}
        onConfirm={() => setActive.mutate(confirming)}
        onCancel={() => setConfirming(null)}
      />
    </>
  )
}

/** Add an admin (with a first password), or edit one. Your own role and status can't change here. */
function AdminDialog({ admin, self = false, roles, onDone, onCancel }) {
  const isNew = !admin
  const [values, setValues] = useState({ name: admin?.name ?? '', email: admin?.email ?? '', roleId: String(admin?.roleId ?? ''), isActive: admin?.isActive ?? true, password: '' })
  const [errors, setErrors] = useState({})
  const set = (field) => (event) => setValues((current) => ({ ...current, [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }))

  const save = useMutation({
    mutationFn: (body) => (isNew ? createAdmin(body) : updateAdmin(admin.id, body)),
    onSuccess: (data) => onDone(data.admin),
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  })

  function submit() {
    const found = {}
    if (!values.name.trim()) found.name = ['Enter a name.']
    if (!EMAIL.test(values.email.trim())) found.email = ['Enter a valid email address.']
    if (!values.roleId) found.roleId = ['Choose a role.']
    if (isNew && passwordProblem(values.password)) found.password = [passwordProblem(values.password)]
    setErrors(found)
    if (Object.keys(found).length > 0) return
    const body = { name: values.name.trim(), email: values.email.trim() }
    if (!self) Object.assign(body, { roleId: Number(values.roleId), isActive: values.isActive })
    if (isNew) body.password = values.password
    save.mutate(body)
  }

  const shown = ['name', 'email', 'roleId', 'isActive', 'password']
  const otherError = save.error && !Object.keys(save.error.fieldErrors ?? {}).some((field) => shown.includes(field)) ? save.error.message : null

  return (
    <FormDialog
      isOpen
      title={isNew ? 'Add an admin' : `Edit ${admin.name}`}
      description={isNew ? 'They sign in at /admin with this email and password. Share the password safely; they can be given a new one at any time.' : undefined}
      submitLabel={isNew ? 'Add admin' : 'Save'}
      busy={save.isPending}
      error={otherError}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <Field label="Name" error={fieldError(errors, 'name')}>
        {(a11y) => <input {...a11y} value={values.name} maxLength={100} autoComplete="off" onChange={set('name')} />}
      </Field>
      <Field label="Email" error={fieldError(errors, 'email')}>
        {(a11y) => <input {...a11y} type="email" value={values.email} maxLength={255} autoComplete="off" onChange={set('email')} />}
      </Field>
      <Field label="Role" error={fieldError(errors, 'roleId')} hint={self ? "You can't change your own role." : 'What this admin can see and do.'}>
        {(a11y) => (
          <select {...a11y} value={values.roleId} disabled={self || !roles.data} onChange={set('roleId')}>
            <option value="">{roles.isPending ? 'Loading roles…' : 'Choose…'}</option>
            {(roles.data?.roles ?? []).map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      {isNew && (
        <Field label="Password" error={fieldError(errors, 'password')} hint="At least 12 characters, with letters and numbers.">
          {(a11y) => <input {...a11y} type="password" value={values.password} autoComplete="new-password" onChange={set('password')} />}
        </Field>
      )}
      {!self && (
        <label className="checkbox">
          <input type="checkbox" checked={values.isActive} onChange={set('isActive')} />
          Active (can sign in)
        </label>
      )}
      {fieldError(errors, 'isActive') && <p className="field__error">{fieldError(errors, 'isActive')}</p>}
    </FormDialog>
  )
}

/** Sets a new password chosen by the Owner; the admin is signed out everywhere. */
function PasswordDialog({ admin, onDone, onCancel }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState({})
  const reset = useMutation({
    mutationFn: () => resetAdminPassword(admin.id, password),
    onSuccess: onDone,
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  })
  function submit() {
    const found = {}
    if (passwordProblem(password)) found.password = [passwordProblem(password)]
    else if (password !== confirm) found.confirm = ['The passwords are different.']
    setErrors(found)
    if (Object.keys(found).length === 0) reset.mutate()
  }
  return (
    <FormDialog
      isOpen
      title={`New password for ${admin.name}`}
      description="They are signed out everywhere and sign in again with this password. Share it with them safely."
      submitLabel="Set password"
      busy={reset.isPending}
      error={reset.error && !reset.error.fieldErrors ? reset.error.message : null}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <Field label="New password" error={fieldError(errors, 'password')} hint="At least 12 characters, with letters and numbers.">
        {(a11y) => <input {...a11y} type="password" value={password} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} />}
      </Field>
      <Field label="Repeat the password" error={fieldError(errors, 'confirm')}>
        {(a11y) => <input {...a11y} type="password" value={confirm} autoComplete="new-password" onChange={(event) => setConfirm(event.target.value)} />}
      </Field>
    </FormDialog>
  )
}

export default AdminUsersPage
