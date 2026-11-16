import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getPreferences, savePreferences, systemKeys } from '../api/admin'
import { LIVE_DATA } from '../api/mode'

export const PAGE_SIZES = [20, 50, 100]
export const MAX_SAVED_FILTERS = 10

/** A filter set's identity: its non-empty params, sorted (so "?a=1&b=2" equals "?b=2&a=1"). */
export const filterKey = (query) =>
  JSON.stringify(
    Object.entries(query ?? {})
      .filter(([, value]) => value !== '' && value !== null && value !== undefined)
      .map(([key, value]) => [key, String(value)])
      .sort(([a], [b]) => a.localeCompare(b)),
  )

/**
 * The signed-in admin's own settings for one grid (Magento's "Columns" and
 * saved "views"), stored by the server per admin: GET/PUT /preferences/{key}
 * (docs/backend/PHASE7_CONTRACT.md §7). `columns` = [{ id, label, required? }].
 *
 * The grid renders with the defaults straight away; saved settings apply once
 * they arrive, and a failed load just keeps the defaults. Changes show at once
 * and are then saved (the whole value, like the API's PUT).
 */
export function useGridPreferences(key, columns) {
  const queryClient = useQueryClient()
  const queryKey = systemKeys.preferences(key)
  const saved = useQuery({ queryKey, queryFn: ({ signal }) => getPreferences(key, { signal }), enabled: LIVE_DATA, staleTime: Infinity, retry: false })
  const save = useMutation({
    mutationFn: (value) => savePreferences(key, value),
    onSuccess: (value) => queryClient.setQueryData(queryKey, value),
  })

  const value = saved.data ?? {}
  const known = new Set(columns.map((column) => column.id))
  const required = columns.filter((column) => column.required).map((column) => column.id)
  // null = every column (the default); unknown ids from an older layout are ignored.
  const chosen = Array.isArray(value.columns) ? value.columns.filter((id) => known.has(id)) : null
  const visible = chosen === null ? columns.map((column) => column.id) : [...new Set([...required, ...chosen])]
  const pageSize = PAGE_SIZES.includes(value.pageSize) ? value.pageSize : PAGE_SIZES[0]
  const filters = Array.isArray(value.filters) ? value.filters : []

  /** Applies `changes` ({ columns?, pageSize?, filters? }) now, then saves; resolves when saved. */
  function update(changes) {
    const next = { columns: chosen, pageSize: value.pageSize ?? null, filters, ...changes }
    queryClient.setQueryData(queryKey, { ...value, ...next })
    return save.mutateAsync(next).catch((error) => {
      // Back to what the server has: the change didn't stick.
      queryClient.setQueryData(queryKey, value)
      throw error
    })
  }

  return {
    enabled: LIVE_DATA,
    columns,
    isVisible: (id) => !LIVE_DATA || visible.includes(id),
    visible,
    pageSize,
    filters,
    update,
    saving: save.isPending,
  }
}
