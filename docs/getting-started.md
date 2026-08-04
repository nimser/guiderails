# Getting Started with Guiderails

Welcome! This is the contributor gateway for Guiderails — a steering engine that mediates AI coding agent events (user input, tool calls, tool output) against rule packs.

## What This Project Does

Your AI coding agent shouldn't read `.env` files raw, `grep` when `rg` is faster, or force-push over shared history. Guiderails steers it to the better move — and blocks when nothing safe exists.

```
Agent Tool Call → Match Rules → Resolve Action → Enforce
      ↓               ↓             ↓                   ↓
ToolCallContext   Rule Packs   GuardrailAction   Harness Specific
               (YAML)       + Fallback Chain      Behaviour
```

1. **ToolCallContext** — the adapter normalizes harness-specific events into this common shape
2. **Rule Packs** — match conditions (regex, file-path, predicate) and default actions that define what to watch for
3. **GuardrailAction** — the engine evaluates rules and resolves the action through a fallback chain
4. **Behaviour** — the adapter translates the resolved behaviour (`block`, `suggest`, `run`, `redact`, `confirm`) into harness-specific enforcement

## Where to Start

### 🟢 Easiest: Write a YAML Rule Pack

No TypeScript required. Write a YAML file describing what to watch for, submit a PR.

- **Format guide:** [rule-pack-guide.md](rule-pack-guide.md)
- **Examples:** Built-in packs in `src/packs/`
- **Ideas:** Check the backlog of planned packs below

### 🟡 Medium: Embed the Library or Build an Adapter

Building your own harness, or want guiderails in an agent app? The library is one function ([ADR-003](adrs/003-public-api-contract.md)):

```typescript
import { createEngine, loadAllRulePacks, PredicateRegistry } from "guiderails";

const registry = new PredicateRegistry();
registry.register("my-check", (ctx) => /* ... */);

const engine = createEngine(loadAllRulePacks("./packs", registry), {
  block: true,
  suggest: true,
  run: false,
  redact: false,
  confirm: true,
  redactUserInput: false,
}, { registry });

// On each tool call, tool result, or user prompt:
const action = engine.evaluate({ toolName: "bash", command: "cat .env" });

if (action?.type === "block") {
  console.log(action.message);
  // → "Blocked: `cat .env` — displaying .env file content may leak secrets."
}
```

You own the glue; the engine owns matching, resolution, and fallback. Community adapters for other harnesses (OpenCode, Codex, …) build against this same surface — see [ADR-009](adrs/009-adapter-scope-and-tiering.md) for the tiering model.

Run `npm run docs` to generate the full API reference locally (outputs to `docs/api/`).

#### Adapter Capabilities

Not every harness supports every behavior. Source-verified per
[ADR-002](adrs/002-behavior-model.md) / [ADR-007](adrs/007-trust-and-self-protection.md).
Unsupported behaviors degrade via the [fallback chain](#fallback-chains).

| Harness     | `run` | `redact` | `confirm` | `redactUserInput` | `tamperResistant` | `haltTurnBeforeTool` | `haltTurnAfterTool` |
| ----------- | :---: | :------: | :-------: | :---------------: | :----------------: | :-------------------: | :--------------------: |
| Pi          |  ✅   |    ✅    |    ✅     |        ✅         |         ❌          |           ✅           |           ✅            |
| Claude Code |  ✅   |    ✅ (≥ 2.1.121)    |    ✅     |        ✅         |         ✅          |           ✅           |           ✅            |

Community adapters declare their own row against the same flags ([ADR-009](adrs/009-adapter-scope-and-tiering.md)).

### 🔴 Deeper: Engine Improvements

Changes to the match conditions, resolver, or type system. Read the architecture docs first (below), then open an issue to discuss your approach.

## Architecture

Single package built around a dependency-free core. This is a hub-and-spoke layout, not
a linear stack: `core/` has zero outgoing imports, and `matcher/`, `resolver/`, and
`infrastructure/` each import *only* `core/` — they don't depend on each other. `engine/`
is the sole module that reaches beyond `core/`, importing `matcher/` and `resolver/` too.
Nothing ever imports `engine/` or `infrastructure/` — those are the outermost layers,
consumed by adapters, never by other internal modules.

```
                      ┌─────────────┐
                      │   matcher/  │
                      └─────────────┘
                             │
                             ▼
┌─────────────────┐   ┌─────────────┐   ┌─────────────────┐
│ infrastructure/ │──▶│    core/    │◀──│    resolver/    │
│                 │   │  zero deps  │   │                 │
└─────────────────┘   └─────────────┘   └─────────────────┘
     (→ core)                                (→ core)
                             ▲
                             │ (→ core)
                    ┌─────────────────┐
                    │     engine/     │
                    │   also imports  │
                    │    matcher/ +   │
                    │    resolver/    │
                    └─────────────────┘
```

This mirrors the classic **Ports & Adapters (Hexagonal Architecture)** convention — pure
domain logic in the middle, everything else plugged in around it, nothing reaching back
into the center's dependents. Rendered as a graph:

```mermaid
flowchart TD
    matcher{{matcher/}} --> core{{"core/\nzero deps"}}
    resolver{{resolver/}} --> core
    infra{{infrastructure/}} --> core
    engine{{engine/}} --> core
    engine --> matcher
    engine --> resolver
```

**Import rules** (hard constraints):

- `core/` imports nothing
- `matcher/` and `resolver/` import `core/` only
- `engine/` imports `core/`, `matcher/`, `resolver/` (never `infrastructure/`)
- `infrastructure/` imports `core/` only
- The `yaml` npm package (v2.4.0) is used ONLY in `infrastructure/yaml-pack-loader.ts`

### Fallback Chains

When a harness lacks a capability, the engine walks a deterministic chain:

- `run → suggest → block`
- `confirm → block` (or via `action.fallback` if defined, up to 5 nested links — see [ADR-002](adrs/002-behavior-model.md))
- `redact → block`
- `suggest → block` (when no replacement available)

Implemented in `src/resolver/action-resolver.ts`. Adapters declare `HarnessCapabilities`; the engine handles the rest.

### Matching Layers

Three-layer defense-in-depth:

- **L1** Substring pre-filter — fast scan, catches wrappers
- **L2** Structural regex — precise, configured behavior
- **L3** Wrapper detection (`eval`, `bash -c`, `$()`) — triggers force-block

L1+L3 match = force-block regardless of L2 (adversarial pattern detected).

### Architectural Decisions

Read these in order:

| #   | ADR                                                              | What it covers                                                                                |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | [Layered Architecture](adrs/001-layered-architecture.md)         | Package structure, dependency direction, module responsibilities                              |
| 2   | [Behavior Model](adrs/002-behavior-model.md)                     | Five behaviors, three phases, capability table, fallback chains                               |
| 3   | [Public API Contract](adrs/003-public-api-contract.md)           | The minimal embeddable surface: `createEngine`/`evaluate`, pack loader, public types          |
| 4   | [Matching Strategy](adrs/004-matching-strategy.md)               | Three-layer defense-in-depth, risk escalation, command splitting                              |
| 5   | [YAML Rule Packs](adrs/005-yaml-rule-packs.md)                   | Why YAML, built-in packs, predicate limitations                                               |
| 6   | [Observability](adrs/006-observability-strategy.md)              | In-memory stats, tiered roadmap                                                               |
| 7   | [Trust & Self-Protection](adrs/007-trust-and-self-protection.md) | `defaultDecision`, `--strict`, `overridable`, `tamperResistant`, fail-open/fail-closed        |
| 8   | [Non-Goals](adrs/008-non-goals.md)                               | What this project deliberately does not build                                                 |
| 9   | [Adapter Scope & Tiering](adrs/009-adapter-scope-and-tiering.md) | Tier 1 (Pi, Claude Code) vs. community-owned Tier 2 adapters                                  |
| 10  | [User-Input Mediation](adrs/010-user-input-mediation.md)         | The `user-input` phase — scrubbing what the user pastes into the prompt                       |

### Practical Guides

| Guide                                       | What it covers                                                 |
| ------------------------------------------- | -------------------------------------------------------------- |
| [How Matching Works](how-matching-works.md) | Layer-by-layer walkthrough with real command examples          |
| [Rule Pack Guide](rule-pack-guide.md)       | Complete YAML format spec, action types, defense-in-depth tips |

## Key Vocabulary

Guiderails uses precise terms. Here's what you need to know:

| Term              | Meaning                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule              | Detection pattern + phase + default action                                                                                                                                                                    |
| Rule Pack         | Named collection of rules (YAML or TypeScript)                                                                                                                                                                |
| Behavior          | Category: block/suggest/run/redact/confirm                                                                                                                                                                    |
| Action            | Concrete response object (e.g., a suggest action with replacement + message)                                                                                                                                  |
| Phase             | When a rule fires: user-input, before-tool, or after-tool                                                                                                                                                     |
| ToolCallContext   | Normalized input from a harness (discriminated union on `toolName`)                                                                                                                                           |
| Adapter           | Integration shim for a specific harness. Tier 1 (first-party): Pi, Claude Code. Tier 2: community-owned ([ADR-009](adrs/009-adapter-scope-and-tiering.md)).                                                   |
| Harness           | The platform (Pi, Claude Code). NOT the agent (the AI model).                                                                                                                                                 |
| Fallback Chain    | Deterministic degradation when a harness lacks a capability                                                                                                                                                   |
| Matcher           | User-facing name for a match condition: bash-command (regex), file-path (regex), or predicate (TypeScript function). Internally represented as a `MatchCondition` discriminated union.                       |
| Match Condition   | A rule's `match` field — a declarative spec that the engine evaluates via `matchesMatcher()`. Type alias: `MatchCondition`.                                                                                  |
| Default Decision  | The default action of the implicit catch-all rule that fires when nothing else matches (`allow \| suggest \| confirm \| block`, default `allow`). See [ADR-007](adrs/007-trust-and-self-protection.md).      |
| Overridable       | Rule-level flag; `false` locks a built-in rule against user config overrides. Not available to community packs. See [ADR-007](adrs/007-trust-and-self-protection.md).                                        |
| Tamper-Resistant  | Adapter capability declaring whether it runs as an external hook process (harder to tamper with) vs. an in-process plugin. See [ADR-007](adrs/007-trust-and-self-protection.md).                             |
| Turn Halt         | `haltTurn` modifier on `block`/`redact` actions that stops the agent's current turn, not the session. See [ADR-002](adrs/002-behavior-model.md).                                                              |

### Don't Confuse These

- **Behavior vs Action:** Behavior is the category (block/suggest/run/redact/confirm). Action is the concrete response object (e.g., a "suggest action" with a replacement and message).
- **Rule Pack vs package:** A rule pack is a domain concept (a collection of rules). A package is the npm artifact.
- **Harness vs agent:** The harness is the platform (Pi, Claude Code). The agent is the AI model running inside it. Adapters integrate with harnesses, not agents.

## Code Style (Quick Reference)

- TypeScript strict mode, no `any`, no `!` non-null assertions
- Named exports only — no default exports
- Format with oxfmt (single quotes, no semicolons, 100 char print width)
- Tests colocated: `file.test.ts` next to `file.ts`

The linter and formatter catch most issues. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full setup.

## Questions?

1. **Architecture unclear?** Read the ADRs in order — they explain the _why_, not just the _what_.
2. **Rule pack logic tricky?** Check [how-matching-works.md](how-matching-works.md) for the layer-by-layer examples.
3. **Need to discuss?** Open an issue first. We'd rather talk about your approach for 10 minutes than review a 500-line PR that misses the mark.

## Reporting Security Issues

See [SECURITY.md](../SECURITY.md) — please report privately!
