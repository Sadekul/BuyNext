import axios from 'axios'

/*
 * LEARNING EXAMPLE — an Axios instance, for comparison with services/apiClient.js.
 * BuyNest's app code uses the fetch-based apiClient; this file powers the
 * API playground at /learn so you can compare both side by side.
 *
 * What Axios does for you that fetch doesn't:
 * - baseURL + `params` object → URL with query string
 * - JSON request bodies and responses are converted automatically
 * - 4xx/5xx responses THROW (fetch resolves and you must check response.ok)
 * - built-in timeout and request/response interceptors (handy for auth tokens)
 */
export const axiosClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 15_000,
  headers: { Accept: 'application/json' },
})
