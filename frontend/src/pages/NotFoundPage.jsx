import { LuMapPinOff } from 'react-icons/lu'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import { ROUTES } from '../constants/routes'

function NotFoundPage() {
  return (
    <div className="section container">
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
