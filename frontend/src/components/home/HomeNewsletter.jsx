import Newsletter from '../forms/Newsletter'
import './HomeNewsletter.css'

/**
 * The home page's newsletter block: the existing sign-up form
 * (components/forms/Newsletter: same API, labels, and messages) on the
 * dark slate block (amber subtitle, white field, red Subscribe). Only the look
 * changes, scoped to this wrapper.
 */
function HomeNewsletter() {
  return (
    <div className="home-newsletter">
      <Newsletter />
    </div>
  )
}

export default HomeNewsletter
