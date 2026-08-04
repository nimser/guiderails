import type { PredicateRegistry } from '../core/predicate-registry.js'
import type {
  DomainEvent,
  GuardrailAction,
  HarnessCapabilities,
  MatchResult,
  RulePack,
  ToolCallContext,
} from '../core/types.js'
import { extractTargets, isKnownTool, isMissingRequiredFields } from '../core/normalizer.js'
import { splitCommands } from '../matcher/command-splitter.js'
import { exceedsMatchInputLimit, MAX_MATCH_INPUT_LENGTH } from '../matcher/matchers.js'
import { findFirstMatchAcrossPacks } from '../matcher/rule-matcher.js'
import { resolveRuleAction } from '../resolver/rule-resolver.js'
import type { StatsTracker } from './stats-tracker.js'

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

  // User-input prompt text is never command-split (ADR-010).
  const commands =
    ctx.toolName === 'user-input' ? [command ?? ''] : command ? splitCommands(command) : ['']
  const match = findFirstMatchAcrossPacks(packs, ctx, commands, registry)
  const result = match
    ? resolveRuleAction(match.rule, match.matchContext, capabilities)
    : { action: null, events: [] }
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
