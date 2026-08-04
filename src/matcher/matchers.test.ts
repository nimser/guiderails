import { describe, it, expect, beforeEach } from 'vitest'
import { matchesMatcher, MAX_MATCH_INPUT_LENGTH } from './matchers'
import { PredicateRegistry } from '../core/predicate-registry'
import type { ToolCallContext } from '../core/types'

describe('matchesMatcher — bash-command', () => {
  let predicateRegistry: PredicateRegistry

  beforeEach(() => {
    predicateRegistry = new PredicateRegistry()
  })

  it('returns true when pattern matches command', () => {
    const matcher = { type: 'bash-command' as const, pattern: /sops/i }
    const ctx: ToolCallContext = { toolName: 'bash', command: 'sops --decrypt file.yaml' }
    expect(matchesMatcher(matcher, ctx, predicateRegistry)).toBe(true)
  })

  it('returns false when pattern does not match command', () => {
    const matcher = { type: 'bash-command' as const, pattern: /sops/i }
    const ctx: ToolCallContext = { toolName: 'bash', command: 'ls -la' }
    expect(matchesMatcher(matcher, ctx, predicateRegistry)).toBe(false)
  })

  it('returns false for non-bash tool', () => {
    const matcher = { type: 'bash-command' as const, pattern: /test/i }
    const ctx: ToolCallContext = { toolName: 'read', filePath: '/tmp' }
    expect(matchesMatcher(matcher, ctx, predicateRegistry)).toBe(false)
  })

  it('returns false when command is missing', () => {
    const matcher = { type: 'bash-command' as const, pattern: /test/i }
    const ctx: ToolCallContext = { toolName: 'bash' }
    expect(matchesMatcher(matcher, ctx, predicateRegistry)).toBe(false)
  })

  it('returns false when command exceeds MAX_MATCH_INPUT_LENGTH (the engine blocks it)', () => {
    const matcher = { type: 'bash-command' as const, pattern: /a/ }
    const ctx: ToolCallContext = {
      toolName: 'bash',
      command: 'a'.repeat(MAX_MATCH_INPUT_LENGTH + 1),
    }
    expect(matchesMatcher(matcher, ctx, predicateRegistry)).toBe(false)
  })

  it('still matches when command equals MAX_MATCH_INPUT_LENGTH', () => {
    const matcher = { type: 'bash-command' as const, pattern: /a/ }
    const ctx: ToolCallContext = {
      toolName: 'bash',
      command: 'a'.repeat(MAX_MATCH_INPUT_LENGTH),
    }
    expect(matchesMatcher(matcher, ctx, predicateRegistry)).toBe(true)
  })

  it('resets lastIndex for global regex', () => {
    const pattern = /sops/g
    const matcher = { type: 'bash-command' as const, pattern }
    const ctx: ToolCallContext = { toolName: 'bash', command: 'sops --decrypt' }

    // First match advances lastIndex
    pattern.test('sops --decrypt')
    expect(pattern.lastIndex).toBeGreaterThan(0)

    // matchesMatcher should still match (defends against shared state)
    expect(matchesMatcher(matcher, ctx, predicateRegistry)).toBe(true)
  })

  it('resets lastIndex for sticky regex', () => {
    const pattern = /sops/y
    const matcher = { type: 'bash-command' as const, pattern }
    const ctx: ToolCallContext = { toolName: 'bash', command: 'sops --decrypt' }

    // First match advances lastIndex
    pattern.test('sops --decrypt')
    expect(pattern.lastIndex).toBeGreaterThan(0)

    // matchesMatcher should still match (defends against shared state)
    expect(matchesMatcher(matcher, ctx, predicateRegistry)).toBe(true)
  })
})

describe('matchesMatcher — file-path', () => {
  let predicateRegistry: PredicateRegistry

  beforeEach(() => {
    predicateRegistry = new PredicateRegistry()
  })

  it('returns true when pattern matches filePath', () => {
    const matcher = { type: 'file-path' as const, pattern: /\.env$/i }
    const ctx: ToolCallContext = { toolName: 'read', filePath: '/home/user/.env' }
    expect(matchesMatcher(matcher, ctx, predicateRegistry)).toBe(true)
  })

  it('returns false when pattern does not match filePath', () => {
    const matcher = { type: 'file-path' as const, pattern: /\.env$/i }
    const ctx: ToolCallContext = { toolName: 'read', filePath: '/home/user/config.json' }
    expect(matchesMatcher(matcher, ctx, predicateRegistry)).toBe(false)
  })

  it('returns false when filePath is missing', () => {
    const matcher = { type: 'file-path' as const, pattern: /test/i }
    const ctx: ToolCallContext = { toolName: 'bash', command: 'ls' }
    expect(matchesMatcher(matcher, ctx, predicateRegistry)).toBe(false)
  })

  it('works with write tool', () => {
    const matcher = { type: 'file-path' as const, pattern: /\.env$/i }
    const ctx: ToolCallContext = { toolName: 'write', filePath: '/tmp/.env' }
    expect(matchesMatcher(matcher, ctx, predicateRegistry)).toBe(true)
  })

  it('returns false when filePath exceeds MAX_MATCH_INPUT_LENGTH (the engine blocks it)', () => {
    const matcher = { type: 'file-path' as const, pattern: /a/ }
    const ctx: ToolCallContext = {
      toolName: 'read',
      filePath: '/' + 'a'.repeat(MAX_MATCH_INPUT_LENGTH),
    }
    expect(matchesMatcher(matcher, ctx, predicateRegistry)).toBe(false)
  })

  it('still matches when filePath equals MAX_MATCH_INPUT_LENGTH', () => {
    const matcher = { type: 'file-path' as const, pattern: /a/ }
    const ctx: ToolCallContext = {
      toolName: 'read',
      filePath: '/' + 'a'.repeat(MAX_MATCH_INPUT_LENGTH - 1),
    }
    expect(matchesMatcher(matcher, ctx, predicateRegistry)).toBe(true)
  })

  it('resets lastIndex for global regex', () => {
    const pattern = /\.env$/g
    const matcher = { type: 'file-path' as const, pattern }
    const ctx: ToolCallContext = { toolName: 'read', filePath: '/home/user/.env' }

    // First match advances lastIndex
    pattern.test('/home/user/.env')
    expect(pattern.lastIndex).toBeGreaterThan(0)

    // matchesMatcher should still match (resets lastIndex internally)
    expect(matchesMatcher(matcher, ctx, predicateRegistry)).toBe(true)
  })

  it('resets lastIndex for sticky regex', () => {
    const anchored = /^\/home/y
    const anchoredMatcher = { type: 'file-path' as const, pattern: anchored }
    const ctx: ToolCallContext = { toolName: 'read', filePath: '/home/user/.env' }

    // Advance lastIndex by testing against a matching substring
    anchored.test('/home/user/.env')
    expect(anchored.lastIndex).toBeGreaterThan(0)

    // matchesMatcher resets lastIndex, so sticky starts from 0 again
    expect(matchesMatcher(anchoredMatcher, ctx, predicateRegistry)).toBe(true)
  })
})

describe('matchesMatcher — predicate', () => {
  let predicateRegistry: PredicateRegistry

  beforeEach(() => {
    predicateRegistry = new PredicateRegistry()
  })

  it('resolves predicateName and calls function', () => {
    predicateRegistry.register('is-bash', (ctx) => ctx.toolName === 'bash')
    const matcher = { type: 'predicate' as const, predicateName: 'is-bash' }
    const ctx: ToolCallContext = { toolName: 'bash', command: 'ls' }
    expect(matchesMatcher(matcher, ctx, predicateRegistry)).toBe(true)
  })

  it('returns false when predicate returns false', () => {
    predicateRegistry.register('always-false', () => false)
    const matcher = { type: 'predicate' as const, predicateName: 'always-false' }
    const ctx: ToolCallContext = { toolName: 'bash', command: 'ls' }
    expect(matchesMatcher(matcher, ctx, predicateRegistry)).toBe(false)
  })

  it('returns false when predicate returns true and toolName does not match', () => {
    predicateRegistry.register('is-write', (ctx) => ctx.toolName === 'write')
    const matcher = { type: 'predicate' as const, predicateName: 'is-write' }
    const ctx: ToolCallContext = { toolName: 'bash', command: 'ls' }
    expect(matchesMatcher(matcher, ctx, predicateRegistry)).toBe(false)
  })

  it('throws when predicateName is not registered', () => {
    const matcher = { type: 'predicate' as const, predicateName: 'unknown' }
    const ctx: ToolCallContext = { toolName: 'bash', command: 'ls' }
    expect(() => matchesMatcher(matcher, ctx, predicateRegistry)).toThrow(
      'Predicate "unknown" is not registered'
    )
  })
})
