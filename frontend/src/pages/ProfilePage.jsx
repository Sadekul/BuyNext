import ErrorMessage from '../components/ui/ErrorMessage'
import Loader from '../components/ui/Loader'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '@tanstack/react-query'
import { profileQuery } from '../queries/userQueries'
import { SITE } from '../constants/site'
import './ProfilePage.css'

/**
 * /account — the customer's profile, loaded from GET /auth/me with the
 * access token (authorizedRequest refreshes it once if it has expired).
 */
function ProfilePage() {
  const { user, authorizedRequest } = useAuth()
  const request = useQuery(profileQuery(user.id, authorizedRequest))

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
        <div>
          <h2 id="profile-title" className="profile__name">
            {profile.firstName} {profile.lastName}
          </h2>
          <p className="profile__username">@{profile.username}</p>
        </div>
      </div>

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
