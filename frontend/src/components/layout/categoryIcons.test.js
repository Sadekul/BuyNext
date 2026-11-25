import { describe, expect, it } from 'vitest'
import { LuFlame, LuHouse, LuLayoutGrid, LuSmartphone, LuStore, LuTag } from 'react-icons/lu'
import { categoryIcon, navLinkIcon } from './categoryIcons'

describe('navigation icons', () => {
  it('maps fixed links, "More" and category pages; unknown categories get the generic icon', () => {
    expect(navLinkIcon({ to: '/' })).toBe(LuHouse)
    expect(navLinkIcon({ to: '/products' })).toBe(LuStore)
    expect(navLinkIcon({ to: '/deals' })).toBe(LuFlame)
    expect(navLinkIcon({ id: 'more', children: [] })).toBe(LuLayoutGrid)
    expect(navLinkIcon({ to: '/categories/smartphones' })).toBe(LuSmartphone)
    expect(navLinkIcon({ to: '/categories/garden-tools' })).toBe(LuTag)
    expect(categoryIcon(undefined)).toBe(LuTag)
  })
})
