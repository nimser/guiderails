import type {
  ToolCallContext,
  RulePack,
  GuardrailAction,
  HarnessCapabilities,
  MatchResult,
  DomainEvent,
} from '../core/types.js'
import type { PredicateRegistry } from '../core/predicate-registry.js'
import type { StatsTracker } from './stats-tracker.js'
import { extractTargets, isMissingRequiredFields, isKnownTool } from '../core/normalizer.js'
import {
  exceedsMatchInputLimit,
  matchesMatcher,
  MAX_MATCH_INPUT_LENGTH,
} from '../matcher/matchers.js'
import { splitCommands } from '../matcher/command-splitter.js'
import { resolveAction } from '../resolver/action-resolver.js'

/**
 * Evaluate a ToolCallContext against the given RulePacks and return the
 * first matching resolved action, or null if no rule matched.
 *
 * The `PredicateRegistry` and `StatsTracker` are explicit collaborators —
 * the engine does not own their lifecycle. Callers wire them up; tests
 * construct fresh instances per test.
 */
export function matchAndResolve(
  ctx: ToolCallContext,
  packs: RulePack[],
  capabilities: HarnessCapabilities,
  registry: PredicateRegistry,
  stats: StatsTracker
): GuardrailAction | null {
  return processMatch(ctx, packs, capabilities, registry, stats).action
}

/**
 * Evaluate a tool call — returns the resolved action plus the
 * domain events that explain how the decision was reached.
 */
export function processMatch(
  ctx: ToolCallContext,
  packs: RulePack[],
  capabilities: HarnessCapabilities,
  registry: PredicateRegistry,
  stats: StatsTracker
): MatchResult {
  const { command, filePath } = extractTargets(ctx)

  if (isMissingRequiredFields(ctx, command, filePath)) {
    return handleMissingTargetsTraced(ctx, stats)
  }

  if (exceedsMatchInputLimit(command) || exceedsMatchInputLimit(filePath)) {
    return handleOversizedInputTraced(ctx, stats)
  }

  // user-input contexts carry prompt text, which is never command-split (ADR-010)
  const commands =
    ctx.toolName === 'user-input' ? [command ?? ''] : command ? splitCommands(command) : ['']
  const result = findFirstMatchTraced(ctx, commands, packs, capabilities, registry)
  stats.record(result.action)
  return result
}

function handleMissingTargetsTraced(ctx: ToolCallContext, stats: StatsTracker): MatchResult {
  if (!isKnownTool(ctx.toolName)) {
    stats.record(null)
    return { action: null, events: [] }
  }
  const msg = `Blocked malformed ${ctx.toolName} tool call: missing required fields. Your adapter may need updating or your harness may be compromised.`
  const action: GuardrailAction = {
    type: 'block',
    message: msg,
  }
  const event: DomainEvent = {
    type: 'fallback-triggered',
    from: 'allow',
    to: 'block',
    reason: msg,
  }
  stats.record(action)
  return { action, events: [event] }
}

function handleOversizedInputTraced(ctx: ToolCallContext, stats: StatsTracker): MatchResult {
  const msg = `Blocked oversized ${ctx.toolName} tool call: input exceeds the ${MAX_MATCH_INPUT_LENGTH}-character matching limit, so no rule can be evaluated against it.`
  const action: GuardrailAction = { type: 'block', message: msg }
  const event: DomainEvent = {
    type: 'fallback-triggered',
    from: 'allow',
    to: 'block',
    reason: msg,
  }
  stats.record(action)
  return { action, events: [event] }
}

function findFirstMatchTraced(
  ctx: ToolCallContext,
  commands: string[],
  packs: RulePack[],
  capabilities: HarnessCapabilities,
  registry: PredicateRegistry
): MatchResult {
  for (const cmd of commands) {
    const matchCtx: ToolCallContext = 'command' in ctx ? { ...ctx, command: cmd } : ctx
    for (const pack of packs) {
      const result = matchPackRulesTraced(pack, matchCtx, capabilities, ctx, cmd, registry)
      if (result) return result
    }
  }
  return { action: null, events: [] }
}

function matchPackRulesTraced(
  pack: RulePack,
  matchCtx: ToolCallContext,
  capabilities: HarnessCapabilities,
  ctx: ToolCallContext,
  cmd: string,
  registry: PredicateRegistry
): MatchResult | undefined {
  const ctxPhase = ctx.toolName === 'user-input' ? 'user-input' : 'before-tool'
  for (const rule of pack.rules) {
    // eslint-disable-next-line no-warning-comments
    // TODO(after-tool): Evaluate after-tool rules in a second pass for redact behavior.
    // Currently unimplemented — after-tool phase is reserved for output redaction.
    if (rule.phase !== ctxPhase) continue
    if (!matchesMatcher(rule.match, matchCtx, registry)) continue

    const matchedValue = cmd || ctx.filePath || ''
    const replacement =
      'replacement' in rule.defaultAction ? rule.defaultAction.replacement : undefined

    const ruleEvent: DomainEvent = {
      type: 'rule-matched',
      ruleId: rule.id,
      matched: matchedValue,
    }

    // In the user-input phase, prompt rewriting is gated on the dedicated
    // redactUserInput capability rather than tool-output redact (ADR-010).
    const effectiveCapabilities: HarnessCapabilities =
      ctxPhase === 'user-input'
        ? { ...capabilities, redact: capabilities.redactUserInput === true }
        : capabilities

    const resolved = resolveAction(rule.defaultAction, effectiveCapabilities, {
      matched: matchedValue,
      replacement,
    })

    const fallbackEvent = detectFallback(rule.defaultAction, resolved)

    return {
      action: resolved,
      events: fallbackEvent ? [ruleEvent, fallbackEvent] : [ruleEvent],
    }
  }
  return undefined
}

/**
 * Detect whether the resolver walked the fallback chain by comparing
 * the rule's declared action type against the resolved action type.
 */
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
