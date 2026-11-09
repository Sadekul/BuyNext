import ErrorMessage from '../components/ui/ErrorMessage'
import Loader from '../components/ui/Loader'
import { useAuth } from '../hooks/useAuth'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuPencil } from 'react-icons/lu'
import EditNameForm from '../components/forms/EditNameForm'
import { profileQuery, userKeys } from '../queries/userQueries'
import { updateProfile } from '../services/authService'
import { SITE } from '../constants/site'
import './ProfilePage.css'

/**
 * /account — the customer's profile, loaded from GET /api/auth/me with the
 * session cookie (authorizedRequest renews the session once if it has expired).
 */
function ProfilePage() {
  const { user, authorizedRequest, updateUser } = useAuth()
  const request = useQuery(profileQuery(user.id, authorizedRequest))
  const queryClient = useQueryClient()
  const [isEditing, setIsEditing] = useState(false)
  const profileKey = userKeys.profile(user.id)

  /*
   * OPTIMISTIC UPDATE: show the new name immediately, before the server
   * answers; roll back if the request fails.
   * We deliberately don't invalidate/refetch afterwards: DummyJSON doesn't
   * save the change, so a refetch would bring the old name back. With a
   * real API, add onSettled: () => invalidateQueries({ queryKey: profileKey }).
   */
  const rename = useMutation({
    mutationFn: (changes) => authorizedRequest(() => updateProfile(changes)),
    onMutate: async (changes) => {
      await queryClient.cancelQueries({ queryKey: profileKey }) // don't let an in-flight refetch overwrite us
      const previous = queryClient.getQueryData(profileKey)
      queryClient.setQueryData(profileKey, (current) => ({ ...current, ...changes }))
      setIsEditing(false)
      return { previous } // becomes `context` in onError
    },
    onError: (error, changes, context) => {
      queryClient.setQueryData(profileKey, context.previous) // roll back
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(profileKey, (current) => ({ ...current, firstName: updated.firstName, lastName: updated.lastName }))
      updateUser({ ...user, firstName: updated.firstName, lastName: updated.lastName }) // header greeting
    },
  })

  if (request.isPending) return <Loader label="Loading your profile…" />
  if (request.error) {
    return <ErrorMessage title="We couldn't load your profile" message={request.error.message} onRetry={() => request.refetch()} />
  }

  const profile = request.data
  const { address } = profile
  const details = [
    ['Name', `${profile.firstName} ${profile.lastName}`],
    ['Username', profile.username],
    ['Email', profile.email],
    ['Phone', profile.phone],
    ['Address', address && [address.line1, `${address.city}, ${address.state} ${address.postalCode}`, address.country].filter(Boolean).join(', ')],
  ].filter(([, value]) => value)

  return (
    <section className="profile" aria-labelledby="profile-title">
      <title>{`My account | ${SITE.name}`}</title>
      <div className="profile__card">
        {profile.image && <img className="profile__avatar" src={profile.image} alt="" width="96" height="96" />}
        {isEditing ? (
          <EditNameForm
            initialValues={{ firstName: profile.firstName, lastName: profile.lastName }}
            onSave={(changes) => rename.mutate(changes)}
            onCancel={() => setIsEditing(false)}
          />
        ) : (
          <div className="profile__identity">
            <h2 id="profile-title" className="profile__name">
              {profile.firstName} {profile.lastName}
            </h2>
            <p className="profile__username">@{profile.username}</p>
            <button type="button" className="profile__edit" onClick={() => setIsEditing(true)}>
              <LuPencil aria-hidden="true" /> Edit name
            </button>
          </div>
        )}
      </div>

      <p className="profile__status" role="status">
        {rename.isPending && 'Saving…'}
        {rename.isSuccess && 'Name updated (demo: DummyJSON forgets it after a reload).'}
        {rename.isError && `Couldn't save your name: ${rename.error.message} Your previous name was restored.`}
      </p>

      <dl className="profile__details">
        {details.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <p className="profile__note">
        Profile editing needs a real backend (DummyJSON doesn't save changes). It arrives with the BuyNest API.
      </p>
    </section>
  )
}

export default ProfilePage
