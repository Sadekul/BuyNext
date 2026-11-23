import { LuMapPinOff } from 'react-icons/lu'
import { useTranslation } from 'react-i18next'
import PageMeta from '../components/common/PageMeta'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import Loader from '../components/ui/Loader'
import { ROUTES } from '../constants/routes'
import { useStoreRedirect } from '../hooks/useStoreRedirect'

/**
 * "Page not found". With BuyNest's API (phase 7) the store's URL redirects
 * are checked first (hooks/useStoreRedirect.js): an old address the admin
 * moved sends the shopper to its new place instead.
 */
function NotFoundPage() {
  const { checking } = useStoreRedirect()
  const { t } = useTranslation('errors')

  if (checking) {
    return (
      <div className="section container">
        <Loader label={t('notFound.looking')} />
      </div>
    )
  }

  return (
    <div className="section container">
      <PageMeta title={t('notFound.title')} noindex />
      <EmptyState icon={LuMapPinOff} title={t('notFound.title')} message={t('notFound.message')}>
        <Button to={ROUTES.home}>{t('notFound.home')}</Button>
        <Button to={ROUTES.products} variant="outline">
          {t('notFound.browse')}
        </Button>
      </EmptyState>
    </div>
  )
}

export default NotFoundPage
