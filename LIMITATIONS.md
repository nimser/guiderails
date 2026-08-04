# Limitations

Guiderails is a steering layer: it changes what happens on the events that flow through an agent harness's hooks. This document states plainly what that architecture cannot do, so you can decide what to pair it with.

## Not a security boundary

The engine runs wherever the adapter runs, and that placement is a declared, per-adapter fact — `tamperResistant` in `HarnessCapabilities` ([ADR-007](docs/adrs/007-trust-and-self-protection.md)):

| Adapter     | Placement                              | `tamperResistant` | What that means                                                                 |
| ----------- | -------------------------------------- | :---------------: | -------------------------------------------------------------------------------- |
| Pi          | in-process plugin inside the harness   |        ❌         | An agent that can execute code in the harness process can, in principle, disable or bypass the plugin. |
| Claude Code | external hook subprocess               |        ✅         | The agent can't reach into the hook process — but the hook _configuration_ is a user-editable file the agent may be able to write. |

Even the strongest adapter placement is not containment. If you need a guarantee that an adversarial agent *cannot* perform an action at all, use an OS-level tool built for that — [agentjail](https://github.com/LuD1161/agentjail) (fail-closed daemon, kernel-backed tiers) is the containment companion this project pairs with, not competes with. Division of labor: agentjail answers "can the agent do X at all"; Guiderails changes _what happens_ on the calls that run.

## Fail-open by default, and what `--strict` trades

An unmatched event **allows** by default — a coding agent that halts on every unmatched call is unusable. This is a deliberate decision ([ADR-007](docs/adrs/007-trust-and-self-protection.md)), and it means a call no rule covers passes through untouched.

`--strict` trades ergonomics for posture: anything secret-shaped that slips past a named rule hits a `confirm` gate instead of silently passing, and the `hardening` pack is locked on. Expect more interruptions; that's the trade.

Two failure cases are unconditionally fail-**closed** and not configurable: an engine crash/timeout resolves to `block` on every adapter, and input past the matcher's length cap is blocked by the engine before any rule runs, so no rule pack or rule ordering can turn it into an allow.

## Pattern matching has a ceiling

Rules are deterministic — substring pre-filters, structural regex, wrapper detection, TypeScript predicates. The `hardening` pack catches common shell evasion (`eval`, `bash -c`, `$()`), but exotic obfuscation (encoding, staged construction across turns) can evade any deterministic matcher. `redact` on tool output is the backstop for what no rule predicted, not a guarantee.

## Prompt injection is out of scope

Guiderails mediates events, not the model's reasoning. If the agent's context is compromised by injected instructions, the rules still apply to what it *does* — but steering a compromised agent is containment work (see above), and detecting the injection itself is a different product category entirely.

## Redaction vs. never-inject

A credential-injection proxy (never expose the secret to the agent at all) is structurally stronger than after-the-fact redaction — *for secrets registered ahead of time on flows the proxy sees*. It doesn't cover the long tail: unregistered secrets, tokens embedded in files the agent reads, output of arbitrary commands, or what the user pastes into a prompt. Never-inject what you know about; redact what you didn't. Pairing, not either/or.

## See also

- [SECURITY.md](SECURITY.md) — reporting and disclosure
- [ADR-008](docs/adrs/008-non-goals.md) — what this project deliberately does not build
