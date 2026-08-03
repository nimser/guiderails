import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { PredicateRegistry } from '../core/predicate-registry.js'

// Directory order is filesystem-defined, not alphabetical: this mock returns
// entries reversed to stand in for any host whose readdir order differs.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readdirSync: (...args: Parameters<typeof actual.readdirSync>) =>
      [...(actual.readdirSync(...args) as string[])].reverse(),
  }
})

const { loadAllRulePacks } = await import('./yaml-pack-loader.js')

const fixturesDir = join(fileURLToPath(import.meta.url), '..', '__fixtures__')

describe('pack load order', () => {
  let testDir: string
  let predicateRegistry: PredicateRegistry

  beforeEach(() => {
    testDir = join(tmpdir(), `guiderails-order-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    predicateRegistry = new PredicateRegistry()
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('loads packs in filename order regardless of directory order', () => {
    cpSync(join(fixturesDir, 'valid-pack1.yaml'), join(testDir, 'valid-pack1.yaml'))
    cpSync(join(fixturesDir, 'valid-pack2.yaml'), join(testDir, 'valid-pack2.yaml'))

    const packs = loadAllRulePacks(testDir, predicateRegistry)

    expect(packs.map((p) => p.id)).toEqual(['pack1', 'pack2'])
  })
})
