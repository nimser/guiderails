import { PredicateRegistry } from '../../core/predicate-registry.js'
import {
  claudeCodeCapabilities,
  CLAUDE_CODE_CAPABILITIES,
} from '../../core/harness-capabilities.js'
import { createEngine, type Engine } from '../../engine/create-engine.js'
import { loadBuiltInRulePacks } from '../../packs/index.js'
import { normalizeHookPayload, type ClaudeCodeHookPayload } from './normalize.js'
import { toHookResponse, failClosedResponse, type ClaudeCodeHookResponse } from './respond.js'

/**
 * Handle one Claude Code hook invocation: parse the payload, evaluate it,
 * and return the structured response. Fail-closed on any error (ADR-007).
 */
export function handleHookEvent(rawPayload: string, engine: Engine): ClaudeCodeHookResponse {
  let payload: ClaudeCodeHookPayload
  try {
    payload = JSON.parse(rawPayload) as ClaudeCodeHookPayload
  } catch {
    return { decision: 'block', reason: 'Guardrail hook received malformed JSON (fail-closed).' }
  }

  try {
    const ctx = normalizeHookPayload(payload)
    if (ctx === null) return {}
    const action = engine.evaluate(ctx)
    return toHookResponse(action, payload)
  } catch {
    return failClosedResponse(payload)
  }
}

/** Build the default engine over the built-in packs for this adapter. */
export function createClaudeCodeEngine(claudeCodeVersion?: string): Engine {
  const registry = new PredicateRegistry()
  const packs = loadBuiltInRulePacks(registry)
  const capabilities = claudeCodeVersion
    ? claudeCodeCapabilities(claudeCodeVersion)
    : CLAUDE_CODE_CAPABILITIES
  return createEngine(packs, capabilities, { registry })
}

/**
 * CLI entry point: read the hook payload from stdin, write the structured
 * decision JSON to stdout. Registered by `npx agent-guardrails install claude-code`.
 */
export async function main(): Promise<void> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  const engine = createClaudeCodeEngine(process.env.CLAUDE_CODE_VERSION)
  const response = handleHookEvent(Buffer.concat(chunks).toString('utf-8'), engine)
  process.stdout.write(JSON.stringify(response))
}
