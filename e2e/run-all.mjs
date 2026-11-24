// Runs every browser suite one after another; exits with 1 if any check failed.
//   npm test             against the dev server (http://localhost:5173)
//   npm run test:prod    against the production build (npm run build && npm run preview)
import { spawnSync } from 'node:child_process'
import { isProductionBuild, preserveStock } from './lib.mjs'

const suites = ['storefront', 'accounts', 'sessions', 'signup', 'orders', 'documents', 'system', 'catalog', 'customers', 'marketing', 'payments', 'launch', 'extras', 'loyalty', 'taka', 'bangla', 'delivery', 'slider', 'configurable', 'security', 'motion', 'admin']
// Laravel mode starts its own dev server, so it runs only in the dev run.
if (!isProductionBuild) suites.push('laravel')

// Test orders use up real stock: put it back afterwards.
const restoreStock = await preserveStock()
const results = []
for (const suite of suites) {
  const run = spawnSync(process.execPath, [`${suite}.mjs`], { cwd: import.meta.dirname, encoding: 'utf8', timeout: 15 * 60_000 })
  process.stdout.write(run.stdout)
  if (run.stderr) process.stderr.write(run.stderr)
  const summary = run.stdout.match(/(\d+) passed, (\d+) failed\s*$/)
  results.push({ suite, passed: Number(summary?.[1] ?? 0), failed: summary ? Number(summary[2]) : 1, crashed: !summary })
}

const restored = await restoreStock()
if (restored > 0) console.log(`\n(Stock put back for ${restored} products changed by test orders)`)

console.log('\n# Summary')
for (const { suite, passed, failed, crashed } of results) {
  console.log(`${failed === 0 ? 'PASS' : 'FAIL'}  ${suite.padEnd(11)} ${crashed ? 'did not finish' : `${passed} passed, ${failed} failed`}`)
}
const total = results.reduce((sum, result) => sum + result.passed, 0)
const failed = results.reduce((sum, result) => sum + result.failed, 0)
console.log(`\n${total} checks passed, ${failed} failed`)
process.exitCode = failed > 0 ? 1 : 0
