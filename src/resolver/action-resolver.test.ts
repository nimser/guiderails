import { describe, expect, it } from 'vitest'
import { resolveAction } from './action-resolver.js'
import type { ResolveContext } from './action-resolver.js'
import { MAX_FALLBACK_DEPTH } from '../core/fallback-depth.js'
import type { BeforeToolAction, GuardrailAction, HarnessCapabilities } from '../core/types.js'

/** Builds a confirm action whose fallback chain holds `links` nested actions. */
function nestedConfirmChain(links: number): BeforeToolAction {
  let action: BeforeToolAction = { type: 'block', message: 'terminal fallback' }
  for (let i = 0; i < links; i++) {
    action = { type: 'confirm', message: `Level ${links - i}?`, fallback: action }
  }
  return action
}

describe('resolveAction', () => {
  const fullCapabilities: HarnessCapabilities = {
    block: true,
    suggest: true,
    run: true,
    redact: true,
    confirm: true,
  }

  const limitedCapabilities: HarnessCapabilities = {
    block: true,
    suggest: true,
    run: false,
    redact: false,
    confirm: false,
  }

  const noSuggest: HarnessCapabilities = {
    block: true,
    suggest: false,
    run: false,
    redact: false,
    confirm: false,
  }

  const ctx: ResolveContext = { matched: 'secret' }

  describe('allow action', () => {
    it('returns allow action directly', () => {
      const action: GuardrailAction = { type: 'allow' }
      const result = resolveAction(action, fullCapabilities, { matched: 'anything' })
      expect(result).toEqual({ type: 'allow' })
    })
  })

  describe('block action', () => {
    it('returns block action with interpolated message', () => {
      const action: GuardrailAction = { type: 'block', message: 'Blocked: {matched}' }
      const result = resolveAction(action, fullCapabilities, { matched: 'suspicious' })
      expect(result).toEqual({ type: 'block', message: 'Blocked: suspicious' })
    })
  })

  describe('suggest action', () => {
    it('returns suggest with replacement when capability available', () => {
      const action: GuardrailAction = {
        type: 'suggest',
        replacement: 'ls -la',
        message: 'Try: {replacement}',
      }
      const result = resolveAction(action, fullCapabilities, { matched: 'anything' })
      expect(result).toEqual({
        type: 'suggest',
        replacement: 'ls -la',
        message: 'Try: ls -la',
      })
    })

    it('interpolates {matched} in suggest message', () => {
      const action: GuardrailAction = {
        type: 'suggest',
        replacement: 'safe-cmd',
        message: 'Instead of {matched}, use {replacement}',
      }
      const result = resolveAction(action, fullCapabilities, { matched: 'dangerous' })
      expect(result).toEqual({
        type: 'suggest',
        replacement: 'safe-cmd',
        message: 'Instead of dangerous, use safe-cmd',
      })
    })

    it('falls back to block when suggest capability is unavailable', () => {
      const action: GuardrailAction = {
        type: 'suggest',
        replacement: 'safe-cmd',
        message: 'Try {replacement}',
      }
      const result = resolveAction(action, noSuggest, { matched: 'dangerous-cmd' })
      expect(result.type).toBe('block')
    })

    it('falls back to block when suggest has no replacement', () => {
      const action: GuardrailAction = { type: 'suggest', replacement: '' }
      const result = resolveAction(action, fullCapabilities, { matched: 'dangerous-cmd' })
      expect(result).toEqual({
        type: 'block',
        message: 'Blocked: `dangerous-cmd` — no Replacement available.',
        fallbackReason:
          '`suggest` action has no `replacement` available. Falling back to a `block`.',
      })
    })
  })

  describe('run action', () => {
    it('returns run action when capability available', () => {
      const action: GuardrailAction = {
        type: 'run',
        replacement: 'safe-command',
        message: 'Running: {replacement}',
      }
      const result = resolveAction(action, fullCapabilities, { matched: 'anything' })
      expect(result).toEqual({
        type: 'run',
        replacement: 'safe-command',
        message: 'Running: safe-command',
      })
    })

    it('falls back to suggest when run capability unavailable', () => {
      const action: GuardrailAction = {
        type: 'run',
        replacement: 'safe-cmd',
      }
      const result = resolveAction(action, limitedCapabilities, { matched: 'anything' })
      expect(result.type).toBe('suggest')
      if (result.type === 'suggest') {
        expect(result.replacement).toBe('safe-cmd')
      }
    })

    it('falls back through suggest to block when both capabilities unavailable', () => {
      const action: GuardrailAction = {
        type: 'run',
        replacement: 'safe-cmd',
      }
      const result = resolveAction(action, noSuggest, { matched: 'dangerous-cmd' })
      expect(result.type).toBe('block')
    })
  })

  describe('redact action', () => {
    it('returns redact action when capability available', () => {
      const action: GuardrailAction = { type: 'redact', replacement: '[REDACTED]' }
      const result = resolveAction(action, fullCapabilities, ctx)
      expect(result).toEqual({ type: 'redact', replacement: '[REDACTED]' })
    })

    it('falls back to block when redact capability unavailable', () => {
      const action: GuardrailAction = { type: 'redact', replacement: '[REDACTED]' }
      const result = resolveAction(action, limitedCapabilities, { matched: 'secret' })
      expect(result.type).toBe('block')
    })
  })

  describe('confirm action', () => {
    it('returns confirm action when capability available', () => {
      const action: GuardrailAction = {
        type: 'confirm',
        message: 'Proceed with {matched}?',
        fallback: { type: 'block', message: 'User cancelled' },
      }
      const result = resolveAction(action, fullCapabilities, { matched: 'dangerous' })
      expect(result).toEqual({
        type: 'confirm',
        message: 'Proceed with dangerous?',
        fallback: { type: 'block', message: 'User cancelled' },
      })
    })

    it('falls back to suggest when confirm capability unavailable', () => {
      const action: GuardrailAction = {
        type: 'confirm',
        message: 'Confirm: {matched}',
        fallback: { type: 'suggest', replacement: 'safe-cmd' },
      }
      const result = resolveAction(action, limitedCapabilities, { matched: 'test' })
      expect(result.type).toBe('suggest')
    })

    it('falls back to block when confirm unavailable and no fallback defined, even when suggest is available (ADR-002)', () => {
      const action: GuardrailAction = {
        type: 'confirm',
        message: 'Confirm: {matched}',
      }
      const suggestOnly: HarnessCapabilities = {
        block: true,
        suggest: true,
        run: false,
        redact: false,
        confirm: false,
      }
      const result = resolveAction(action, suggestOnly, {
        matched: 'test',
        replacement: 'safe-cmd',
      })
      expect(result.type).toBe('block')
    })

    it('reaches the terminal fallback of a chain at the maximum depth', () => {
      const result = resolveAction(nestedConfirmChain(MAX_FALLBACK_DEPTH), limitedCapabilities, {
        matched: 'test',
      })
      expect(result).toEqual({ type: 'block', message: 'terminal fallback' })
    })

    it('blocks a fallback chain nested past the maximum depth', () => {
      const result = resolveAction(
        nestedConfirmChain(MAX_FALLBACK_DEPTH + 1),
        limitedCapabilities,
        { matched: 'test' }
      )
      expect(result.type).toBe('block')
      if (result.type === 'block') {
        expect(result.fallbackReason).toContain('maximum depth')
      }
    })

    it('stops walking a self-referencing fallback chain and blocks', () => {
      const cyclic = { type: 'confirm', message: 'Confirm: {matched}' } as Extract<
        GuardrailAction,
        { type: 'confirm' }
      >
      ;(cyclic as { fallback?: GuardrailAction }).fallback = cyclic
      const result = resolveAction(cyclic, limitedCapabilities, { matched: 'test' })
      expect(result.type).toBe('block')
      if (result.type === 'block') {
        expect(result.fallbackReason).toContain('maximum depth')
      }
    })

    it('falls back to block when confirm capability unavailable, no fallback, and no suggest', () => {
      const action: GuardrailAction = {
        type: 'confirm',
        message: 'Confirm: {matched}',
      }
      const noConfirmNoSuggest: HarnessCapabilities = {
        block: true,
        suggest: false,
        run: false,
        redact: false,
        confirm: false,
      }
      const result = resolveAction(action, noConfirmNoSuggest, { matched: 'test' })
      expect(result.type).toBe('block')
    })
  })

  describe('fallback chain', () => {
    it('run → suggest → block', () => {
      const action: GuardrailAction = { type: 'run', replacement: 'safe' }
      const noRunNoSuggest: HarnessCapabilities = {
        block: true,
        suggest: false,
        run: false,
        redact: false,
        confirm: false,
      }
      const result = resolveAction(action, noRunNoSuggest, { matched: 'dangerous-cmd' })
      expect(result.type).toBe('block')
    })

    it('confirm → block', () => {
      const action: GuardrailAction = { type: 'confirm', message: 'Confirm?' }
      const noConfirmNoSuggest: HarnessCapabilities = {
        block: true,
        suggest: false,
        run: false,
        redact: false,
        confirm: false,
      }
      const result = resolveAction(action, noConfirmNoSuggest, { matched: 'dangerous-cmd' })
      expect(result.type).toBe('block')
    })
  })

  describe('fallbackReason', () => {
    it('attaches fallbackReason when suggest falls back to block', () => {
      const action: GuardrailAction = { type: 'suggest', replacement: 'safe-cmd' }
      const result = resolveAction(action, noSuggest, { matched: 'dangerous' })
      expect(result.type).toBe('block')
      if (result.type === 'block') {
        expect(result.fallbackReason).toBe(
          '`suggest` capability is not supported by your harness. Falling back to a `block`.'
        )
      }
    })

    it('attaches fallbackReason when run falls back to block (neither capability available)', () => {
      const action: GuardrailAction = { type: 'run', replacement: 'safe-cmd' }
      const noRunNoSuggest: HarnessCapabilities = {
        block: true,
        suggest: false,
        run: false,
        redact: false,
        confirm: false,
      }
      const result = resolveAction(action, noRunNoSuggest, { matched: 'dangerous-cmd' })
      expect(result.type).toBe('block')
      if (result.type === 'block') {
        expect(result.fallbackReason).toBe(
          'Neither `run` nor `suggest` capabilities are supported by your harness. Falling back to a `block`.'
        )
      }
    })

    it('attaches fallbackReason when redact falls back to block', () => {
      const action: GuardrailAction = { type: 'redact', replacement: '[REDACTED]' }
      const result = resolveAction(action, limitedCapabilities, { matched: 'secret' })
      expect(result.type).toBe('block')
      if (result.type === 'block') {
        expect(result.fallbackReason).toBe(
          '`redact` capability is not supported by your harness. Falling back to a `block`.'
        )
      }
    })

    it('attaches fallbackReason when confirm falls back to block (no fallback, no suggest)', () => {
      const action: GuardrailAction = { type: 'confirm', message: 'Confirm?' }
      const noConfirmNoSuggest: HarnessCapabilities = {
        block: true,
        suggest: false,
        run: false,
        redact: false,
        confirm: false,
      }
      const result = resolveAction(action, noConfirmNoSuggest, { matched: 'dangerous-cmd' })
      expect(result.type).toBe('block')
      if (result.type === 'block') {
        expect(result.fallbackReason).toBe(
          '`confirm` capability is not supported and no `fallback` action was defined. Falling back to a `block`.'
        )
      }
    })

    it("preserves the rule author's message in the block message field", () => {
      const action: GuardrailAction = {
        type: 'suggest',
        replacement: 'safe-cmd',
        message: 'Use safe-cmd instead',
      }
      const result = resolveAction(action, noSuggest, { matched: 'dangerous' })
      expect(result.type).toBe('block')
      if (result.type === 'block') {
        expect(result.message).toBe('Blocked: Use safe-cmd instead')
        expect(result.fallbackReason).toContain('`suggest` capability')
      }
    })

    it('uses the matched value in the block message when the rule author provided no message', () => {
      const action: GuardrailAction = { type: 'suggest', replacement: 'safe-cmd' }
      const result = resolveAction(action, noSuggest, { matched: 'dangerous-cmd' })
      expect(result.type).toBe('block')
      if (result.type === 'block') {
        expect(result.message).toBe('Blocked: `dangerous-cmd`')
        expect(result.fallbackReason).toBeDefined()
      }
    })

    it('does not attach fallbackReason to a plain block action (no fallback occurred)', () => {
      const action: GuardrailAction = { type: 'block', message: 'Plain block' }
      const result = resolveAction(action, fullCapabilities, { matched: 'anything' })
      expect(result).toEqual({ type: 'block', message: 'Plain block' })
    })
  })

  describe('template interpolation', () => {
    it('interpolates {matched} placeholder', () => {
      const action: GuardrailAction = { type: 'block', message: 'Blocked: {matched}' }
      const result = resolveAction(action, fullCapabilities, { matched: 'sops --decrypt' })
      expect(result).toEqual({ type: 'block', message: 'Blocked: sops --decrypt' })
    })

    it('interpolates {replacement} placeholder', () => {
      const action: GuardrailAction = {
        type: 'suggest',
        replacement: 'safe-cmd',
        message: 'Use {replacement}',
      }
      const result = resolveAction(action, fullCapabilities, { matched: 'anything' })
      expect(result).toEqual({ type: 'suggest', replacement: 'safe-cmd', message: 'Use safe-cmd' })
    })

    it('interpolates multiple {matched} occurrences', () => {
      const action: GuardrailAction = {
        type: 'block',
        message: 'Blocked {matched} because {matched} is dangerous',
      }
      const result = resolveAction(action, fullCapabilities, { matched: 'sops' })
      expect(result).toEqual({
        type: 'block',
        message: 'Blocked sops because sops is dangerous',
      })
    })
  })
})
