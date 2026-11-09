import { Component } from 'react'
import { LuMinus, LuPlus } from 'react-icons/lu'
import './QuantityCounter.css'

/*
 * LEARNING EXAMPLE — QuantityCounter written as a class component.
 *
 * Differences from the functional version:
 * - State is one object (`this.state`) created in the constructor.
 * - Updates go through `this.setState`, which merges into that object.
 * - Event handlers need `this` bound; class-field arrow functions do it.
 */
class QuantityCounterClass extends Component {
  static defaultProps = { min: 1, max: 10 }

  constructor(props) {
    super(props) // must run before `this` can be used
    this.state = { quantity: props.min }
  }

  decrease = () => {
    this.setState((current) => ({ quantity: Math.max(this.props.min, current.quantity - 1) }))
  }

  increase = () => {
    this.setState((current) => ({ quantity: Math.min(this.props.max, current.quantity + 1) }))
  }

  render() {
    const { quantity } = this.state
    const { min, max } = this.props

    return (
      <div className="quantity-counter" role="group" aria-label="Quantity">
        <button type="button" onClick={this.decrease} disabled={quantity <= min} aria-label="Decrease quantity">
          <LuMinus aria-hidden="true" />
        </button>
        <output aria-live="polite">{quantity}</output>
        <button type="button" onClick={this.increase} disabled={quantity >= max} aria-label="Increase quantity">
          <LuPlus aria-hidden="true" />
        </button>
      </div>
    )
  }
}

export default QuantityCounterClass
