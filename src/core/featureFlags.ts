/**
 * Track F feature gate: relationship inference is hidden by default because
 * heuristic guesses are non-deterministic. Core inference code, data model
 * fields, and golden tests remain intact and testable when explicitly enabled.
 */
export const ENABLE_INFERENCE = false;
