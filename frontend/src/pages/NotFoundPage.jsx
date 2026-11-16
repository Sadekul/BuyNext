import { LuMapPinOff } from 'react-icons/lu'
import PageMeta from '../components/common/PageMeta'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import Loader from '../components/ui/Loader'
import { ROUTES } from '../constants/routes'
import { useStoreRedirect } from '../hooks/useStoreRedirect'

/**
 * "Page not found". With BuyNest's API (phase 7) the store's URL redirects
 * are checked first (hooks/useStoreRedirect.js): an old address the admin
 * moved sends the shopper to its new place instead.
 */
function NotFoundPage() {
  const { checking } = useStoreRedirect()

  if (checking) {
    return (
      <div className="section container">
        <Loader label="Looking for this page…" />
      </div>
    )
  }

  return (
    <div className="section container">
      <PageMeta title="Page not found" noindex />
      <EmptyState
        icon={LuMapPinOff}
        title="Page not found"
        message="The page you're looking for doesn't exist or has moved."
      >
        <Button to={ROUTES.home}>Go to homepage</Button>
        <Button to={ROUTES.products} variant="outline">
          Browse products
        </Button>
      </EmptyState>
    </div>
  )
}

export default NotFoundPage
