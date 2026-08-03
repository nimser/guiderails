import { MAX_FALLBACK_DEPTH } from './fallback-depth.js'
import type {
  AfterToolAction,
  BeforeToolAction,
  UserInputAction,
  MatchCondition,
  GuardrailRule,
  RulePack,
} from './types.js'

const VALID_PHASES = new Set(['user-input', 'before-tool', 'after-tool'])

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object'
}

function isMatchCondition(v: unknown): v is MatchCondition {
  if (!isObject(v)) return false

  switch (v.type) {
    case 'bash-command':
    case 'file-path':
      return v.pattern instanceof RegExp
    case 'predicate':
      return typeof v.predicateName === 'string' && v.predicateName.length > 0
    default:
      return false
  }
}

function isBeforeToolAction(v: unknown, fallbackDepth = 0): v is BeforeToolAction {
  if (!isObject(v)) return false

  switch (v.type) {
    case 'allow':
      return true
    case 'block':
      return (
        typeof v.message === 'string' &&
        v.message.length > 0 &&
        (v.fallbackReason === undefined || typeof v.fallbackReason === 'string')
      )
    case 'suggest':
    case 'run':
      return (
        typeof v.replacement === 'string' &&
        v.replacement.length > 0 &&
        (v.message === undefined || typeof v.message === 'string')
      )
    case 'confirm': {
      if (typeof v.message !== 'string' || v.message.length === 0) return false
      if (v.fallback === undefined) return true
      if (fallbackDepth >= MAX_FALLBACK_DEPTH) return false
      return isBeforeToolAction(v.fallback, fallbackDepth + 1)
    }
    default:
      return false
  }
}

function isUserInputAction(v: unknown): v is UserInputAction {
  if (!isObject(v)) return false
  // suggest and run are tool-call concepts, excluded from user-input (ADR-010)
  if (v.type === 'suggest' || v.type === 'run' || v.type === 'allow') return false
  if (v.type === 'redact') return isAfterToolAction(v)
  return isBeforeToolAction(v)
}

function isAfterToolAction(v: unknown): v is AfterToolAction {
  return (
    isObject(v) &&
    v.type === 'redact' &&
    typeof v.replacement === 'string' &&
    v.replacement.length > 0
  )
}

/**
 * Check whether an unknown value is a valid GuardrailRule.
 * Returns true if the rule passes all structural and phase-compatibility checks.
 */
export function validateRule(input: unknown): input is GuardrailRule {
  return getRuleErrors(input).length === 0
}

/**
 * Return descriptive validation errors for a potential GuardrailRule.
 * Checks: required fields, valid phase, valid matcher shape, action-phase compatibility.
 */
export function getRuleErrors(input: unknown): string[] {
  if (!isObject(input)) {
    return ['Rule is not an object']
  }

  const errors: string[] = []
  errors.push(
    ...checkRequiredStringFields(input),
    ...checkPhase(input),
    ...checkMatcher(input),
    ...checkActionForPhase(input)
  )
  return errors
}

function checkRequiredStringFields(input: Record<string, unknown>): string[] {
  const errors: string[] = []
  for (const field of ['id', 'title', 'description'] as const) {
    if (typeof input[field] !== 'string' || !input[field]) {
      errors.push(`Rule "${field}" is required`)
    }
  }
  return errors
}

function checkPhase(input: Record<string, unknown>): string[] {
  if (typeof input.phase !== 'string' || !VALID_PHASES.has(input.phase)) {
    return ['Rule "phase" must be "user-input", "before-tool", or "after-tool"']
  }
  return []
}

function checkMatcher(input: Record<string, unknown>): string[] {
  if (!isMatchCondition(input.match)) {
    return ['Rule "match" is invalid or malformed']
  }
  return []
}

function checkActionForPhase(input: Record<string, unknown>): string[] {
  if (typeof input.phase !== 'string' || !VALID_PHASES.has(input.phase)) {
    return []
  }
  if (input.phase === 'before-tool' && !isBeforeToolAction(input.defaultAction)) {
    return ['Rule "defaultAction" is invalid for before-tool phase']
  }
  if (input.phase === 'after-tool' && !isAfterToolAction(input.defaultAction)) {
    return ['Rule "defaultAction" must be a redact action for after-tool phase']
  }
  if (input.phase === 'user-input' && !isUserInputAction(input.defaultAction)) {
    return ['Rule "defaultAction" must be a redact, block, or confirm action for user-input phase']
  }
  return []
}

/**
 * Check whether an unknown value is a valid RulePack.
 * Validates structure, required fields, unique rule IDs, and each rule individually.
 */
export function validateRulePack(input: unknown): input is RulePack {
  return getRulePackErrors(input).length === 0
}

/**
 * Return descriptive validation errors for a potential RulePack.
 * Checks: required fields, rules array, unique rule IDs, and per-rule validation.
 */
export function getRulePackErrors(input: unknown): string[] {
  if (!isObject(input)) {
    return ['RulePack is not an object']
  }

  const errors: string[] = []
  errors.push(...checkRulePackRequiredFields(input))

  if (!Array.isArray(input.rules)) {
    errors.push('RulePack "rules" must be an array')
    return errors
  }

  errors.push(...checkRulesArray(input.rules))
  return errors
}

function checkRulePackRequiredFields(input: Record<string, unknown>): string[] {
  const errors: string[] = []
  if (typeof input.id !== 'string' || !input.id) errors.push('RulePack "id" is required')
  if (typeof input.name !== 'string' || !input.name) errors.push('RulePack "name" is required')
  if (typeof input.description !== 'string' || !input.description)
    errors.push('RulePack "description" is required')
  return errors
}

function checkRulesArray(rules: unknown[]): string[] {
  const errors: string[] = []
  const ids = new Set<string>()

  for (const rule of rules) {
    if (!isObject(rule)) {
      errors.push('RulePack contains a non-object rule')
      continue
    }
    errors.push(...checkRuleIdUniqueness(rule, ids), ...checkRuleValidity(rule))
  }

  return errors
}

function checkRuleIdUniqueness(rule: Record<string, unknown>, ids: Set<string>): string[] {
  if (typeof rule.id !== 'string' || !rule.id) return []
  if (ids.has(rule.id)) return [`duplicate rule id "${rule.id}"`]
  ids.add(rule.id)
  return []
}

function checkRuleValidity(rule: Record<string, unknown>): string[] {
  const ruleErrors = getRuleErrors(rule)
  if (ruleErrors.length === 0) return []
  const ruleLabel = typeof rule.id === 'string' ? rule.id : '<unknown>'
  return ruleErrors.map((e) => `rule "${ruleLabel}": ${e}`)
}
