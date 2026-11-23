import { LuGitCompareArrows } from 'react-icons/lu'
import { useCompare } from '../../hooks/useCompare'
import { cn } from '../../utils/classNames'
import './CompareButton.css'
import { useTranslation } from 'react-i18next'

/**
 * Phase 11 §2: "Compare" toggle on product cards ("icon") and the product
 * page ("button"). A toggle button: its name stays the same and
 * aria-pressed says whether the product is in the compare list. A 5th
 * product isn't added: the compare bar says why instead.
 * Renders nothing outside <CompareProvider>.
 */
function CompareButton({ product, variant = 'icon', className }) {
  const { t } = useTranslation('catalog')
  const compare = useCompare()
  if (!compare) return null
  const isPicked = compare.isInCompare(product.id)

  return (
    <button
      type="button"
      className={cn('compare-button', `compare-button--${variant}`, isPicked && 'compare-button--picked', className)}
      onClick={() => compare.toggleItem(product)}
      aria-pressed={isPicked}
      aria-label={t('compareButton.label', { title: product.title })}
      title={t(isPicked ? 'compareButton.pickedTitle' : 'compareButton.addTitle')}
    >
      <LuGitCompareArrows aria-hidden="true" />
      {variant === 'button' && <span aria-hidden="true">{t(isPicked ? 'compareButton.comparing' : 'compareButton.compare')}</span>}
    </button>
  )
}

export default CompareButton
