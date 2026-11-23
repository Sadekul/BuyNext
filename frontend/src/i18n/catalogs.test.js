import { describe, expect, it } from 'vitest'
import en from '../locales/en/index.js'
import bn from '../locales/bn/index.js'

/*
 * Phase 13: the English and Bangla catalogs must match exactly: the same
 * namespaces, the same keys (no missing or extra ones) and, per key, the
 * same interpolation variables ({{name}}, {{count, number}} → "name",
 * "count") and the same <tags> for <Trans>.
 */

function flatten(tree, prefix = '') {
  return Object.entries(tree).flatMap(([key, value]) =>
    value && typeof value === 'object' ? flatten(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]],
  )
}

const variables = (text) => [...new Set([...String(text).matchAll(/\{\{\s*([\w.]+)\s*(?:,[^}]*)?\}\}/g)].map((match) => match[1]))].sort()
const tags = (text) => [...new Set([...String(text).matchAll(/<\/?([a-zA-Z][\w]*)\s*\/?>/g)].map((match) => match[1]))].sort()

describe('translation catalogs', () => {
  it('have the same namespaces in English and Bangla', () => {
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort())
  })

  for (const namespace of Object.keys(en)) {
    describe(namespace, () => {
      const english = Object.fromEntries(flatten(en[namespace]))
      const bangla = Object.fromEntries(flatten(bn[namespace] ?? {}))

      it('has every key in both languages (no missing or extra keys)', () => {
        expect(Object.keys(bangla).filter((key) => !(key in english))).toEqual([])
        expect(Object.keys(english).filter((key) => !(key in bangla))).toEqual([])
      })

      it('uses the same interpolation variables and tags', () => {
        const mismatches = Object.keys(english)
          .filter((key) => key in bangla)
          .filter((key) => JSON.stringify(variables(english[key])) !== JSON.stringify(variables(bangla[key])) || JSON.stringify(tags(english[key])) !== JSON.stringify(tags(bangla[key])))
        expect(mismatches).toEqual([])
      })

      it('has no empty Bangla values and translates the sentences', () => {
        expect(Object.entries(bangla).filter(([, value]) => typeof value !== 'string' || value.trim() === '').map(([key]) => key)).toEqual([])
        // A Bangla value that is just the English sentence again is a missed translation
        // (short codes, brand names, and the language names are fine).
        const untranslated = Object.keys(english).filter((key) => bangla[key] === english[key] && /[a-z]{3,}\s+[a-z]{2,}/i.test(english[key].replace(/<[^>]+>|\{\{[^}]+\}\}/g, '')))
        expect(untranslated).toEqual([])
      })
    })
  }
})
