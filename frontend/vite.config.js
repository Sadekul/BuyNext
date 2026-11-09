import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { handleAuthRequest } from './server/authBff.js'

/*
 * Serves the sign-in service (server/authBff.js) at /api/auth/* in
 * `npm run dev` and `npm run preview`, the way the Vercel/Netlify functions
 * do in production. Converts Node's request/response to the Web standard
 * Request/Response the service is written against.
 */
function authService() {
  async function middleware(req, res) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined
    const request = new Request(`http://${req.headers.host}${req.originalUrl ?? req.url}`, {
      method: req.method,
      headers: Object.entries(req.headers).flatMap(([name, value]) =>
        Array.isArray(value) ? value.map((item) => [name, item]) : [[name, value]],
      ),
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
    })
    const response = await handleAuthRequest(request)
    res.statusCode = response.status
    response.headers.forEach((value, name) => {
      if (name !== 'set-cookie') res.setHeader(name, value)
    })
    const cookies = response.headers.getSetCookie()
    if (cookies.length > 0) res.setHeader('Set-Cookie', cookies)
    res.end(Buffer.from(await response.arrayBuffer()))
  }
  // No return value: Vite would call a returned function as a post-middleware hook.
  const mount = (server) => {
    server.middlewares.use('/api/auth', middleware)
  }
  return { name: 'buynest-auth-service', configureServer: mount, configurePreviewServer: mount }
}

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
    `connect-src 'self' ${apiOrigin}`, // 'self' covers the sign-in service at /api/auth
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
  plugins: [react(), authService(), contentSecurityPolicy(mode)],
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
