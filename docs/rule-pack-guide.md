# Writing Rule Packs

Rule packs are YAML files that tell Guiderails what to watch for and what to do when a match is found. They're the primary way to contribute — no TypeScript required.

This guide covers the format. For the _why_ behind rule packs, see [ADR-005](adrs/005-yaml-rule-packs.md).

## Quick Start

```bash
# Create a packs directory in your project
mkdir -p .guiderails/packs

# Write your rule pack
cat > .guiderails/packs/docker-secrets.yaml << 'EOF'
id: docker-secrets
name: Docker Secrets Protection
description: Prevent leaking Docker secrets via --env-file

rules:
  - id: docker.env-file
    title: Block --env-file in docker run
    description: Catches docker run with --env-file, which exposes .env contents in process listings
    phase: before-tool
    match:
      type: bash-command
      pattern: "docker\\s+run.*--env-file"
    defaultAction:
      type: suggest
      replacement: "docker run --secret id=mysecret,src=.env"
      message: "Use Docker secrets instead of --env-file. `{matched}` exposes .env contents."
EOF
```

## The Schema

```yaml
# ─── Pack metadata ───
id: my-pack # Unique identifier (kebab-case)
name: My Rule Pack # Human-readable name
description: What this protects # Explains the pack's purpose
nonOverridable: true # Optional; user config cannot disable this pack's rules

# ─── Rules ───
rules:
  - id: my-pack.rule-name # Stable dotted ID (pack.rule)
    title: Short title # Appears in match reports
    description: What this catches and why it matters
    phase: before-tool # user-input, before-tool, or after-tool
    match:
      type: bash-command # bash-command or file-path
      pattern: "regex-here" # Regex matching the tool call input
    defaultAction:
      type: block # block, suggest, run, redact, or confirm
      message: "Why this was stopped. `{matched}` triggered the rule."
```

## Matcher Types

### bash-command

Matches against the full command string passed to the `bash` tool. Best for catching dangerous CLI usage.

```yaml
match:
  type: bash-command
  pattern: "sops\\s+(-{1,2}d(ecrypt)?)"
```

The pattern is a regex. Use `\\s+` for whitespace, `\\b` for word boundaries.

### file-path

Matches against file path arguments in `read`/`write` tool calls. Best for protecting sensitive files.

```yaml
match:
  type: file-path
  pattern: "\\.env$"
```

### predicate (TypeScript only)

Function-based matcher for complex logic. Can't be expressed in YAML — requires a predicate function registered in TypeScript via the `PredicateRegistry`, referenced by `predicateName` in the YAML `match` block. Used when regex isn't expressive enough (e.g., multi-field conditions or external state checks).

## Action Types

### block — Stop it, no alternative

```yaml
defaultAction:
  type: block
  message: "Blocked: `{matched}` exposes secrets."
```

### suggest — Stop it, offer a safer alternative

```yaml
defaultAction:
  type: suggest
  replacement: "sed 's/=.*/=[REDACTED]/' {matched}"
  message: "`{matched}` may contain secrets. Try viewing keys without values."
```

### confirm — Ask the user

```yaml
defaultAction:
  type: confirm
  message: "Read `{matched}`? It may contain sensitive data."
  fallback:
    type: block
    message: "Blocked: `{matched}` — confirmation required."
```

A `fallback` may itself be a `confirm` with its own `fallback`, up to 5 nested links. Deeper chains — including a YAML anchor that aliases a fallback back to its own action — are rejected at load time.

## Steering Rules (Quality of Life)

The same format covers non-security steering — rules that keep the agent on the fast path. These fire every session:

```yaml
rules:
  # grep → rg: the agent gets a faster tool and keeps moving
  - id: modern-cli.grep
    title: Prefer ripgrep over grep
    phase: before-tool
    match:
      type: bash-command
      pattern: "^grep\\b|[;&|]\\s*grep\\b"
    defaultAction:
      type: suggest
      replacement: "rg"
      message: "`{matched}` — use `rg` instead: faster, respects .gitignore."

  # npm in a pnpm repo: catch the mismatch before it corrupts the lockfile
  - id: package-manager.npm-in-pnpm
    title: npm install in a pnpm repository
    phase: before-tool
    match:
      type: predicate
      predicateName: npm-in-pnpm-repo
    defaultAction:
      type: suggest
      replacement: "pnpm add"
      message: "This repo uses pnpm (`pnpm-lock.yaml` present). `{matched}` would create a conflicting lockfile."

  # committing to a protected branch: a human should decide
  - id: git-safety.commit-to-main
    title: Confirm commits to protected branches
    phase: before-tool
    match:
      type: predicate
      predicateName: on-protected-branch
    defaultAction:
      type: confirm
      message: "You're about to commit directly to a protected branch. Proceed?"
```

## User-Input Rules

The `user-input` phase matches the prompt text the user submits, before it reaches the provider API ([ADR-010](adrs/010-user-input-mediation.md)). Use it to scrub pasted secrets:

```yaml
rules:
  - id: env.pasted-key
    title: Scrub API keys pasted into prompts
    phase: user-input
    match:
      type: bash-command # matches the prompt text for user-input rules
      pattern: "(sk|ghp|xox[bap])-[A-Za-z0-9_-]{20,}"
    defaultAction:
      type: redact
      message: "A secret-shaped value in your prompt was replaced with a placeholder before sending."
```

`redact` rewrites the prompt; `block` and `confirm` are also valid in this phase. `suggest` and `run` are tool-call concepts and are rejected at load time.

## Message Templates

Use `{matched}` in any message field. At match time, it's replaced with the actual command or file path that triggered the rule:

```yaml
message: "Blocked: `{matched}` — this file may contain secrets."
# → "Blocked: `cat .env.production` — this file may contain secrets."
```

## Phase-Behavior Matrix

Not every action works in every phase ([ADR-002](adrs/002-behavior-model.md)):

| Phase         | block | suggest | run | redact | confirm |
| ------------- | :---: | :-----: | :-: | :----: | :-----: |
| `user-input`  |  ✅   |   ❌    | ❌  |   ✅   |   ✅    |
| `before-tool` |  ✅   |   ✅    | ✅  |   ❌   |   ✅    |
| `after-tool`  |  ❌   |   ❌    | ❌  |   ✅   |   ❌    |

`user-input` fires on the prompt the user submits. `before-tool` fires _before_ the command runs (most common). `after-tool` fires after and can only redact output. Invalid combinations are rejected at load time.

## Built-in Rule Packs

See the [Pack Gallery](packs.md) for the full auto-generated list of shipped packs and rules. Steering packs: `modern-cli`, `package-manager`, `git-safety`. Security packs: `env`, `sops`, `private-key`, `encryption-tools`, `secret-managers`, `hardening`.

## Overriding Built-in Rules

You can disable or change any built-in rule in `guiderails.json`:

```json
{
  "rules": {
    "sops.decrypt": { "action": "off" },
    "env.read": { "action": "confirm" }
  }
}
```

Packs marked `nonOverridable: true` (currently only `hardening`) ignore these overrides — their rules always fire with their default action ([ADR-007](adrs/007-trust-and-self-protection.md)). Adversarial wrapper patterns are guilty until proven innocent.

## Defense in Depth Tip

For maximum coverage, pair `bash-command` and `file-path` matchers on the same concern:

```yaml
rules:
  # Catch `cat .env`, `less .env`, etc.
  - id: env.cat
    phase: before-tool
    match:
      type: bash-command
      pattern: "\\b(cat|less|more|head|tail)\\s+[^|&]*\\.env"
    defaultAction:
      type: block
      message: "Blocked: `{matched}` may expose secrets."

  # Also catch direct `read` tool calls on .env files
  - id: env.read
    phase: before-tool
    match:
      type: file-path
      pattern: "\\.env(\\..+)?$"
    defaultAction:
      type: block
      message: "Blocked: reading `{matched}` may expose secrets."
```

The first catches shell commands; the second catches agents that use harness-native file reading tools instead of `bash`.

## Contributing a Rule Pack

1. Write a YAML file following the schema above
2. Test it locally with `npm test`
3. Submit a PR — the easiest contribution path

Community packs are curated in [awesome-guiderails](https://github.com/nimser/awesome-guiderails).
