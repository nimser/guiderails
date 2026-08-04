/**
 * Maximum number of nested `fallback` links a rule's action may declare.
 *
 * A `confirm` action can name a `fallback` action, which can itself be a
 * `confirm` with another `fallback` — an unbounded chain, and a cyclic one
 * when YAML anchors alias a fallback back to its own action. The chain is
 * bounded so a malformed pack fails at load time with a clear error instead
 * of overflowing the stack while it is parsed, validated, or resolved.
 */
export const MAX_FALLBACK_DEPTH = 5
