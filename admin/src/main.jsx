import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
// Shared with the storefront: one brand, one set of design tokens.
import '../../frontend/src/assets/styles/tokens.css'
import '../../frontend/src/assets/styles/base.css'
import '../../frontend/src/assets/styles/utilities.css'
import './admin.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename="/admin" useTransitions={false}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
