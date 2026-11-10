import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { handleApiRequest } from './server/api.js'

/*
 * The shop owner's dashboard (../admin, a separate React app) at /admin/:
 * - `npm run dev` also starts the admin dev server (port 5175) and forwards
 *   /admin/ to it, so http://localhost:5173/admin/ works with one command.
 * - `npm run build` builds it into dist/admin; `npm run preview` serves it.
 */
const ADMIN_DIR = fileURLToPath(new URL('../admin/', import.meta.url))
const ADMIN_PORT = 5175

const isPortInUse = (port) =>
  new Promise((resolve) => {
    const socket = connect(port, 'localhost')
    socket.once('connect', () => {
      socket.end()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })

// "/admin" → "/admin/" (the app's base path).
function redirectAdminRoot(req, res, next) {
  if (req.url !== '/admin') return next()
  res.statusCode = 302
  res.setHeader('Location', '/admin/')
  res.end()
}

function adminApp() {
  return {
    name: 'buynest-admin-app',
    async configureServer(server) {
      server.middlewares.use(redirectAdminRoot)
      const viteBin = `${ADMIN_DIR}node_modules/vite/bin/vite.js`
      if (process.env.VITEST || !existsSync(viteBin)) return // tests, or admin deps not installed
      // Already running (e.g. this dev server restarted after a config change): reuse it.
      if (await isPortInUse(ADMIN_PORT)) return
      const child = spawn(process.execPath, [viteBin], { cwd: ADMIN_DIR, stdio: ['ignore', 'inherit', 'inherit'] })
      process.once('exit', () => child.kill())
    },
    configurePreviewServer(server) {
      server.middlewares.use(redirectAdminRoot)
      // Admin pages are client-side routes: serve the admin app's index.html for them.
      server.middlewares.use((req, res, next) => {
        const path = req.url.split('?')[0]
        if (path.startsWith('/admin/') && !path.slice(path.lastIndexOf('/')).includes('.')) req.url = '/admin/index.html'
        next()
      })
    },
  }
}

/*
 * Serves BuyNest's server-side services (server/api.js: sign-in at
 * /api/auth/*, admin at /api/admin/*) in `npm run dev` and `npm run preview`,
 * the way the Vercel/Netlify functions do in production. Converts Node's request/response to the Web standard
 * Request/Response the service is written against.
 */
function apiServices() {
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
    const response = await handleApiRequest(request)
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
    server.middlewares.use('/api', middleware)
  }
  return { name: 'buynest-api-services', configureServer: mount, configurePreviewServer: mount }
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
  plugins: [react(), apiServices(), adminApp(), contentSecurityPolicy(mode)],
  server: {
    // The admin dev server (see adminApp above); ws: hot reload for admin pages.
    proxy: { '/admin/': { target: `http://localhost:${ADMIN_PORT}`, ws: true } },
  },
  // Preview serves the built admin from dist/admin instead (not the dev proxy).
  preview: { proxy: {} },
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
