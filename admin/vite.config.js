import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/*
 * BuyNest admin dashboard: a separate app, served under /admin/ on the
 * storefront's address so it shares the sign-in session (HttpOnly cookies)
 * and the /api services.
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
  },
})
