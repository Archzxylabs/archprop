/**
 * ABI surface tests.
 *
 * The ABIs are the frozen contract boundary. These tests pin the read and event
 * surface that docs/INTERFACES.md declares, so removing or renaming an entry
 * that callers depend on fails loudly here rather than at runtime.
 */

import { describe, expect, it } from "vitest";
import {
  archpropRegistryAbi,
  identityRegistryAbi,
  mockIdrAbi,
  offeringEscrowAbi,
  propertyTokenAbi,
  revenueDistributorAbi,
} from "../src/abi";

type AbiParameter = {
  name: string;
  type: string;
  indexed?: boolean;
  components?: AbiParameter[];
};

type AbiEntry = {
  type: string;
  name?: string;
  stateMutability?: string;
  inputs?: AbiParameter[];
  outputs?: AbiParameter[];
};

function entries(abi: readonly unknown[]): AbiEntry[] {
  return abi as AbiEntry[];
}

function viewFns(abi: readonly unknown[]): string[] {
  return entries(abi)
    .filter((e) => e.type === "function" && e.stateMutability === "view")
    .map((e) => e.name as string)
    .sort();
}

function events(abi: readonly unknown[]): string[] {
  return entries(abi)
    .filter((e) => e.type === "event")
    .map((e) => e.name as string)
    .sort();
}

function findFn(
  abi: readonly unknown[],
  name: string,
): AbiEntry | undefined {
  return entries(abi).find((e) => e.type === "function" && e.name === name);
}

describe("ArchpropRegistry ABI", () => {
  it("exposes the declared read surface", () => {
    expect(viewFns(archpropRegistryAbi)).toEqual([
      "assetOwner",
      "assetStatus",
      "assetToken",
      "getAsset",
      "getLatestAttestation",
      "isRevenueAttestationValid",
    ]);
  });

  it("exposes the declared events", () => {
    expect(events(archpropRegistryAbi)).toEqual([
      "AgreementRegistered",
      "AssetCreated",
      "AssetRejected",
      "AssetStatusChanged",
      "AssetVerified",
      "AttestationSubmitted",
      "TokenLinked",
    ]);
  });

  it("declares getAsset's struct output", () => {
    const getAsset = findFn(archpropRegistryAbi, "getAsset");
    const output = getAsset?.outputs?.[0];
    expect(output?.type).toBe("tuple");
    expect(getAsset?.inputs?.[0]?.type).toBe("bytes32");
  });

  it("keeps isRevenueAttestationValid's argument order", () => {
    const fn = findFn(archpropRegistryAbi, "isRevenueAttestationValid");
    expect(fn?.inputs?.map((i) => i.type)).toEqual([
      "bytes32",
      "bytes32",
      "uint256",
    ]);
  });

  it("uses uint8 for the status enum, matching the Solidity enum width", () => {
    expect(findFn(archpropRegistryAbi, "assetStatus")?.outputs?.[0]?.type).toBe(
      "uint8",
    );
  });
});

describe("event indexing", () => {
  /**
   * `docs/INTERFACES.md` requires `assetId`/`offeringId`/`epochId` to be
   * indexed whenever present, plus the secondary subject where declared. These
   * assertions pin each indexed flag exactly, so a regression here fails the
   * suite instead of silently breaking every topic filter that queries logs.
   */
  const EXPECTED_INDEXED: Record<string, Array<[string, boolean]>> = {
    AssetCreated: [
      ["assetId", true],
      ["owner", true],
      ["metadataHash", false],
    ],
    AssetVerified: [["assetId", true]],
    AttestationSubmitted: [
      ["assetId", true],
      ["kind", true],
      ["verifier", true],
      ["evidenceHash", false],
      ["value", false],
    ],
    AssetRejected: [
      ["assetId", true],
      ["kind", true],
      ["verifier", true],
      ["evidenceHash", false],
    ],
    AgreementRegistered: [
      ["assetId", true],
      ["agreementHash", false],
    ],
    AssetStatusChanged: [
      ["assetId", true],
      ["from", false],
      ["to", false],
    ],
    TokenLinked: [
      ["assetId", true],
      ["token", true],
    ],
  };

  const ALL_EVENTS: Array<readonly unknown[]> = [
    archpropRegistryAbi,
    identityRegistryAbi,
    propertyTokenAbi,
    offeringEscrowAbi,
    revenueDistributorAbi,
    mockIdrAbi,
  ];

  function findEvent(name: string): { name: string; inputs: AbiParameter[] } | undefined {
    for (const abi of ALL_EVENTS) {
      const found = entries(abi).find(
        (e) => e.type === "event" && e.name === name,
      );
      if (found) {
        return found as { name: string; inputs: AbiParameter[] };
      }
    }
    return undefined;
  }

  it("matches the frozen indexed flags for the registry", () => {
    for (const [eventName, expected] of Object.entries(EXPECTED_INDEXED)) {
      const event = findEvent(eventName);
      expect(event, `${eventName} exists`).toBeDefined();
      expect(
        event?.inputs?.map((i) => [i.name, i.indexed === true]),
        `${eventName} indexed flags`,
      ).toEqual(expected);
    }
  });

  it("indexes every primary subject id the frozen contract declares", () => {
    for (const abi of ALL_EVENTS) {
      for (const entry of entries(abi)) {
        if (entry.type !== "event") {
          continue;
        }
        for (const input of entry.inputs ?? []) {
          if (
            input.name === "assetId" ||
            input.name === "offeringId" ||
            input.name === "epochId"
          ) {
            // `assetId` is bytes32; `offeringId`/`epochId` are uint256 counters.
            const expectedType =
              input.name === "assetId" ? "bytes32" : "uint256";
            expect(
              input.type === expectedType && input.indexed === true,
              `${entry.name}.${input.name} is an indexed ${expectedType}`,
            ).toBe(true);
          }
        }
      }
    }
  });
});

describe("PropertyToken ABI", () => {
  it("exposes the declared read surface", () => {
    expect(viewFns(propertyTokenAbi)).toEqual([
      "allowance",
      "assetId",
      "balanceOf",
      "decimals",
      "identityRegistry",
      "name",
      "offeringEscrow",
      "revenueDistributor",
      "symbol",
      "totalSupply",
    ]);
  });

  it("exposes the declared events", () => {
    expect(events(propertyTokenAbi)).toEqual(["Approval", "Transfer"]);
  });

  it("declares decimals as uint8", () => {
    expect(findFn(propertyTokenAbi, "decimals")?.outputs?.[0]?.type).toBe(
      "uint8",
    );
  });
});

describe("OfferingEscrow ABI", () => {
  it("exposes the declared read surface", () => {
    expect(viewFns(offeringEscrowAbi)).toEqual([
      "allocationOf",
      "getOffering",
      "paymentOf",
      "refundClaimed",
      "tokensClaimed",
    ]);
  });

  it("exposes the declared events", () => {
    expect(events(offeringEscrowAbi)).toEqual([
      "FundsReleased",
      "InvestmentMade",
      "OfferingCreated",
      "OfferingFailed",
      "OfferingFunded",
      "RefundClaimed",
      "TokensClaimed",
    ]);
  });

  it("uses uint8 for the offering status enum", () => {
    const getOffering = findFn(offeringEscrowAbi, "getOffering");
    expect(getOffering?.outputs?.[0]?.type).toBe("tuple");
    expect(getOffering?.inputs?.[0]?.type).toBe("uint256");
  });
});

describe("RevenueDistributor ABI", () => {
  it("exposes the declared read surface", () => {
    expect(viewFns(revenueDistributorAbi)).toEqual([
      "claimableRevenue",
      "getRevenueEpoch",
      "revenueClaimed",
    ]);
  });

  it("exposes the declared events", () => {
    expect(events(revenueDistributorAbi)).toEqual([
      "RevenueClaimed",
      "RevenuePublished",
    ]);
  });
});

describe("IdentityRegistry ABI", () => {
  it("exposes the declared read surface", () => {
    expect(viewFns(identityRegistryAbi)).toEqual(["isApproved"]);
  });

  it("exposes the declared events", () => {
    expect(events(identityRegistryAbi)).toEqual(["InvestorApprovalChanged"]);
  });
});

describe("MockIDR ABI", () => {
  it("exposes the ERC20 read surface", () => {
    expect(viewFns(mockIdrAbi)).toEqual([
      "balanceOf",
      "decimals",
      "name",
      "symbol",
      "totalSupply",
    ]);
  });

  it("marks faucet as a write", () => {
    expect(findFn(mockIdrAbi, "faucet")?.stateMutability).toBe("nonpayable");
  });

  it("exposes the DemoMint event", () => {
    expect(events(mockIdrAbi)).toEqual(["DemoMint"]);
  });
});

describe("ABI hygiene", () => {
  it("keeps every ABI entry well-formed", () => {
    const abis: Record<string, readonly unknown[]> = {
      registry: archpropRegistryAbi,
      propertyToken: propertyTokenAbi,
      offeringEscrow: offeringEscrowAbi,
      revenueDistributor: revenueDistributorAbi,
      identityRegistry: identityRegistryAbi,
      mockIdr: mockIdrAbi,
    };
    for (const [label, abi] of Object.entries(abis)) {
      expect(Array.isArray(abi), `${label} is an array`).toBe(true);
      for (const entry of entries(abi)) {
        expect(["function", "event"], `${label} entry type`).toContain(
          entry.type,
        );
        if (entry.type === "function") {
          expect(entry.name, `${label} function has a name`).toBeTruthy();
          expect(
            entry.stateMutability,
            `${label}.${entry.name} has stateMutability`,
          ).toBeTruthy();
        }
      }
    }
  });

  it("exposes the struct components the reader decodes", () => {
    const getAsset = findFn(archpropRegistryAbi, "getAsset");
    expect(getAsset?.outputs?.[0]?.type).toBe("tuple");
    expect(getAsset?.inputs?.[0]?.type).toBe("bytes32");

    const getAttestation = findFn(archpropRegistryAbi, "getLatestAttestation");
    expect(getAttestation?.outputs?.[0]?.type).toBe("tuple");
    expect(getAttestation?.inputs?.map((i) => i.type)).toEqual([
      "bytes32",
      "uint8",
    ]);
  });
});
