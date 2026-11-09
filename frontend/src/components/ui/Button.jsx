import { Link } from 'react-router'
import { cn } from '../../utils/classNames'
import './Button.css'

/**
 * Reusable button. Renders a router <Link> when `to` is provided, otherwise
 * a native <button>, so links and actions share one visual style.
 *
 * Variants: primary | secondary | outline | ghost | light
 * Sizes: sm | md | lg
 */
function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  to,
  type = 'button',
  className,
  children,
  ...rest
}) {
  const classes = cn('btn', `btn--${variant}`, `btn--${size}`, fullWidth && 'btn--full', className)

  if (to) {
    return (
      <Link to={to} className={classes} {...rest}>
        {children}
      </Link>
    )
  }

  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  )
}

export default Button
