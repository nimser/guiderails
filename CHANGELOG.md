# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.2] - 2026-08-04

### Fixed

- Input longer than `MAX_MATCH_INPUT_LENGTH` is blocked by the engine before any rule is evaluated, so an `allow` rule ordered ahead of a `block` rule can no longer turn oversized input into an allow
- `confirm` fallback chains are capped at 5 nested links in the loader, the validator, and the resolver — a deeper or self-referencing chain (YAML anchor aliased back to its own action) is rejected at load time instead of overflowing the stack

## [0.1.1] - 2026-08-03

### Fixed

- `yaml` is a runtime dependency — the YAML pack loader imports it at run time, so installing the package no longer relies on the consumer hoisting it
- `build` removes `dist/` before compiling, so the published tarball carries only files that have a source counterpart
- `loadAllRulePacks()` sorts directory entries, so first-match rule precedence is the same on every filesystem

## [0.1.0] - 2026-07-06

- Initial release — core policy engine, matcher registry, YAML rule packs (env, sops, private-key, secret-managers, encryption-tools, hardening), Pi adapter

[Unreleased]: https://github.com/nimser/guiderails/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/nimser/guiderails/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/nimser/guiderails/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/nimser/guiderails/releases/tag/v0.1.0
