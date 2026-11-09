import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

/*
 * Content-Security-Policy for production builds, added to index.html as a
 * <meta> tag. It tells the browser which origins may serve scripts, styles,
 * images, fonts, and API responses, so injected markup can't load or run
 * anything else. The API origin comes from VITE_API_BASE_URL, so switching to
 * Laravel needs no change here. Build-only: the dev server relies on inline
 * scripts and a WebSocket for hot reload.
 * (frame-ancestors can't be set in a <meta> tag; X-Frame-Options in
 * vercel.json / public/_headers blocks framing instead.)
 */
function contentSecurityPolicy(mode) {
  const env = loadEnv(mode, import.meta.dirname, 'VITE_')
  const apiOrigin = env.VITE_API_BASE_URL ? new URL(env.VITE_API_BASE_URL).origin : ''
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: https://cdn.dummyjson.com ${apiOrigin}`,
    `connect-src 'self' ${apiOrigin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ]
    .map((directive) => directive.trim())
    .join('; ')

  return {
    name: 'buynest-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' },
    ],
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), contentSecurityPolicy(mode)],
  // Vitest reuses this config, so tests compile JSX exactly like the app.
  test: {
    environment: 'jsdom', // a simulated browser DOM
    setupFiles: ['./src/test/setup.js'],
    css: false,
    // A fake API URL: no test can reach the real (changing) DummyJSON API.
    env: { VITE_API_BASE_URL: 'https://api.test', VITE_API_PROVIDER: 'dummyjson' },
    restoreMocks: true,
  },
}))
