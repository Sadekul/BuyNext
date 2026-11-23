import { api } from './client'

/*
 * Phase 13 (docs/backend/PHASE13_CONTRACT.md §4), BuyNest's backend only:
 * email templates per language (server/adminPhase13Api.js in the frontend
 * project). Bangla texts of products, categories, pages and home blocks,
 * the customer's and order's language, and Settings → General ride on the
 * existing routes. Permission: email_templates.manage.
 */

export const phase13Keys = {
  emailTemplate: (key, locale) => ['email-template', key, locale],
}

const inLocale = (locale) => ({ params: { locale } })

/** The template in one language → the template + { locale }. */
export const getEmailTemplateIn = (key, locale, { signal } = {}) => api.get(`/api/admin/email-templates/${key}`, { ...inLocale(locale), signal })
/** { subject, body } → { template } (that language only). */
export const updateEmailTemplateIn = (key, locale, values) => api.put(`/api/admin/email-templates/${key}`, values, inLocale(locale))
/** A draft rendered with sample data in that language → { subject, html, text }. */
export const previewEmailTemplateIn = (key, locale, values, { signal } = {}) => api.post(`/api/admin/email-templates/${key}/preview`, values, { ...inLocale(locale), signal })
export const testEmailTemplateIn = (key, locale, values) => api.post(`/api/admin/email-templates/${key}/test`, values, inLocale(locale))
/** That language's default again (the other language is kept) → { template }. */
export const resetEmailTemplateIn = (key, locale) => api.post(`/api/admin/email-templates/${key}/reset`, {}, inLocale(locale))
