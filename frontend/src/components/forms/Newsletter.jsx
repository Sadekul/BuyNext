import { useId, useState } from 'react'
import { LuMail } from 'react-icons/lu'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import './Newsletter.css'

// Deliberately simple check; real validation (React Hook Form + Zod) comes later.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Newsletter sign-up with a controlled email input.
 * DEMO ONLY: nothing is sent anywhere yet. A real subscription needs a
 * backend endpoint (or email provider API) — that arrives with the backend.
 */
function Newsletter() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [isConfirmationOpen, setIsConfirmationOpen] = useState(false)
  const inputId = useId()
  const errorId = useId()

  function handleSubmit(event) {
    event.preventDefault()

    if (!EMAIL_PATTERN.test(email.trim())) {
      setError('Please enter a valid email address.')
      return
    }

    setError('')
    setIsConfirmationOpen(true)
  }

  function handleConfirmationClose() {
    setIsConfirmationOpen(false)
    setEmail('')
  }

  return (
    <section className="newsletter" aria-labelledby="newsletter-title">
      <div className="newsletter__inner container">
        <div className="newsletter__copy">
          <LuMail className="newsletter__icon" aria-hidden="true" />
          <div>
            <h2 id="newsletter-title" className="newsletter__title">
              Get 10% off your first order
            </h2>
            <p className="newsletter__text">Join the BuyNest newsletter for new arrivals, exclusive deals, and style tips.</p>
          </div>
        </div>

        <form className="newsletter__form" onSubmit={handleSubmit} noValidate>
          <div className="newsletter__field">
            <label htmlFor={inputId} className="visually-hidden">
              Email address
            </label>
            <input
              id={inputId}
              type="email"
              className="newsletter__input"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? errorId : undefined}
              autoComplete="email"
            />
            <Button type="submit" variant="secondary">
              Subscribe
            </Button>
          </div>
          {error && (
            <p id={errorId} className="newsletter__error" role="alert">
              {error}
            </p>
          )}
        </form>
      </div>

      <Modal isOpen={isConfirmationOpen} onClose={handleConfirmationClose} title="You're on the list (demo)">
        <p>
          Thanks! In this learning build nothing is actually sent — <strong>{email}</strong> was not stored anywhere.
          Real sign-ups will be handled by the BuyNest backend.
        </p>
        <Button onClick={handleConfirmationClose} className="newsletter__modal-button">
          Continue shopping
        </Button>
      </Modal>
    </section>
  )
}

export default Newsletter
