import { describe, expect, it } from "vitest";
import {
  UINT256_MAX,
  isCanonicalUnsignedInt,
  parseCanonicalUnsignedInt,
  toCanonicalString,
} from "./numbers";
import { createPropertySchema, revenueEpochSchema } from "./schemas";

describe("isCanonicalUnsignedInt", () => {
  it("accepts canonical values", () => {
    expect(isCanonicalUnsignedInt("0")).toBe(true);
    expect(isCanonicalUnsignedInt("1")).toBe(true);
    expect(isCanonicalUnsignedInt("1000000")).toBe(true);
    expect(isCanonicalUnsignedInt(UINT256_MAX.toString(10))).toBe(true);
  });

  it("rejects signs, decimals, exponents, and hex", () => {
    for (const value of [
      "-1",
      "+1",
      "1.5",
      "1e3",
      "0x10",
      "1_000",
      " 1",
      "1 ",
      "",
      "007",
      "abc",
      "Infinity",
      "NaN",
    ]) {
      expect(isCanonicalUnsignedInt(value), value).toBe(false);
    }
  });

  it("rejects non-strings and null-like inputs", () => {
    for (const value of [1, 1.5, null, undefined, {}, [], true, Symbol("x")]) {
      expect(isCanonicalUnsignedInt(value as unknown)).toBe(false);
    }
  });

  it("parses exactly, including values beyond Number.MAX_SAFE_INTEGER", () => {
    const huge = (2n ** 128n).toString(10);
    expect(parseCanonicalUnsignedInt(huge)).toBe(2n ** 128n);
    expect(parseCanonicalUnsignedInt("0")).toBe(0n);
    expect(parseCanonicalUnsignedInt("1.5")).toBeNull();
    expect(parseCanonicalUnsignedInt(1)).toBeNull();
  });

  it("round-trips through toCanonicalString", () => {
    expect(toCanonicalString(2n ** 200n + 7n)).toBe((2n ** 200n + 7n).toString(10));
  });
});

const validProperty = {
  externalId: "PROP-001",
  name: "Sunset Villas",
  location: "Bandung, ID",
  propertyType: "RESIDENTIAL",
  issuerName: "ArchProp Demo Issuer",
  indicativeValue: "1000000",
  offeringTarget: "500000",
  tokenSupply: "10000",
  tokenPrice: "50",
  economicRightsBps: 8500,
  description: "A demo property used for testing only.",
};

describe("createPropertySchema", () => {
  it("accepts a consistent property", () => {
    const result = createPropertySchema.safeParse(validProperty);
    expect(result.success).toBe(true);
  });

  it("rejects offeringTarget that does not equal supply x price", () => {
    const result = createPropertySchema.safeParse({ ...validProperty, offeringTarget: "499999" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages.join(" ")).toContain("tokenSupply x tokenPrice");
    }
  });

  it("rejects zero supply even when the arithmetic happens to hold", () => {
    const result = createPropertySchema.safeParse({
      ...validProperty,
      tokenSupply: "0",
      offeringTarget: "0",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-canonical numeric strings", () => {
    for (const field of ["indicativeValue", "offeringTarget", "tokenSupply", "tokenPrice"] as const) {
      const result = createPropertySchema.safeParse({ ...validProperty, [field]: "1.5" });
      expect(result.success, field).toBe(false);
    }
  });

  it("never throws and returns safeParse errors for malformed numeric values", () => {
    const malformedValues = ["", "abc", " 10", "0x10", "+1"];
    const numericFields = ["indicativeValue", "offeringTarget", "tokenSupply", "tokenPrice"] as const;

    for (const field of numericFields) {
      for (const malformed of malformedValues) {
        let parsedResult: unknown;
        expect(() => {
          parsedResult = createPropertySchema.safeParse({
            ...validProperty,
            [field]: malformed,
          });
        }, `expected safeParse not to throw for field ${field} with value "${malformed}"`).not.toThrow();

        const result = parsedResult as ReturnType<typeof createPropertySchema.safeParse>;
        expect(result.success, `expected validation error for field ${field} with value "${malformed}"`).toBe(false);
      }
    }
  });

  it("accepts canonical Villa Nusa configuration", () => {
    const villaNusa = {
      externalId: "ARCHPROP-001",
      name: "Villa Nusa",
      location: "Bali, Indonesia",
      propertyType: "RESIDENTIAL",
      issuerName: "PT Nusa Properties",
      indicativeValue: "10000000000",
      offeringTarget: "3000000000",
      tokenSupply: "300000",
      tokenPrice: "10000",
      economicRightsBps: 3000,
      description:
        "Canonical demo villa in Bali. Offers 30% economic participation rights in rental distributions and net exit proceeds.",
    };
    const result = createPropertySchema.safeParse(villaNusa);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.indicativeValue).toBe("10000000000");
      expect(result.data.offeringTarget).toBe("3000000000");
      expect(result.data.tokenSupply).toBe("300000");
      expect(result.data.tokenPrice).toBe("10000");
      expect(result.data.economicRightsBps).toBe(3000);
      // Invariant check: target == supply * price
      expect(BigInt(result.data.offeringTarget)).toBe(
        BigInt(result.data.tokenSupply) * BigInt(result.data.tokenPrice),
      );
    }
  });

  it("rejects economic rights outside 1..10000 bps", () => {
    expect(createPropertySchema.safeParse({ ...validProperty, economicRightsBps: 0 }).success).toBe(
      false,
    );
    expect(
      createPropertySchema.safeParse({ ...validProperty, economicRightsBps: 10_001 }).success,
    ).toBe(false);
    expect(
      createPropertySchema.safeParse({ ...validProperty, economicRightsBps: 10_000 }).success,
    ).toBe(true);
  });

  it("rejects a uint256 overflow in any numeric field", () => {
    const overflow = (UINT256_MAX + 1n).toString(10);
    expect(createPropertySchema.safeParse({ ...validProperty, indicativeValue: overflow }).success).toBe(
      false,
    );
  });
});

describe("revenueEpochSchema", () => {
  const valid = {
    assetId: "0x1756428cf9ce005285ddcf87c75240c798535bed95c6aeca6a5a7d3eb7b364ae",
    period: "2026-Q3",
    amount: "500000",
    evidenceHash: "0x" + "44".repeat(32),
    txHash: "0x" + "55".repeat(32),
  };

  it("accepts a well-formed request", () => {
    expect(revenueEpochSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects uppercase asset ids, hashes, and tx hashes", () => {
    expect(
      revenueEpochSchema.safeParse({ ...valid, assetId: valid.assetId.toUpperCase() }).success,
    ).toBe(false);
    expect(
      revenueEpochSchema.safeParse({ ...valid, evidenceHash: "0x" + "AA".repeat(32) }).success,
    ).toBe(false);
    expect(
      revenueEpochSchema.safeParse({ ...valid, txHash: "0x" + "AA".repeat(32) }).success,
    ).toBe(false);
  });

  it("rejects non-canonical amounts", () => {
    expect(revenueEpochSchema.safeParse({ ...valid, amount: "0" }).success).toBe(true);
    expect(revenueEpochSchema.safeParse({ ...valid, amount: "1e3" }).success).toBe(false);
    expect(revenueEpochSchema.safeParse({ ...valid, amount: "-1" }).success).toBe(false);
  });

  it("never throws and returns safeParse errors for malformed amount values", () => {
    const malformedValues = ["", "abc", " 10", "0x10", "+1"];
    for (const malformed of malformedValues) {
      let parsedResult: unknown;
      expect(() => {
        parsedResult = revenueEpochSchema.safeParse({
          ...valid,
          amount: malformed,
        });
      }, `expected revenueEpochSchema.safeParse not to throw for amount "${malformed}"`).not.toThrow();

      const result = parsedResult as ReturnType<typeof revenueEpochSchema.safeParse>;
      expect(result.success, `expected validation error for amount "${malformed}"`).toBe(false);
    }
  });
});
