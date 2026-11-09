import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Vitest reuses this config, so tests compile JSX exactly like the app.
  test: {
    environment: 'jsdom', // a simulated browser DOM
    setupFiles: ['./src/test/setup.js'],
    css: false,
    // A fake API URL: no test can reach the real (changing) DummyJSON API.
    env: { VITE_API_BASE_URL: 'https://api.test', VITE_API_PROVIDER: 'dummyjson' },
    restoreMocks: true,
  },
})
