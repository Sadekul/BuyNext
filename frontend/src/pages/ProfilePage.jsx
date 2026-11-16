import ErrorMessage from '../components/ui/ErrorMessage'
import Loader from '../components/ui/Loader'
import { useAuth } from '../hooks/useAuth'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuPencil } from 'react-icons/lu'
import EditNameForm from '../components/forms/EditNameForm'
import { CheckboxField } from '../components/forms/FormField'
import { profileQuery, userKeys } from '../queries/userQueries'
import { updateProfile } from '../services/authService'
import { REAL_ACCOUNTS } from '../constants/accounts'
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
   * OPTIMISTIC UPDATE: show the new details immediately, before the server
   * answers; roll back if the request fails.
   * BuyNest accounts save the change, so afterwards the profile is fetched
   * again (onSettled) to show exactly what was stored. DummyJSON doesn't save
   * it: a refetch would bring the old name back, so the demo skips that.
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
      queryClient.setQueryData(profileKey, (current) => ({ ...current, firstName: updated.firstName, lastName: updated.lastName, phone: updated.phone }))
      updateUser({ ...user, firstName: updated.firstName, lastName: updated.lastName }) // header greeting
    },
    onSettled: () => {
      if (REAL_ACCOUNTS) queryClient.invalidateQueries({ queryKey: profileKey })
    },
  })

  /*
   * The newsletter switch (BuyNest accounts, phase 7). No confirmation email:
   * the account's address is already verified. Shown once the API says
   * whether the customer is subscribed.
   */
  const newsletter = useMutation({
    mutationFn: (subscribed) => authorizedRequest(() => updateProfile({ newsletter: subscribed })),
    onSuccess: (updated, subscribed) => {
      queryClient.setQueryData(profileKey, (current) => ({ ...current, newsletter: updated.newsletter ?? subscribed }))
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
            initialValues={{
              firstName: profile.firstName,
              lastName: profile.lastName,
              ...(REAL_ACCOUNTS && { phone: profile.phone ?? '' }),
            }}
            onSave={(changes) => rename.mutate(changes)}
            onCancel={() => setIsEditing(false)}
          />
        ) : (
          <div className="profile__identity">
            <h2 id="profile-title" className="profile__name">
              {profile.firstName} {profile.lastName}
            </h2>
            {profile.username && <p className="profile__username">@{profile.username}</p>}
            <button type="button" className="profile__edit" onClick={() => setIsEditing(true)}>
              <LuPencil aria-hidden="true" /> {REAL_ACCOUNTS ? 'Edit details' : 'Edit name'}
            </button>
          </div>
        )}
      </div>

      <p className="profile__status" role="status">
        {rename.isPending && 'Saving…'}
        {rename.isSuccess && (REAL_ACCOUNTS ? 'Your details were saved.' : 'Name updated (demo: DummyJSON forgets it after a reload).')}
        {rename.isError && `Couldn't save your changes: ${rename.error.message} Your previous details were restored.`}
      </p>

      <dl className="profile__details">
        {details.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {REAL_ACCOUNTS && typeof profile.newsletter === 'boolean' && (
        <section className="profile__newsletter" aria-labelledby="profile-newsletter-title">
          <h2 id="profile-newsletter-title" className="profile__section-title">
            Newsletter
          </h2>
          <CheckboxField
            label="Email me new arrivals, deals, and style tips"
            checked={newsletter.isPending ? newsletter.variables : profile.newsletter}
            disabled={newsletter.isPending}
            onChange={(event) => newsletter.mutate(event.target.checked)}
          />
          <p className="profile__status" role="status">
            {newsletter.isPending && 'Saving…'}
            {newsletter.isSuccess && (newsletter.data?.newsletter ?? newsletter.variables ? "You're subscribed to the newsletter." : "You're unsubscribed from the newsletter.")}
            {newsletter.isError && `Couldn't change your newsletter setting: ${newsletter.error.message}`}
          </p>
        </section>
      )}

      <p className="profile__note">
        {REAL_ACCOUNTS
          ? 'To use a different email address, contact BuyNest support: a new address has to be confirmed first.'
          : "Profile editing needs a real backend (DummyJSON doesn't save changes). It arrives with the BuyNest API."}
      </p>
    </section>
  )
}

export default ProfilePage
