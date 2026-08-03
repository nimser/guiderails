import { readFileSync, readdirSync, statSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { join } from 'node:path'
import { PredicateRegistry } from '../core/predicate-registry.js'
import { validateRulePack, getRulePackErrors } from '../core/validator.js'
import type { MatchCondition, GuardrailAction, BeforeToolAction, RulePack } from '../core/types.js'

interface RawMatcher {
  type: string
  pattern?: string
  predicateName?: string
}

interface RawAction {
  type: string
  message?: string
  replacement?: string
  fallback?: RawAction
}

interface RawRule {
  id: string
  title: string
  description: string
  phase: string
  match: RawMatcher
  defaultAction: RawAction
}

/**
 * Load and parse a single YAML rule pack file.
 * Validates structure and returns a typed RulePack, or throws on error.
 *
 * @param filePath - Path to the YAML file
 * @param predicateRegistry - Registry for resolving named predicate matchers
 */
export function loadYamlRulePack(filePath: string, predicateRegistry: PredicateRegistry): RulePack {
  const content = readFileSync(filePath, 'utf-8')
  const raw = parseYaml(content)

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      `Rule pack YAML must be a mapping with id, name, description, and rules fields: ${filePath}`
    )
  }

  const { id, name, description, rules: rawRules } = raw

  if (!id || !name || !description) {
    throw new Error(`Rule pack missing required fields (id, name, description): ${filePath}`)
  }

  if (!Array.isArray(rawRules)) {
    throw new TypeError(`Rule pack "rules" must be an array: ${filePath}`)
  }

  const rules = rawRules.map((rawRule: RawRule, index: number) => {
    if (
      !rawRule.id ||
      !rawRule.title ||
      !rawRule.description ||
      !rawRule.phase ||
      !rawRule.match ||
      !rawRule.defaultAction
    ) {
      throw new Error(`Rule #${index} in ${filePath} missing required fields`)
    }

    const match = parseMatcher(rawRule.match, predicateRegistry, filePath)
    const defaultAction = parseAction(rawRule.defaultAction)

    return {
      id: rawRule.id,
      title: rawRule.title,
      description: rawRule.description,
      phase: rawRule.phase,
      match,
      defaultAction,
    }
  })

  const pack: unknown =
    raw.nonOverridable === true
      ? { id, name, description, rules, nonOverridable: true }
      : { id, name, description, rules }

  if (!validateRulePack(pack)) {
    const errors = getRulePackErrors(pack)
    throw new Error(`Rule pack "${id}" validation failed: ${errors.join('; ')}`)
  }

  return pack
}

/**
 * Load all `.yaml` / `.yml` files from a directory as rule packs.
 * Non-YAML files are silently skipped. Throws if any YAML file fails validation.
 *
 * @param packDir - Directory containing YAML rule pack files
 * @param predicateRegistry - Registry for resolving named predicate matchers
 */
export function loadAllRulePacks(
  packDir: string,
  predicateRegistry: PredicateRegistry
): RulePack[] {
  const packs: RulePack[] = []

  let entries: string[]
  try {
    // Sorted: first match wins across packs, so precedence must not ride on
    // filesystem directory order.
    entries = readdirSync(packDir).sort()
  } catch (err) {
    throw new Error(`Failed to read rule pack directory ${packDir}: ${(err as Error).message}`)
  }

  for (const entry of entries) {
    const fullPath = join(packDir, entry)
    try {
      const stat = statSync(fullPath)
      if (!stat.isFile()) continue
      if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue

      const pack = loadYamlRulePack(fullPath, predicateRegistry)
      packs.push(pack)
    } catch (err) {
      throw new Error(`Failed to load rule pack ${fullPath}: ${(err as Error).message}`)
    }
  }

  return packs
}

function parseMatcher(
  raw: RawMatcher,
  predicateRegistry: PredicateRegistry,
  filePath: string
): MatchCondition {
  if (!raw.type) {
    throw new Error(`Matcher missing "type" field in ${filePath}`)
  }

  switch (raw.type) {
    case 'bash-command': {
      if (typeof raw.pattern !== 'string') {
        throw new TypeError(`bash-command matcher requires string pattern: ${filePath}`)
      }
      try {
        return { type: 'bash-command', pattern: new RegExp(raw.pattern) }
      } catch (err) {
        throw new Error(`Invalid regex "${raw.pattern}" in ${filePath}: ${(err as Error).message}`)
      }
    }
    case 'file-path': {
      if (typeof raw.pattern !== 'string') {
        throw new TypeError(`file-path matcher requires string pattern: ${filePath}`)
      }
      try {
        return { type: 'file-path', pattern: new RegExp(raw.pattern) }
      } catch (err) {
        throw new Error(`Invalid regex "${raw.pattern}" in ${filePath}: ${(err as Error).message}`)
      }
    }
    case 'predicate': {
      if (typeof raw.predicateName !== 'string') {
        throw new TypeError(`predicate matcher requires string predicateName: ${filePath}`)
      }
      const fn = predicateRegistry.resolve(raw.predicateName)
      if (!fn) {
        throw new Error(`Unknown predicate "${raw.predicateName}" in ${filePath}`)
      }
      return { type: 'predicate', predicateName: raw.predicateName }
    }
    default:
      throw new Error(`Unknown matcher type "${raw.type}" in ${filePath}`)
  }
}

function parseAction(raw: RawAction): GuardrailAction {
  if (!raw.type) {
    throw new Error('Action missing "type" field')
  }

  switch (raw.type) {
    case 'allow':
      return { type: 'allow' }
    case 'block':
      requireString(raw, 'message', 'block')
      return { type: 'block', message: raw.message as string }
    case 'suggest':
      requireString(raw, 'replacement', 'suggest')
      return {
        type: 'suggest',
        replacement: raw.replacement as string,
        message: raw.message,
      }
    case 'run':
      requireString(raw, 'replacement', 'run')
      return {
        type: 'run',
        replacement: raw.replacement as string,
        message: raw.message,
      }
    case 'redact':
      requireString(raw, 'replacement', 'redact')
      return { type: 'redact', replacement: raw.replacement as string }
    case 'confirm':
      requireString(raw, 'message', 'confirm')
      return {
        type: 'confirm',
        message: raw.message as string,
        fallback: raw.fallback ? parseBeforeToolAction(raw.fallback) : undefined,
      }
    default:
      throw new Error(`Unknown action type "${raw.type}"`)
  }
}

function requireString(raw: RawAction, field: 'message' | 'replacement', actionType: string): void {
  const value = raw[field]
  if (typeof value !== 'string' || value === '') {
    throw new Error(
      `Action "${actionType}" requires a non-empty "${field}" field (got ${JSON.stringify(value)})`
    )
  }
}

function parseBeforeToolAction(raw: RawAction): BeforeToolAction {
  const action = parseAction(raw)
  if (action.type === 'redact') {
    throw new Error('redact action is not allowed in before-tool context')
  }
  return action
}
