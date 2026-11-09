import { useState } from 'react'
import Button from '../components/ui/Button'
import Loader from '../components/ui/Loader'
import ErrorMessage from '../components/ui/ErrorMessage'
import EmptyState from '../components/ui/EmptyState'
import Modal from '../components/ui/Modal'
import ProductBadge from '../components/product/ProductBadge'
import RatingStars from '../components/product/RatingStars'
import RatingStarsClass from '../learning/RatingStarsClass'
import QuantityCounter from '../learning/QuantityCounter'
import QuantityCounterClass from '../learning/QuantityCounterClass'
import './ComponentLabPage.css'

/**
 * LEARNING PAGE (/learn) — a living style guide. Shows every reusable UI
 * component in isolation, plus functional vs class component comparisons.
 * Not linked from the main navigation; remove or hide before launch.
 */
function ComponentLabPage() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [retryCount, setRetryCount] = useState(0)

  return (
    <div className="section container component-lab">
      <header>
        <h1>Component lab</h1>
        <p className="component-lab__intro">Reusable BuyNest components, rendered in isolation for learning and testing.</p>
      </header>

      <section aria-labelledby="lab-class-vs-function">
        <h2 id="lab-class-vs-function">Functional vs class components</h2>
        <div className="component-lab__compare">
          <LabCard title="RatingStars (function)">
            <RatingStars rating={4.12} />
          </LabCard>
          <LabCard title="RatingStarsClass (class)">
            <RatingStarsClass rating={4.12} />
          </LabCard>
          <LabCard title="QuantityCounter (function + useState)">
            <QuantityCounter max={5} />
          </LabCard>
          <LabCard title="QuantityCounterClass (class + setState)">
            <QuantityCounterClass max={5} />
          </LabCard>
        </div>
      </section>

      <section aria-labelledby="lab-buttons">
        <h2 id="lab-buttons">Buttons and badges</h2>
        <div className="component-lab__row">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
        </div>
        <div className="component-lab__row">
          <ProductBadge variant="sale">-18%</ProductBadge>
          <ProductBadge variant="warning">Low stock</ProductBadge>
          <ProductBadge variant="danger">Out of stock</ProductBadge>
          <ProductBadge>New</ProductBadge>
        </div>
      </section>

      <section aria-labelledby="lab-feedback">
        <h2 id="lab-feedback">Loading, error, and empty states</h2>
        <div className="component-lab__compare">
          <LabCard title="Loader">
            <Loader label="Loading products…" />
          </LabCard>
          <LabCard title={`ErrorMessage (retried ${retryCount}×)`}>
            <ErrorMessage
              titleAs="h4"
              message="We couldn't load products. Check your connection."
              onRetry={() => setRetryCount((count) => count + 1)}
            />
          </LabCard>
          <LabCard title="EmptyState">
            <EmptyState titleAs="h4" title="Your cart is empty" message="Add products to see them here." />
          </LabCard>
        </div>
      </section>

      <section aria-labelledby="lab-modal">
        <h2 id="lab-modal">Modal</h2>
        <Button variant="outline" onClick={() => setIsModalOpen(true)}>
          Open modal
        </Button>
        <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Example modal">
          <p>Press Escape, click the backdrop, or use the close button. Focus stays inside while open.</p>
        </Modal>
      </section>
    </div>
  )
}

function LabCard({ title, children }) {
  return (
    <div className="component-lab__card">
      <h3 className="component-lab__card-title">{title}</h3>
      {children}
    </div>
  )
}

export default ComponentLabPage
