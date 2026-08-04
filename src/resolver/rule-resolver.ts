import type {
  BeforeToolRule,
  DomainEvent,
  GuardrailAction,
  HarnessCapabilities,
  MatchResult,
  ToolCallContext,
  UserInputRule,
} from '../core/types.js'
import { resolveAction } from './action-resolver.js'

type ResolvableRule = BeforeToolRule | UserInputRule

export function resolveRuleAction(
  rule: ResolvableRule,
  matchContext: ToolCallContext,
  capabilities: HarnessCapabilities
): MatchResult {
  const command = 'command' in matchContext ? matchContext.command : undefined
  const matched = command || matchContext.filePath || ''
  const replacement =
    'replacement' in rule.defaultAction ? rule.defaultAction.replacement : undefined
  const effectiveCapabilities = capabilitiesForRule(rule, capabilities)
  const action = resolveAction(rule.defaultAction, effectiveCapabilities, { matched, replacement })
  const ruleEvent: DomainEvent = { type: 'rule-matched', ruleId: rule.id, matched }
  const fallbackEvent = detectFallback(rule.defaultAction, action)

  return {
    action,
    events: fallbackEvent ? [ruleEvent, fallbackEvent] : [ruleEvent],
  }
}

function capabilitiesForRule(
  rule: ResolvableRule,
  capabilities: HarnessCapabilities
): HarnessCapabilities {
  if (rule.phase !== 'user-input') return capabilities
  return { ...capabilities, redact: capabilities.redactUserInput === true }
}

function detectFallback(
  original: GuardrailAction,
  resolved: GuardrailAction
): DomainEvent | undefined {
  if (original.type === resolved.type) return undefined

  const reason =
    resolved.type === 'block' && 'fallbackReason' in resolved && resolved.fallbackReason
      ? resolved.fallbackReason
      : `Capability '${original.type}' not available`

  return {
    type: 'fallback-triggered',
    from: original.type,
    to: resolved.type,
    reason,
  }
}
