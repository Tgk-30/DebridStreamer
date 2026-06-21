// Shared JSON-coercion helpers used by the concrete debrid services. These
// mirror the per-service Swift `int64Value(_:)` helper and the
// `JSONSerialization.jsonObject(...) as? [String: Any]` casts, centralized so
// each service stays a close line-by-line port without duplicating the plumbing.

/** Async delay used by retry/poll loops; default is a no-op so tests don't sleep. */
export type Sleep = (ms: number) => Promise<void>;
export const noopSleep: Sleep = () => Promise.resolve();

/** Coerces a JSON value to a number (mirrors Swift `int64Value`: NSNumber / Int /
 * numeric String). Returns null when not coercible. */
export function int64Value(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number.parseInt(value, 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/** Parse text into a JSON object, or null (mirrors `as? [String: Any]`). */
export function parseJSONObject(text: string): Record<string, unknown> | null {
  if (text.length === 0) return null;
  try {
    const value = JSON.parse(text);
    return value != null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Parse text into a JSON array of objects, or null (mirrors `as? [[String: Any]]`). */
export function parseJSONObjectArray(
  text: string,
): Record<string, unknown>[] | null {
  if (text.length === 0) return null;
  try {
    const value = JSON.parse(text);
    if (!Array.isArray(value)) return null;
    return value as Record<string, unknown>[];
  } catch {
    return null;
  }
}

/** Narrowing accessor for a nested object field (mirrors `x[k] as? [String: Any]`). */
export function asObject(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Narrowing accessor for an array-of-objects field. */
export function asObjectArray(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) return null;
  return value as Record<string, unknown>[];
}

/** True when `value` parses as an absolute URL (mirrors `URL(string:) != nil`). */
export function isValidURL(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
