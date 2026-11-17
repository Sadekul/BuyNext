import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
// Shared with the storefront: one brand, one set of design tokens.
import '../../frontend/src/assets/styles/tokens.css'
import '../../frontend/src/assets/styles/base.css'
import '../../frontend/src/assets/styles/utilities.css'
import './admin.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary'
import { installErrorReporting } from './utils/errorReporting'

// Phase 9: report crashes to BuyNest's own service (POST /api/client-errors). Only with
// BuyNest's accounts behind the admin: the DummyJSON demo has nowhere to send them.
if (import.meta.env.VITE_ACCOUNTS_BACKEND === 'laravel') installErrorReporting({ release: import.meta.env.VITE_RELEASE })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename="/admin" useTransitions={false}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
)
