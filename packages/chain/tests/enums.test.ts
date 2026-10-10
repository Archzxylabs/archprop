/**
 * Enum decoding tests.
 *
 * Unknown chain values must throw, never map to a default or an adjacent
 * member. The frozen numeric order from docs/INTERFACES.md is asserted here so
 * a reordering is caught by a test rather than by a mis-stated lifecycle.
 */

import { describe, expect, it } from "vitest";
import {
  ASSET_STATUS_ENUM,
  ATTESTATION_TYPE_ENUM,
  decodeAssetStatus,
  decodeAttestationType,
  decodeOfferingStatus,
  encodeAssetStatus,
  encodeAttestationType,
  encodeOfferingStatus,
  GOLDEN_PATH_LIFECYCLE,
  isTerminalLifecycleStatus,
  OFFERING_STATUS_ENUM,
  UnknownEnumValueError,
} from "../src/enums";

describe("frozen enum order", () => {
  it("preserves the AssetStatus order from docs/INTERFACES.md", () => {
    expect([...ASSET_STATUS_ENUM]).toEqual([
      "SUBMITTED",
      "UNDER_VERIFICATION",
      "VERIFIED",
      "ISSUANCE_READY",
      "OFFERING",
      "FUNDED",
      "ACTIVE",
      "REJECTED",
      "FAILED",
    ]);
  });

  it("preserves the AttestationType order from docs/INTERFACES.md", () => {
    expect([...ATTESTATION_TYPE_ENUM]).toEqual([
      "OWNERSHIP",
      "VALUATION",
      "REVENUE",
    ]);
  });

  it("preserves the OfferingStatus order from docs/INTERFACES.md", () => {
    expect([...OFFERING_STATUS_ENUM]).toEqual(["OPEN", "FUNDED", "FAILED"]);
  });

  it("keeps the golden path in ascending order with no skipped state", () => {
    const indices = GOLDEN_PATH_LIFECYCLE.map((status) =>
      ASSET_STATUS_ENUM.indexOf(status),
    );
    for (let i = 1; i < indices.length; i += 1) {
      expect(indices[i]).toBe((indices[i - 1] as number) + 1);
    }
  });
});

describe("decodeAssetStatus", () => {
  it("decodes each declared value", () => {
    ASSET_STATUS_ENUM.forEach((status, index) => {
      expect(decodeAssetStatus(index)).toBe(status);
      expect(decodeAssetStatus(BigInt(index))).toBe(status);
    });
  });

  it("throws on an out-of-range value instead of defaulting", () => {
    expect(() => decodeAssetStatus(9)).toThrow(UnknownEnumValueError);
    expect(() => decodeAssetStatus(255)).toThrow(UnknownEnumValueError);
    expect(() => decodeAssetStatus(BigInt(100))).toThrow(UnknownEnumValueError);
  });

  it("throws on a negative value", () => {
    expect(() => decodeAssetStatus(-1)).toThrow(UnknownEnumValueError);
  });

  it("names the enum in the error for diagnosability", () => {
    expect(() => decodeAssetStatus(99)).toThrow(/AssetStatus/);
  });
});

describe("decodeAttestationType", () => {
  it("decodes each declared value", () => {
    expect(decodeAttestationType(0)).toBe("OWNERSHIP");
    expect(decodeAttestationType(1)).toBe("VALUATION");
    expect(decodeAttestationType(2)).toBe("REVENUE");
  });

  it("throws on an out-of-range value", () => {
    expect(() => decodeAttestationType(3)).toThrow(UnknownEnumValueError);
  });
});

describe("decodeOfferingStatus", () => {
  it("decodes each declared value", () => {
    expect(decodeOfferingStatus(0)).toBe("OPEN");
    expect(decodeOfferingStatus(1)).toBe("FUNDED");
    expect(decodeOfferingStatus(2)).toBe("FAILED");
  });

  it("throws on an out-of-range value", () => {
    expect(() => decodeOfferingStatus(3)).toThrow(UnknownEnumValueError);
  });
});

describe("encode round-trips", () => {
  it("round-trips every asset status", () => {
    for (const status of ASSET_STATUS_ENUM) {
      expect(decodeAssetStatus(encodeAssetStatus(status))).toBe(status);
    }
  });

  it("round-trips every attestation type", () => {
    for (const kind of ATTESTATION_TYPE_ENUM) {
      expect(decodeAttestationType(encodeAttestationType(kind))).toBe(kind);
    }
  });

  it("round-trips every offering status", () => {
    for (const status of OFFERING_STATUS_ENUM) {
      expect(decodeOfferingStatus(encodeOfferingStatus(status))).toBe(status);
    }
  });
});

describe("isTerminalLifecycleStatus", () => {
  it("treats REJECTED and FAILED as terminal", () => {
    expect(isTerminalLifecycleStatus("REJECTED")).toBe(true);
    expect(isTerminalLifecycleStatus("FAILED")).toBe(true);
  });

  it("treats golden-path states as non-terminal", () => {
    for (const status of GOLDEN_PATH_LIFECYCLE) {
      expect(isTerminalLifecycleStatus(status)).toBe(false);
    }
  });
});
