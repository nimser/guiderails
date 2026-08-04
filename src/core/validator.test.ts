import { describe, it, expect } from 'vitest'
import { validateRule, validateRulePack, getRuleErrors, getRulePackErrors } from './validator.js'
import { MAX_FALLBACK_DEPTH } from './fallback-depth.js'
import type { GuardrailRule, RulePack } from './types.js'

/** Builds a confirm action whose fallback chain holds `links` nested actions. */
function nestedConfirm(links: number): Record<string, unknown> {
  let action: Record<string, unknown> = { type: 'block', message: 'cancelled' }
  for (let i = 0; i < links; i++) {
    action = { type: 'confirm', message: `level ${links - i}?`, fallback: action }
  }
  return action
}

function validRule(overrides: Partial<GuardrailRule> = {}): GuardrailRule {
  return {
    id: 'test.rule',
    title: 'Test Rule',
    description: 'A test rule',
    phase: 'before-tool',
    match: { type: 'bash-command', pattern: /test/i },
    defaultAction: { type: 'block', message: 'Blocked: {matched}' },
    ...overrides,
  }
}

describe('validateRule', () => {
  it('validates a valid before-tool rule', () => {
    const rule = validRule()
    expect(validateRule(rule)).toBe(true)
    expect(getRuleErrors(rule)).toHaveLength(0)
  })

  it('fails on missing id', () => {
    const rule = { ...validRule(), id: '' }
    expect(validateRule(rule)).toBe(false)
    expect(getRuleErrors(rule)).toEqual(expect.arrayContaining([expect.stringContaining('id')]))
  })

  it('fails on missing title', () => {
    const rule = { ...validRule(), title: '' }
    expect(validateRule(rule)).toBe(false)
  })

  it('fails on missing description', () => {
    const rule = { ...validRule(), description: '' }
    expect(validateRule(rule)).toBe(false)
  })

  it('fails when after-tool has block action', () => {
    const rule = {
      ...validRule(),
      phase: 'after-tool' as const,
      defaultAction: { type: 'block' as const, message: 'nope' },
    }
    expect(validateRule(rule)).toBe(false)
    expect(getRuleErrors(rule)).toEqual(expect.arrayContaining([expect.stringContaining('redact')]))
  })

  it('validates when after-tool has redact action', () => {
    const rule = {
      ...validRule(),
      phase: 'after-tool' as const,
      defaultAction: { type: 'redact' as const, replacement: '[REDACTED]' },
    }
    expect(validateRule(rule)).toBe(true)
  })

  it('fails when before-tool has redact action', () => {
    const rule = {
      ...validRule(),
      defaultAction: { type: 'redact' as const, replacement: '[REDACTED]' },
    }
    expect(validateRule(rule)).toBe(false)
  })

  it('validates when before-tool has allow action', () => {
    const rule = {
      ...validRule(),
      defaultAction: { type: 'allow' as const },
    }
    expect(validateRule(rule)).toBe(true)
  })

  it('rejects non-object input', () => {
    expect(validateRule(null)).toBe(false)
    expect(validateRule(undefined)).toBe(false)
    expect(validateRule('string')).toBe(false)
  })

  it('reports all errors at once', () => {
    const rule = { id: '', title: '', description: '' }
    const errors = getRuleErrors(rule)
    expect(errors.length).toBeGreaterThan(1)
  })

  it('fails on invalid phase value', () => {
    const rule = { ...validRule(), phase: 'during-tool' }
    expect(validateRule(rule)).toBe(false)
    expect(getRuleErrors(rule)).toEqual(expect.arrayContaining([expect.stringContaining('phase')]))
  })

  it('fails when match is missing', () => {
    const { match: _match, ...ruleWithoutMatch } = validRule()
    expect(validateRule(ruleWithoutMatch)).toBe(false)
    expect(getRuleErrors(ruleWithoutMatch)).toEqual(
      expect.arrayContaining([expect.stringContaining('match')])
    )
  })

  it('fails when matcher has unknown type', () => {
    const rule = { ...validRule(), match: { type: 'custom', pattern: /x/ } }
    expect(validateRule(rule)).toBe(false)
  })

  it('fails when suggest action has non-string replacement', () => {
    const rule = {
      ...validRule(),
      defaultAction: { type: 'suggest', replacement: 42, message: 'try' },
    }
    expect(validateRule(rule)).toBe(false)
  })

  it('fails when run action has non-string message', () => {
    const rule = {
      ...validRule(),
      defaultAction: { type: 'run', replacement: 'cmd', message: 123 },
    }
    expect(validateRule(rule)).toBe(false)
  })

  it('fails when confirm has invalid nested fallback', () => {
    const rule = {
      ...validRule(),
      defaultAction: { type: 'confirm', message: 'ok?', fallback: { type: 'invalid' } },
    }
    expect(validateRule(rule)).toBe(false)
  })

  it('validates confirm with valid nested fallback', () => {
    const rule = {
      ...validRule(),
      defaultAction: {
        type: 'confirm',
        message: 'ok?',
        fallback: { type: 'block', message: 'cancelled' },
      },
    }
    expect(validateRule(rule)).toBe(true)
  })

  it('validates a confirm fallback chain at the maximum depth', () => {
    const rule = {
      ...validRule(),
      defaultAction: nestedConfirm(MAX_FALLBACK_DEPTH),
    }
    expect(validateRule(rule)).toBe(true)
  })

  it('fails when a confirm fallback chain is nested past the maximum depth', () => {
    const rule = {
      ...validRule(),
      defaultAction: nestedConfirm(MAX_FALLBACK_DEPTH + 1),
    }
    expect(validateRule(rule)).toBe(false)
  })

  it('fails instead of overflowing on a self-referencing fallback', () => {
    const cyclic: Record<string, unknown> = { type: 'confirm', message: 'ok?' }
    cyclic.fallback = cyclic
    const rule = { ...validRule(), defaultAction: cyclic }
    expect(validateRule(rule)).toBe(false)
  })

  it('fails when predicate matcher has empty predicateName', () => {
    const rule = { ...validRule(), match: { type: 'predicate', predicateName: '' } }
    expect(validateRule(rule)).toBe(false)
  })

  it('fails when block action has empty message', () => {
    const rule = { ...validRule(), defaultAction: { type: 'block', message: '' } }
    expect(validateRule(rule)).toBe(false)
  })

  it('fails when suggest action has empty replacement', () => {
    const rule = {
      ...validRule(),
      defaultAction: { type: 'suggest', replacement: '', message: 'try' },
    }
    expect(validateRule(rule)).toBe(false)
  })

  it('fails when run action has empty replacement', () => {
    const rule = {
      ...validRule(),
      defaultAction: { type: 'run', replacement: '', message: 'run' },
    }
    expect(validateRule(rule)).toBe(false)
  })

  it('fails when confirm action has empty message', () => {
    const rule = { ...validRule(), defaultAction: { type: 'confirm', message: '' } }
    expect(validateRule(rule)).toBe(false)
  })

  it('fails when redact action has empty replacement', () => {
    const rule = {
      ...validRule(),
      phase: 'after-tool' as const,
      defaultAction: { type: 'redact', replacement: '' },
    }
    expect(validateRule(rule)).toBe(false)
  })
})

describe('validateRulePack', () => {
  function validPack(overrides: Partial<RulePack> = {}): RulePack {
    return {
      id: 'test-pack',
      name: 'Test Pack',
      description: 'A test pack',
      rules: [validRule()],
      ...overrides,
    }
  }

  it('validates a valid pack', () => {
    expect(validateRulePack(validPack())).toBe(true)
    expect(getRulePackErrors(validPack())).toHaveLength(0)
  })

  it('fails on duplicate rule IDs', () => {
    const pack = validPack({
      rules: [validRule({ id: 'dup' }), validRule({ id: 'dup' })],
    })
    expect(validateRulePack(pack)).toBe(false)
    expect(getRulePackErrors(pack)).toEqual(
      expect.arrayContaining([expect.stringContaining('duplicate')])
    )
  })

  it('fails when a rule is invalid', () => {
    const badRule = {
      ...validRule(),
      phase: 'after-tool' as const,
      defaultAction: { type: 'block' as const, message: 'x' },
    }
    const pack = validPack({ rules: [badRule] })
    expect(validateRulePack(pack)).toBe(false)
  })

  it('fails on missing pack id', () => {
    expect(validateRulePack(validPack({ id: '' }))).toBe(false)
  })

  it('fails on missing pack name', () => {
    expect(validateRulePack(validPack({ name: '' }))).toBe(false)
  })

  it('rejects non-object input', () => {
    expect(validateRulePack(null)).toBe(false)
    expect(validateRulePack('string')).toBe(false)
  })

  it('fails when rules is not an array', () => {
    const pack = { id: 'p', name: 'P', description: 'D', rules: 'not-an-array' }
    expect(validateRulePack(pack)).toBe(false)
    expect(getRulePackErrors(pack)).toEqual(
      expect.arrayContaining([expect.stringContaining('rules')])
    )
  })

  it('fails when rules contains a non-object', () => {
    const pack = { id: 'p', name: 'P', description: 'D', rules: ['not-an-object', 42] }
    expect(validateRulePack(pack)).toBe(false)
    expect(getRulePackErrors(pack)).toEqual(
      expect.arrayContaining([expect.stringContaining('non-object')])
    )
  })
})
