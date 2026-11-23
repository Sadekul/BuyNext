import { useEffect, useRef } from 'react'
import { Navigate, useLocation } from 'react-router'
import { LuHeartHandshake } from 'react-icons/lu'
import Button from '../components/ui/Button'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import './PrivacyPage.css'
import { useTranslation } from 'react-i18next'

/**
 * /goodbye (REAL_SHOP, phase 9): shown right after a customer deleted their
 * account (the privacy page sends them here with `state.deleted`). Opened
 * any other way, it goes to the home page.
 */
function AccountDeletedPage() {
  const { t } = useTranslation('account')
  const location = useLocation()
  const headingRef = useRef(null)
  const deleted = location.state?.deleted === true

  // Focus the message: the page the customer was on is gone.
  useEffect(() => {
    if (deleted) headingRef.current?.focus()
  }, [deleted])

  if (!deleted) return <Navigate to={ROUTES.home} replace />

  return (
    <div className="goodbye feedback section container">
      <title>{`${t('deleted.tabTitle')} | ${SITE.name}`}</title>
      <LuHeartHandshake className="feedback__icon" aria-hidden="true" />
      <h1 className="feedback__title" ref={headingRef} tabIndex={-1}>
        {t('deleted.title')}
      </h1>
      <p className="feedback__message">{t('deleted.message', { store: SITE.name })}</p>
      <div className="feedback__actions">
        <Button to={ROUTES.home}>{t('deleted.back')}</Button>
      </div>
    </div>
  )
}

export default AccountDeletedPage
