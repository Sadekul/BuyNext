/*
 * Phase 13: the sign-in service's own shopper-facing messages in English and
 * Bangla (docs/I18N.md), and the language it asks the API for.
 *
 * The language is the store's `buynest_lang` cookie (set by the language
 * switch; SameSite=Lax, so the browser sends it with every same-site request).
 * Every call to the Laravel API sends it as `Accept-Language`, so the API's
 * validation messages and product content come back in the same language.
 * No cookie → no header: the API then uses the store's default language,
 * exactly like the storefront does. Admin calls (/api/admin/…) stay English.
 */

export const LANGUAGE_COOKIE = 'buynest_lang'

/** 'en' | 'bn' from the request's cookie, or null when the shopper never chose. */
export function requestLanguage(request) {
  const header = request?.headers?.get?.('cookie') ?? ''
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index > 0 && part.slice(0, index).trim() === LANGUAGE_COOKIE) {
      const value = decodeURIComponent(part.slice(index + 1).trim()).toLowerCase()
      return value === 'bn' || value === 'en' ? value : null
    }
  }
  return null
}

/**
 * The Accept-Language header for an API call (none for admin paths or without a choice).
 * `explicit` ('en' | 'bn') wins over the cookie: the public catalog names its language in
 * the URL (`?lang=bn`), so shared caches never mix the two languages.
 */
export function languageHeaders(request, path = '', explicit = null) {
  if (String(path).startsWith('/api/admin/')) return {}
  const language = explicit === 'en' || explicit === 'bn' ? explicit : requestLanguage(request)
  return language ? { 'Accept-Language': language } : {}
}

const MESSAGES = {
  unreachable: { en: 'The server could not be reached. Please try again.', bn: 'সার্ভারে পৌঁছানো যায়নি। আবার চেষ্টা করুন।' },
  requestFailed: { en: 'The request failed.', bn: 'অনুরোধটি সফল হয়নি।' },
  fileTooLarge: { en: 'The file is too large to download here.', bn: 'ফাইলটি এখানে ডাউনলোড করার জন্য অনেক বড়।' },
  signIn: { en: 'Please sign in to continue.', bn: 'চালিয়ে যেতে সাইন ইন করুন।' },
  sessionExpired: { en: 'Your session has expired.', bn: 'আপনার সেশনের মেয়াদ শেষ হয়েছে।' },
  notFound: { en: 'Not found.', bn: 'পাওয়া যায়নি।' },
  forbidden: { en: 'Forbidden.', bn: 'অনুমতি নেই।' },
  catalogReadOnly: { en: 'The catalog is read-only.', bn: 'ক্যাটালগটি শুধু দেখার জন্য।' },
  catalogFailed: { en: 'The catalog could not be loaded.', bn: 'ক্যাটালগ লোড করা যায়নি।' },
  savedCartFailed: { en: 'Your saved cart could not be loaded. Please try again.', bn: 'আপনার সংরক্ষিত কার্ট লোড করা যায়নি। আবার চেষ্টা করুন।' },
  paymentLinkInvalid: {
    en: "This payment link isn't valid. Open your order and use Pay now.",
    bn: 'এই পেমেন্ট লিংকটি সঠিক নয়। আপনার অর্ডারটি খুলে "এখনই পেমেন্ট করুন" ব্যবহার করুন।',
  },
  giftCardCode: { en: 'Enter the gift card code from your email.', bn: 'ইমেইলে পাওয়া গিফট কার্ড কোডটি লিখুন।' },
  emailCodeSent: { en: 'We emailed a code to your new address.', bn: 'আপনার নতুন ঠিকানায় একটি কোড ইমেইল করা হয়েছে।' },
  accountDeleted: { en: 'Your account was deleted.', bn: 'আপনার অ্যাকাউন্ট মুছে ফেলা হয়েছে।' },
  alertLinkInvalid: { en: "This link isn't valid. Open the link from the email again.", bn: 'এই লিংকটি সঠিক নয়। ইমেইলের লিংকটি আবার খুলুন।' },
  alertsStopped: {
    en: "You won't get any more back-in-stock emails for these products.",
    bn: 'এই পণ্যগুলো স্টকে ফেরার বিষয়ে আপনাকে আর কোনো ইমেইল পাঠানো হবে না।',
  },
  noAlertsLeft: { en: 'There were no alerts left to stop.', bn: 'বন্ধ করার মতো কোনো অ্যালার্ট বাকি ছিল না।' },
  newsletterThanks: { en: 'Thanks! Check your inbox to confirm.', bn: 'ধন্যবাদ! নিশ্চিত করতে আপনার ইনবক্স দেখুন।' },
  newsletterConfirmInvalid: {
    en: 'This confirmation link is invalid or has expired. Subscribe again to get a new one.',
    bn: 'এই নিশ্চিতকরণ লিংকটি সঠিক নয় বা এর মেয়াদ শেষ। নতুন লিংক পেতে আবার সাবস্ক্রাইব করুন।',
  },
  newsletterUnsubscribeInvalid: { en: 'This unsubscribe link is invalid.', bn: 'এই আনসাবস্ক্রাইব লিংকটি সঠিক নয়।' },
  demoOnly: { en: 'This needs the BuyNest backend; the demo accounts cannot do it.', bn: 'এর জন্য BuyNest-এর ব্যাকএন্ড দরকার; ডেমো অ্যাকাউন্ট দিয়ে এটি করা যায় না।' },
  usernamePassword: { en: 'Enter your username and password.', bn: 'আপনার ইউজারনেম ও পাসওয়ার্ড লিখুন।' },
}

/** One of the messages above in the request's language (English without a choice). */
export function serverMessage(request, id) {
  const entry = MESSAGES[id]
  if (!entry) return id
  return requestLanguage(request) === 'bn' ? entry.bn : entry.en
}

export const SERVER_MESSAGES = MESSAGES
