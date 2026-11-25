import { useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { LuArrowRight } from 'react-icons/lu'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import SectionHeading from '../common/SectionHeading'
import ProductCard from '../product/ProductCard'
import ProductGridSkeleton from '../product/ProductGridSkeleton'
import ErrorMessage from '../ui/ErrorMessage'
import { rankedProductsQuery } from '../../queries/productQueries'
import { BEST_SELLING_DAYS } from '../../utils/homeSections'
import { cn } from '../../utils/classNames'
import './TopProductsTabs.css'

/**
 * "Top products" (phase 17, PHASE17_CONTRACT.md §4.3): one product grid per
 * ranking (utils/homeSections.js HOME_RANKINGS: Best selling, Trending (by
 * rating), New arrivals, On sale), shown as WAI-ARIA tabs:
 *
 *   section (named by its h2 "Top products")
 *     div role=tablist (named by the h2)
 *       button role=tab  aria-selected  aria-controls=<panel>  tabindex 0 (selected) / -1
 *     div role=tabpanel  aria-labelledby=<tab>  (hidden unless selected)
 *
 * Keyboard (automatic activation): Left / Right move to the previous / next
 * tab and show it (wrapping), Home / End the first / last; Tab leaves the tab
 * list for the panel. A panel loads its products the first time it is shown
 * (one request per ranking, cached and shared with the compact lists).
 * `rankings`: only the ones the API can really give (the demo has no sales
 * or dates, so "Best selling" and "New arrivals" are left out there; with
 * BuyNest's API "Best selling" only once real sales are known, see HomePage).
 */
function TopProductsTabs({ rankings, onAddToCart, limit = 12 }) {
  const { t } = useTranslation('marketing')
  const baseId = useId()
  const headingId = `${baseId}-title`
  // null until the shopper picks a tab: the first tab is shown, even if one appears before it later
  // ("Best selling" shows up once real sales are known).
  const [selectedId, setSelectedId] = useState(null)
  const tabsRef = useRef(null)

  if (rankings.length === 0) return null
  const selected = rankings.find((ranking) => ranking.id === selectedId) ?? rankings[0]
  const tabId = (ranking) => `${baseId}-tab-${ranking.id}`
  const panelId = (ranking) => `${baseId}-panel-${ranking.id}`

  const onKeyDown = (event) => {
    const current = rankings.findIndex((ranking) => ranking.id === selected.id)
    const rtl = tabsRef.current && getComputedStyle(tabsRef.current).direction === 'rtl'
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[event.key]
    let next
    if (step) next = (current + step + rankings.length) % rankings.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = rankings.length - 1
    else return
    event.preventDefault()
    setSelectedId(rankings[next].id)
    tabsRef.current?.querySelectorAll('[role="tab"]')[next]?.focus()
  }

  const selectedLabel = t(selected.labelKey)

  return (
    <section className="section home-section top-products" aria-labelledby={headingId}>
      <div className="container">
        <div className="top-products__head">
          <SectionHeading id={headingId} eyebrow={t('home.top.eyebrow')} title={t('home.top.title')} />
          <div ref={tabsRef} className="top-products__tabs" role="tablist" aria-labelledby={headingId} onKeyDown={onKeyDown}>
            {rankings.map((ranking) => {
              const isSelected = ranking.id === selected.id
              return (
                <button
                  key={ranking.id}
                  type="button"
                  role="tab"
                  id={tabId(ranking)}
                  className={cn('top-products__tab', isSelected && 'top-products__tab--selected')}
                  aria-selected={isSelected}
                  aria-controls={panelId(ranking)}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => setSelectedId(ranking.id)}
                >
                  {t(ranking.labelKey)}
                </button>
              )
            })}
          </div>
        </div>

        {rankings.map((ranking) => (
          <div
            key={ranking.id}
            role="tabpanel"
            id={panelId(ranking)}
            aria-labelledby={tabId(ranking)}
            className="top-products__panel"
            hidden={ranking.id !== selected.id}
            tabIndex={0}
          >
            {ranking.id === selected.id && (
              <RankingPanel ranking={ranking} label={selectedLabel} limit={limit} onAddToCart={onAddToCart} />
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

/** One tab's products: loaded when the tab is first shown (then cached). */
function RankingPanel({ ranking, label, limit, onAddToCart }) {
  const { t } = useTranslation('marketing')
  const request = useQuery(rankedProductsQuery(ranking, limit))
  const products = request.data ?? []

  return (
    <>
      <div className="top-products__panel-head">
        <p className="top-products__about">{t(`home.top.about.${ranking.id}`, { days: BEST_SELLING_DAYS })}</p>
        <Link to={ranking.viewAllTo} className="section-heading__link" aria-label={t('home.viewAllNamed', { title: label })}>
          {t('home.lists.viewAll')}
          <LuArrowRight aria-hidden="true" />
        </Link>
      </div>
      {request.isPending ? (
        <ProductGridSkeleton count={6} label={t('home.top.loading')} />
      ) : request.error ? (
        <ErrorMessage titleAs="h3" title={t('home.top.failed')} message={request.error.message} onRetry={request.refetch} />
      ) : products.length === 0 ? (
        <p className="top-products__empty">{t('home.top.empty')}</p>
      ) : (
        <ul className="top-products__grid">
          {products.map((product) => (
            <li key={product.id}>
              <ProductCard product={product} onAddToCart={onAddToCart} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

export default TopProductsTabs
