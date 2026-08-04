import type { PredicateRegistry } from '../core/predicate-registry.js'
import type {
  BeforeToolRule,
  GuardrailRule,
  RulePack,
  ToolCallContext,
  UserInputRule,
} from '../core/types.js'
import { matchesMatcher } from './matchers.js'

type MatchableRule = BeforeToolRule | UserInputRule
type MatchablePhase = MatchableRule['phase']

export interface RuleMatch {
  readonly matchContext: ToolCallContext
  readonly rule: MatchableRule
}

export function findFirstMatchAcrossPacks(
  packs: RulePack[],
  context: ToolCallContext,
  commands: string[],
  predicateRegistry: PredicateRegistry
): RuleMatch | undefined {
  const phase = phaseForContext(context)

  for (const command of commands) {
    const matchContext: ToolCallContext = 'command' in context ? { ...context, command } : context

    for (const pack of packs) {
      const match = findFirstMatchInPack(pack, phase, matchContext, predicateRegistry)
      if (match) return match
    }
  }

  return undefined
}

function phaseForContext(context: ToolCallContext): MatchablePhase {
  // TODO(after-tool): Map after-tool contexts once output redaction is implemented.
  return context.toolName === 'user-input' ? 'user-input' : 'before-tool'
}

function findFirstMatchInPack(
  pack: RulePack,
  phase: MatchablePhase,
  matchContext: ToolCallContext,
  predicateRegistry: PredicateRegistry
): RuleMatch | undefined {
  for (const rule of pack.rules) {
    if (!isRuleForPhase(rule, phase)) continue
    if (!matchesMatcher(rule.match, matchContext, predicateRegistry)) continue

    return { matchContext, rule }
  }

  return undefined
}

function isRuleForPhase(rule: GuardrailRule, phase: MatchablePhase): rule is MatchableRule {
  return rule.phase === phase
}
