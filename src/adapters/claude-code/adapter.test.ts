import { describe, expect, it } from 'vitest'
import { normalizeHookPayload } from './normalize.js'
import { toHookResponse, failClosedResponse } from './respond.js'
import { handleHookEvent, createClaudeCodeEngine } from './hook.js'
import {
  claudeCodeCapabilities,
  CLAUDE_CODE_CAPABILITIES,
} from '../../core/harness-capabilities.js'
import type { Engine } from '../../engine/create-engine.js'

describe('CLAUDE_CODE_CAPABILITIES', () => {
  it('declares full native support', () => {
    expect(CLAUDE_CODE_CAPABILITIES).toMatchObject({
      block: true,
      suggest: true,
      run: true,
      redact: true,
      confirm: true,
      redactUserInput: true,
      tamperResistant: true,
      haltTurnBeforeTool: true,
      haltTurnAfterTool: true,
    })
  })

  it('gates redact on the 2.1.121 version floor', () => {
    expect(claudeCodeCapabilities('2.1.121').redact).toBe(true)
    expect(claudeCodeCapabilities('2.2.0').redact).toBe(true)
    expect(claudeCodeCapabilities('2.1.120').redact).toBe(false)
    expect(claudeCodeCapabilities('1.9.9').redact).toBe(false)
  })
})

describe('normalizeHookPayload', () => {
  it('maps PreToolUse Bash to a bash context', () => {
    expect(
      normalizeHookPayload({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'cat .env' },
      })
    ).toEqual({ toolName: 'bash', command: 'cat .env', filePath: undefined })
  })

  it('maps PreToolUse Read to a read context', () => {
    expect(
      normalizeHookPayload({
        hook_event_name: 'PreToolUse',
        tool_name: 'Read',
        tool_input: { file_path: '/repo/.env' },
      })
    ).toEqual({ toolName: 'read', command: undefined, filePath: '/repo/.env' })
  })

  it('maps UserPromptSubmit to a user-input context', () => {
    expect(normalizeHookPayload({ hook_event_name: 'UserPromptSubmit', prompt: 'hello' })).toEqual({
      toolName: 'user-input',
      command: 'hello',
    })
  })
})

describe('toHookResponse', () => {
  const pre = {
    hook_event_name: 'PreToolUse' as const,
    tool_name: 'Bash',
    tool_input: { command: 'x' },
  }

  it('emits deny for block', () => {
    const r = toHookResponse({ type: 'block', message: 'nope' }, pre)
    expect(r.hookSpecificOutput?.permissionDecision).toBe('deny')
    expect(r.hookSpecificOutput?.permissionDecisionReason).toBe('nope')
  })

  it('emits deny with replacement for suggest', () => {
    const r = toHookResponse({ type: 'suggest', replacement: 'rg foo', message: 'use rg' }, pre)
    expect(r.hookSpecificOutput?.permissionDecision).toBe('deny')
    expect(r.hookSpecificOutput?.permissionDecisionReason).toContain('rg foo')
  })

  it('emits updatedInput for run', () => {
    const r = toHookResponse({ type: 'run', replacement: 'safe-cmd' }, pre)
    expect(r.hookSpecificOutput?.permissionDecision).toBe('allow')
    expect(r.hookSpecificOutput?.updatedInput).toMatchObject({ command: 'safe-cmd' })
  })

  it('emits ask for confirm', () => {
    const r = toHookResponse({ type: 'confirm', message: 'sure?' }, pre)
    expect(r.hookSpecificOutput?.permissionDecision).toBe('ask')
  })

  it('emits an empty response for allow/no-match', () => {
    expect(toHookResponse(null, pre)).toEqual({})
  })

  it('rewrites the prompt for user-input redact', () => {
    const r = toHookResponse(
      { type: 'redact', replacement: '[SECRET-REDACTED]' },
      {
        hook_event_name: 'UserPromptSubmit',
        prompt: 'my key is ghp_abcdefghijklmnopqrstuvwxyz0123456789 ok',
      }
    )
    expect(r.hookSpecificOutput?.updatedPrompt).toBe('my key is [SECRET-REDACTED] ok')
  })

  it('fail-closed response denies the event', () => {
    expect(failClosedResponse(pre).hookSpecificOutput?.permissionDecision).toBe('deny')
    expect(failClosedResponse({ hook_event_name: 'UserPromptSubmit', prompt: 'x' }).decision).toBe(
      'block'
    )
  })
})

describe('handleHookEvent (end to end over built-in packs)', () => {
  const engine = createClaudeCodeEngine()

  it('denies cat .env with a suggested redacted read', () => {
    const r = handleHookEvent(
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'cat .env' },
      }),
      engine
    )
    expect(r.hookSpecificOutput?.permissionDecision).toBe('deny')
    expect(r.hookSpecificOutput?.permissionDecisionReason).toContain('[REDACTED]')
  })

  it('passes benign commands through untouched', () => {
    const r = handleHookEvent(
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' },
      }),
      engine
    )
    expect(r).toEqual({})
  })

  it('fail-closes on malformed JSON', () => {
    expect(handleHookEvent('not json', engine).decision).toBe('block')
  })

  it('fail-closes when the engine throws', () => {
    const throwing: Engine = {
      evaluate: () => {
        throw new Error('boom')
      },
      processMatch: () => {
        throw new Error('boom')
      },
      getStats: () => ({ checks: 0, blocks: 0, suggests: 0 }),
      resetStats: () => {},
    }
    const r = handleHookEvent(
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
      }),
      throwing
    )
    expect(r.hookSpecificOutput?.permissionDecision).toBe('deny')
  })
})
