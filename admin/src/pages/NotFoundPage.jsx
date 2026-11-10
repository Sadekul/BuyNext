import { Link } from 'react-router'

function NotFoundPage() {
  return (
    <div className="state">
      <title>Not found | BuyNest Admin</title>
      <p>This admin page doesn't exist.</p>
      <Link to="/" className="btn btn--outline btn--sm">
        Go to the overview
      </Link>
    </div>
  )
}

export default NotFoundPage
