import { LuShoppingBag } from 'react-icons/lu'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import Loader from '../ui/Loader'
import ErrorMessage from '../ui/ErrorMessage'
import RatingStars from './RatingStars'
import { useQuery } from '@tanstack/react-query'
import { productQuery } from '../../queries/productQueries'
import { ROUTES } from '../../constants/routes'
import { formatPrice, formatSlug } from '../../utils/formatters'
import { getProductPricing } from '../../utils/pricing'
import { fromPrice } from '../../utils/variants'
import { getPurchaseLimits } from '../../utils/inventory'
import { isGiftCardProduct } from '../../utils/giftCards'
import { availabilityLabel } from '../../utils/catalogText'
import './QuickViewModal.css'
import { useTranslation } from 'react-i18next'

const AVAILABILITY_TONE = { 'In Stock': 'success', 'Low Stock': 'warning', 'Out of Stock': 'danger' }

/**
 * Quick view: a modal with a product summary, without leaving the listing.
 * List responses only contain card fields, so we fetch the full product
 * (description, images) by ID when the modal opens. The details page uses
 * the same query, so opening "View full details" afterwards is instant.
 */
function QuickViewModal({ product, onClose, onAddToCart }) {
  const { t } = useTranslation('catalog')
  return (
    <Modal isOpen={product !== null} onClose={onClose} title={product?.title ?? t('quickView.title')}>
      {/* Mount the content only while open, so each product gets a fresh request. */}
      {product && <QuickViewContent product={product} onAddToCart={onAddToCart} />}
    </Modal>
  )
}

function QuickViewContent({ product, onAddToCart }) {
  const { t } = useTranslation('catalog')
  const request = useQuery(productQuery(product.id))

  if (request.isPending) return <Loader label={t('quickView.loading')} />
  if (request.error) {
    return <ErrorMessage titleAs="h3" message={request.error.message} onRetry={() => request.refetch()} />
  }

  const details = request.data
  // Phase 16: a configurable product whose variants cost differently shows "From ৳x" (options are chosen on its page).
  const from = fromPrice(details)
  const { hasDiscount, roundedDiscount, salePrice, originalPrice } = getProductPricing(from === null ? details : { price: from, discountPercentage: 0 })
  const { canBuy } = getPurchaseLimits(details)

  return (
    <div className="quick-view">
      <img
        className="quick-view__image"
        src={details.images[0] ?? details.thumbnail}
        alt={details.title}
        width="400"
        height="400"
      />

      <div className="quick-view__info">
        <p className="quick-view__meta">
          {details.brand && <span>{details.brand}</span>}
          {details.category && <span>{details.categoryName ?? formatSlug(details.category)}</span>}
        </p>
        {details.rating !== null && <RatingStars rating={details.rating} />}

        <p className="quick-view__price">
          <span className="quick-view__price-current">
            {from !== null && t('card.from')}
            {formatPrice(salePrice)}
          </span>
          {hasDiscount && (
            <>
              <s>{formatPrice(originalPrice)}</s>
              <span className="quick-view__saving">{t('card.save', { percent: roundedDiscount })}</span>
            </>
          )}
        </p>

        {details.availabilityStatus && (
          <p className={`quick-view__stock quick-view__stock--${AVAILABILITY_TONE[details.availabilityStatus] ?? 'success'}`}>
            {availabilityLabel(details.availabilityStatus)}
          </p>
        )}
        {details.description && <p className="quick-view__description">{details.description}</p>}

        <div className="quick-view__actions">
          {details.hasVariants || isGiftCardProduct(details) ? (
            // Options (size, color), or a gift card's amount and recipient, are chosen on the product page.
            <Button to={ROUTES.productDetails(details.id)}>{t(isGiftCardProduct(details) ? 'card.chooseAmount' : 'card.chooseOptions')}</Button>
          ) : (
            <>
              <Button onClick={() => onAddToCart(details)} disabled={!canBuy}>
                <LuShoppingBag aria-hidden="true" />
                {t(canBuy ? 'card.addToCart' : 'card.unavailable')}
              </Button>
              <Button to={ROUTES.productDetails(details.id)} variant="outline">
                {t('quickView.fullDetails')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default QuickViewModal
