# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.1] - 2026-08-03

### Fixed

- `yaml` is a runtime dependency — the YAML pack loader imports it at run time, so installing the package no longer relies on the consumer hoisting it

## [0.1.0] - 2026-07-06

- Initial release — core policy engine, matcher registry, YAML rule packs (env, sops, private-key, secret-managers, encryption-tools, hardening), Pi adapter

[Unreleased]: https://github.com/nimser/guiderails/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/nimser/guiderails/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/nimser/guiderails/releases/tag/v0.1.0
