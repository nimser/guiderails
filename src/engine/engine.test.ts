import { describe, expect, it, beforeEach } from 'vitest'
import { matchAndResolve, processMatch } from './engine.js'
import { StatsTracker } from './stats-tracker.js'
import { PredicateRegistry } from '../core/predicate-registry.js'
import { MAX_MATCH_INPUT_LENGTH } from '../matcher/matchers.js'
import type { ToolCallContext, RulePack, HarnessCapabilities } from '../core/types.js'

const fullCapabilities: HarnessCapabilities = {
  block: true,
  suggest: true,
  run: true,
  redact: true,
  confirm: true,
}

function makeDeps() {
  return { registry: new PredicateRegistry(), stats: new StatsTracker() }
}

describe('matchAndResolve', () => {
  let registry: PredicateRegistry
  let stats: StatsTracker

  beforeEach(() => {
    ;({ registry, stats } = makeDeps())
  })

  it('returns null when no command and no filePath (early exit)', () => {
    const ctx: ToolCallContext = { toolName: 'custom-tool' }
    const packs: RulePack[] = []
    const result = matchAndResolve(ctx, packs, fullCapabilities, registry, stats)
    expect(result).toBeNull()
  })

  it('fails closed (block) when bash context is missing required command', () => {
    const ctx: ToolCallContext = { toolName: 'bash' } as ToolCallContext
    const packs: RulePack[] = []
    const result = matchAndResolve(ctx, packs, fullCapabilities, registry, stats)
    expect(result).toEqual({
      type: 'block',
      message:
        'Blocked malformed bash tool call: missing required fields. Your adapter may need updating or your harness may be compromised.',
    })
  })

  it('fails closed (block) when read context is missing required filePath', () => {
    const ctx = { toolName: 'read' } as ToolCallContext
    const packs: RulePack[] = []
    const result = matchAndResolve(ctx, packs, fullCapabilities, registry, stats)
    expect(result).toEqual({
      type: 'block',
      message:
        'Blocked malformed read tool call: missing required fields. Your adapter may need updating or your harness may be compromised.',
    })
  })

  it('fails closed (block) when write context is missing required filePath', () => {
    const ctx = { toolName: 'write' } as ToolCallContext
    const packs: RulePack[] = []
    const result = matchAndResolve(ctx, packs, fullCapabilities, registry, stats)
    expect(result).toEqual({
      type: 'block',
      message:
        'Blocked malformed write tool call: missing required fields. Your adapter may need updating or your harness may be compromised.',
    })
  })

  it('returns null when no rules match', () => {
    const ctx: ToolCallContext = { toolName: 'bash', command: 'ls -la' }
    const packs: RulePack[] = [
      {
        id: 'test-pack',
        name: 'Test Pack',
        description: 'Test',
        rules: [
          {
            id: 'test-rule',
            title: 'Test Rule',
            description: 'Matches sops',
            phase: 'before-tool',
            match: { type: 'bash-command', pattern: /sops/i },
            defaultAction: { type: 'block', message: 'Blocked' },
          },
        ],
      },
    ]
    const result = matchAndResolve(ctx, packs, fullCapabilities, registry, stats)
    expect(result).toBeNull()
  })

  it('returns resolved action when rule matches', () => {
    const ctx: ToolCallContext = { toolName: 'bash', command: 'sops --decrypt secret.yaml' }
    const packs: RulePack[] = [
      {
        id: 'test-pack',
        name: 'Test Pack',
        description: 'Test',
        rules: [
          {
            id: 'sops-block',
            title: 'SOPS Block',
            description: 'Block sops commands',
            phase: 'before-tool',
            match: { type: 'bash-command', pattern: /sops/i },
            defaultAction: { type: 'block', message: 'Blocked: {matched}' },
          },
        ],
      },
    ]
    const result = matchAndResolve(ctx, packs, fullCapabilities, registry, stats)
    expect(result).toBeDefined()
    expect(result?.type).toBe('block')
    if (result?.type === 'block') {
      expect(result.message).toContain('sops')
    }
  })

  it('returns first match when multiple rules match (priority order)', () => {
    const ctx: ToolCallContext = { toolName: 'bash', command: 'sops --decrypt secret.yaml' }
    const packs: RulePack[] = [
      {
        id: 'test-pack',
        name: 'Test Pack',
        description: 'Test',
        rules: [
          {
            id: 'first-match',
            title: 'First Match',
            description: 'Should match first',
            phase: 'before-tool',
            match: { type: 'bash-command', pattern: /sops/i },
            defaultAction: { type: 'block', message: 'First' },
          },
          {
            id: 'second-match',
            title: 'Second Match',
            description: 'Should not match',
            phase: 'before-tool',
            match: { type: 'bash-command', pattern: /sops/i },
            defaultAction: { type: 'block', message: 'Second' },
          },
        ],
      },
    ]
    const result = matchAndResolve(ctx, packs, fullCapabilities, registry, stats)
    expect(result?.type).toBe('block')
    if (result?.type === 'block') {
      expect(result.message).toBe('First')
    }
  })

  it('interpolates {matched} in action message', () => {
    const ctx: ToolCallContext = { toolName: 'bash', command: 'rm -rf /' }
    const packs: RulePack[] = [
      {
        id: 'test-pack',
        name: 'Test Pack',
        description: 'Test',
        rules: [
          {
            id: 'rm-block',
            title: 'RM Block',
            description: 'Block rm',
            phase: 'before-tool',
            match: { type: 'bash-command', pattern: /rm\s/ },
            defaultAction: { type: 'block', message: 'Blocked: {matched}' },
          },
        ],
      },
    ]
    const result = matchAndResolve(ctx, packs, fullCapabilities, registry, stats)
    expect(result?.type).toBe('block')
    if (result?.type === 'block') {
      expect(result.message).toBe('Blocked: rm -rf /')
    }
  })

  it('matches file-path rules', () => {
    const ctx: ToolCallContext = { toolName: 'read', filePath: '/home/user/.env' }
    const packs: RulePack[] = [
      {
        id: 'test-pack',
        name: 'Test Pack',
        description: 'Test',
        rules: [
          {
            id: 'env-block',
            title: 'ENV Block',
            description: 'Block .env files',
            phase: 'before-tool',
            match: { type: 'file-path', pattern: /\.env$/i },
            defaultAction: { type: 'block', message: 'Blocked: {matched}' },
          },
        ],
      },
    ]
    const result = matchAndResolve(ctx, packs, fullCapabilities, registry, stats)
    expect(result?.type).toBe('block')
    if (result?.type === 'block') {
      expect(result.message).toBe('Blocked: /home/user/.env')
    }
  })

  it('handles multiple rule packs', () => {
    const ctx: ToolCallContext = { toolName: 'bash', command: 'sops --decrypt secret.yaml' }
    const packs: RulePack[] = [
      {
        id: 'pack-1',
        name: 'Pack 1',
        description: 'First pack',
        rules: [],
      },
      {
        id: 'pack-2',
        name: 'Pack 2',
        description: 'Second pack',
        rules: [
          {
            id: 'sops-block',
            title: 'SOPS Block',
            description: 'Block sops',
            phase: 'before-tool',
            match: { type: 'bash-command', pattern: /sops/i },
            defaultAction: { type: 'block', message: 'Blocked' },
          },
        ],
      },
    ]
    const result = matchAndResolve(ctx, packs, fullCapabilities, registry, stats)
    expect(result?.type).toBe('block')
  })

  it('applies capability fallback (run → suggest)', () => {
    const ctx: ToolCallContext = { toolName: 'bash', command: 'sops --decrypt secret.yaml' }
    const packs: RulePack[] = [
      {
        id: 'test-pack',
        name: 'Test Pack',
        description: 'Test',
        rules: [
          {
            id: 'sops-run',
            title: 'SOPS Run',
            description: 'Run sops',
            phase: 'before-tool',
            match: { type: 'bash-command', pattern: /sops/i },
            defaultAction: { type: 'run', replacement: 'safe-cmd', message: 'Running' },
          },
        ],
      },
    ]
    const noRun: HarnessCapabilities = {
      block: true,
      suggest: true,
      run: false,
      redact: false,
      confirm: false,
    }
    const result = matchAndResolve(ctx, packs, noRun, registry, stats)
    expect(result?.type).toBe('suggest')
  })
})

describe('matchAndResolve — oversized input', () => {
  let registry: PredicateRegistry
  let stats: StatsTracker

  beforeEach(() => {
    ;({ registry, stats } = makeDeps())
  })

  function packWithLeadingAllowRule(): RulePack[] {
    return [
      {
        id: 'test-pack',
        name: 'Test Pack',
        description: 'Test',
        rules: [
          {
            id: 'allow-everything',
            title: 'Allow Everything',
            description: 'Ordered before any block rule',
            phase: 'before-tool',
            match: { type: 'bash-command', pattern: /.*/ },
            defaultAction: { type: 'allow' },
          },
          {
            id: 'allow-every-path',
            title: 'Allow Every Path',
            description: 'Ordered before any block rule',
            phase: 'before-tool',
            match: { type: 'file-path', pattern: /.*/ },
            defaultAction: { type: 'allow' },
          },
        ],
      },
    ]
  }

  it('blocks an oversized command even when an allow rule is ordered first', () => {
    const ctx: ToolCallContext = {
      toolName: 'bash',
      command: 'a'.repeat(MAX_MATCH_INPUT_LENGTH + 1),
    }
    const result = matchAndResolve(
      ctx,
      packWithLeadingAllowRule(),
      fullCapabilities,
      registry,
      stats
    )
    expect(result?.type).toBe('block')
  })

  it('blocks an oversized file path even when an allow rule is ordered first', () => {
    const ctx: ToolCallContext = {
      toolName: 'read',
      filePath: '/' + 'a'.repeat(MAX_MATCH_INPUT_LENGTH),
    }
    const result = matchAndResolve(
      ctx,
      packWithLeadingAllowRule(),
      fullCapabilities,
      registry,
      stats
    )
    expect(result?.type).toBe('block')
  })

  it('blocks an oversized command with no rule packs loaded at all', () => {
    const ctx: ToolCallContext = {
      toolName: 'bash',
      command: 'a'.repeat(MAX_MATCH_INPUT_LENGTH + 1),
    }
    const result = matchAndResolve(ctx, [], fullCapabilities, registry, stats)
    expect(result?.type).toBe('block')
  })

  it('emits a fallback-triggered event for oversized input', () => {
    const ctx: ToolCallContext = {
      toolName: 'bash',
      command: 'a'.repeat(MAX_MATCH_INPUT_LENGTH + 1),
    }
    const result = processMatch(ctx, [], fullCapabilities, registry, stats)
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({
      type: 'fallback-triggered',
      from: 'allow',
      to: 'block',
    })
  })

  it('evaluates rules normally at exactly MAX_MATCH_INPUT_LENGTH', () => {
    const ctx: ToolCallContext = {
      toolName: 'bash',
      command: 'a'.repeat(MAX_MATCH_INPUT_LENGTH),
    }
    const result = matchAndResolve(
      ctx,
      packWithLeadingAllowRule(),
      fullCapabilities,
      registry,
      stats
    )
    expect(result?.type).toBe('allow')
  })
})

describe('matchAndResolve — phase handling', () => {
  let registry: PredicateRegistry
  let stats: StatsTracker

  beforeEach(() => {
    ;({ registry, stats } = makeDeps())
  })

  it('skips after-tool rules in before-tool evaluation', () => {
    const ctx: ToolCallContext = { toolName: 'bash', command: 'sops --decrypt secret.yaml' }
    const packs: RulePack[] = [
      {
        id: 'test-pack',
        name: 'Test Pack',
        description: 'Test',
        rules: [
          {
            id: 'after-only',
            title: 'After Only',
            description: 'after-tool redact',
            phase: 'after-tool',
            match: { type: 'bash-command', pattern: /sops/i },
            defaultAction: { type: 'redact', replacement: 'safe-cmd' },
          },
        ],
      },
    ]
    const result = matchAndResolve(ctx, packs, fullCapabilities, registry, stats)
    expect(result).toBeNull()
  })
})

describe('matchAndResolve — split commands', () => {
  let registry: PredicateRegistry
  let stats: StatsTracker

  beforeEach(() => {
    ;({ registry, stats } = makeDeps())
  })

  it('matches only the second sub-command in a split', () => {
    const ctx: ToolCallContext = { toolName: 'bash', command: 'ls; sops --decrypt secret.yaml' }
    const packs: RulePack[] = [
      {
        id: 'test-pack',
        name: 'Test Pack',
        description: 'Test',
        rules: [
          {
            id: 'sops-block',
            title: 'SOPS Block',
            description: 'Block sops',
            phase: 'before-tool',
            match: { type: 'bash-command', pattern: /sops/ },
            defaultAction: { type: 'block', message: 'Blocked: {matched}' },
          },
        ],
      },
    ]
    const result = matchAndResolve(ctx, packs, fullCapabilities, registry, stats)
    expect(result?.type).toBe('block')
    if (result?.type === 'block') {
      expect(result.message).toBe('Blocked: sops --decrypt secret.yaml')
    }
  })
})

describe('matchAndResolve — predicate matcher', () => {
  let registry: PredicateRegistry
  let stats: StatsTracker

  beforeEach(() => {
    ;({ registry, stats } = makeDeps())
  })

  it('matches via predicate matcher end-to-end', () => {
    registry.register('is-dangerous-rm', (ctx) => {
      return ctx.toolName === 'bash' && !!ctx.command && ctx.command.includes('rm -rf')
    })

    const ctx: ToolCallContext = { toolName: 'bash', command: 'rm -rf /' }
    const packs: RulePack[] = [
      {
        id: 'test-pack',
        name: 'Test Pack',
        description: 'Test',
        rules: [
          {
            id: 'rm-block',
            title: 'RM Block',
            description: 'Block rm -rf',
            phase: 'before-tool',
            match: { type: 'predicate', predicateName: 'is-dangerous-rm' },
            defaultAction: { type: 'block', message: 'Blocked: {matched}' },
          },
        ],
      },
    ]
    const result = matchAndResolve(ctx, packs, fullCapabilities, registry, stats)
    expect(result?.type).toBe('block')
    if (result?.type === 'block') {
      expect(result.message).toBe('Blocked: rm -rf /')
    }
  })
})

describe('processMatch — domain events', () => {
  let registry: PredicateRegistry
  let stats: StatsTracker

  beforeEach(() => {
    ;({ registry, stats } = makeDeps())
  })

  it('emits rule-matched event when a rule fires', () => {
    const ctx: ToolCallContext = { toolName: 'bash', command: 'sops --decrypt secret.yaml' }
    const packs: RulePack[] = [
      {
        id: 'test-pack',
        name: 'Test Pack',
        description: 'Test',
        rules: [
          {
            id: 'sops-block',
            title: 'SOPS Block',
            description: 'Block sops',
            phase: 'before-tool',
            match: { type: 'bash-command', pattern: /sops/i },
            defaultAction: { type: 'block', message: 'Blocked: {matched}' },
          },
        ],
      },
    ]
    const result = processMatch(ctx, packs, fullCapabilities, registry, stats)
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toEqual({
      type: 'rule-matched',
      ruleId: 'sops-block',
      matched: 'sops --decrypt secret.yaml',
    })
  })

  it('emits no events when no rule matches', () => {
    const ctx: ToolCallContext = { toolName: 'bash', command: 'ls -la' }
    const packs: RulePack[] = [
      {
        id: 'test-pack',
        name: 'Test Pack',
        description: 'Test',
        rules: [
          {
            id: 'sops-block',
            title: 'SOPS Block',
            description: 'Block sops',
            phase: 'before-tool',
            match: { type: 'bash-command', pattern: /sops/i },
            defaultAction: { type: 'block', message: 'Blocked' },
          },
        ],
      },
    ]
    const result = processMatch(ctx, packs, fullCapabilities, registry, stats)
    expect(result.events).toHaveLength(0)
    expect(result.action).toBeNull()
  })

  it('emits fallback-triggered when run falls back to suggest', () => {
    const ctx: ToolCallContext = { toolName: 'bash', command: 'sops --decrypt secret.yaml' }
    const packs: RulePack[] = [
      {
        id: 'test-pack',
        name: 'Test Pack',
        description: 'Test',
        rules: [
          {
            id: 'sops-run',
            title: 'SOPS Run',
            description: 'Run sops',
            phase: 'before-tool',
            match: { type: 'bash-command', pattern: /sops/i },
            defaultAction: { type: 'run', replacement: 'safe-cmd', message: 'Running' },
          },
        ],
      },
    ]
    const noRun: HarnessCapabilities = {
      block: true,
      suggest: true,
      run: false,
      redact: false,
      confirm: false,
    }
    const result = processMatch(ctx, packs, noRun, registry, stats)
    expect(result.action?.type).toBe('suggest')
    expect(result.events).toHaveLength(2)
    expect(result.events[0].type).toBe('rule-matched')
    expect(result.events[1]).toEqual({
      type: 'fallback-triggered',
      from: 'run',
      to: 'suggest',
      reason: expect.stringContaining('run'),
    })
  })

  it('emits fallback-triggered when suggest has no replacement and caps lack suggest', () => {
    const ctx: ToolCallContext = { toolName: 'bash', command: 'sops --decrypt secret.yaml' }
    const packs: RulePack[] = [
      {
        id: 'test-pack',
        name: 'Test Pack',
        description: 'Test',
        rules: [
          {
            id: 'sops-suggest',
            title: 'SOPS Suggest',
            description: 'Suggest alternative',
            phase: 'before-tool',
            match: { type: 'bash-command', pattern: /sops/i },
            defaultAction: { type: 'suggest', replacement: 'safe-cmd', message: 'Try this' },
          },
        ],
      },
    ]
    const noSuggest: HarnessCapabilities = {
      block: true,
      suggest: false,
      run: false,
      redact: false,
      confirm: false,
    }
    const result = processMatch(ctx, packs, noSuggest, registry, stats)
    expect(result.action?.type).toBe('block')
    expect(result.events).toHaveLength(2)
    expect(result.events[1]).toEqual({
      type: 'fallback-triggered',
      from: 'suggest',
      to: 'block',
      reason: expect.stringContaining('suggest'),
    })
  })

  it('emits fallback-triggered when run falls all the way to block', () => {
    const ctx: ToolCallContext = { toolName: 'bash', command: 'sops --decrypt secret.yaml' }
    const packs: RulePack[] = [
      {
        id: 'test-pack',
        name: 'Test Pack',
        description: 'Test',
        rules: [
          {
            id: 'sops-run',
            title: 'SOPS Run',
            description: 'Run sops',
            phase: 'before-tool',
            match: { type: 'bash-command', pattern: /sops/i },
            defaultAction: { type: 'run', replacement: 'safe-cmd', message: 'Running' },
          },
        ],
      },
    ]
    const blockOnly: HarnessCapabilities = {
      block: true,
      suggest: false,
      run: false,
      redact: false,
      confirm: false,
    }
    const result = processMatch(ctx, packs, blockOnly, registry, stats)
    expect(result.action?.type).toBe('block')
    expect(result.events[1]).toEqual({
      type: 'fallback-triggered',
      from: 'run',
      to: 'block',
      reason: expect.any(String),
    })
  })

  it('does not emit fallback event when action resolves without fallback', () => {
    const ctx: ToolCallContext = { toolName: 'bash', command: 'sops --decrypt secret.yaml' }
    const packs: RulePack[] = [
      {
        id: 'test-pack',
        name: 'Test Pack',
        description: 'Test',
        rules: [
          {
            id: 'sops-block',
            title: 'SOPS Block',
            description: 'Block sops',
            phase: 'before-tool',
            match: { type: 'bash-command', pattern: /sops/i },
            defaultAction: { type: 'block', message: 'Blocked' },
          },
        ],
      },
    ]
    const result = processMatch(ctx, packs, fullCapabilities, registry, stats)
    expect(result.events).toHaveLength(1)
    expect(result.events[0].type).toBe('rule-matched')
  })

  it('emits fallback-triggered on malformed bash tool call', () => {
    const ctx = { toolName: 'bash' } as ToolCallContext
    const result = processMatch(ctx, [], fullCapabilities, registry, stats)
    expect(result.action?.type).toBe('block')
    expect(result.events).toHaveLength(1)
    expect(result.events[0].type).toBe('fallback-triggered')
    expect(result.events[0]).toMatchObject({
      from: 'allow',
      to: 'block',
    })
  })

  it('emits no events for unknown tool with no fields (early exit)', () => {
    const ctx: ToolCallContext = { toolName: 'custom-tool' }
    const result = processMatch(ctx, [], fullCapabilities, registry, stats)
    expect(result.action).toBeNull()
    expect(result.events).toHaveLength(0)
  })

  it('matchAndResolve returns only the action (processMatch returns trace too)', () => {
    const ctx: ToolCallContext = { toolName: 'bash', command: 'sops --decrypt secret.yaml' }
    const packs: RulePack[] = [
      {
        id: 'test-pack',
        name: 'Test Pack',
        description: 'Test',
        rules: [
          {
            id: 'sops-block',
            title: 'SOPS Block',
            description: 'Block sops',
            phase: 'before-tool',
            match: { type: 'bash-command', pattern: /sops/i },
            defaultAction: { type: 'block', message: 'Blocked' },
          },
        ],
      },
    ]
    const action = matchAndResolve(ctx, packs, fullCapabilities, registry, stats)
    expect(action?.type).toBe('block')
    // matchAndResolve returns GuardrailAction, not MatchResult
    expect(action).not.toHaveProperty('events')
  })
})

describe('matchAndResolve — stats tracking', () => {
  let registry: PredicateRegistry
  let stats: StatsTracker

  beforeEach(() => {
    ;({ registry, stats } = makeDeps())
  })

  it('tracks suggest actions in stats', () => {
    const ctx: ToolCallContext = { toolName: 'bash', command: 'sops --decrypt' }
    const packs: RulePack[] = [
      {
        id: 'test-pack',
        name: 'Test Pack',
        description: 'Test',
        rules: [
          {
            id: 'sops-suggest',
            title: 'SOPS Suggest',
            description: 'Suggest alternative',
            phase: 'before-tool',
            match: { type: 'bash-command', pattern: /sops/i },
            defaultAction: { type: 'suggest', replacement: 'safe-cmd', message: 'Try this' },
          },
        ],
      },
    ]
    matchAndResolve(ctx, packs, fullCapabilities, registry, stats)
    const snapshot = stats.getStats()
    expect(snapshot.checks).toBe(1)
    expect(snapshot.suggests).toBe(1)
    expect(snapshot.blocks).toBe(0)
  })

  it('tracks no-match as check without block or suggest', () => {
    const ctx: ToolCallContext = { toolName: 'bash', command: 'ls -la' }
    const packs: RulePack[] = [
      {
        id: 'test-pack',
        name: 'Test Pack',
        description: 'Test',
        rules: [
          {
            id: 'sops-block',
            title: 'SOPS Block',
            description: 'Block sops',
            phase: 'before-tool',
            match: { type: 'bash-command', pattern: /sops/i },
            defaultAction: { type: 'block', message: 'Blocked' },
          },
        ],
      },
    ]
    matchAndResolve(ctx, packs, fullCapabilities, registry, stats)
    const snapshot = stats.getStats()
    expect(snapshot.checks).toBe(1)
    expect(snapshot.blocks).toBe(0)
    expect(snapshot.suggests).toBe(0)
  })

  it('resetStats() on the local tracker clears counters', () => {
    const ctx: ToolCallContext = { toolName: 'bash', command: 'sops --decrypt' }
    const packs: RulePack[] = [
      {
        id: 'test-pack',
        name: 'Test Pack',
        description: 'Test',
        rules: [
          {
            id: 'sops-block',
            title: 'SOPS Block',
            description: 'Block sops',
            phase: 'before-tool',
            match: { type: 'bash-command', pattern: /sops/i },
            defaultAction: { type: 'block', message: 'Blocked' },
          },
        ],
      },
    ]
    matchAndResolve(ctx, packs, fullCapabilities, registry, stats)
    stats.resetStats()
    expect(stats.getStats()).toEqual({ checks: 0, blocks: 0, suggests: 0 })
  })
})

describe('matchAndResolve — engine isolation between calls', () => {
  it('two engines with independent registries do not share predicate registrations', () => {
    const { registry: r1, stats: s1 } = makeDeps()
    const { registry: r2, stats: s2 } = makeDeps()
    r1.register('only-on-r1', () => true)
    expect(r1.resolve('only-on-r1')).toBeDefined()
    expect(r2.resolve('only-on-r1')).toBeUndefined()
    // Both trackers start at zero
    expect(s1.getStats().checks).toBe(0)
    expect(s2.getStats().checks).toBe(0)
  })
})
