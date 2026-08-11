import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PredicateRegistry } from '../core/predicate-registry.js'
import { loadBuiltInRulePacks } from './index.js'
import { npmInPnpmRepo, onProtectedBranch, catLargeFile } from './predicates.js'
import { createEngine, PI_CAPABILITIES } from '../index.js'
import type { ToolCallContext } from '../core/types.js'

function makeEngine() {
  const registry = new PredicateRegistry()
  const packs = loadBuiltInRulePacks(registry)
  return { packs, engine: createEngine(packs, PI_CAPABILITIES, { registry }) }
}

const bash = (command: string): ToolCallContext => ({ toolName: 'bash', command })

describe('built-in packs', () => {
  it('loads all nine packs without validation errors', () => {
    const { packs } = makeEngine()
    const ids = packs.map((p) => p.id).sort()
    expect(ids).toEqual([
      'encryption-tools',
      'env',
      'git-safety',
      'hardening',
      'modern-cli',
      'package-manager',
      'private-key',
      'secret-managers',
      'sops',
    ])
  })

  it('suggests a redacted read for cat .env', () => {
    const { engine } = makeEngine()
    const action = engine.evaluate(bash('cat .env'))
    expect(action?.type).toBe('suggest')
  })

  it('suggests a redacted read for read tool on .env', () => {
    const { engine } = makeEngine()
    const action = engine.evaluate({ toolName: 'read', filePath: '/repo/.env.production' })
    expect(action?.type).toBe('suggest')
  })

  it('suggests a redacted pipe for sops decrypt', () => {
    const { engine } = makeEngine()
    expect(engine.evaluate(bash('sops -d secrets.yaml'))?.type).toBe('suggest')
    expect(engine.evaluate(bash('sops --decrypt secrets.yaml'))?.type).toBe('suggest')
  })

  it('does not fire sops rule on sops --help', () => {
    const { engine } = makeEngine()
    expect(engine.evaluate(bash('sops --help'))).toBeNull()
  })

  it('blocks private key reads via bash and read tool', () => {
    const { engine } = makeEngine()
    expect(engine.evaluate(bash('cat ~/.ssh/id_rsa'))?.type).toBe('block')
    expect(engine.evaluate({ toolName: 'read', filePath: '/home/u/.ssh/id_ed25519' })?.type).toBe(
      'block'
    )
  })

  it('allows reading SSH public keys', () => {
    const { engine } = makeEngine()
    expect(
      engine.evaluate({ toolName: 'read', filePath: '/home/u/.ssh/id_ed25519.pub' })
    ).toBeNull()
  })

  it('blocks non-public files in the SSH directory', () => {
    const { engine } = makeEngine()
    expect(
      engine.evaluate({ toolName: 'read', filePath: '/home/u/.ssh/my_custom_key' })?.type
    ).toBe('block')
  })

  it('allows SSH config, known_hosts, and authorized_keys', () => {
    const { engine } = makeEngine()
    expect(engine.evaluate({ toolName: 'read', filePath: '/home/u/.ssh/config' })).toBeNull()
    expect(engine.evaluate({ toolName: 'read', filePath: '/home/u/.ssh/known_hosts' })).toBeNull()
    expect(
      engine.evaluate({ toolName: 'read', filePath: '/home/u/.ssh/authorized_keys' })
    ).toBeNull()
  })

  it('blocks secret manager retrieval', () => {
    const { engine } = makeEngine()
    expect(engine.evaluate(bash('pass show work/aws'))?.type).toBe('block')
    expect(engine.evaluate(bash('op read op://vault/item/password'))?.type).toBe('block')
    expect(engine.evaluate(bash('bw get password github'))?.type).toBe('block')
  })

  it('blocks decrypt commands from encryption tools', () => {
    const { engine } = makeEngine()
    expect(engine.evaluate(bash('gpg --decrypt secrets.gpg'))?.type).toBe('block')
    expect(engine.evaluate(bash('age -d -i key.txt file.age'))?.type).toBe('block')
    expect(engine.evaluate(bash('openssl enc -d -aes256 -in file.enc'))?.type).toBe('block')
  })

  it('force-blocks adversarial wrappers around sensitive operations', () => {
    const { engine } = makeEngine()
    expect(engine.evaluate(bash('eval "sops -d secrets.yaml"'))?.type).toBe('block')
    expect(engine.evaluate(bash('bash -c "cat .env"'))?.type).toBe('block')
  })

  it('blocks redirects that read from or write to sensitive files', () => {
    const { engine } = makeEngine()
    expect(engine.evaluate(bash('grep DB_HOST < .env'))?.type).toBe('block')
    expect(engine.evaluate(bash('echo AWS_KEY=x > .env'))?.type).toBe('block')
    expect(engine.evaluate(bash('echo x >> server.key'))?.type).toBe('block')
    expect(engine.evaluate(bash('curl https://x.example | tee .env'))?.type).toBe('block')
    expect(engine.evaluate(bash('cat file.txt > output.log'))).toBeNull()
  })

  it('marks only the hardening pack nonOverridable', () => {
    const { packs } = makeEngine()
    for (const pack of packs) {
      expect(pack.nonOverridable ?? false).toBe(pack.id === 'hardening')
    }
  })

  it('steers recursive grep to rg but leaves plain grep alone', () => {
    const { engine } = makeEngine()
    expect(engine.evaluate(bash('grep -r TODO src/'))?.type).toBe('suggest')
    expect(engine.evaluate(bash('grep TODO file.txt'))).toBeNull()
    expect(engine.evaluate(bash('rg TODO src/'))).toBeNull()
  })

  it('steers find -name to fd but leaves fd alone', () => {
    const { engine } = makeEngine()
    expect(engine.evaluate(bash('find . -name "*.ts"'))?.type).toBe('suggest')
    expect(engine.evaluate(bash('fd ".ts$"'))).toBeNull()
  })

  it('suggests force-with-lease for plain force push, not for force-with-lease', () => {
    const { engine } = makeEngine()
    expect(engine.evaluate(bash('git push --force origin main'))?.type).toBe('suggest')
    expect(engine.evaluate(bash('git push --force-with-lease origin main'))).toBeNull()
  })

  it('confirms destructive resets', () => {
    const { engine } = makeEngine()
    expect(engine.evaluate(bash('git reset --hard HEAD~3'))?.type).toBe('confirm')
    expect(engine.evaluate(bash('git clean -fd'))?.type).toBe('confirm')
  })

  it('redacts secret-shaped tokens pasted into prompts', () => {
    const { engine } = makeEngine()
    const action = engine.evaluate({
      toolName: 'user-input',
      command: 'why does auth fail with key sk-abcdefghijklmnopqrstuvwxyz123456?',
    })
    expect(action?.type).toBe('redact')
  })

  it('falls back to block for pasted secrets when the harness cannot rewrite prompts', () => {
    const registry = new PredicateRegistry()
    const packs = loadBuiltInRulePacks(registry)
    const engine = createEngine(packs, { ...PI_CAPABILITIES, redactUserInput: false }, { registry })
    const action = engine.evaluate({
      toolName: 'user-input',
      command: 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    })
    expect(action?.type).toBe('block')
  })

  it('leaves ordinary prompts alone', () => {
    const { engine } = makeEngine()
    expect(
      engine.evaluate({ toolName: 'user-input', command: 'refactor the parser module' })
    ).toBeNull()
  })
})

describe('built-in predicates', () => {
  it('npm-in-pnpm-repo fires only with a pnpm lockfile present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gr-pnpm-'))
    expect(npmInPnpmRepo(bash('npm install lodash'), dir)).toBe(false)
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    expect(npmInPnpmRepo(bash('npm install lodash'), dir)).toBe(true)
    expect(npmInPnpmRepo(bash('pnpm add lodash'), dir)).toBe(false)
  })

  it('on-protected-branch fires for git commit on main only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gr-git-'))
    mkdirSync(join(dir, '.git'))
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    expect(onProtectedBranch(bash('git commit -m "x"'), dir)).toBe(true)
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/feature/x\n')
    expect(onProtectedBranch(bash('git commit -m "x"'), dir)).toBe(false)
    expect(onProtectedBranch(bash('git status'), dir)).toBe(false)
  })

  it('cat-large-file fires only above the size threshold', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gr-cat-'))
    writeFileSync(join(dir, 'small.txt'), 'hello')
    writeFileSync(join(dir, 'big.txt'), 'x'.repeat(300_000))
    expect(catLargeFile(bash('cat small.txt'), dir)).toBe(false)
    expect(catLargeFile(bash('cat big.txt'), dir)).toBe(true)
    expect(catLargeFile(bash('cat missing.txt'), dir)).toBe(false)
  })
})
