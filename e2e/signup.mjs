// Customer accounts with BuyNest's API: sign-up → emailed code → signed in; profile; password reset; admin view.
// Reads the codes from Laravel's local test inbox (/dev/mailbox). BuyNest accounts only (E2E_ACCOUNTS=laravel).
import {
  ADMIN_USER,
  BASE,
  LARAVEL,
  LARAVEL_URL,
  adminSignIn,
  axeViolations,
  latestCode,
  launch,
  reporter,
  sidewaysOverflow,
  storefrontSignIn,
  storefrontSignOut,
  visible,
  watchErrors,
} from './lib.mjs'

const report = reporter('sign-up and email codes')
const { log } = report
if (!LARAVEL) {
  console.log('(Sign-up checks skipped: they need BuyNest accounts, E2E_ACCOUNTS=laravel)')
  report.done()
  process.exit(0)
}

const browser = await launch()
const errors = []
const axe = async (page, name) => {
  const violations = await axeViolations(page)
  log(violations.length === 0, `axe ${name}: ${violations.join(', ') || 'no violations'}`)
}
const run = Date.now()
const nadia = { email: `nadia.${run}@example.com`, password: 'Secret123', firstName: 'Nadia' }
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true })
const page = watchErrors(await ctx.newPage(), errors)

async function fillSignUp(account, phone = '+880 1712-345678') {
  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' })
  await page.getByLabel('First name').fill(account.firstName)
  await page.getByLabel('Last name').fill('Rahman')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Phone number').fill(phone)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  await page.getByLabel('Confirm password').fill(account.password)
  await page.getByLabel(/I agree to the terms/).check()
}

// ---------- Sign-up ----------
await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' })
log((await page.getByLabel('Username').count()) === 0 && (await page.getByLabel('Phone number').isVisible()), 'sign-up asks for a phone number, not a username')
await axe(page, 'sign-up')
await fillSignUp(nadia, '12345')
await page.getByRole('button', { name: 'Create account' }).click()
log(await visible(page.getByText('Include the country code')), 'an invalid phone number is caught before sending')
await page.getByLabel('Phone number').fill('+880 1712-345678')
await page.getByRole('button', { name: 'Create account' }).click()
log(await visible(page.getByRole('heading', { name: 'Check your email' })), 'sign-up → "Check your email" page')
log(await page.getByText(nadia.email).isVisible(), 'the code page names the email address')
log(await page.getByRole('button', { name: /Send a new code in \d+s/ }).isDisabled(), 'resend waits a minute (countdown)')
await axe(page, 'confirm email')

const first = await latestCode(nadia.email)
log(/Confirm your email/.test(first.subject), `a 6-digit code was emailed ("${first.subject}")`)

// A wrong code first, then the right one
const wrong = String((Number(first.code) + 1) % 1_000_000).padStart(6, '0')
await page.getByLabel('6-digit code').fill(wrong)
await page.getByRole('button', { name: 'Confirm and sign in' }).click()
log(await visible(page.getByText('That code is incorrect or has expired.')), 'a wrong code is refused on the field')
await page.getByLabel('6-digit code').fill(first.code)
await page.getByRole('button', { name: 'Confirm and sign in' }).click()
log(await visible(page.getByRole('heading', { name: /Hi, Nadia/ })), 'the right code confirms the email and signs in')
log(await visible(page.getByText('+8801712345678')), 'the profile shows the phone number (international form)')
log((await ctx.cookies()).some((cookie) => cookie.name === 'buynest_at' && cookie.httpOnly), 'signed in with an HttpOnly session cookie')

// Profile edits are saved for real now
await page.getByRole('button', { name: 'Edit details' }).click()
await page.getByLabel('Phone number').fill('+44 20 7946 0958')
await page.getByRole('button', { name: 'Save' }).click()
log(await visible(page.getByText('Your details were saved.')), 'profile edit: saved')
await page.reload({ waitUntil: 'networkidle' })
log(await visible(page.getByText('+442079460958')), 'profile edit: still there after a reload (stored in the database)')

// Sign out, then sign back in with the email
await storefrontSignOut(page)
await storefrontSignIn(page, nadia)
log(await visible(page.getByRole('heading', { name: /Hi, Nadia/ })), 'signs back in with email and password')
await storefrontSignOut(page)

// The same email can't sign up twice
await fillSignUp(nadia)
await page.getByRole('button', { name: 'Create account' }).click()
log(await visible(page.getByText(/already exists/)), 'signing up again with a confirmed email: "already exists"')

// ---------- An unconfirmed account trying to sign in ----------
const rafi = { email: `rafi.${run}@example.com`, password: 'Secret456', firstName: 'Rafi' }
await fillSignUp(rafi, '+1 555 010 0199')
await page.getByRole('button', { name: 'Create account' }).click()
await page.getByRole('heading', { name: 'Check your email' }).waitFor()
const rafiFirst = await latestCode(rafi.email)
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.getByLabel('Email').fill(rafi.email)
await page.getByLabel('Password', { exact: true }).fill(rafi.password)
await page.getByRole('button', { name: /^sign in$/i }).click()
log(await visible(page.getByRole('heading', { name: 'Check your email' })), 'unconfirmed account: sign-in continues on the code page')
const rafiCode = await latestCode(rafi.email)
log(rafiCode.id === rafiFirst.id, 'no second email within the minute (the first code still works)')
await page.getByLabel('6-digit code').fill(rafiCode.code)
await page.getByRole('button', { name: 'Confirm and sign in' }).click()
log(await visible(page.getByRole('heading', { name: /Hi, Rafi/ })), 'unconfirmed account: confirmed and signed in')
await storefrontSignOut(page)

// ---------- Forgot password ----------
await page.goto(`${BASE}/forgot-password`, { waitUntil: 'networkidle' })
await axe(page, 'forgot password')
await page.getByLabel('Email').fill(nadia.email)
await page.getByRole('button', { name: 'Send code' }).click()
log(await visible(page.getByRole('heading', { name: 'Choose a new password' })), 'forgot password: asks for the code and a new password')
const reset = await latestCode(nadia.email, { after: first.id })
log(/Reset your BuyNest password/.test(reset.subject), `a reset code was emailed ("${reset.subject}")`)
await page.getByLabel('6-digit code').fill(reset.code)
await page.getByLabel('New password', { exact: true }).fill('BrandNew99')
await page.getByLabel('Confirm new password').fill('BrandNew99')
await page.getByRole('button', { name: 'Save new password' }).click()
log(await visible(page.getByText('Your password has been changed')), 'password changed → sign-in page with a notice')
await page.getByLabel('Email').fill(nadia.email)
await page.getByLabel('Password', { exact: true }).fill(nadia.password)
await page.getByRole('button', { name: /^sign in$/i }).click()
log(await visible(page.getByRole('alert').filter({ hasText: 'incorrect' })), 'the old password no longer works')
await storefrontSignIn(page, { ...nadia, password: 'BrandNew99' })
log(await visible(page.getByRole('heading', { name: /Hi, Nadia/ })), 'the new password works')
await storefrontSignOut(page)

// An unknown email gets the same answer (no account lookup leaks)
await page.goto(`${BASE}/forgot-password`, { waitUntil: 'networkidle' })
await page.getByLabel('Email').fill(`nobody.${run}@example.com`)
await page.getByRole('button', { name: 'Send code' }).click()
log(await visible(page.getByText(/If an account exists for/)), 'unknown email: same "if an account exists" answer')

// ---------- Phone-sized layout ----------
await page.setViewportSize({ width: 390, height: 844 })
for (const path of ['/register', '/login', '/forgot-password']) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  const overflow = await sidewaysOverflow(page)
  log(overflow <= 0, `390px ${path}: no sideways scroll (${overflow}px)`)
}
await page.setViewportSize({ width: 1280, height: 900 })

// ---------- The admin sees the new customers ----------
await adminSignIn(page, ADMIN_USER)
await page.getByRole('heading', { name: 'Overview' }).waitFor()
await page.goto(`${BASE}/admin/customers?q=${encodeURIComponent(nadia.email)}`, { waitUntil: 'networkidle' })
const row = page.locator('tbody tr').filter({ hasText: nadia.email })
log(await visible(row), 'admin: the new customer is listed')
log((await row.innerText()).includes('Active') && (await row.innerText()).includes('+442079460958'), 'admin: with status "Active" and the saved phone')

// ---------- The local test inbox ----------
const inbox = await ctx.newPage()
await inbox.goto(`${LARAVEL_URL}/dev/mailbox`, { waitUntil: 'networkidle' })
log(await visible(inbox.getByText(nadia.email)), `test inbox at ${LARAVEL_URL}/dev/mailbox lists the emails`)

log(errors.length === 0, `no page errors ${JSON.stringify(errors)}`)
report.done()
await browser.close()
