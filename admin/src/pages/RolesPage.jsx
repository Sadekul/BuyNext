import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuEye, LuLock, LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu'
import { adminKeys, createRole, deleteRole, getPermissions, getRoles, updateRole } from '../api/admin'
import ConfirmDialog from '../components/ConfirmDialog'
import Field from '../components/Field'
import FormDialog from '../components/FormDialog'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount } from '../utils/format'
import { permissionLabel } from '../utils/permissions'

/**
 * Roles (System → Roles): what each kind of admin may do, as permission
 * checkboxes grouped by area. System roles (Owner) can't be changed or deleted.
 */
function RolesPage() {
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState(null) // { role? } — no role: a new one
  const [toDelete, setToDelete] = useState(null)
  const [notice, setNotice] = useState(null)
  const noticeRef = useRef(null)
  const opener = useRef(null)

  const roles = useQuery({ queryKey: adminKeys.roles, queryFn: ({ signal }) => getRoles({ signal }) })
  const permissions = useQuery({ queryKey: adminKeys.permissions, queryFn: ({ signal }) => getPermissions({ signal }), staleTime: Infinity })

  function done(text, tone = 'success') {
    setDialog(null)
    setToDelete(null)
    setNotice({ text, tone })
    queryClient.invalidateQueries({ queryKey: adminKeys.roles })
    requestAnimationFrame(() => noticeRef.current?.focus())
  }
  function open(role, event) {
    opener.current = event.currentTarget
    setNotice(null)
    setDialog({ role })
  }
  function close() {
    setDialog(null)
    opener.current?.focus()
  }

  const remove = useMutation({
    mutationFn: (role) => deleteRole(role.id),
    onSuccess: (_, role) => done(`The ${role.name} role was deleted.`),
    // In use (422 naming how many admins have it): say so and keep the role.
    onError: (error) => done(error.message, 'error'),
  })

  return (
    <>
      <title>Roles | BuyNest Admin</title>
      <PageHeader
        title="Roles"
        description="What each kind of admin can see and do. The server checks these on every request."
        actions={
          <button type="button" className="btn btn--primary" onClick={(event) => open(null, event)}>
            <LuPlus aria-hidden="true" /> Add role
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

      {roles.isPending && <Loading label="Loading roles…" />}
      {roles.error && <ErrorState error={roles.error} onRetry={roles.refetch} />}
      {roles.data && roles.data.roles.length === 0 && <Empty>No roles yet.</Empty>}
      {roles.data && roles.data.roles.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <caption className="visually-hidden">Admin roles</caption>
            <thead>
              <tr>
                <th scope="col">Role</th>
                <th scope="col">Description</th>
                <th scope="col" className="num">
                  Permissions
                </th>
                <th scope="col" className="num">
                  Admins
                </th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {roles.data.roles.map((role) => (
                <tr key={role.id}>
                  <th scope="row">
                    {role.name} {role.isSystem && <StatusBadge tone="info" icon={LuLock} label="System" />}
                  </th>
                  <td>{role.description || <span className="muted">—</span>}</td>
                  <td className="num">{formatCount(role.permissions.length)}</td>
                  <td className="num">{role.adminCount === null ? '—' : formatCount(role.adminCount)}</td>
                  <td className="table__actions">
                    {role.isSystem ? (
                      <button type="button" className="icon-button" aria-label={`View ${role.name}`} onClick={(event) => open(role, event)}>
                        <LuEye aria-hidden="true" />
                      </button>
                    ) : (
                      <>
                        <button type="button" className="icon-button" aria-label={`Edit ${role.name}`} onClick={(event) => open(role, event)}>
                          <LuPencil aria-hidden="true" />
                        </button>
                        <button type="button" className="icon-button icon-button--danger" aria-label={`Delete ${role.name}`} onClick={() => setToDelete(role)}>
                          <LuTrash2 aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog && <RoleDialog role={dialog.role} permissions={permissions} onDone={(role, isNew) => done(`The ${role.name} role was ${isNew ? 'added' : 'saved'}.`)} onCancel={close} />}
      <ConfirmDialog
        isOpen={toDelete !== null}
        title={`Delete the ${toDelete?.name} role?`}
        message="Only a role no admin uses can be deleted. Move its admins to another role first."
        confirmLabel="Delete role"
        busy={remove.isPending}
        onConfirm={() => remove.mutate(toDelete)}
        onCancel={() => setToDelete(null)}
      />
    </>
  )
}

/** Name, description, and the permission checkboxes by area. A system role opens read-only. */
function RoleDialog({ role, permissions, onDone, onCancel }) {
  const isNew = !role
  const readOnly = role?.isSystem === true
  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  const [chosen, setChosen] = useState(() => new Set(role?.permissions ?? []))
  const [errors, setErrors] = useState({})

  const save = useMutation({
    mutationFn: (body) => (isNew ? createRole(body) : updateRole(role.id, body)),
    onSuccess: (data) => onDone(data.role, isNew),
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  })

  function toggle(key, on) {
    setChosen((current) => {
      const next = new Set(current)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }
  function submit() {
    if (readOnly) return onCancel()
    if (name.trim().length < 2) return setErrors({ name: ['Enter a name of 2 to 60 characters.'] })
    setErrors({})
    save.mutate({ name: name.trim(), description: description.trim() || null, permissions: [...chosen] })
  }

  const otherError = save.error && !save.error.fieldErrors?.name && !save.error.fieldErrors?.permissions ? save.error.fieldErrors ? Object.values(save.error.fieldErrors)[0][0] : save.error.message : null

  return (
    <FormDialog
      isOpen
      wide
      title={readOnly ? `${role.name} (system role)` : isNew ? 'Add a role' : `Edit ${role.name}`}
      description={readOnly ? "A system role can't be changed or deleted: it always has every permission." : undefined}
      submitLabel={readOnly ? 'Close' : isNew ? 'Add role' : 'Save'}
      busy={save.isPending}
      error={otherError}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <div className="form__grid">
        <Field label="Name" error={errors.name?.[0]}>
          {(a11y) => <input {...a11y} value={name} maxLength={60} readOnly={readOnly} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <Field label="Description (optional)" error={errors.description?.[0]}>
          {(a11y) => <input {...a11y} value={description} maxLength={255} readOnly={readOnly} onChange={(event) => setDescription(event.target.value)} />}
        </Field>
      </div>
      {permissions.isPending && <Loading label="Loading permissions…" />}
      {permissions.error && <ErrorState error={permissions.error} onRetry={permissions.refetch} />}
      {permissions.data && (
        <div className="permission-groups">
          {permissions.data.groups.map((group) => (
            <fieldset key={group.label} className="permission-group">
              <legend>{group.label}</legend>
              {group.permissions.map((permission) => (
                <label key={permission.key} className="checkbox">
                  <input type="checkbox" checked={readOnly || chosen.has(permission.key)} disabled={readOnly} onChange={(event) => toggle(permission.key, event.target.checked)} />
                  {/* Phase 11: a key the API sends without words (rewards.manage) gets this app's label. */}
                  {permission.label && permission.label !== permission.key ? permission.label : permissionLabel(permission.key)}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      )}
      {errors.permissions && <p className="field__error">{errors.permissions[0]}</p>}
      {!readOnly && (
        <p className="field__hint" aria-live="polite">
          {chosen.size === 1 ? '1 permission chosen.' : `${chosen.size} permissions chosen.`}
        </p>
      )}
    </FormDialog>
  )
}

export default RolesPage
