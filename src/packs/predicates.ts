import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolCallContext } from '../core/types.js'
import type { PredicateRegistry } from '../core/predicate-registry.js'

const SSH_ALLOWLIST = new Set(['known_hosts', 'config', 'authorized_keys'])
const NPM_INSTALL = /(^|[;&|]\s*)npm\s+(install|i|add)\b/
const GIT_COMMIT = /(^|[;&|]\s*)git\s+commit\b/
const CAT_FILE = /(^|[;&|]\s*)cat\s+(?:-\S+\s+)*([^\s;&|<>]+)/
const PROTECTED_BRANCHES = new Set(['main', 'master'])
const LARGE_FILE_BYTES = 262_144 // 256 KiB — larger than any file worth cat-ing into context

function command(ctx: ToolCallContext): string {
  return 'command' in ctx && ctx.command ? ctx.command : ''
}

/** Any file in a `.ssh/` directory that is not a public key or a known-safe config file. */
export function sshPrivateKey(ctx: ToolCallContext): boolean {
  const filePath = 'filePath' in ctx && ctx.filePath ? ctx.filePath : ''
  if (!/\.ssh\//.test(filePath)) return false
  const filename = filePath.split('/').pop() ?? ''
  if (SSH_ALLOWLIST.has(filename)) return false
  if (/\.(pub|pubkey)$/.test(filename)) return false
  return true
}

/** `npm install`/`npm i`/`npm add` issued in a workspace that uses pnpm. */
export function npmInPnpmRepo(ctx: ToolCallContext, cwd = process.cwd()): boolean {
  if (!NPM_INSTALL.test(command(ctx))) return false
  return existsSync(join(cwd, 'pnpm-lock.yaml'))
}

/** `git commit` while the current branch is a protected branch (main/master). */
export function onProtectedBranch(ctx: ToolCallContext, cwd = process.cwd()): boolean {
  if (!GIT_COMMIT.test(command(ctx))) return false
  try {
    const head = readFileSync(join(cwd, '.git', 'HEAD'), 'utf-8').trim()
    const branch = head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : ''
    return PROTECTED_BRANCHES.has(branch)
  } catch {
    return false
  }
}

/** `cat <path>` where the target file is large enough to flood the context window. */
export function catLargeFile(ctx: ToolCallContext, cwd = process.cwd()): boolean {
  const match = CAT_FILE.exec(command(ctx))
  const path = match?.[2]
  if (!path) return false
  try {
    const target = path.startsWith('/') ? path : join(cwd, path)
    return statSync(target).size > LARGE_FILE_BYTES
  } catch {
    return false
  }
}

/**
 * Register the built-in predicates the shipped packs reference.
 * Adapters call this before `loadAllRulePacks()` on the built-in pack directory.
 */
export function registerBuiltInPredicates(registry: PredicateRegistry): void {
  registry.register('ssh-private-key', sshPrivateKey)
  registry.register('npm-in-pnpm-repo', (ctx) => npmInPnpmRepo(ctx))
  registry.register('on-protected-branch', (ctx) => onProtectedBranch(ctx))
  registry.register('cat-large-file', (ctx) => catLargeFile(ctx))
}
