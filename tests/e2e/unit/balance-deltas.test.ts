import { describe, expect, it } from "vitest";
import { assertBalanceDelta } from "../local-anvil/runner";

describe("assertBalanceDelta Helper Unit Tests", () => {
  const account = "0x976EA74026E726554dB657fA54763abd0C3a0aa9" as const;

  it("records exact credit (positive delta) successfully", () => {
    const res = assertBalanceDelta(
      "Investor revenue credit",
      account,
      500_000_000n,
      550_000_000n,
      50_000_000n,
    );
    expect(res.label).toBe("Investor revenue credit");
    expect(res.account).toBe(account);
    expect(res.before).toBe(500_000_000n);
    expect(res.after).toBe(550_000_000n);
    expect(res.delta).toBe(50_000_000n);
    expect(res.expectedDelta).toBe(50_000_000n);
  });

  it("records exact debit (negative delta) successfully", () => {
    const res = assertBalanceDelta(
      "Investor investment debit",
      account,
      2_000_000_000n,
      500_000_000n,
      -1_500_000_000n,
    );
    expect(res.label).toBe("Investor investment debit");
    expect(res.delta).toBe(-1_500_000_000n);
    expect(res.expectedDelta).toBe(-1_500_000_000n);
  });

  it("records exact zero delta successfully", () => {
    const res = assertBalanceDelta(
      "Zero-dust epoch close",
      account,
      900_000_000n,
      900_000_000n,
      0n,
    );
    expect(res.delta).toBe(0n);
    expect(res.expectedDelta).toBe(0n);
  });

  it("fails closed when delta is off-by-one on credit", () => {
    expect(() =>
      assertBalanceDelta(
        "Off-by-one credit",
        account,
        0n,
        49_999_999n,
        50_000_000n,
      ),
    ).toThrow(/\[BALANCE-DELTA-MISMATCH\]/);
  });

  it("fails closed when delta is off-by-one on debit", () => {
    expect(() =>
      assertBalanceDelta(
        "Off-by-one debit",
        account,
        1_500_000_000n,
        1n,
        -1_500_000_000n,
      ),
    ).toThrow(/\[BALANCE-DELTA-MISMATCH\]/);
  });

  it("fails closed when delta sign is inverted", () => {
    expect(() =>
      assertBalanceDelta(
        "Inverted sign",
        account,
        100n,
        200n,
        -100n,
      ),
    ).toThrow(/\[BALANCE-DELTA-MISMATCH\]/);
  });

  it("fails closed when non-zero delta occurs where zero expected", () => {
    expect(() =>
      assertBalanceDelta(
        "Unexpected non-zero delta",
        account,
        100n,
        101n,
        0n,
      ),
    ).toThrow(/\[BALANCE-DELTA-MISMATCH\]/);
  });

  it("includes informative diagnostic with account, label, before, after, expected, and observed", () => {
    try {
      assertBalanceDelta(
        "Diagnostic test",
        account,
        1_000n,
        1_500n,
        1_000n,
      );
      expect.fail("Expected assertBalanceDelta to throw");
    } catch (err: unknown) {
      const msg = String(err);
      expect(msg).toContain("[BALANCE-DELTA-MISMATCH]");
      expect(msg).toContain("Diagnostic test");
      expect(msg).toContain(account);
      expect(msg).toContain("expected delta +1000");
      expect(msg).toContain("observed +500");
      expect(msg).toContain("before: 1000");
      expect(msg).toContain("after: 1500");
    }
  });
});
