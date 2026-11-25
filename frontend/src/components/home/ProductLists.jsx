import { useQueries } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import CompactProductList from './CompactProductList'
import { rankedProductsQuery } from '../../queries/productQueries'
import { compactListOrder } from '../../utils/homeSections'
import './CompactProductList.css'

/**
 * Phase 17 (PHASE17_CONTRACT.md §4.5): the four compact lists side by side on
 * desktop (Best selling, Top rated, On sale, New), two per row on tablets,
 * and a sideways swipe on phones (one list and a peek of the next).
 * `rankings`: the ones the API can give (utils/homeSections.js
 * availableRankings), so the demo shows Top rated and On sale only.
 * Each list reuses the "Top products" tab's request for the same ranking
 * (one cache entry each: rankedProductsQuery). A list that fails or comes
 * back empty is left out, and the whole section when none has products.
 */
function ProductLists({ rankings, limit = 12 }) {
  const { t } = useTranslation('marketing')
  const lists = compactListOrder(rankings)
  const requests = useQueries({ queries: lists.map((ranking) => rankedProductsQuery(ranking, limit)) })

  const shown = lists
    .map((ranking, index) => ({ ranking, request: requests[index] }))
    .filter(({ request }) => request.isPending || (!request.error && (request.data?.length ?? 0) > 0))
  if (shown.length === 0) return null

  return (
    <section className="section home-section product-lists" aria-labelledby="product-lists-title">
      <div className="container">
        <h2 id="product-lists-title" className="visually-hidden">
          {t('home.lists.label')}
        </h2>
        <div className={`product-lists__row product-lists__row--${shown.length}`}>
          {shown.map(({ ranking, request }) => (
            <CompactProductList
              key={ranking.id}
              title={t(ranking.listKey)}
              products={request.data ?? []}
              isLoading={request.isPending}
              viewAllTo={ranking.viewAllTo}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

export default ProductLists
