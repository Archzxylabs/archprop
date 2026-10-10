import { describe, expect, it } from "vitest";
import type {
  AssetId,
  LifecycleStatus,
  PresentationStatus,
} from "@archprop/shared";
import { VILLA_NUSA } from "@archprop/shared";
import {
  statusLabelFor,
  statusToneFor,
} from "@/components/status-badge";
import { buildMarketplaceCards } from "@/lib/client/listings";
import {
  ARBITRUM_SEPOLIA_EXPLORER,
  chainUnavailable,
  explorerAddressUrl,
  explorerTxUrl,
  formatBps,
  formatCompact,
  formatWholeUnits,
  truncateHash,
  type ChainDataState,
  type PropertyCardView,
} from "@/lib/client/view-models";

/**
 * Frozen-contract assertions for the FE-001 shell.
 *
 * These tests exist to keep the frontend honest about three things: the frozen
 * lifecycle vocabulary, the boundary between a bytes32 asset ID and an EVM
 * address, and the rule that no economic value is ever invented without a chain
 * read.
 */

const FROZEN_LIFECYCLE_STATUSES: readonly LifecycleStatus[] = [
  "SUBMITTED",
  "UNDER_VERIFICATION",
  "VERIFIED",
  "ISSUANCE_READY",
  "OFFERING",
  "FUNDED",
  "ACTIVE",
  "REJECTED",
  "FAILED",
];

/** Presentation-only states: never chain lifecycle names. */
const PRESENTATION_ONLY_STATUSES: readonly PresentationStatus[] = [
  "DRAFT",
  "COMING_SOON",
  "VERIFICATION_PENDING",
];

describe("frozen lifecycle statuses", () => {
  it("maps every frozen lifecycle status to its expected label", () => {
    const expected: Record<LifecycleStatus, string> = {
      SUBMITTED: "Submitted",
      UNDER_VERIFICATION: "Under Verification",
      VERIFIED: "Verified",
      ISSUANCE_READY: "Issuance Ready",
      OFFERING: "Open for Investment",
      FUNDED: "Funded",
      ACTIVE: "Active",
      REJECTED: "Rejected",
      FAILED: "Failed",
    };

    for (const status of FROZEN_LIFECYCLE_STATUSES) {
      expect(statusLabelFor(status)).toBe(expected[status]);
    }
  });

  it("maps every frozen lifecycle status to its expected tone", () => {
    const expected: Record<LifecycleStatus, string> = {
      SUBMITTED: "neutral",
      UNDER_VERIFICATION: "pending",
      VERIFIED: "verified",
      ISSUANCE_READY: "verified",
      OFFERING: "pending",
      FUNDED: "verified",
      ACTIVE: "verified",
      REJECTED: "critical",
      FAILED: "critical",
    };

    for (const status of FROZEN_LIFECYCLE_STATUSES) {
      expect(statusToneFor(status)).toBe(expected[status]);
    }
  });

  it("never invents a chain status outside the frozen enum", () => {
    for (const status of FROZEN_LIFECYCLE_STATUSES) {
      const label = statusLabelFor(status);
      expect(label).toBeTruthy();
      expect(label).not.toMatch(/minted|paid out|distributed/i);
    }
  });
});

describe("presentation-only statuses", () => {
  it("stays identifiable as a presentation state, not a chain state", () => {
    for (const status of PRESENTATION_ONLY_STATUSES) {
      expect(FROZEN_LIFECYCLE_STATUSES).not.toContain(status);
    }
  });

  it("maps to human labels rather than raw enum tokens", () => {
    const expected: Record<string, string> = {
      DRAFT: "Draft",
      COMING_SOON: "Coming Soon",
      VERIFICATION_PENDING: "Verification Pending",
    };

    for (const status of PRESENTATION_ONLY_STATUSES) {
      expect(statusLabelFor(status)).toBe(expected[status]);
    }
  });

  it("assigns only presentation-safe tones", () => {
    for (const status of PRESENTATION_ONLY_STATUSES) {
      expect(["pending", "neutral"]).toContain(statusToneFor(status));
    }
  });
});

describe("explorerTxUrl", () => {
  it("accepts a transaction hash", () => {
    const txHash = `0x${"a".repeat(64)}`;
    expect(explorerTxUrl(txHash)).toBe(`${ARBITRUM_SEPOLIA_EXPLORER}/tx/${txHash}`);
  });

  it("accepts uppercase transaction hashes", () => {
    const txHash = `0x${"A".repeat(64)}`;
    expect(explorerTxUrl(txHash)).toBe(`${ARBITRUM_SEPOLIA_EXPLORER}/tx/${txHash}`);
  });

  it("rejects an address, which is not a transaction hash", () => {
    expect(explorerTxUrl(`0x${"a".repeat(40)}`)).toBeNull();
  });

  it("accepts a hash-shaped 32-byte value", () => {
    // Both `AssetId` and `TxHash` are the same `Hex` alias, so the compiler
    // cannot stop an asset ID reaching this function. The shape check is the
    // only guard, and the call sites below are what actually keep the two
    // apart: `TxLifecycleState.txHash` is typed `TxHash` and is only ever set
    // from a real wallet receipt.
    const hash = `0x${"a".repeat(64)}`;
    expect(explorerTxUrl(hash)).toBe(`${ARBITRUM_SEPOLIA_EXPLORER}/tx/${hash}`);
  });

  it("rejects malformed input", () => {
    for (const value of [
      null,
      undefined,
      "",
      "0x",
      `0x${"z".repeat(64)}`,
      "not-a-hash",
      `0x${"a".repeat(63)}`,
      `0x${"a".repeat(65)}`,
      `${"a".repeat(64)}`,
    ]) {
      expect(explorerTxUrl(value)).toBeNull();
    }
  });
});

describe("explorerAddressUrl", () => {
  it("accepts a 20-byte address", () => {
    const address = `0x${"b".repeat(40)}`;
    expect(explorerAddressUrl(address)).toBe(
      `${ARBITRUM_SEPOLIA_EXPLORER}/address/${address}`,
    );
  });

  it("rejects a bytes32 asset ID, which is not an address", () => {
    expect(explorerAddressUrl(VILLA_NUSA.id)).toBeNull();
  });

  it("rejects a transaction hash", () => {
    expect(explorerAddressUrl(`0x${"a".repeat(64)}`)).toBeNull();
  });

  it("rejects malformed input", () => {
    for (const value of [
      null,
      undefined,
      "",
      "0x",
      `0x${"b".repeat(39)}`,
      `0x${"b".repeat(41)}`,
      "villa-nusa",
    ]) {
      expect(explorerAddressUrl(value)).toBeNull();
    }
  });
});

describe("marketplace cards", () => {
  const noChainRead = <T,>(): ChainDataState<T> =>
    chainUnavailable("No wallet is connected, so no chain read has happened.");

  it("never invents funding for an asset without a chain result", () => {
    const cards = buildMarketplaceCards(noChainRead);

    for (const card of cards) {
      expect(card.funding.status).toBe("unavailable");
      expect(card.funding.status).not.toBe("ready");

      if (card.funding.status === "unavailable") {
        expect(card.funding.reason).toBeTruthy();
      }
    }
  });

  it("does not present a funding percentage anywhere in the seed data", () => {
    const serialized = JSON.stringify(
      buildMarketplaceCards(noChainRead),
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    );

    expect(serialized).not.toMatch(/fundedPercent|percentFunded|progressPercent/);
  });

  it("never invokes the chain reader for a listing with no on-chain asset", () => {
    // Ubud Retreat and Lombok Residence publish no on-chain asset, so asking
    // the chain about them would be a read for an asset that cannot exist.
    const seen: AssetId[] = [];
    const cards = buildMarketplaceCards((assetId) => {
      seen.push(assetId);
      return noChainRead();
    });

    expect(seen).toEqual([VILLA_NUSA.id]);

    const assetless = cards.filter((card) => card.assetId === null);
    expect(assetless.length).toBeGreaterThan(0);
    for (const card of assetless) {
      expect(card.funding.status).toBe("unavailable");
    }
  });

  it("passes through a chain funding read when one exists", () => {
    const funding: PropertyCardView["funding"] = {
      status: "ready",
      value: {
        raisedAmount: 1_000_000_000n,
        targetAmount: 3_000_000_000n,
        percentBps: 3_333,
      },
    };

    const cards = buildMarketplaceCards((assetId) =>
      assetId === VILLA_NUSA.id ? funding : noChainRead(),
    );

    const villaNusa = cards.find((card) => card.assetId === VILLA_NUSA.id);
    expect(villaNusa?.funding).toBe(funding);
  });

  it("uses the frozen Villa Nusa bytes32 asset ID for its property link", () => {
    const cards = buildMarketplaceCards(noChainRead);
    const villaNusa = cards.find((card) => card.externalId === VILLA_NUSA.externalId);

    expect(villaNusa?.assetId).toBe(VILLA_NUSA.id);
    // The property route is keyed on the bytes32 asset ID, not a slug or
    // address.
    expect(`/property/${villaNusa?.assetId as AssetId}`).toBe(
      `/property/${VILLA_NUSA.id}`,
    );
  });
});

describe("Villa Nusa identity", () => {
  it("is a bytes32 asset ID, not an EVM address", () => {
    expect(VILLA_NUSA.id).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(VILLA_NUSA.id).not.toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("satisfies target == supply * price with zero decimals", () => {
    expect(VILLA_NUSA.tokenSupply * VILLA_NUSA.tokenPrice).toBe(
      VILLA_NUSA.offeringTarget,
    );
  });
});

describe("formatting helpers", () => {
  // Numbers are grouped with a narrow no-break space (U+202F) per
  // `formatWholeUnits`, so an ordinary space is the wrong expectation.
  const THIN_SPACE = " ";

  it("formats whole units without inventing fractional digits", () => {
    expect(formatWholeUnits(10_000_000_000n)).toBe(`10${THIN_SPACE}000${THIN_SPACE}000${THIN_SPACE}000`);
    expect(formatWholeUnits(0n)).toBe("0");
    expect(formatWholeUnits(300_000n)).toBe(`300${THIN_SPACE}000`);
  });

  it("preserves bigint precision beyond Number.MAX_SAFE_INTEGER", () => {
    const huge = 10_000_000_000_000_000_001n;
    expect(formatWholeUnits(huge)).toBe(
      `10${THIN_SPACE}000${THIN_SPACE}000${THIN_SPACE}000${THIN_SPACE}000${THIN_SPACE}000${THIN_SPACE}001`,
    );
  });

  it("truncates rather than rounds away zero-decimal units", () => {
    // Both mIDR and AVNUSA use 0 decimals; a fractional input must not gain
    // precision the on-chain integer does not have.
    expect(formatWholeUnits(1234.99)).toBe(`1${THIN_SPACE}234`);
  });

  it("handles negatives", () => {
    expect(formatWholeUnits(-1_500n)).toBe(`-1${THIN_SPACE}500`);
  });

  it("compacts large figures", () => {
    expect(formatCompact(10_000_000_000n)).toBe("10.0B");
    expect(formatCompact(3_000_000_000n)).toBe("3.0B");
    expect(formatCompact(0n)).toBe("0");
  });

  it("formats basis points as a percentage", () => {
    expect(formatBps(3_000)).toBe("30%");
    expect(formatBps(0)).toBe("0%");
    expect(formatBps(2_550)).toBe("25.50%");
  });

  it("truncates hashes for display while keeping both ends", () => {
    const shortened = truncateHash(VILLA_NUSA.id);
    expect(shortened).toContain("0x1756428c");
    expect(shortened).toContain("b7b364ae");
    expect(shortened).toContain("…");
    expect(shortened.length).toBeLessThan(VILLA_NUSA.id.length);
  });

  it("renders an em dash for a missing hash", () => {
    expect(truncateHash(null)).toBe("—");
    expect(truncateHash(undefined)).toBe("—");
    expect(truncateHash("")).toBe("—");
  });

  it("does not truncate a short value that fits in the display budget", () => {
    expect(truncateHash("0x1234")).toBe("0x1234");
  });
});
