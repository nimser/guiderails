import { MAX_FALLBACK_DEPTH } from '../core/fallback-depth.js'
import type { GuardrailAction, HarnessCapabilities } from '../core/types.js'

/**
 * Interpolation context for guardrail action messages.
 * `{matched}` is replaced with the matched command or file path.
 * `{replacement}` is replaced with the suggested/replacement command.
 */
export interface ResolveContext {
  matched: string
  replacement?: string
}

function interpolate(message: string, ctx: ResolveContext): string {
  let result = message
  result = result.replaceAll('{matched}', ctx.matched)
  if (ctx.replacement !== undefined) {
    result = result.replaceAll('{replacement}', ctx.replacement)
  }
  return result
}

function interpolateMessage(message: string | undefined, ctx: ResolveContext): string | undefined {
  if (message === undefined) return undefined
  return interpolate(message, ctx)
}

/**
 * Resolve a GuardrailAction against HarnessCapabilities, walking the fallback chain
 * when a behavior is not supported.
 *
 * Fallback chains (ADR-002):
 * - run → suggest → block
 * - confirm → block
 * - redact → block (when unsupported)
 * - suggest → block (when unsupported)
 */
export function resolveAction(
  action: GuardrailAction,
  capabilities: HarnessCapabilities,
  ctx: ResolveContext,
  fallbackDepth = 0
): GuardrailAction {
  switch (action.type) {
    case 'allow':
      return action
    case 'block':
      return resolveBlock(action, ctx)
    case 'suggest':
      return resolveSuggest(action, capabilities, ctx)
    case 'run':
      return resolveRun(action, capabilities, ctx)
    case 'redact':
      return resolveRedact(action, capabilities, ctx)
    case 'confirm':
      return resolveConfirm(action, capabilities, ctx, fallbackDepth)
  }
}

function resolveBlock(
  action: Extract<GuardrailAction, { type: 'block' }>,
  ctx: ResolveContext
): GuardrailAction {
  return {
    type: 'block',
    message: interpolate(action.message, ctx),
  }
}

function resolveSuggest(
  action: Extract<GuardrailAction, { type: 'suggest' }>,
  capabilities: HarnessCapabilities,
  ctx: ResolveContext
): GuardrailAction {
  if (!capabilities.suggest) {
    return fallbackBlock(
      '`suggest` capability is not supported by your harness. Falling back to a `block`.',
      action.message,
      ctx
    )
  }
  if (!action.replacement) {
    return fallbackBlock(
      '`suggest` action has no `replacement` available. Falling back to a `block`.',
      `\`${ctx.matched}\` — no Replacement available.`,
      ctx
    )
  }
  const replacement = action.replacement
  return {
    type: 'suggest',
    replacement,
    message: interpolateMessage(action.message, { ...ctx, replacement }),
  }
}

function resolveRun(
  action: Extract<GuardrailAction, { type: 'run' }>,
  capabilities: HarnessCapabilities,
  ctx: ResolveContext
): GuardrailAction {
  if (capabilities.run) {
    const replacement = action.replacement
    return {
      type: 'run',
      replacement,
      message: interpolateMessage(action.message, { ...ctx, replacement }),
    }
  }
  if (capabilities.suggest && action.replacement) {
    const replacement = action.replacement
    return {
      type: 'suggest',
      replacement,
      message: interpolateMessage(action.message, { ...ctx, replacement }),
    }
  }
  return fallbackBlock(
    'Neither `run` nor `suggest` capabilities are supported by your harness. Falling back to a `block`.',
    action.message,
    ctx
  )
}

function resolveRedact(
  action: Extract<GuardrailAction, { type: 'redact' }>,
  capabilities: HarnessCapabilities,
  ctx: ResolveContext
): GuardrailAction {
  if (capabilities.redact) {
    return { type: 'redact', replacement: action.replacement }
  }
  return fallbackBlock(
    '`redact` capability is not supported by your harness. Falling back to a `block`.',
    undefined,
    ctx
  )
}

function resolveConfirm(
  action: Extract<GuardrailAction, { type: 'confirm' }>,
  capabilities: HarnessCapabilities,
  ctx: ResolveContext,
  fallbackDepth: number
): GuardrailAction {
  if (capabilities.confirm) {
    return {
      type: 'confirm',
      message: interpolate(action.message, ctx),
      fallback: action.fallback,
    }
  }
  if (action.fallback) {
    if (fallbackDepth >= MAX_FALLBACK_DEPTH) {
      return fallbackBlock(
        `\`confirm\` fallback chain exceeds the maximum depth of ${MAX_FALLBACK_DEPTH}. Falling back to a \`block\`.`,
        action.message,
        ctx
      )
    }
    return resolveAction(action.fallback, capabilities, ctx, fallbackDepth + 1)
  }
  // ADR-002: confirm falls back straight to block, never to suggest — a rule
  // that asked for a human decision must not degrade into handing the agent
  // an actionable replacement.
  return fallbackBlock(
    '`confirm` capability is not supported and no `fallback` action was defined. Falling back to a `block`.',
    action.message,
    ctx
  )
}

function fallbackBlock(
  fallbackReason: string,
  message: string | undefined,
  ctx: ResolveContext
): GuardrailAction {
  return {
    type: 'block',
    message: message
      ? interpolate(`Blocked: ${message}`, ctx)
      : interpolate(`Blocked: \`${ctx.matched}\``, ctx),
    fallbackReason,
  }
}
