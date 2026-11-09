import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
// Global styles first, so component stylesheets (imported by App) can override them.
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/common/ErrorBoundary'
import RootErrorFallback from './components/common/RootErrorFallback'

// Entry point: find <div id="root"> in index.html and let React own it.
// BrowserRouter enables client-side routing for everything inside <App />.
//
// useTransitions={false}: by default React Router renders URL changes as a
// low-priority transition. The catalog's filter checkboxes read their value
// from the URL, so a transition made them flicker back for a moment after
// each click. Synchronous updates keep controlled inputs instant.
//
// The outer ErrorBoundary is the last line of defence: MainLayout has one per
// page, but a crash in the header, cart drawer, or a provider would otherwise
// leave a blank screen.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary fallback={() => <RootErrorFallback />}>
      <BrowserRouter useTransitions={false}>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
