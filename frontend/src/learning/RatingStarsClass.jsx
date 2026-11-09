import { Component } from 'react'
import { FaRegStar, FaStar, FaStarHalfStroke } from 'react-icons/fa6'
import '../components/product/RatingStars.css'

/*
 * LEARNING EXAMPLE — the same component as components/product/RatingStars.jsx,
 * written as a class. Compare the two side by side at /learn.
 * BuyNest uses the functional version; classes are legacy-style React.
 *
 * Differences to notice:
 * - Extends React's Component class and must define render().
 * - Props are read from `this.props` instead of function parameters.
 */
class RatingStarsClass extends Component {
  static defaultProps = { showValue: true }

  getStarTypes() {
    const roundedRating = Math.round(this.props.rating * 2) / 2
    return Array.from({ length: 5 }, (_, index) => {
      const starNumber = index + 1
      if (roundedRating >= starNumber) return 'full'
      if (roundedRating >= starNumber - 0.5) return 'half'
      return 'empty'
    })
  }

  render() {
    const { rating, showValue } = this.props

    return (
      <div className="rating-stars" role="img" aria-label={`Rated ${rating.toFixed(1)} out of 5`}>
        {this.getStarTypes().map((type, index) => {
          if (type === 'full') return <FaStar key={index} aria-hidden="true" />
          if (type === 'half') return <FaStarHalfStroke key={index} aria-hidden="true" />
          return <FaRegStar key={index} aria-hidden="true" />
        })}
        {showValue && (
          <span className="rating-stars__value" aria-hidden="true">
            {rating.toFixed(1)}
          </span>
        )}
      </div>
    )
  }
}

export default RatingStarsClass
