import type { ToolCallContext } from '../../core/types.js'

/** The subset of a Claude Code hook payload the adapter reads. */
export interface ClaudeCodeHookPayload {
  hook_event_name: 'PreToolUse' | 'PostToolUse' | 'UserPromptSubmit'
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_response?: unknown
  prompt?: string
}

const TOOL_NAME_MAP: Record<string, string> = {
  Bash: 'bash',
  Read: 'read',
  Write: 'write',
  Edit: 'write',
}

/**
 * Normalize a Claude Code hook payload into the engine's `ToolCallContext`.
 * Returns null for events the engine has no rules-phase for (e.g. PostToolUse
 * until after-tool evaluation ships).
 */
export function normalizeHookPayload(payload: ClaudeCodeHookPayload): ToolCallContext | null {
  if (payload.hook_event_name === 'UserPromptSubmit') {
    if (typeof payload.prompt !== 'string') return null
    return { toolName: 'user-input', command: payload.prompt }
  }

  if (payload.hook_event_name === 'PreToolUse') {
    const toolName = TOOL_NAME_MAP[payload.tool_name ?? ''] ?? payload.tool_name ?? ''
    const input = payload.tool_input ?? {}
    const command = typeof input.command === 'string' ? input.command : undefined
    const filePath = typeof input.file_path === 'string' ? input.file_path : undefined
    return { toolName, command, filePath }
  }

  // PostToolUse: after-tool evaluation is not wired yet; nothing to normalize.
  return null
}
