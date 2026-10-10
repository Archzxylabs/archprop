/**
 * Canonical base-10 integer handling for numeric JSON fields.
 *
 * docs/INTERFACES.md requires numeric JSON fields to be canonical base-10
 * strings validated as unsigned integers before conversion to database numeric
 * values. These helpers are the single place that conversion happens, so no
 * route can accidentally accept a float, exponent, sign, whitespace, or a
 * leading zero.
 */

/** Matches a canonical unsigned base-10 integer: optional single leading zero. */
export const UNSIGNED_INT_PATTERN = /^(0|[1-9][0-9]*)$/;

/**
 * True for a canonical unsigned base-10 integer string. Rejects `-1`, `+1`,
 * `1.5`, `1e3`, `0x10`, ` 1`, `007`, empty strings, and non-strings.
 */
export function isCanonicalUnsignedInt(value: unknown): value is string {
  return typeof value === "string" && UNSIGNED_INT_PATTERN.test(value);
}

/**
 * Parses a canonical unsigned integer string to bigint, or returns null when
 * the input is not canonical. BigInt is exact, so a value wider than a uint256
 * still round-trips and can be rejected by the caller against its own bound.
 */
export function parseCanonicalUnsignedInt(value: unknown): bigint | null {
  if (!isCanonicalUnsignedInt(value)) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/** Inclusive upper bound shared by every uint256 column and ABI field. */
export const UINT256_MAX = (1n << 256n) - 1n;

/** Formats a bigint as a canonical base-10 string for JSON responses. */
export function toCanonicalString(value: bigint): string {
  return value.toString(10);
}
