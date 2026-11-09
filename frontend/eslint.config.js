import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Never lint build output.
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      // Core JavaScript correctness rules (unused variables, unreachable code, ...).
      js.configs.recommended,
      // Rules of Hooks + React Compiler-aware checks (state in render, ref misuse, ...).
      reactHooks.configs.flat.recommended,
      // Warns when a file breaks Fast Refresh (HMR) by exporting non-components.
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
  // Server-side code: the sign-in service, its host adapters, and build config run on Node.
  {
    files: ['server/**/*.js', 'api/**/*.js', 'netlify/**/*.mjs', 'vite.config.js'],
    languageOptions: { globals: globals.node },
  },
])
