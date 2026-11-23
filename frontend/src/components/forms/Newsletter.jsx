import { useId, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { LuMail } from 'react-icons/lu'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { REAL_SHOP } from '../../constants/shop'
import { subscribeToNewsletter } from '../../services/newsletterService'
import './Newsletter.css'
import { Trans, useTranslation } from 'react-i18next'

// Deliberately simple check; real validation (React Hook Form + Zod) comes later.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Newsletter sign-up with a controlled email input.
 * REAL_SHOP (backend phase 7): BuyNest's API emails a confirmation link
 * (double opt-in). Its answer is the same for every address, so the form
 * can't be used to find out who is subscribed.
 * DEMO: nothing is sent anywhere; the modal says so.
 */
function Newsletter() {
  const { t } = useTranslation('marketing')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [isConfirmationOpen, setIsConfirmationOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const inputId = useId()
  const errorId = useId()
  const subscribe = useMutation({
    mutationFn: (address) => subscribeToNewsletter(address, { source: 'footer' }),
    onSuccess: (answer) => {
      setConfirmation(answer?.message || t('newsletter.thanks'))
      setIsConfirmationOpen(true)
    },
    onError: (failure) => setError(failure.fieldErrors?.email?.[0] ?? failure.message),
  })

  function handleSubmit(event) {
    event.preventDefault()

    if (!EMAIL_PATTERN.test(email.trim())) {
      setError(t('newsletter.invalid'))
      return
    }

    setError('')
    if (REAL_SHOP) subscribe.mutate(email.trim())
    else setIsConfirmationOpen(true)
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
              {t('newsletter.title')}
            </h2>
            <p className="newsletter__text">{t('newsletter.text')}</p>
          </div>
        </div>

        <form className="newsletter__form" onSubmit={handleSubmit} noValidate>
          <div className="newsletter__field">
            <label htmlFor={inputId} className="visually-hidden">
              {t('newsletter.email')}
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
            <Button type="submit" variant="secondary" disabled={subscribe.isPending}>
              {t(subscribe.isPending ? 'newsletter.subscribing' : 'newsletter.subscribe')}
            </Button>
          </div>
          {error && (
            <p id={errorId} className="newsletter__error" role="alert">
              {error}
            </p>
          )}
        </form>
      </div>

      <Modal isOpen={isConfirmationOpen} onClose={handleConfirmationClose} title={t(REAL_SHOP ? 'newsletter.checkInbox' : 'newsletter.demoTitle')}>
        {REAL_SHOP ? (
          <p>
            {confirmation} {t('newsletter.valid')}
          </p>
        ) : (
          <p>
            <Trans t={t} i18nKey="newsletter.demoText" values={{ email }} components={{ strong: <strong /> }} />
          </p>
        )}
        <Button onClick={handleConfirmationClose} className="newsletter__modal-button">
          {t('newsletter.continue')}
        </Button>
      </Modal>
    </section>
  )
}

export default Newsletter
