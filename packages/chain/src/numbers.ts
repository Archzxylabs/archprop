/**
 * Numeric helpers for chain economics.
 *
 * Both mIDR and property tokens use zero decimals (docs/INTERFACES.md,
 * ADR-002), so every amount is an exact on-chain integer unit. Chain values
 * are `bigint`; HTTP and display boundaries use decimal strings. Conversion
 * between the two must never lose precision and must never go through
 * JavaScript `number`.
 */

import type { AssetId } from "@archprop/shared";

/** Thrown when a decimal string is not a valid, non-negative integer. */
export class InvalidAmountError extends Error {
  override readonly name = "InvalidAmountError";

  constructor(readonly value: string, reason: string) {
    super(`Invalid amount "${value}": ${reason}`);
  }
}

const DECIMAL_INTEGER_PATTERN = /^(0|[1-9][0-9]*)$/;

/** True when `value` is a canonical non-negative decimal integer string. */
export function isDecimalIntegerString(value: string): boolean {
  return DECIMAL_INTEGER_PATTERN.test(value);
}

/**
 * Parses a decimal integer string into a bigint without precision loss.
 *
 * Accepts only canonical non-negative decimal integers (no exponent, sign,
 * decimal point, whitespace, or leading zeros beyond "0" itself) so that a
 * value that would round-trip through `number` is rejected rather than
 * silently corrupted.
 */
export function parseAmount(value: string): bigint {
  if (typeof value !== "string") {
    throw new InvalidAmountError(String(value), "expected a string");
  }
  if (value.length === 0) {
    throw new InvalidAmountError(value, "empty string");
  }
  if (!isDecimalIntegerString(value)) {
    throw new InvalidAmountError(
      value,
      "expected a canonical non-negative decimal integer",
    );
  }
  return BigInt(value);
}

/**
 * Parses a decimal integer string into a bigint, treating an empty or absent
 * value as zero. Used for optional numeric query/form fields.
 */
export function parseOptionalAmount(value: string | undefined): bigint {
  if (value === undefined || value.length === 0) {
    return 0n;
  }
  return parseAmount(value);
}

/** Formats a bigint amount as an exact decimal string for display/HTTP. */
export function formatAmount(value: bigint): string {
  return value.toString(10);
}

/** True when `value` is a non-negative bigint. */
export function isValidAmount(value: bigint): boolean {
  return typeof value === "bigint" && value >= 0n;
}

/** Throws unless `value` is a non-negative bigint. */
export function assertValidAmount(value: bigint, label: string): bigint {
  if (!isValidAmount(value)) {
    throw new InvalidAmountError(
      value.toString(10),
      `${label} must be a non-negative integer`,
    );
  }
  return value;
}

/**
 * Formats a bigint amount with grouping separators for display only.
 * Never use the result for a transaction argument; use `formatAmount`.
 */
export function formatAmountWithSeparators(value: bigint): string {
  return value.toString(10).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** True when `value` is a 32-byte hex string (`bytes32`). */
export function isBytes32(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

/** True when `value` is a non-zero 32-byte hex string. */
export function isNonZeroBytes32(value: string): boolean {
  return isBytes32(value) && !/^0x0{64}$/.test(value);
}

/**
 * Validates that an evidence/agreement hash is present and non-zero, matching
 * the frozen protocol rule that evidence hashes must be nonzero.
 */
export function assertNonZeroHash(value: string, label: string): AssetId {
  if (!isNonZeroBytes32(value)) {
    throw new InvalidAmountError(
      value,
      `${label} must be a non-zero bytes32 hash`,
    );
  }
  return value.toLowerCase() as AssetId;
}

/** True when `value` is a valid non-negative uint256. */
export function isUint256(value: bigint): boolean {
  return value >= 0n && value < 2n ** 256n;
}

/** Asserts a bigint fits in uint256. */
export function assertUint256(value: bigint, label: string): bigint {
  if (!isUint256(value)) {
    throw new InvalidAmountError(
      value.toString(10),
      `${label} must fit in uint256`,
    );
  }
  return value;
}

/** Asserts a bigint fits in uint64 (used for deadlines). */
export function assertUint64(value: bigint, label: string): bigint {
  if (value < 0n || value > 2n ** 64n - 1n) {
    throw new InvalidAmountError(
      value.toString(10),
      `${label} must fit in uint64`,
    );
  }
  return value;
}
