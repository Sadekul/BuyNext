import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/*
 * BuyNest admin dashboard: a separate app, served under /admin/ on the
 * storefront's address so it uses the same /api services. Admins have their
 * own sign-in and session cookies, separate from customers'.
 * - `npm run dev` in frontend/ starts this dev server too and forwards
 *   /admin to it, so http://localhost:5173/admin/ just works.
 * - `npm run build` in frontend/ builds this app into frontend/dist/admin.
 */

// Same Content-Security-Policy as the storefront (see frontend/vite.config.js),
// added to the built index.html. The admin only talks to its own origin (/api).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://cdn.dummyjson.com https://dummyjson.com",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

function contentSecurityPolicy() {
  return {
    name: 'buynest-admin-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    ],
  }
}

export default defineConfig({
  base: '/admin/',
  // Read the storefront's .env files, so both apps agree on VITE_ACCOUNTS_BACKEND.
  envDir: '../frontend',
  plugins: [react(), contentSecurityPolicy()],
  server: {
    port: 5175,
    strictPort: true,
    // Normally reached through the storefront (localhost:5173/admin/): hot
    // reload connects back through that address.
    hmr: { clientPort: 5173 },
    // Opened directly on :5175, API calls still reach the storefront's services.
    proxy: { '/api': 'http://localhost:5173' },
    // The design tokens and base styles are shared with ../frontend.
    fs: { allow: ['..'] },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: false,
    restoreMocks: true,
    // Demo accounts in unit tests, whatever ../frontend/.env.local says.
    env: { VITE_ACCOUNTS_BACKEND: 'dummyjson' },
  },
})
