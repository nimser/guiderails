// ── Engine Factory (the public integration surface, ADR-003) ──
export {
  /**
   * Create a guardrail engine over rule packs and harness capabilities.
   * The public entry point for adapters and embedders: one `evaluate()`
   * call per event, covering all three phases.
   */
  createEngine,
} from './engine/create-engine.js'
export type { Engine, CreateEngineOptions } from './engine/create-engine.js'

// ── Tier 1 Harness Capabilities (ADR-009) ───────────────
export {
  /** Pi capability constant (in-process plugin; all behaviors native). */
  PI_CAPABILITIES,
  /** Claude Code capability constant (external hooks; all behaviors native, redact ≥ 2.1.121). */
  CLAUDE_CODE_CAPABILITIES,
  /** The Claude Code version floor for the `redact` behavior. */
  CLAUDE_CODE_REDACT_MIN_VERSION,
  /** Claude Code capabilities gated on the installed CLI version. */
  claudeCodeCapabilities,
} from './core/harness-capabilities.js'

// ── Built-in Rule Packs ─────────────────────────────────
export {
  /** Register built-in predicates and load every shipped rule pack — the zero-config path. */
  loadBuiltInRulePacks,
  /** Register the predicates the built-in packs reference. */
  registerBuiltInPredicates,
  /** Directory containing the shipped YAML rule packs. */
  BUILTIN_PACKS_DIR,
} from './packs/index.js'

// ── Core Types ──────────────────────────────────────────
export type { HarnessCapabilities } from './core/types.js'
export type {
  /** The five behaviors a guardrail rule can enforce. */
  GuardrailBehavior,
  /** Union of all possible guardrail actions across both phases. */
  GuardrailAction,
  /** Normalized context for a tool call. */
  ToolCallContext,
  /** A declarative condition that describes when a rule fires. */
  MatchCondition,
  /** Union of rules from both phases. */
  GuardrailRule,
  /** A single guardrail rule evaluated in the before-tool phase. */
  BeforeToolRule,
  /** A single guardrail rule evaluated in the after-tool phase. */
  AfterToolRule,
  /** Actions available in the before-tool phase. */
  BeforeToolAction,
  /** Actions available in the after-tool phase. */
  AfterToolAction,
  /** Actions available in the user-input phase (ADR-010). */
  UserInputAction,
  /** A single guardrail rule evaluated in the user-input phase. */
  UserInputRule,
  /** A named collection of guardrail rules. */
  RulePack,
  /** Emitted when a rule's matcher fires against a tool call. */
  RuleMatchedEvent,
  /** Emitted when the resolver walks the fallback chain. */
  FallbackTriggeredEvent,
  /** Union of all domain events the engine can produce. */
  DomainEvent,
  /** Engine output: the resolved action plus the trace of how it was decided. */
  MatchResult,
} from './core/types.js'

// ── Normalizer ─────────────────────────────────────────
export {
  /** @internal Check whether a tool name is one of the well-known tools with required fields. */
  isKnownTool,
  /** @internal Extract command and filePath from a ToolCallContext. */
  extractTargets,
  /** @internal Check whether a ToolCallContext is missing required fields. */
  isMissingRequiredFields,
} from './core/normalizer.js'

// ── Predicate Registry ──────────────────────────────────
export {
  /** Registry for named predicate matchers referenced by YAML configs. */
  PredicateRegistry,
} from './core/predicate-registry.js'
export type { PredicateFunction } from './core/predicate-registry.js'

// ── Validator ───────────────────────────────────────────
export {
  /** Check whether an unknown value is a valid GuardrailRule. */
  validateRule,
  /** Check whether an unknown value is a valid RulePack. */
  validateRulePack,
  /** Return descriptive validation errors for a potential GuardrailRule. */
  getRuleErrors,
  /** Return descriptive validation errors for a potential RulePack. */
  getRulePackErrors,
} from './core/validator.js'

// ── Engine internals ────────────────────────────────────
export type { Stats } from './engine/stats-tracker.js'
export {
  /** @internal Engine plumbing — use `createEngine().evaluate()` instead. */
  matchAndResolve,
  /** @internal Engine plumbing — use `createEngine().processMatch()` instead. */
  processMatch,
} from './engine/engine.js'
export {
  /** @internal Accumulator for intervention stats — owned by the engine instance. */
  StatsTracker,
} from './engine/stats-tracker.js'

// ── Matcher internals ───────────────────────────────────
export {
  /** @internal Matching dispatch — production code goes through `createEngine().evaluate()`. */
  matchesMatcher,
  /** @internal Maximum input length before regex matchers fail-closed. */
  MAX_MATCH_INPUT_LENGTH,
} from './matcher/matchers.js'

// ── Infrastructure ──────────────────────────────────────
export {
  /**
   * Load and parse a single YAML rule pack file. Validates structure
   * and returns a typed `RulePack`, or throws on error.
   */
  loadYamlRulePack,
  /**
   * Load all `.yaml` / `.yml` files from a directory as rule packs.
   * Non-YAML files are silently skipped. Throws if any pack fails validation.
   */
  loadAllRulePacks,
} from './infrastructure/yaml-pack-loader.js'
