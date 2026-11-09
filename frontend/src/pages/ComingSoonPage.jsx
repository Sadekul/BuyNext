import { LuConstruction } from 'react-icons/lu'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import { ROUTES } from '../constants/routes'

/**
 * Temporary placeholder for routes whose pages are built in later phases,
 * so every link in the template already goes somewhere sensible.
 */
function ComingSoonPage({ title, phase }) {
  return (
    <div className="section container">
      <EmptyState
        icon={LuConstruction}
        title={title}
        message={`This page is built in Phase ${phase} of the BuyNest project.`}
      >
        <Button to={ROUTES.home}>Back to homepage</Button>
      </EmptyState>
    </div>
  )
}

export default ComingSoonPage
