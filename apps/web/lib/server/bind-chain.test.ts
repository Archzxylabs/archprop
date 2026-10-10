/**
 * Route-level integration tests for POST /api/properties/:id/bind-chain.
 *
 * Verifies:
 *  - Authentication and authorization gates (401, 403)
 *  - Request field validation (422 malformed, stale, future timestamps)
 *  - Property state & asset ID verification (404, 409)
 *  - On-chain receipt, event, and registry asset verification (502, 404, 409)
 *  - Signer recovery using exact buildPropertyBindingMessage
 *  - Conditional service-role DB update and concurrency conflict handling (409, 200)
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  createPublicClient,
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  toHex,
  type Hex,
  type Log,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildPropertyBindingMessage,
  type AssetId,
  type TxHash,
} from "@archprop/shared";
import * as supabaseModule from "./supabase";
import { ASSET_CREATED_EVENT } from "./chain";
import { POST as bindChain } from "../../app/api/properties/[id]/bind-chain/route";

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(),
  };
});

const REGISTRY_ADDRESS: `0x${string}` = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const DISTRIBUTOR_ADDRESS: `0x${string}` = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const PROPERTY_ID = "11111111-2222-3333-4444-555555555555";
const OWNER_USER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const FOREIGN_USER_ID = "99999999-8888-7777-6666-555555555555";
const EXTERNAL_ID = "ARCHPROP-001";
const CHAIN_ASSET_ID = keccak256(toHex(EXTERNAL_ID)); // 0x1756428cf9ce005285ddcf87c75240c798535bed95c6aeca6a5a7d3eb7b364ae
const TX_HASH: `0x${string}` = `0x${"11".repeat(32)}`;
const METADATA_HASH: `0x${string}` = `0x${"22".repeat(32)}`;

const ownerAccount = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const foreignAccount = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

function buildAssetCreatedLog(args: {
  assetId: `0x${string}`;
  owner: `0x${string}`;
  metadataHash: `0x${string}`;
  emitter?: `0x${string}`;
}): Log {
  const topics = encodeEventTopics({
    abi: [ASSET_CREATED_EVENT],
    eventName: "AssetCreated",
    args: { assetId: args.assetId, owner: args.owner },
  });
  const data = encodeAbiParameters([{ type: "bytes32" }], [args.metadataHash]);
  return {
    address: args.emitter ?? REGISTRY_ADDRESS,
    topics,
    data,
    blockNumber: 12_345n,
    blockHash: "0x" + "aa".repeat(32),
    transactionHash: TX_HASH,
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  } as unknown as Log;
}

async function signBinding(args: {
  account: typeof ownerAccount;
  propertyId: string;
  userId: string;
  chainAssetId: AssetId;
  txHash: TxHash;
  issuedAtMs: string;
}): Promise<Hex> {
  const message = buildPropertyBindingMessage({
    propertyId: args.propertyId,
    userId: args.userId,
    chainAssetId: args.chainAssetId,
    txHash: args.txHash,
    issuedAtMs: args.issuedAtMs,
  });
  return args.account.signMessage({ message });
}

function makeBindRequest(
  propertyId: string,
  body: Record<string, unknown>,
  token?: string,
): NextRequest {
  return new NextRequest(`http://localhost/api/properties/${propertyId}/bind-chain`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL = "https://sepolia-rollup.arbitrum.io/rpc";
  process.env.NEXT_PUBLIC_ARCHPROP_REGISTRY_ADDRESS = REGISTRY_ADDRESS;
  process.env.NEXT_PUBLIC_REVENUE_DISTRIBUTOR_ADDRESS = DISTRIBUTOR_ADDRESS;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
});

describe("POST /api/properties/:id/bind-chain", () => {
  let propertyRow: Record<string, unknown> | null;
  let updateCalls: Array<{
    payload: Record<string, unknown>;
    filters: Record<string, unknown>;
  }>;
  let updateError: { code?: string; message?: string } | null;
  let updateResultRows: Array<Record<string, unknown>>;
  let currentRegistryAsset: {
    owner: `0x${string}`;
    metadataHash: `0x${string}`;
    agreementHash: `0x${string}`;
    status: number;
    token: `0x${string}`;
  };
  let receiptLogs: Log[];
  let receiptStatus: "success" | "reverted";
  let rpcChainId: number;

  beforeEach(() => {
    propertyRow = {
      id: PROPERTY_ID,
      owner_user_id: OWNER_USER_ID,
      status_cache: "DRAFT",
      chain_asset_id: null,
      external_id: EXTERNAL_ID,
      name: "Villa Nusa",
      slug: "villa-nusa",
      property_type: "RESIDENTIAL",
      location: "Bali, Indonesia",
      issuer_name: "PT Nusa Properties",
      description: "A luxury villa.",
      indicative_value: "10000000000",
      offering_target: "3000000000",
      token_supply: "300000",
      token_price: "10000",
      economic_rights_bps: 3000,
      token_address: null,
      created_at: "2026-08-22T00:00:00Z",
    };

    updateCalls = [];
    updateError = null;
    updateResultRows = [
      {
        ...propertyRow,
        status_cache: "SUBMITTED",
        chain_asset_id: CHAIN_ASSET_ID,
      },
    ];

    currentRegistryAsset = {
      owner: ownerAccount.address,
      metadataHash: METADATA_HASH,
      agreementHash: `0x${"00".repeat(32)}`,
      status: 0, // SUBMITTED
      token: `0x${"00".repeat(20)}`,
    };

    receiptLogs = [
      buildAssetCreatedLog({
        assetId: CHAIN_ASSET_ID,
        owner: ownerAccount.address,
        metadataHash: METADATA_HASH,
      }),
    ];
    receiptStatus = "success";
    rpcChainId = 421614;

    // Mock Supabase clients
    vi.spyOn(supabaseModule, "createUserClient").mockImplementation(() => {
      return {
        auth: {
          getUser: vi.fn().mockImplementation(async (jwt: string) => {
            if (jwt === "valid-owner-jwt") {
              return {
                data: { user: { id: OWNER_USER_ID, email: "owner@example.com" } },
                error: null,
              };
            }
            if (jwt === "foreign-user-jwt") {
              return {
                data: { user: { id: FOREIGN_USER_ID, email: "foreign@example.com" } },
                error: null,
              };
            }
            return { data: { user: null }, error: { message: "Invalid session" } };
          }),
        },
      } as unknown as supabaseModule.UserSupabaseClient;
    });

    vi.spyOn(supabaseModule, "createServiceClient").mockImplementation(() => {
      return {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "properties") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: propertyRow,
                      error: null,
                    }),
                  }),
                }),
              }),
              update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
                const filters: Record<string, unknown> = {};
                const builder = {
                  eq: vi.fn().mockImplementation((col: string, val: unknown) => {
                    filters[col] = val;
                    return builder;
                  }),
                  is: vi.fn().mockImplementation((col: string, val: unknown) => {
                    filters[col] = val;
                    return builder;
                  }),
                  select: vi.fn().mockImplementation(() => {
                    updateCalls.push({ payload, filters });
                    if (updateError) {
                      return Promise.resolve({ data: null, error: updateError });
                    }
                    return Promise.resolve({ data: updateResultRows, error: null });
                  }),
                };
                return builder;
              }),
            };
          }
          return {};
        }),
      } as unknown as supabaseModule.UserSupabaseClient;
    });

    // Mock viem createPublicClient
    vi.mocked(createPublicClient).mockReturnValue({
      getChainId: vi.fn().mockImplementation(async () => rpcChainId),
      getTransactionReceipt: vi.fn().mockImplementation(async () => ({
        status: receiptStatus,
        blockNumber: 12_345n,
        logs: receiptLogs,
      })),
      readContract: vi.fn().mockImplementation(async () => currentRegistryAsset),
    } as unknown as ReturnType<typeof createPublicClient>);
  });

  describe("Authentication & Authorization", () => {
    it("rejects missing Authorization header with 401 unauthorized", async () => {
      const issuedAtMs = Date.now().toString();
      const signature = await signBinding({
        account: ownerAccount,
        propertyId: PROPERTY_ID,
        userId: OWNER_USER_ID,
        chainAssetId: CHAIN_ASSET_ID,
        txHash: TX_HASH,
        issuedAtMs,
      });

      const request = makeBindRequest(PROPERTY_ID, {
        txHash: TX_HASH,
        chainAssetId: CHAIN_ASSET_ID,
        signature,
        issuedAtMs,
      });

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error.code).toBe("unauthorized");
      expect(updateCalls).toHaveLength(0);
    });

    it("rejects invalid/expired JWT token with 401 unauthorized", async () => {
      const issuedAtMs = Date.now().toString();
      const signature = await signBinding({
        account: ownerAccount,
        propertyId: PROPERTY_ID,
        userId: OWNER_USER_ID,
        chainAssetId: CHAIN_ASSET_ID,
        txHash: TX_HASH,
        issuedAtMs,
      });

      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: CHAIN_ASSET_ID,
          signature,
          issuedAtMs,
        },
        "invalid-jwt-token",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error.code).toBe("unauthorized");
      expect(updateCalls).toHaveLength(0);
    });

    it("rejects caller when JWT user does not own the property (403 forbidden)", async () => {
      const issuedAtMs = Date.now().toString();
      const signature = await signBinding({
        account: ownerAccount,
        propertyId: PROPERTY_ID,
        userId: FOREIGN_USER_ID,
        chainAssetId: CHAIN_ASSET_ID,
        txHash: TX_HASH,
        issuedAtMs,
      });

      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: CHAIN_ASSET_ID,
          signature,
          issuedAtMs,
        },
        "foreign-user-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.error.code).toBe("forbidden");
      expect(json.error.message).toBe("You do not own this property.");
      expect(updateCalls).toHaveLength(0);
    });

    it("rejects request when recovered signature does not match on-chain asset owner (403 signer_mismatch)", async () => {
      const issuedAtMs = Date.now().toString();
      // Signed with a different key than the on-chain asset owner
      const signature = await signBinding({
        account: foreignAccount,
        propertyId: PROPERTY_ID,
        userId: OWNER_USER_ID,
        chainAssetId: CHAIN_ASSET_ID,
        txHash: TX_HASH,
        issuedAtMs,
      });

      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: CHAIN_ASSET_ID,
          signature,
          issuedAtMs,
        },
        "valid-owner-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.error.code).toBe("signer_mismatch");
      expect(json.error.message).toBe("The signature does not match the on-chain asset owner.");
      expect(updateCalls).toHaveLength(0);
    });
  });

  describe("Request Field Validation (422)", () => {
    it("rejects malformed txHash with 422 validation_failed", async () => {
      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: "0x123", // too short
          chainAssetId: CHAIN_ASSET_ID,
          signature: `0x${"aa".repeat(65)}`,
          issuedAtMs: Date.now().toString(),
        },
        "valid-owner-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(422);
      const json = await response.json();
      expect(json.error.code).toBe("validation_failed");
      expect(json.error.fields?.txHash).toBeDefined();
    });

    it("rejects malformed chainAssetId with 422 validation_failed", async () => {
      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: "not-a-valid-hex",
          signature: `0x${"aa".repeat(65)}`,
          issuedAtMs: Date.now().toString(),
        },
        "valid-owner-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(422);
      const json = await response.json();
      expect(json.error.code).toBe("validation_failed");
      expect(json.error.fields?.chainAssetId).toBeDefined();
    });

    it("rejects malformed signature with 422 validation_failed", async () => {
      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: CHAIN_ASSET_ID,
          signature: "0xbad",
          issuedAtMs: Date.now().toString(),
        },
        "valid-owner-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(422);
      const json = await response.json();
      expect(json.error.code).toBe("validation_failed");
      expect(json.error.fields?.signature).toBeDefined();
    });

    it("rejects malformed issuedAtMs with 422 validation_failed", async () => {
      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: CHAIN_ASSET_ID,
          signature: `0x${"aa".repeat(65)}`,
          issuedAtMs: "123.456",
        },
        "valid-owner-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(422);
      const json = await response.json();
      expect(json.error.code).toBe("validation_failed");
      expect(json.error.fields?.issuedAtMs).toBeDefined();
    });

    it("rejects stale timestamp older than 10 minutes with 422 validation_failed", async () => {
      const elevenMinutesAgo = (Date.now() - 11 * 60 * 1000).toString();
      const signature = await signBinding({
        account: ownerAccount,
        propertyId: PROPERTY_ID,
        userId: OWNER_USER_ID,
        chainAssetId: CHAIN_ASSET_ID,
        txHash: TX_HASH,
        issuedAtMs: elevenMinutesAgo,
      });

      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: CHAIN_ASSET_ID,
          signature,
          issuedAtMs: elevenMinutesAgo,
        },
        "valid-owner-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(422);
      const json = await response.json();
      expect(json.error.code).toBe("validation_failed");
      expect(json.error.fields?.issuedAtMs).toContain("timestamp is older than 10 minutes");
    });

    it("rejects future timestamp more than 60 seconds ahead with 422 validation_failed", async () => {
      const twoMinutesAhead = (Date.now() + 120 * 1000).toString();
      const signature = await signBinding({
        account: ownerAccount,
        propertyId: PROPERTY_ID,
        userId: OWNER_USER_ID,
        chainAssetId: CHAIN_ASSET_ID,
        txHash: TX_HASH,
        issuedAtMs: twoMinutesAhead,
      });

      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: CHAIN_ASSET_ID,
          signature,
          issuedAtMs: twoMinutesAhead,
        },
        "valid-owner-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(422);
      const json = await response.json();
      expect(json.error.code).toBe("validation_failed");
      expect(json.error.fields?.issuedAtMs).toContain("timestamp is more than 60 seconds in the future");
    });
  });

  describe("Property State & Asset ID Gates (404, 409)", () => {
    it("returns 404 when property does not exist in DB", async () => {
      propertyRow = null;
      const issuedAtMs = Date.now().toString();
      const signature = await signBinding({
        account: ownerAccount,
        propertyId: PROPERTY_ID,
        userId: OWNER_USER_ID,
        chainAssetId: CHAIN_ASSET_ID,
        txHash: TX_HASH,
        issuedAtMs,
      });

      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: CHAIN_ASSET_ID,
          signature,
          issuedAtMs,
        },
        "valid-owner-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.error.code).toBe("not_found");
    });

    it("returns 409 when property is not in DRAFT status", async () => {
      if (propertyRow) {
        propertyRow.status_cache = "SUBMITTED";
      }
      const issuedAtMs = Date.now().toString();
      const signature = await signBinding({
        account: ownerAccount,
        propertyId: PROPERTY_ID,
        userId: OWNER_USER_ID,
        chainAssetId: CHAIN_ASSET_ID,
        txHash: TX_HASH,
        issuedAtMs,
      });

      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: CHAIN_ASSET_ID,
          signature,
          issuedAtMs,
        },
        "valid-owner-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.error.code).toBe("conflict");
      expect(json.error.message).toBe("The property is already bound or is not in draft state.");
    });

    it("returns 409 when property already has a chain_asset_id", async () => {
      if (propertyRow) {
        propertyRow.chain_asset_id = CHAIN_ASSET_ID;
      }
      const issuedAtMs = Date.now().toString();
      const signature = await signBinding({
        account: ownerAccount,
        propertyId: PROPERTY_ID,
        userId: OWNER_USER_ID,
        chainAssetId: CHAIN_ASSET_ID,
        txHash: TX_HASH,
        issuedAtMs,
      });

      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: CHAIN_ASSET_ID,
          signature,
          issuedAtMs,
        },
        "valid-owner-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.error.code).toBe("conflict");
    });

    it("returns 409 asset_id_mismatch when chainAssetId does not match externalId hash", async () => {
      const mismatchedAssetId: `0x${string}` = `0x${"ee".repeat(32)}`;
      const issuedAtMs = Date.now().toString();
      const signature = await signBinding({
        account: ownerAccount,
        propertyId: PROPERTY_ID,
        userId: OWNER_USER_ID,
        chainAssetId: mismatchedAssetId,
        txHash: TX_HASH,
        issuedAtMs,
      });

      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: mismatchedAssetId,
          signature,
          issuedAtMs,
        },
        "valid-owner-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.error.code).toBe("asset_id_mismatch");
      expect(json.error.message).toBe("The chain asset id does not match the property external id.");
    });
  });

  describe("Chain & Receipt Verification (502, 404, 409)", () => {
    it("returns 502 chain_mismatch when RPC reports foreign chain ID", async () => {
      rpcChainId = 1; // Mainnet
      const issuedAtMs = Date.now().toString();
      const signature = await signBinding({
        account: ownerAccount,
        propertyId: PROPERTY_ID,
        userId: OWNER_USER_ID,
        chainAssetId: CHAIN_ASSET_ID,
        txHash: TX_HASH,
        issuedAtMs,
      });

      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: CHAIN_ASSET_ID,
          signature,
          issuedAtMs,
        },
        "valid-owner-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(502);
      const json = await response.json();
      expect(json.error.code).toBe("chain_mismatch");
      expect(json.error.message).toContain("421614 is required");
    });

    it("returns 404 not_found when transaction receipt does not exist", async () => {
      vi.mocked(createPublicClient).mockReturnValue({
        getChainId: vi.fn().mockResolvedValue(421614),
        getTransactionReceipt: vi.fn().mockRejectedValue(new Error("Transaction receipt not found.")),
      } as unknown as ReturnType<typeof createPublicClient>);

      const issuedAtMs = Date.now().toString();
      const signature = await signBinding({
        account: ownerAccount,
        propertyId: PROPERTY_ID,
        userId: OWNER_USER_ID,
        chainAssetId: CHAIN_ASSET_ID,
        txHash: TX_HASH,
        issuedAtMs,
      });

      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: CHAIN_ASSET_ID,
          signature,
          issuedAtMs,
        },
        "valid-owner-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.error.code).toBe("not_found");
    });

    it("returns 409 chain_reverted when referenced transaction reverted", async () => {
      receiptStatus = "reverted";
      const issuedAtMs = Date.now().toString();
      const signature = await signBinding({
        account: ownerAccount,
        propertyId: PROPERTY_ID,
        userId: OWNER_USER_ID,
        chainAssetId: CHAIN_ASSET_ID,
        txHash: TX_HASH,
        issuedAtMs,
      });

      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: CHAIN_ASSET_ID,
          signature,
          issuedAtMs,
        },
        "valid-owner-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.error.code).toBe("chain_reverted");
    });

    it("returns 409 event_not_found when receipt has no AssetCreated from registry", async () => {
      // Event emitted by another contract
      receiptLogs = [
        buildAssetCreatedLog({
          assetId: CHAIN_ASSET_ID,
          owner: ownerAccount.address,
          metadataHash: METADATA_HASH,
          emitter: `0x${"88".repeat(20)}`,
        }),
      ];

      const issuedAtMs = Date.now().toString();
      const signature = await signBinding({
        account: ownerAccount,
        propertyId: PROPERTY_ID,
        userId: OWNER_USER_ID,
        chainAssetId: CHAIN_ASSET_ID,
        txHash: TX_HASH,
        issuedAtMs,
      });

      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: CHAIN_ASSET_ID,
          signature,
          issuedAtMs,
        },
        "valid-owner-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.error.code).toBe("event_not_found");
    });

    it("returns 409 event_not_found when AssetCreated event has different asset ID", async () => {
      receiptLogs = [
        buildAssetCreatedLog({
          assetId: `0x${"ff".repeat(32)}`,
          owner: ownerAccount.address,
          metadataHash: METADATA_HASH,
        }),
      ];

      const issuedAtMs = Date.now().toString();
      const signature = await signBinding({
        account: ownerAccount,
        propertyId: PROPERTY_ID,
        userId: OWNER_USER_ID,
        chainAssetId: CHAIN_ASSET_ID,
        txHash: TX_HASH,
        issuedAtMs,
      });

      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: CHAIN_ASSET_ID,
          signature,
          issuedAtMs,
        },
        "valid-owner-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.error.code).toBe("event_not_found");
    });

    it("returns 409 invalid_metadata_hash when AssetCreated metadataHash is zero", async () => {
      receiptLogs = [
        buildAssetCreatedLog({
          assetId: CHAIN_ASSET_ID,
          owner: ownerAccount.address,
          metadataHash: `0x${"00".repeat(32)}`,
        }),
      ];

      const issuedAtMs = Date.now().toString();
      const signature = await signBinding({
        account: ownerAccount,
        propertyId: PROPERTY_ID,
        userId: OWNER_USER_ID,
        chainAssetId: CHAIN_ASSET_ID,
        txHash: TX_HASH,
        issuedAtMs,
      });

      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: CHAIN_ASSET_ID,
          signature,
          issuedAtMs,
        },
        "valid-owner-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.error.code).toBe("invalid_metadata_hash");
    });
  });

  describe("Current Registry State Verification (409)", () => {
    it("returns 409 owner_mismatch when current registry owner differs from event owner", async () => {
      currentRegistryAsset.owner = foreignAccount.address;

      const issuedAtMs = Date.now().toString();
      const signature = await signBinding({
        account: ownerAccount,
        propertyId: PROPERTY_ID,
        userId: OWNER_USER_ID,
        chainAssetId: CHAIN_ASSET_ID,
        txHash: TX_HASH,
        issuedAtMs,
      });

      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: CHAIN_ASSET_ID,
          signature,
          issuedAtMs,
        },
        "valid-owner-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.error.code).toBe("owner_mismatch");
    });

    it("returns 409 metadata_mismatch when current registry metadataHash differs from event", async () => {
      currentRegistryAsset.metadataHash = `0x${"99".repeat(32)}`;

      const issuedAtMs = Date.now().toString();
      const signature = await signBinding({
        account: ownerAccount,
        propertyId: PROPERTY_ID,
        userId: OWNER_USER_ID,
        chainAssetId: CHAIN_ASSET_ID,
        txHash: TX_HASH,
        issuedAtMs,
      });

      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: CHAIN_ASSET_ID,
          signature,
          issuedAtMs,
        },
        "valid-owner-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.error.code).toBe("metadata_mismatch");
    });

    it("returns 409 invalid_status when current registry status is not SUBMITTED", async () => {
      currentRegistryAsset.status = 1; // UNDER_VERIFICATION

      const issuedAtMs = Date.now().toString();
      const signature = await signBinding({
        account: ownerAccount,
        propertyId: PROPERTY_ID,
        userId: OWNER_USER_ID,
        chainAssetId: CHAIN_ASSET_ID,
        txHash: TX_HASH,
        issuedAtMs,
      });

      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: CHAIN_ASSET_ID,
          signature,
          issuedAtMs,
        },
        "valid-owner-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.error.code).toBe("invalid_status");
      expect(json.error.message).toBe("The on-chain asset status must be SUBMITTED.");
    });
  });

  describe("Database Update & Concurrency Handling (409, 200)", () => {
    it("returns 409 conflict when conditional update matches zero rows (concurrent bind)", async () => {
      updateResultRows = []; // Zero rows updated

      const issuedAtMs = Date.now().toString();
      const signature = await signBinding({
        account: ownerAccount,
        propertyId: PROPERTY_ID,
        userId: OWNER_USER_ID,
        chainAssetId: CHAIN_ASSET_ID,
        txHash: TX_HASH,
        issuedAtMs,
      });

      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: CHAIN_ASSET_ID,
          signature,
          issuedAtMs,
        },
        "valid-owner-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.error.code).toBe("conflict");
      expect(json.error.message).toBe("The property has already been bound or is not in draft state.");
    });

    it("returns 409 conflict when concurrent bind causes unique constraint violation", async () => {
      updateError = {
        code: "23505",
        message: 'duplicate key value violates unique constraint "properties_chain_asset_id_key"',
      };

      const issuedAtMs = Date.now().toString();
      const signature = await signBinding({
        account: ownerAccount,
        propertyId: PROPERTY_ID,
        userId: OWNER_USER_ID,
        chainAssetId: CHAIN_ASSET_ID,
        txHash: TX_HASH,
        issuedAtMs,
      });

      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: CHAIN_ASSET_ID,
          signature,
          issuedAtMs,
        },
        "valid-owner-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.error.code).toBe("conflict");
      expect(json.error.message).toBe("This on-chain asset is already bound to a property.");
    });

    it("successfully binds property, conditionally updates DB to SUBMITTED, and returns 200 { property }", async () => {
      const issuedAtMs = Date.now().toString();
      const signature = await signBinding({
        account: ownerAccount,
        propertyId: PROPERTY_ID,
        userId: OWNER_USER_ID,
        chainAssetId: CHAIN_ASSET_ID,
        txHash: TX_HASH,
        issuedAtMs,
      });

      const request = makeBindRequest(
        PROPERTY_ID,
        {
          txHash: TX_HASH,
          chainAssetId: CHAIN_ASSET_ID,
          signature,
          issuedAtMs,
        },
        "valid-owner-jwt",
      );

      const response = await bindChain(request, {
        params: Promise.resolve({ id: PROPERTY_ID }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();

      // Verify response structure
      expect(json.property).toBeDefined();
      expect(json.property.id).toBe(PROPERTY_ID);
      expect(json.property.statusCache).toBe("SUBMITTED");
      expect(json.property.chainAssetId).toBe(CHAIN_ASSET_ID);

      // Verify exact DB conditional update was performed
      expect(updateCalls).toHaveLength(1);
      const update = updateCalls[0];
      expect(update).toBeDefined();
      expect(update?.payload).toEqual({
        chain_asset_id: CHAIN_ASSET_ID,
        status_cache: "SUBMITTED",
      });
      expect(update?.filters).toEqual({
        id: PROPERTY_ID,
        owner_user_id: OWNER_USER_ID,
        status_cache: "DRAFT",
        chain_asset_id: null,
      });
    });
  });
});
