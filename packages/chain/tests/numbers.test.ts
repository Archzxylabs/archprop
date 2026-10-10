/**
 * Numeric helper tests.
 *
 * Zero-decimal tokens mean every amount is an exact integer. These tests pin
 * the precision and validation guarantees that keep a large amount from being
 * corrupted by a float round-trip.
 */

import { describe, expect, it } from "vitest";
import {
  assertNonZeroHash,
  assertUint256,
  assertUint64,
  assertValidAmount,
  formatAmount,
  formatAmountWithSeparators,
  InvalidAmountError,
  isBytes32,
  isDecimalIntegerString,
  isNonZeroBytes32,
  parseAmount,
  parseOptionalAmount,
} from "../src/numbers";

const VALID_HASH = `0x${"ab".repeat(32)}`;
const ZERO_HASH = `0x${"00".repeat(32)}`;

describe("parseAmount", () => {
  it("parses a canonical decimal integer", () => {
    expect(parseAmount("0")).toBe(0n);
    expect(parseAmount("300000")).toBe(300000n);
    expect(parseAmount("10000000000")).toBe(10_000_000_000n);
  });

  it("preserves precision beyond Number.MAX_SAFE_INTEGER", () => {
    const huge = "9007199254740993";
    expect(Number(huge)).toBe(9_007_199_254_740_992); // float rounds
    expect(parseAmount(huge)).toBe(9_007_199_254_740_993n); // bigint is exact
  });

  it("round-trips through formatAmount without precision loss", () => {
    const values = ["0", "1", "300000", "10000000000", "9007199254740993"];
    for (const value of values) {
      expect(formatAmount(parseAmount(value))).toBe(value);
    }
  });

  it("rejects a decimal point", () => {
    expect(() => parseAmount("1.5")).toThrow(InvalidAmountError);
  });

  it("rejects an exponent", () => {
    expect(() => parseAmount("1e6")).toThrow(InvalidAmountError);
  });

  it("rejects a sign", () => {
    expect(() => parseAmount("-1")).toThrow(InvalidAmountError);
    expect(() => parseAmount("+1")).toThrow(InvalidAmountError);
  });

  it("rejects whitespace", () => {
    expect(() => parseAmount(" 1")).toThrow(InvalidAmountError);
    expect(() => parseAmount("1 ")).toThrow(InvalidAmountError);
    expect(() => parseAmount("")).toThrow(InvalidAmountError);
  });

  it("rejects a hex literal rather than coercing it", () => {
    expect(() => parseAmount("0x10")).toThrow(InvalidAmountError);
  });

  it("rejects a non-numeric string", () => {
    expect(() => parseAmount("abc")).toThrow(InvalidAmountError);
  });

  it("rejects a leading zero, which would make round-trips ambiguous", () => {
    expect(() => parseAmount("007")).toThrow(InvalidAmountError);
  });
});

describe("parseOptionalAmount", () => {
  it("treats undefined as zero", () => {
    expect(parseOptionalAmount(undefined)).toBe(0n);
  });

  it("treats an empty string as zero", () => {
    expect(parseOptionalAmount("")).toBe(0n);
  });

  it("still rejects a malformed value", () => {
    expect(() => parseOptionalAmount("abc")).toThrow(InvalidAmountError);
  });
});

describe("isDecimalIntegerString", () => {
  it("accepts canonical integers", () => {
    expect(isDecimalIntegerString("0")).toBe(true);
    expect(isDecimalIntegerString("42")).toBe(true);
  });

  it("rejects non-canonical forms", () => {
    expect(isDecimalIntegerString("")).toBe(false);
    expect(isDecimalIntegerString("1.0")).toBe(false);
    expect(isDecimalIntegerString("-1")).toBe(false);
    expect(isDecimalIntegerString("01")).toBe(false);
  });
});

describe("assertValidAmount", () => {
  it("accepts a non-negative bigint", () => {
    expect(assertValidAmount(0n, "target")).toBe(0n);
    expect(assertValidAmount(300000n, "target")).toBe(300000n);
  });

  it("rejects a negative bigint", () => {
    expect(() => assertValidAmount(-1n, "target")).toThrow(InvalidAmountError);
  });
});

describe("formatAmountWithSeparators", () => {
  it("groups thousands for display", () => {
    expect(formatAmountWithSeparators(10_000_000_000n)).toBe("10,000,000,000");
    expect(formatAmountWithSeparators(300_000n)).toBe("300,000");
  });

  it("does not group small values", () => {
    expect(formatAmountWithSeparators(42n)).toBe("42");
  });
});

describe("hash validation", () => {
  it("recognises a valid bytes32", () => {
    expect(isBytes32(VALID_HASH)).toBe(true);
  });

  it("rejects a short hash", () => {
    expect(isBytes32("0xabcd")).toBe(false);
  });

  it("recognises the zero hash as zero", () => {
    expect(isNonZeroBytes32(VALID_HASH)).toBe(true);
    expect(isNonZeroBytes32(ZERO_HASH)).toBe(false);
  });

  it("asserts non-zero hashes, matching the frozen evidence rule", () => {
    expect(assertNonZeroHash(VALID_HASH, "evidenceHash")).toBe(VALID_HASH);
    expect(() => assertNonZeroHash(ZERO_HASH, "evidenceHash")).toThrow(
      InvalidAmountError,
    );
  });
});

describe("uint bounds", () => {
  it("accepts values inside uint256", () => {
    expect(assertUint256(0n, "target")).toBe(0n);
    expect(assertUint256(2n ** 256n - 1n, "target")).toBe(2n ** 256n - 1n);
  });

  it("rejects values outside uint256", () => {
    expect(() => assertUint256(2n ** 256n, "target")).toThrow(InvalidAmountError);
    expect(() => assertUint256(-1n, "target")).toThrow(InvalidAmountError);
  });

  it("accepts values inside uint64", () => {
    expect(assertUint64(0n, "deadline")).toBe(0n);
    expect(assertUint64(2n ** 64n - 1n, "deadline")).toBe(2n ** 64n - 1n);
  });

  it("rejects values outside uint64", () => {
    expect(() => assertUint64(2n ** 64n, "deadline")).toThrow(
      InvalidAmountError,
    );
  });
});
