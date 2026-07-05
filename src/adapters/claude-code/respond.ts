import type { GuardrailAction } from '../../core/types.js'
import type { ClaudeCodeHookPayload } from './normalize.js'

/** Structured hook output Claude Code consumes on stdout. */
export interface ClaudeCodeHookResponse {
  hookSpecificOutput?: {
    hookEventName: string
    permissionDecision?: 'allow' | 'deny' | 'ask'
    permissionDecisionReason?: string
    updatedInput?: Record<string, unknown>
    updatedPrompt?: string
  }
  decision?: 'block'
  reason?: string
  continue?: boolean
  stopReason?: string
}

/**
 * Translate a resolved GuardrailAction into Claude Code structured hook JSON.
 * All decisions are structured `permissionDecision` output — never exit codes.
 */
export function toHookResponse(
  action: GuardrailAction | null,
  payload: ClaudeCodeHookPayload
): ClaudeCodeHookResponse {
  const eventName = payload.hook_event_name

  if (action === null || action.type === 'allow') {
    return {}
  }

  if (eventName === 'UserPromptSubmit') {
    return userPromptResponse(action, payload)
  }

  switch (action.type) {
    case 'block':
      return deny(eventName, action.message)
    case 'suggest':
      return deny(
        eventName,
        `${action.message ?? 'A safer alternative is available.'}\nRetry with:\n\`\`\`\n${action.replacement}\n\`\`\``
      )
    case 'run':
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          permissionDecision: 'allow',
          permissionDecisionReason: action.message,
          updatedInput: { ...payload.tool_input, command: action.replacement },
        },
      }
    case 'confirm':
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          permissionDecision: 'ask',
          permissionDecisionReason: action.message,
        },
      }
    case 'redact':
      // PostToolUse updatedToolOutput wiring lands with after-tool evaluation.
      return deny(eventName, 'Output redaction is not wired for this event yet.')
  }
}

function userPromptResponse(
  action: GuardrailAction,
  payload: ClaudeCodeHookPayload
): ClaudeCodeHookResponse {
  switch (action.type) {
    case 'redact': {
      // The engine's user-input redact carries the placeholder; apply it here
      // is the rule pattern's job upstream — the adapter substitutes wholesale
      // only when given a rewritten prompt. Minimal contract: block-shaped
      // output with the scrubbed prompt via updatedPrompt.
      const scrubbed = payload.prompt ?? ''
      return {
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          updatedPrompt: scrubbed.length > 0 ? scrubPrompt(scrubbed, action.replacement) : scrubbed,
        },
      }
    }
    case 'confirm':
      return { decision: 'block', reason: action.message }
    default:
      return {
        decision: 'block',
        reason: 'message' in action && action.message ? action.message : 'Prompt blocked.',
      }
  }
}

const SECRET_SHAPES =
  /\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g

function scrubPrompt(prompt: string, placeholder: string): string {
  return prompt.replaceAll(SECRET_SHAPES, placeholder)
}

function deny(eventName: string, reason: string): ClaudeCodeHookResponse {
  return {
    hookSpecificOutput: {
      hookEventName: eventName,
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }
}

/** The unconditional fail-closed response (ADR-007): deny on engine crash/timeout. */
export function failClosedResponse(payload: ClaudeCodeHookPayload): ClaudeCodeHookResponse {
  if (payload.hook_event_name === 'UserPromptSubmit') {
    return { decision: 'block', reason: 'Guardrail engine error — prompt blocked (fail-closed).' }
  }
  return deny(payload.hook_event_name, 'Guardrail engine error — tool call blocked (fail-closed).')
}
