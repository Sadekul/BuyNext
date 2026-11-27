// Phase 20, end to end in a real browser: SMS order notifications (docs/backend/PHASE20_CONTRACT.md §4).
// Nothing reaches a real SMS provider: the suite uses the "log" (test mode) provider, whose texts are only saved
// (read back from the dev SMS inbox, GET /dev/sms and /dev/sms/latest?to=…).
//
// Checks: Settings → SMS in the admin (switched on with the log provider, every text, the one-tap link; the template
// editor: the Bangla counter in Unicode parts, Insert a variable, edit + save, Reset to default; Send a test SMS → the
// SMS log and the dev inbox), cash on delivery confirmation required (Settings → Cash on delivery); the checkout line
// "We'll text order updates to this number." only while SMS is on; guest COD orders with a Bangladeshi mobile:
//   A: the "Please confirm" text with a /c/ link (and no "Order placed") → the link page (GET changes nothing: still
//      pending in To confirm) → Confirm → confirmed in the admin, "Order confirmed" text; the link again shows "already
//      confirmed" and a second POST is refused (422); shipped from the order page with notify and a tracking number →
//      "Order shipped" with the tracking link; marked delivered with notify → "Order delivered" (an edited template)
//   B: the link page in Bangla, then Cancel with a reason → cancelled and restocked, "Order cancelled" text
//   C: confirmed by staff without notify and shipped with notify off → no text after the first one
//   D: a United States address and phone (through the API) → no text at all
//   E: placed after SMS is switched off → no text, no checkout line
// a bad link ("This link can't be used"); the SMS log (search, Status and Text filters); the order page's SMS panel;
// axe on the /c page (English and Bangla, pending and result), Settings → SMS, the SMS log and the order page; 390px
// on the /c page and Settings → SMS; no page errors.
//
// Uses the usual dev servers (storefront http://localhost:5173, API http://127.0.0.1:8000) and php (`artisan tinker`
// for reading and putting back the settings rows and removing the suite's texts).
//
// Left behind on purpose (like the other suites): the test orders (A delivered and paid, B cancelled from the link,
// C shipped then marked delivered without notifying, D and E cancelled without notifying), their shipments,
// invoices, history, confirmation logs, audit entries and the emails in the dev mailbox. Put back or removed: the SMS
// settings, cod_require_confirmation and default_country (Bangladesh for the run, for the checkout's Division → District →
// Area form) exactly as stored at the start (rows put back or removed, so the defaults
// apply again), every SMS row the suite wrote (the five test phone numbers and the test orders), saved carts and stock.
// Guest checkout only: no customer account is made, and the demo accounts are never touched.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import {
  ADMIN_USER,
  BASE,
  LARAVEL,
  LARAVEL_URL,
  SHOPPER,
  SHOPPER_2,
  adminSignIn,
  axeViolations,
  clearSavedCart,
  launch,
  preserveStock,
  reporter,
  sidewaysOverflow,
  visible,
  watchErrors,
} from "./lib.mjs";

const report = reporter(
  "sms: SMS settings, order texts, the one-tap confirmation link, SMS log",
);
const { log } = report;
if (!LARAVEL) {
  console.log("(Skipped: needs the BuyNest API, E2E_ACCOUNTS=laravel)");
  report.done();
  process.exit(0);
}

const BACKEND = join(import.meta.dirname, "..", "backend");
const api = async (path, { method = "GET", token, body } = {}) => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${LARAVEL_URL}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body && JSON.stringify(body),
    });
    if (response.status === 429 && attempt < 4) {
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          (Number(response.headers.get("retry-after")) || 5) * 1000,
        ),
      );
      continue;
    }
    return {
      status: response.status,
      body: await response.json().catch(() => null),
    };
  }
};
const owner = (
  await api("/api/admin/v1/auth/login", {
    method: "POST",
    body: { email: ADMIN_USER.email, password: ADMIN_USER.password },
  })
).body?.data?.tokens?.access_token;
const admin$ = (path, options = {}) =>
  api(`/api/admin/v1${path}`, { token: owner, ...options });
const orderOf = async (number) =>
  (await admin$(`/orders/${number}`)).body?.data;
const stockOf = async (id) =>
  (await admin$(`/products/${id}`)).body?.data?.stock_quantity;
const smsState = async () => (await admin$("/sms")).body?.data;
/** Runs PHP in the backend (local development only). */
function tinker(code) {
  const run = spawnSync("php", ["artisan", "tinker", `--execute=${code}`], {
    cwd: BACKEND,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (run.status !== 0)
    throw new Error(
      `tinker failed: ${(run.stderr || run.stdout).trim().slice(0, 200)}`,
    );
  return run.stdout.trim();
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** The newest text to a number in the dev SMS inbox, or null. */
async function latestText(phone) {
  const response = await fetch(
    `${LARAVEL_URL}/dev/sms/latest?to=${encodeURIComponent(phone)}`,
  );
  return response.ok ? (await response.json()).data : null;
}
/** Waits for a text to `phone` newer than `after` (an id), or null. */
async function waitText(phone, { after = 0, tries = 20 } = {}) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const text = await latestText(phone);
    if (text && text.id > after) return text;
    await sleep(250);
  }
  return null;
}

const run = Date.now().toString(36);
const digits = String(Date.now()).slice(-7);
// One Bangladeshi mobile per order (and one for the test SMS), so each one's texts are easy to find.
const PHONES = {
  a: `0171${digits}`,
  b: `0181${digits}`,
  c: `0191${digits}`,
  e: `0161${digits}`,
  test: `0151${digits}`,
};
const stored = (phone) => `+880${phone.slice(1)}`;
const emailOf = (key) => `sms.${key}.${run}@example.com`;
const DRESS = 166; // Tartan Dress (minimum order 1)
const SMS_KEYS = [
  "sms_enabled",
  "sms_provider",
  "sms_events",
  "sms_templates",
  "sms_confirm_link",
  "cod_require_confirmation",
  "default_country",
];
const keyList = SMS_KEYS.map((key) => `'${key}'`).join(",");
const readRows = () =>
  JSON.parse(
    tinker(
      `echo json_encode(DB::table('settings')->whereIn('key', [${keyList}])->pluck('value', 'key'));`,
    ) || "{}",
  );
const ALL_EVENTS = [
  "order_placed",
  "cod_confirm_request",
  "order_confirmed",
  "order_shipped",
  "order_delivered",
  "order_cancelled",
];
const EVENT_LABELS = [
  "Order placed",
  "Please confirm (cash on delivery)",
  "Order confirmed",
  "Order shipped",
  "Order delivered",
  "Order cancelled",
];
const DELIVERED_TEMPLATE = `{store}: order {order} has arrived (e2e ${run}). Thank you!`;
const TRACKING = `SF${run.toUpperCase()}`;

// What this suite changes, recorded first so it can be put back exactly
const restoreStock = await preserveStock();
const rowsBefore = readRows();
const smsBefore = (await smsState())?.settings;
const codBefore = (await admin$("/settings")).body?.data?.cod;
const made = { orders: {} };

const browser = await launch();
const errors = [];
const axe = async (page, name) => {
  const violations = await axeViolations(page);
  log(
    violations.length === 0,
    `axe ${name}: ${violations.join(", ") || "no violations"}`,
  );
};
const overflowAt390 = async (page, name) => {
  const size = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflow = await sidewaysOverflow(page);
  log(overflow <= 0, `390px ${name}: no sideways scroll (${overflow}px)`);
  await page.setViewportSize(size);
};
async function newPage({ viewport = { width: 1280, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport, bypassCSP: true });
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(45000);
  return watchErrors(await context.newPage(), errors);
}
async function part(name, body) {
  try {
    await body();
  } catch (error) {
    log(false, `${name} stopped early: ${error.message.split("\n")[0]}`);
  }
}
const text = async (locator) =>
  (
    (await locator
      .first()
      .textContent()
      .catch(() => "")) ?? ""
  )
    .replace(/\s+/g, " ")
    .trim();
async function addToCart(page, id) {
  await page.goto(`${BASE}/products/${id}`, { waitUntil: "networkidle" });
  await page
    .locator(".product-details")
    .getByRole("button", { name: /add to cart/i })
    .first()
    .click();
  const miniCart = page.getByRole("dialog");
  if (await visible(miniCart, 3000)) {
    await page.keyboard.press("Escape");
    await miniCart
      .first()
      .waitFor({ state: "hidden", timeout: 5000 })
      .catch(() => {});
  }
}
const settled = (page) =>
  page
    .waitForFunction(
      () =>
        ![...document.querySelectorAll("button")].some((b) =>
          /Checking prices/.test(b.textContent),
        ),
      null,
      { timeout: 20000 },
    )
    .catch(() => {});
/** Chooses `label` in the <select name=…> once its list has it. */
async function pick(page, name, label) {
  await page.waitForFunction(
    ([selector, wanted]) => {
      const element = document.querySelector(selector);
      return (
        element &&
        !element.disabled &&
        [...element.options].some(
          (option) => option.textContent.trim() === wanted,
        )
      );
    },
    [`select[name="${name}"]`, label],
    { timeout: 15000 },
  );
  await page.locator(`select[name="${name}"]`).selectOption({ label });
}
/** A guest checkout to a Dhaka (Banani) address, cash on delivery; returns the order number. */
async function checkoutBangladesh(page, key, { add = true } = {}) {
  if (add) await addToCart(page, DRESS);
  await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle" });
  await page.locator('[name="email"]').waitFor();
  await page.locator('[name="email"]').fill(emailOf(key));
  await page.locator('[name="phone"]').fill(PHONES[key]);
  await page.locator('[name="shipping.country"]').selectOption("Bangladesh");
  await page.locator('select[name="shipping.divisionId"]').waitFor();
  for (const [name, value] of Object.entries({
    firstName: "Rahim",
    lastName: "Sms",
  }))
    await page.locator(`[name="shipping.${name}"]`).fill(value);
  await pick(page, "shipping.divisionId", "Dhaka");
  await pick(page, "shipping.districtId", "Dhaka");
  await pick(page, "shipping.areaId", "Banani");
  await page.locator('[name="shipping.line1"]').fill("House 7, Road 11");
  await settled(page);
  await page.locator('input[name="paymentMethod"][value="cod"]').check();
  await settled(page);
  const button = page.getByRole("button", { name: /^Place order · / });
  await button.waitFor({ timeout: 20000 });
  await button.click();
  await page
    .waitForURL(/\/order-confirmation\/BN-/, { timeout: 45000 })
    .catch(async (error) => {
      const shown = await page
        .locator('[role="alert"], .form-field__error')
        .allInnerTexts()
        .catch(() => []);
      throw new Error(
        `the order wasn't placed (shown: ${JSON.stringify(shown.filter(Boolean)).slice(0, 300)}): ${error.message.split("\n")[0]}`,
      );
    });
  const number = new URL(page.url()).pathname.split("/").pop();
  made.orders[key] = number;
  return number;
}
const tokenOf = (body) => body?.match(/\/c\/([A-Za-z0-9_-]{20,})/)?.[1] ?? null;

async function adminPage() {
  const admin = await newPage({ viewport: { width: 1440, height: 900 } });
  await adminSignIn(admin, ADMIN_USER);
  await admin.getByRole("heading", { name: "Overview" }).waitFor();
  return admin;
}
async function saveSms(admin) {
  await admin
    .getByRole("form", { name: "SMS settings" })
    .getByRole("button", { name: "Save SMS settings" })
    .click();
  return visible(
    admin.getByRole("status").filter({ hasText: "SMS settings saved." }),
  );
}
const toConfirmNumbers = async (admin) => {
  await admin.goto(`${BASE}/admin/to-confirm`, { waitUntil: "networkidle" });
  await admin.getByRole("heading", { name: "To confirm", level: 1 }).waitFor();
  await admin.waitForTimeout(500);
  return admin.locator("li.confirm-card h2 a").allInnerTexts();
};
/** The link page's main area (the header has its own language switch). */
const linkMain = (page) => page.locator("main");
async function openLink(page, token) {
  await page.goto(`${BASE}/c/${token}`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 1 }).first().waitFor();
}
async function switchLanguage(page, name, lang) {
  await linkMain(page)
    .getByRole("group", { name: /Language|ভাষা/ })
    .getByRole("button", { name, exact: true })
    .click();
  await page
    .waitForFunction((want) => document.documentElement.lang === want, lang, {
      timeout: 10000,
    })
    .catch(() => {});
}

let admin;
const tokens = {};
try {
  log(
    Boolean(owner) && Boolean(smsBefore) && Boolean(codBefore),
    `settings read first (SMS ${smsBefore?.sms_enabled ? "on" : "off"}, cod_require_confirmation ${codBefore?.require_confirmation}, ${Object.keys(rowsBefore).length} stored rows)`,
  );
  const storeOff = (await api("/api/v1/store")).body?.data;
  log(
    !smsBefore?.sms_enabled || "sms_updates" in (storeOff ?? {}),
    "GET /store matches the starting state",
  );

  // ---------- 1. Settings → SMS: switch it on ----------
  await part("admin settings", async () => {
    admin = await adminPage();
    await admin.goto(`${BASE}/admin/settings/sms`, {
      waitUntil: "networkidle",
    });
    log(
      await visible(
        admin.getByRole("heading", { level: 1, name: "SMS notifications" }),
      ),
      'Settings → SMS: h1 "SMS notifications"',
    );
    const tiles = await text(admin.locator("dl.stats"));
    log(
      ["Sent today", "Failed today", "Last 30 days"].every((label) =>
        tiles.includes(label),
      ),
      `stat tiles: "${tiles}"`,
    );
    const form = admin.getByRole("form", { name: "SMS settings" });
    const toggle = form.getByRole("switch", { name: "SMS notifications" });
    if (await toggle.isChecked()) {
      await toggle.click();
      await saveSms(admin);
    }
    log(
      !(await form
        .getByRole("switch", { name: "SMS notifications" })
        .isChecked()) &&
        (await text(form.locator("#sms-state"))) === "Off: no texts are sent",
      'the switch is off ("Off: no texts are sent")',
    );
    await form.getByRole("switch", { name: "SMS notifications" }).click();
    log(
      (await text(form.locator("#sms-state"))) ===
        "On: customers get order texts",
      'switched on: "On: customers get order texts"',
    );
    const providers = form.getByRole("group", { name: "Provider" });
    const logRadio = providers.getByRole("radio", {
      name: "Test mode (log only)",
    });
    await logRadio.check();
    const logNote = await admin.evaluate(
      (id) => document.getElementById(id)?.textContent ?? "",
      await logRadio.getAttribute("aria-describedby"),
    );
    log(
      logNote.includes("Test mode: messages are only saved, not sent.") &&
        (await providers
          .getByRole("radio", { name: "SSL Wireless" })
          .isDisabled()),
      `Provider: the log is chosen ("${logNote.trim()}"); SSL Wireless isn't set up, so it can't be chosen`,
    );
    const events = form.getByRole("group", { name: "Texts to send" });
    for (const name of EVENT_LABELS)
      await events.getByRole("checkbox", { name, exact: true }).check();
    await form
      .getByRole("checkbox", { name: "Include a one-tap confirmation link" })
      .check();
    await axe(admin, "Settings → SMS");
    await overflowAt390(admin, "Settings → SMS");
    log(await saveSms(admin), 'Save SMS settings → "SMS settings saved."');
    const saved = (await smsState())?.settings;
    log(
      saved?.sms_enabled === true &&
        saved.sms_provider === "log" &&
        saved.sms_events.join() === ALL_EVENTS.join() &&
        saved.sms_confirm_link === true,
      `saved on the server: ${JSON.stringify({ ...saved, sms_templates: undefined })}`,
    );
    const store = (await api("/api/v1/store")).body?.data;
    log(
      store?.sms_updates === true,
      `GET /store sms_updates: ${store?.sms_updates}`,
    );

    // Cash on delivery orders need confirming (Settings → Cash on delivery)
    const cod = await admin$("/settings", {
      method: "PATCH",
      body: { cod: { require_confirmation: true } },
    });
    log(
      cod.status === 200 &&
        (await api("/api/v1/store")).body?.data?.cod?.require_confirmation ===
          true,
      "Settings → Cash on delivery: confirmation required",
    );
    // The Division → District → Area form at checkout comes with a Bangladeshi store (Settings → Checkout default country).
    const country = await admin$("/settings", {
      method: "PATCH",
      body: { checkout: { default_country: "Bangladesh" } },
    });
    log(
      country.status === 200 &&
        (await api("/api/v1/store")).body?.data?.default_country ===
          "Bangladesh",
      `Settings → Checkout: default country Bangladesh (${country.status})`,
    );
  });

  // ---------- 2. The template editor ----------
  await part("template editor", async () => {
    const form = admin.getByRole("form", { name: "SMS settings" });
    await form
      .getByRole("combobox", { name: "Template", exact: true })
      .selectOption({ label: "Order placed" });
    const tabs = form.getByRole("tablist", { name: "Template language" });
    const english = form.getByRole("textbox", {
      name: "Order placed text (English)",
    });
    const countEn = await english.evaluate((area) =>
      area
        .getAttribute("aria-describedby")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent)
        .join(" "),
    );
    log(
      /^\d+ characters · 1 SMS$/.test(countEn.trim()),
      `English counter: "${countEn.trim()}"`,
    );
    await tabs.getByRole("tab", { name: "বাংলা" }).click();
    const bangla = form.getByRole("textbox", {
      name: "Order placed text (Bangla)",
    });
    await bangla.waitFor();
    const countBn = await bangla.evaluate((area) =>
      area
        .getAttribute("aria-describedby")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent)
        .join(" "),
    );
    log(
      /^Unicode \(Bangla\): \d+ SMS · \d+ characters$/.test(countBn.trim()) &&
        /[ঀ-৿]/.test(await bangla.inputValue()),
      `Bangla tab: the default Bangla text, counter "${countBn.trim()}"`,
    );
    await tabs.getByRole("tab", { name: "English" }).click();

    // Order delivered (English): an edited text, a variable inserted
    await form
      .getByRole("combobox", { name: "Template", exact: true })
      .selectOption({ label: "Order delivered" });
    const delivered = form.getByRole("textbox", {
      name: "Order delivered text (English)",
    });
    await delivered.fill(DELIVERED_TEMPLATE.replace("{store}: ", ""));
    await delivered.evaluate((area) => area.setSelectionRange(0, 0));
    await form
      .getByRole("button", { name: "Insert {store}: Store name" })
      .click();
    await admin.waitForTimeout(200);
    const inserted = await delivered.inputValue();
    log(
      inserted.startsWith("{store}order {order}"),
      `Insert {store} puts the variable at the caret ("${inserted.slice(0, 40)}…")`,
    );
    await delivered.fill(DELIVERED_TEMPLATE);
    log(await saveSms(admin), 'the edited "Order delivered" text saved');
    log(
      (await smsState())?.settings?.sms_templates?.order_delivered?.en ===
        DELIVERED_TEMPLATE,
      "stored as the Order delivered English template",
    );
  });

  // ---------- 3. The checkout line and order A: the "Please confirm" text ----------
  await part("order A: the confirmation text", async () => {
    const shop = await newPage();
    await addToCart(shop, DRESS);
    await shop.goto(`${BASE}/checkout`, { waitUntil: "networkidle" });
    log(
      await visible(shop.getByText("We'll text order updates to this number.")),
      'checkout: "We\'ll text order updates to this number." under the phone',
    );
    const number = await checkoutBangladesh(shop, "a", { add: false });
    const order = await orderOf(number);
    log(
      order?.phone === stored(PHONES.a) &&
        order?.confirmation?.status === "pending",
      `${number}: phone ${order?.phone}, confirmation ${order?.confirmation?.status}`,
    );
    const sms = await waitText(PHONES.a);
    tokens.a = tokenOf(sms?.body);
    log(
      sms?.event === "cod_confirm_request" &&
        sms.status === "sent" &&
        sms.provider === "log" &&
        sms.order_number === number &&
        sms.body.includes(number) &&
        // The link uses the API's STOREFRONT_URL (the dev server's address even while this suite tests the production build on another port).
        /https?:\/\/[^\s/]+\/c\/[A-Za-z0-9_-]{20,}/.test(sms.body) &&
        Boolean(tokens.a),
      `dev inbox: "Please confirm" (${sms?.event}, ${sms?.status}): "${sms?.body}"`,
    );
    log(
      sms?.to === stored(PHONES.a) &&
        sms?.locale === "en" &&
        ["gsm", "unicode"].includes(sms?.encoding),
      `to ${sms?.to}, ${sms?.locale}, ${sms?.encoding}, ${sms?.segments} part(s)`,
    );
    log(
      !(order?.sms ?? []).some((item) => item.event === "order_placed") &&
        (order?.sms ?? []).length === 1,
      `no "Order placed" text: the order has ${(order?.sms ?? []).map((item) => item.event).join(", ")}`,
    );
    const html = await fetch(`${LARAVEL_URL}/dev/sms`).then((response) =>
      response.text(),
    );
    log(html.includes(number), "the dev SMS inbox page (/dev/sms) lists it");
    await shop.context().close();
  });

  // ---------- 4. The link: look (nothing changes), confirm, look again ----------
  await part("order A: confirm from the link", async () => {
    if (!tokens.a) throw new Error("no link for order A");
    const number = made.orders.a;
    const shop = await newPage();
    await openLink(shop, tokens.a);
    log(
      await visible(
        shop.getByRole("heading", { level: 1, name: "Confirm your order" }),
      ),
      'the link: h1 "Confirm your order"',
    );
    const dl = await text(shop.locator('dl[aria-label="Order summary"]'));
    log(
      dl.includes("Order number") &&
        dl.includes(number) &&
        dl.includes("Placed on") &&
        dl.includes("1 item") &&
        dl.includes("Total to pay on delivery"),
      `summary: "${dl}"`,
    );
    log(
      (await shop.getByText(/Rahim|Banani|House 7/).count()) === 0,
      "no name or address on the page",
    );
    await axe(shop, "/c page (English, pending)");
    await overflowAt390(shop, "/c page (pending)");
    const still = await orderOf(number);
    log(
      still?.confirmation?.status === "pending",
      `opening the link changed nothing: still ${still?.confirmation?.status}`,
    );
    log(
      (await toConfirmNumbers(admin)).includes(number),
      `${number} is still in Sales → To confirm`,
    );

    const before = (await latestText(PHONES.a))?.id ?? 0;
    await shop.getByRole("button", { name: "Confirm my order" }).click();
    const result = shop
      .getByRole("status")
      .filter({
        hasText: `Thank you, your order ${number} is confirmed. We'll text you when it ships.`,
      });
    log(
      await visible(result),
      `Confirm → "Thank you, your order ${number} is confirmed. We'll text you when it ships."`,
    );
    log(
      (await visible(
        shop.getByRole("heading", { level: 1, name: "Your order" }),
      )) &&
        (await visible(shop.getByRole("link", { name: "Track your order" }))),
      'h1 "Your order" and "Track your order"',
    );
    await axe(shop, "/c page (English, confirmed)");
    const confirmed = await orderOf(number);
    log(
      confirmed?.confirmation?.status === "confirmed" &&
        (confirmed?.confirmation?.logs ?? []).some((item) =>
          /from the SMS link/.test(item.note ?? ""),
        ),
      `the admin: confirmation ${confirmed?.confirmation?.status} ("${(confirmed?.confirmation?.logs ?? []).at(-1)?.note}")`,
    );
    log(
      !(await toConfirmNumbers(admin)).includes(number),
      `${number} has left To confirm`,
    );
    const sms = await waitText(PHONES.a, { after: before });
    log(
      sms?.event === "order_confirmed" && sms.body.includes(number),
      `"Order confirmed" text: "${sms?.body}"`,
    );

    // The same link again
    await openLink(shop, tokens.a);
    log(
      await visible(
        shop
          .getByRole("status")
          .filter({ hasText: `Your order ${number} is already confirmed.` }),
      ),
      `the link again: "Your order ${number} is already confirmed. …"`,
    );
    log(
      (await shop.getByRole("button", { name: "Confirm my order" }).count()) ===
        0,
      "no buttons any more",
    );
    const again = await api(`/api/v1/order-confirmations/${tokens.a}`, {
      method: "POST",
      body: { action: "confirm" },
    });
    log(
      again.status === 422 && Boolean(again.body?.errors?.token),
      `POST again: ${again.status} (${again.body?.errors?.token?.[0]})`,
    );
    const get = await api(`/api/v1/order-confirmations/${tokens.a}`);
    log(
      get.status === 200 &&
        get.body?.data?.status === "confirmed" &&
        !("phone" in (get.body?.data ?? {})),
      `GET: ${JSON.stringify(get.body?.data)}`,
    );
    await shop.context().close();
  });

  // ---------- 5. Order B: Bangla, then Cancel from the link ----------
  await part("order B: cancel from the link", async () => {
    const shop = await newPage();
    const number = await checkoutBangladesh(shop, "b");
    await shop.context().close();
    const sms = await waitText(PHONES.b);
    tokens.b = tokenOf(sms?.body);
    log(
      sms?.event === "cod_confirm_request" && Boolean(tokens.b),
      `${number}: "Please confirm" text with a link`,
    );
    if (!tokens.b) throw new Error("no link for order B");
    const stockPlaced = await stockOf(DRESS);

    const bn = await newPage();
    await openLink(bn, tokens.b);
    await switchLanguage(bn, "বাংলা", "bn");
    log(
      await visible(
        bn.getByRole("heading", { level: 1, name: "আপনার অর্ডার নিশ্চিত করুন" }),
      ),
      'Bangla: h1 "আপনার অর্ডার নিশ্চিত করুন"',
    );
    log(
      await visible(bn.getByRole("button", { name: "আমার অর্ডার নিশ্চিত করুন" })),
      'Bangla: button "আমার অর্ডার নিশ্চিত করুন"',
    );
    await axe(bn, "/c page (Bangla, pending)");
    await overflowAt390(bn, "/c page (Bangla)");
    await switchLanguage(bn, "English", "en");
    await bn.context().close();

    const shopB = await newPage();
    await openLink(shopB, tokens.b);
    const before = (await latestText(PHONES.b))?.id ?? 0;
    await shopB.getByRole("button", { name: "Cancel this order" }).click();
    const dialog = shopB.getByRole("dialog", {
      name: `Cancel order ${number}?`,
    });
    log(await visible(dialog), `Cancel asks first: "Cancel order ${number}?"`);
    await axe(shopB, "/c cancel dialog");
    await dialog.getByRole("button", { name: "Keep my order" }).click();
    await dialog.waitFor({ state: "hidden" }).catch(() => {});
    log(
      (await orderOf(number))?.status !== "cancelled",
      '"Keep my order" closes it, nothing changes',
    );
    await shopB.getByRole("button", { name: "Cancel this order" }).click();
    await dialog
      .getByRole("textbox", { name: /Why are you cancelling\?/ })
      .fill(`Ordered twice (e2e ${run})`);
    await dialog
      .getByRole("button", { name: "Yes, cancel this order" })
      .click();
    log(
      await visible(
        shopB
          .getByRole("status")
          .filter({ hasText: `Your order ${number} is cancelled.` }),
      ),
      `→ "Your order ${number} is cancelled."`,
    );
    const cancelled = await orderOf(number);
    log(
      cancelled?.status === "cancelled" &&
        cancelled?.confirmation?.status === "cancelled" &&
        JSON.stringify(cancelled).includes(`Ordered twice (e2e ${run})`),
      `the admin: ${cancelled?.status}, confirmation ${cancelled?.confirmation?.status}, with the reason`,
    );
    const stockNow = await stockOf(DRESS);
    log(
      stockNow === stockPlaced + 1,
      `restocked: ${stockPlaced} → ${stockNow}`,
    );
    const text_ = await waitText(PHONES.b, { after: before });
    log(
      text_?.event === "order_cancelled" && text_.body.includes(number),
      `"Order cancelled" text: "${text_?.body}"`,
    );
    await switchLanguage(shopB, "বাংলা", "bn");
    await axe(shopB, "/c page (Bangla, cancelled)");
    await switchLanguage(shopB, "English", "en");
    await shopB.context().close();
  });

  // ---------- 6. A bad link ----------
  await part("bad link", async () => {
    const shop = await newPage();
    await openLink(shop, randomBytes(32).toString("base64url").slice(0, 43));
    log(
      await visible(
        shop.getByRole("heading", {
          level: 1,
          name: "This link can't be used",
        }),
      ),
      'a bad token: h1 "This link can\'t be used"',
    );
    log(
      await visible(
        shop
          .getByRole("status")
          .filter({ hasText: "This link isn't valid or has expired." }),
      ),
      '"This link isn\'t valid or has expired. …"',
    );
    await axe(shop, "/c page (bad link)");
    await shop.context().close();
  });

  // ---------- 7. Order A: shipped with notify, delivered with notify ----------
  await part("order A: shipped and delivered", async () => {
    const number = made.orders.a;
    if (!number) throw new Error("no order A");
    await admin.goto(`${BASE}/admin/orders/${number}`, {
      waitUntil: "networkidle",
    });
    let before = (await latestText(PHONES.a))?.id ?? 0;
    await admin.getByRole("button", { name: "Ship", exact: true }).click();
    let dialog = admin.getByRole("dialog");
    await dialog.getByLabel("Carrier").selectOption("steadfast");
    await dialog.getByLabel("Tracking number (optional)").fill(TRACKING);
    log(
      await dialog
        .getByRole("checkbox", {
          name: "Email the customer the tracking details",
        })
        .isChecked(),
      'Ship: "Email the customer the tracking details" ticked',
    );
    await dialog.getByRole("button", { name: "Create shipment" }).click();
    log(
      await visible(admin.getByText(/The order is now shipped\./)),
      "shipped",
    );
    let sms = await waitText(PHONES.a, { after: before });
    log(
      sms?.event === "order_shipped" &&
        sms.body.includes("Steadfast") &&
        sms.body.includes(`https://steadfast.com.bd/t/${TRACKING}`),
      `"Order shipped" text with the tracking link: "${sms?.body}"`,
    );

    before = sms?.id ?? before;
    await admin.getByRole("button", { name: "Mark as delivered" }).click();
    dialog = admin.getByRole("dialog");
    log(
      await dialog
        .getByRole("checkbox", { name: "Email the customer" })
        .isChecked(),
      'Mark as delivered: "Email the customer" ticked',
    );
    await dialog.getByRole("button", { name: "Mark as delivered" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
    sms = await waitText(PHONES.a, { after: before });
    const expected = DELIVERED_TEMPLATE.replace("{store}", "BuyNest").replace(
      "{order}",
      number,
    );
    log(
      sms?.event === "order_delivered" && sms.body === expected,
      `"Order delivered" text, from the edited template: "${sms?.body}"`,
    );

    // The order page's SMS panel
    await admin.reload({ waitUntil: "networkidle" });
    const panel = admin.getByRole("region", { name: "SMS", exact: true });
    await panel.waitFor();
    const items = await panel
      .getByRole("list", { name: "SMS" })
      .getByRole("listitem")
      .allInnerTexts();
    const labels = items.map((item) => item.split("\n")[0].trim());
    log(
      [
        "Please confirm (cash on delivery)",
        "Order confirmed",
        "Order shipped",
        "Order delivered",
      ].every((label) => labels.includes(label)) &&
        items.every(
          (item) => item.includes("Sent") && item.includes(stored(PHONES.a)),
        ),
      `order page SMS panel: ${labels.join(", ")} (all Sent, to ${stored(PHONES.a)})`,
    );
    await panel.scrollIntoViewIfNeeded();
    await axe(admin, "order page with the SMS panel");
    await panel
      .getByRole("link", { name: "Texts for this order in the SMS log" })
      .click();
    await admin.waitForURL(/\/admin\/sms\?q=/);
    const rows = admin
      .getByRole("table", { name: "Texts, newest first" })
      .locator("tbody tr");
    await rows.first().waitFor();
    const rowTexts = await rows.allInnerTexts();
    log(
      rowTexts.length >= 4 &&
        rowTexts.filter((row) => row.includes(number)).length === 4,
      `"Texts for this order in the SMS log" → the log searched for ${number} (${rowTexts.length} rows)`,
    );
  });

  // ---------- 8. Order C: confirmed without notify, shipped with notify off; order D: not a Bangladeshi phone ----------
  await part("no text without notify", async () => {
    const shop = await newPage();
    const number = await checkoutBangladesh(shop, "c");
    await shop.context().close();
    const first = await waitText(PHONES.c);
    log(
      first?.event === "cod_confirm_request",
      `${number}: "Please confirm" text`,
    );
    const confirmed = await admin$(`/orders/${number}/confirmation`, {
      method: "POST",
      body: { outcome: "confirmed", notify_customer: false },
    });
    log(
      confirmed.status === 200 || confirmed.status === 201,
      `confirmed by staff without notifying (${confirmed.status})`,
    );
    await admin.goto(`${BASE}/admin/orders/${number}`, {
      waitUntil: "networkidle",
    });
    await admin.getByRole("button", { name: "Ship", exact: true }).click();
    const dialog = admin.getByRole("dialog");
    await dialog.getByLabel("Carrier").selectOption("steadfast");
    await dialog.getByLabel("Tracking number (optional)").fill(`${TRACKING}C`);
    await dialog
      .getByRole("checkbox", {
        name: "Email the customer the tracking details",
      })
      .uncheck();
    await dialog.getByRole("button", { name: "Create shipment" }).click();
    log(
      await visible(admin.getByText(/The order is now shipped\./)),
      'shipped with "Email the customer" unticked',
    );
    await sleep(1500);
    const latest = await latestText(PHONES.c);
    const order = await orderOf(number);
    log(
      order?.status === "shipped" &&
        latest?.id === first?.id &&
        (order?.sms ?? []).length === 1,
      `no text for the staff confirmation or the shipment (still only ${latest?.event})`,
    );

    // D: a United States address and phone
    const placed = await api("/api/v1/orders", {
      method: "POST",
      body: {
        guest: { email: emailOf("d") },
        email: emailOf("d"),
        phone: "+1 555 010 2030",
        items: [{ product_id: DRESS, quantity: 1 }],
        shipping_address: {
          first_name: "Dana",
          last_name: "Sms",
          line1: "12 Market Street",
          city: "Springfield",
          state: "Oregon",
          postal_code: "29112",
          country: "United States",
        },
        shipping_method: "standard",
        payment_method: "cod",
      },
    });
    const numberD = placed.body?.data?.number;
    if (numberD) made.orders.d = numberD;
    await sleep(1000);
    const orderD = numberD ? await orderOf(numberD) : null;
    log(
      placed.status === 201 && (orderD?.sms ?? []).length === 0,
      `${numberD} (United States phone): no text (${(orderD?.sms ?? []).length} texts, ${placed.status})`,
    );
    await admin.goto(`${BASE}/admin/orders/${numberD}`, {
      waitUntil: "networkidle",
    });
    log(
      await visible(
        admin
          .getByRole("region", { name: "SMS", exact: true })
          .getByText("No texts for this order."),
      ),
      'its order page: "No texts for this order."',
    );
  });

  // ---------- 9. Send a test SMS, the SMS log ----------
  await part("test SMS and the SMS log", async () => {
    await admin.goto(`${BASE}/admin/settings/sms`, {
      waitUntil: "networkidle",
    });
    const form = admin.getByRole("form", { name: "Send a test SMS" });
    await form.getByLabel("Mobile number").fill(PHONES.test);
    await form.getByLabel("Text (optional)").fill(`BuyNest e2e test ${run}`);
    await form.getByRole("button", { name: "Send test SMS" }).click();
    log(
      await visible(
        form
          .getByRole("status")
          .filter({
            hasText: `Test SMS sent to ${stored(PHONES.test)} (saved only: test mode).`,
          }),
      ),
      `"Test SMS sent to ${stored(PHONES.test)} (saved only: test mode)."`,
    );
    const sms = await latestText(PHONES.test);
    log(
      sms?.event === null &&
        sms.body === `BuyNest e2e test ${run}` &&
        sms.status === "sent",
      `dev inbox: the test text ("${sms?.body}", ${sms?.status})`,
    );

    await admin.goto(`${BASE}/admin/sms`, { waitUntil: "networkidle" });
    log(
      await visible(admin.getByRole("heading", { level: 1, name: "SMS log" })),
      'Sales → SMS log: h1 "SMS log"',
    );
    const table = admin.getByRole("table", { name: "Texts, newest first" });
    const headers = await table.getByRole("columnheader").allTextContents();
    log(
      ["Time", "Phone", "Order", "Text", "Status", "Parts", "Error"].every(
        (name) => headers.map((item) => item.trim()).includes(name),
      ),
      `columns: ${headers
        .map((item) => item.trim())
        .filter(Boolean)
        .join(", ")}`,
    );
    await axe(admin, "SMS log");
    await admin
      .getByRole("searchbox", { name: "Search texts" })
      .fill(PHONES.test);
    await admin.getByRole("button", { name: "Search", exact: true }).click();
    await admin.waitForURL(/q=/);
    const rows = table.locator("tbody tr");
    await rows
      .filter({ hasText: `BuyNest e2e test ${run}` })
      .first()
      .waitFor();
    // The list before the search stays on screen until the search's answer comes.
    await admin
      .waitForFunction(
        () => document.querySelectorAll("table.sms-log tbody tr").length === 1,
        null,
        { timeout: 10000 },
      )
      .catch(() => {});
    log(
      (await rows.count()) === 1 &&
        (await text(rows.first())).includes("Test message"),
      `search by phone ${PHONES.test}: the test text ("${(await text(rows.first())).slice(0, 100)}")`,
    );
    await admin
      .getByRole("combobox", { name: "Text", exact: true })
      .selectOption({ label: "Test messages" });
    await admin.waitForURL(/event=test/);
    await admin.waitForTimeout(500);
    log((await rows.count()) === 1, 'Text "Test messages": still the one row');
    await admin
      .getByRole("combobox", { name: "Text", exact: true })
      .selectOption({ label: "Order shipped" });
    await admin.waitForURL(/event=order_shipped/);
    log(
      await visible(admin.getByText("No texts match.")),
      'Text "Order shipped" with that phone: "No texts match."',
    );
    await admin.goto(`${BASE}/admin/sms?q=${encodeURIComponent(PHONES.a)}`, {
      waitUntil: "networkidle",
    });
    await rows.first().waitFor();
    log(
      (await rows.count()) === 4,
      `search ${PHONES.a}: order A's 4 texts (${await rows.count()})`,
    );
    await admin
      .getByRole("combobox", { name: "Text", exact: true })
      .selectOption({ label: "Order shipped" });
    await admin.waitForURL(/event=order_shipped/);
    await admin
      .waitForFunction(
        () => document.querySelectorAll("table.sms-log tbody tr").length === 1,
        null,
        { timeout: 10000 },
      )
      .catch(() => {});
    log(
      (await rows.count()) === 1 &&
        (await text(rows.first())).includes(TRACKING),
      'Text "Order shipped": the one shipped text',
    );
    await admin
      .getByRole("combobox", { name: "Status", exact: true })
      .selectOption({ label: "Failed" });
    await admin.waitForURL(/status=failed/);
    log(
      await visible(admin.getByText("No texts match.")),
      'Status "Failed": "No texts match."',
    );
    log(
      (await admin.getByRole("button", { name: /^Retry the / }).count()) === 0,
      "no Retry buttons (nothing failed)",
    );
    const stats = (await smsState())?.stats;
    log(stats?.sent_today >= 8, `stats: ${JSON.stringify(stats)}`);
  });

  // ---------- 10. Reset the template, switch SMS off ----------
  await part("switched off", async () => {
    await admin.goto(`${BASE}/admin/settings/sms`, {
      waitUntil: "networkidle",
    });
    const form = admin.getByRole("form", { name: "SMS settings" });
    await form
      .getByRole("combobox", { name: "Template", exact: true })
      .selectOption({ label: "Order delivered" });
    const delivered = form.getByRole("textbox", {
      name: "Order delivered text (English)",
    });
    log(
      (await delivered.inputValue()) === DELIVERED_TEMPLATE,
      "the edited text is shown",
    );
    await form.getByRole("button", { name: "Reset to default" }).click();
    const defaults = (await smsState())?.defaults?.templates;
    log(
      (await delivered.inputValue()) === defaults?.order_delivered?.en,
      `Reset to default: "${await delivered.inputValue()}"`,
    );
    await form.getByRole("switch", { name: "SMS notifications" }).click();
    log(
      (await text(form.locator("#sms-state"))) === "Off: no texts are sent",
      "switched off",
    );
    log(await saveSms(admin), "saved");
    const saved = (await smsState())?.settings;
    log(
      saved?.sms_enabled === false &&
        saved.sms_templates.order_delivered.en === null,
      `the server: off, Order delivered template back to the default (${JSON.stringify(saved?.sms_templates?.order_delivered)})`,
    );
    log(
      !("sms_updates" in ((await api("/api/v1/store")).body?.data ?? {})),
      "GET /store: no sms_updates",
    );

    const shop = await newPage();
    await addToCart(shop, DRESS);
    await shop.goto(`${BASE}/checkout`, { waitUntil: "networkidle" });
    await shop.locator('[name="phone"]').waitFor();
    await shop.waitForTimeout(500);
    log(
      (await shop
        .getByText("We'll text order updates to this number.")
        .count()) === 0,
      "checkout: no SMS line",
    );
    const number = await checkoutBangladesh(shop, "e", { add: false });
    await shop.context().close();
    await sleep(1500);
    log(
      (await latestText(PHONES.e)) === null &&
        ((await orderOf(number))?.sms ?? []).length === 0,
      `${number} placed while off: no text`,
    );
  });
} catch (error) {
  log(false, `the suite stopped early: ${error.message.split("\n")[0]}`);
} finally {
  const problems = [];
  const attempt = async (what, body) => {
    try {
      await body();
    } catch (error) {
      problems.push(`${what}: ${error.message.split("\n")[0]}`);
    }
  };
  await attempt("test orders", async () => {
    for (const number of Object.values(made.orders)) {
      const order = await orderOf(number);
      if (!order) continue;
      if (order.status === "pending_payment" || order.status === "processing")
        await admin$(`/orders/${number}`, {
          method: "PATCH",
          body: { status: "cancelled", notify_customer: false },
        });
      else if (order.status === "shipped")
        await admin$(`/orders/${number}`, {
          method: "PATCH",
          body: { status: "delivered", notify_customer: false },
        });
    }
  });
  await attempt("settings", () => {
    const missing = SMS_KEYS.filter((key) => !(key in rowsBefore));
    const updates = Object.entries(rowsBefore)
      .map(
        ([key, value]) =>
          `DB::table('settings')->where('key', '${key}')->update(['value' => base64_decode('${Buffer.from(String(value)).toString("base64")}')]);`,
      )
      .join(" ");
    tinker(
      `${updates} DB::table('settings')->whereIn('key', [${missing.map((key) => `'${key}'`).join(",")}])->delete(); Illuminate\\Support\\Facades\\Cache::forget('buynest.settings'); echo 'ok';`,
    );
  });
  await attempt("texts", () => {
    const phones = Object.values(PHONES)
      .map((phone) => `'${stored(phone)}'`)
      .join(",");
    const numbers =
      Object.values(made.orders)
        .map((number) => `'${number}'`)
        .join(",") || "''";
    tinker(
      `App\\Models\\SmsMessage::whereIn('to', [${phones}])->orWhereIn('order_id', App\\Models\\Order::whereIn('number', [${numbers}])->pluck('id'))->delete(); echo 'ok';`,
    );
  });
  await attempt("saved carts", async () => {
    await clearSavedCart(SHOPPER);
    await clearSavedCart(SHOPPER_2);
  });
  await attempt("stock", () => restoreStock());

  const rowsAfter = readRows();
  const smsAfter = (await smsState())?.settings;
  const open = [];
  for (const number of Object.values(made.orders))
    if (!["cancelled", "delivered"].includes((await orderOf(number))?.status))
      open.push(number);
  const leftTexts = Number(
    tinker(
      `echo App\\Models\\SmsMessage::whereIn('to', [${Object.values(PHONES)
        .map((phone) => `'${stored(phone)}'`)
        .join(",")}])->count();`,
    ),
  );
  const settingsBack =
    JSON.stringify(rowsAfter) === JSON.stringify(rowsBefore) &&
    JSON.stringify(smsAfter) === JSON.stringify(smsBefore);
  log(
    problems.length === 0 &&
      settingsBack &&
      open.length === 0 &&
      leftTexts === 0,
    `cleanup: SMS, COD confirmation and default country settings put back, test orders closed (${Object.values(made.orders).join(", ")}), the suite's texts removed, carts and stock put back${problems.length || !settingsBack || open.length || leftTexts ? ` — left: ${[...problems, settingsBack ? "" : `rows ${JSON.stringify(rowsAfter)}`, ...open, leftTexts ? `${leftTexts} texts` : ""].filter(Boolean).join("; ")}` : ""}`,
  );
}

log(errors.length === 0, `no page errors ${JSON.stringify(errors)}`);
report.done();
await browser.close();
