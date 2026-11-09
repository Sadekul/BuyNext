import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
// Global styles first, so component stylesheets (imported by App) can override them.
import './index.css'
import App from './App.jsx'

// Entry point: find <div id="root"> in index.html and let React own it.
// BrowserRouter enables client-side routing for everything inside <App />.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
