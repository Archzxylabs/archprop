import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createPublicClient, encodeAbiParameters, encodeEventTopics, type Log } from "viem";
import { isUniqueViolation, jsonError, isConstraintViolation } from "./http";
import * as supabaseModule from "./supabase";
import { REVENUE_PUBLISHED_EVENT } from "./chain";
import { POST as recordRevenue } from "../../app/api/demo/revenue/route";

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(),
  };
});

const DISTRIBUTOR: `0x${string}` = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";
const ASSET_ID: `0x${string}` = "0x1756428cf9ce005285ddcf87c75240c798535bed95c6aeca6a5a7d3eb7b364ae";
const EVIDENCE_HASH: `0x${string}` = `0x${"44".repeat(32)}`;
const TX_HASH: `0x${string}` = `0x${"33".repeat(32)}`;
const OWNER_USER_ID = "11111111-1111-1111-1111-111111111111";
const PROPERTY_ID = "22222222-2222-2222-2222-222222222222";

function buildRevenuePublishedLog(args: {
  epochId: bigint;
  assetId: `0x${string}`;
  amount: bigint;
  evidenceHash: `0x${string}`;
  claimDeadline: bigint;
  emitter?: `0x${string}`;
}): Log {
  const topics = encodeEventTopics({
    abi: [REVENUE_PUBLISHED_EVENT],
    eventName: "RevenuePublished",
    args: { epochId: args.epochId, assetId: args.assetId },
  });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "bytes32" }, { type: "uint64" }],
    [args.amount, args.evidenceHash, args.claimDeadline],
  );
  return {
    address: args.emitter ?? DISTRIBUTOR,
    topics,
    data,
    blockNumber: 12_345n,
    blockHash: "0x" + "11".repeat(32),
    transactionHash: TX_HASH,
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  } as unknown as Log;
}

function makeRequest(body: Record<string, unknown>, token?: string): NextRequest {
  return new NextRequest("http://localhost/api/demo/revenue", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const validBody = {
  propertyId: PROPERTY_ID,
  period: "2026-Q3",
  assetId: ASSET_ID,
  amount: "5000000",
  evidenceHash: EVIDENCE_HASH,
  txHash: TX_HASH,
};

beforeAll(() => {
  process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL = "https://sepolia-rollup.arbitrum.io/rpc";
  process.env.NEXT_PUBLIC_ARCHPROP_REGISTRY_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  process.env.NEXT_PUBLIC_ARCHPROP_ESCROW_FACTORY_ADDRESS = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
  process.env.NEXT_PUBLIC_ARCHPROP_TOKEN_FACTORY_ADDRESS = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
  process.env.NEXT_PUBLIC_ARCHPROP_DISTRIBUTOR_ADDRESS = DISTRIBUTOR;
  process.env.NEXT_PUBLIC_REVENUE_DISTRIBUTOR_ADDRESS = DISTRIBUTOR;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
});

describe("Duplicate revenue period isolation and conflict handling", () => {
  describe("PostgreSQL error code classification", () => {
    it("identifies code 23505 as unique violation", () => {
      expect(isUniqueViolation({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe(true);
      expect(isUniqueViolation({ code: "23505" })).toBe(true);
    });

    it("rejects non-23505 codes as unique violations", () => {
      expect(isUniqueViolation({ code: "23503" })).toBe(false); // foreign key
      expect(isUniqueViolation({ code: "23514" })).toBe(false); // check constraint
      expect(isUniqueViolation({ code: "42501" })).toBe(false); // permission denied
      expect(isUniqueViolation(null)).toBe(false);
      expect(isUniqueViolation(undefined)).toBe(false);
      expect(isUniqueViolation("23505")).toBe(false);
      expect(isUniqueViolation({})).toBe(false);
    });

    it("identifies foreign key and check constraint violations", () => {
      expect(isConstraintViolation({ code: "23503" })).toBe(true);
      expect(isConstraintViolation({ code: "23514" })).toBe(true);
      expect(isConstraintViolation({ code: "23505" })).toBe(false);
    });
  });

  describe("Duplicate revenue period conflict responses", () => {
    it("generates correct 409 conflict envelope for pre-existing period", async () => {
      const response = jsonError(
        409,
        "conflict",
        "This period has already been recorded for this property.",
      );

      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json).toEqual({
        error: {
          code: "conflict",
          message: "This period has already been recorded for this property.",
        },
      });
    });

    it("simulates pre-check detection for duplicate (property_id, period)", async () => {
      const existingEpoch = { id: "987fcdeb-51a2-43d7-9012-3456789abcde" };

      const checkPeriodConflict = (existing: { id: string } | null) => {
        if (existing) {
          return jsonError(409, "conflict", "This period has already been recorded for this property.");
        }
        return null;
      };

      const conflictResponse = checkPeriodConflict(existingEpoch);
      expect(conflictResponse).not.toBeNull();
      expect(conflictResponse?.status).toBe(409);

      const json = await conflictResponse?.json();
      expect(json).toEqual({
        error: {
          code: "conflict",
          message: "This period has already been recorded for this property.",
        },
      });

      const okResponse = checkPeriodConflict(null);
      expect(okResponse).toBeNull();
    });

    it("simulates insert race-condition handling via unique constraint violation", async () => {
      const handleInsertResult = (insertError: unknown) => {
        if (insertError) {
          if (isUniqueViolation(insertError)) {
            return jsonError(409, "conflict", "This transaction has already been recorded.");
          }
          return jsonError(500, "insert_failed", "The revenue epoch could not be recorded.");
        }
        return { status: 201 };
      };

      const uniqueViolationError = {
        code: "23505",
        message: 'duplicate key value violates unique constraint "revenue_epochs_one_per_period"',
        detail: "Key (property_id, period)=(123, 2026-Q3) already exists.",
      };

      const response = handleInsertResult(uniqueViolationError);
      expect("status" in response && response.status).toBe(409);
      const json = await (response as { json: () => Promise<unknown> }).json();
      expect(json).toEqual({
        error: {
          code: "conflict",
          message: "This transaction has already been recorded.",
        },
      });

      const genericError = { code: "58000", message: "system error" };
      const errResponse = handleInsertResult(genericError);
      expect("status" in errResponse && errResponse.status).toBe(500);
    });
  });

  describe("POST /api/demo/revenue actual route handler regression tests", () => {
    let existingPeriodRow: { id: string } | null = null;
    let existingEpochRow: { id: string } | null = null;
    let insertError: unknown = null;
    let insertCalls: Array<Record<string, unknown>> = [];
    let mockPropertyOwnerId: string = OWNER_USER_ID;

    beforeEach(() => {
      existingPeriodRow = null;
      existingEpochRow = null;
      insertError = null;
      insertCalls = [];
      mockPropertyOwnerId = OWNER_USER_ID;

      // Mock createUserClient (auth validation)
      vi.spyOn(supabaseModule, "createUserClient").mockImplementation(() => {
        return {
          auth: {
            getUser: vi.fn().mockImplementation(async (token: string) => {
              if (token === "valid-owner-jwt") {
                return {
                  data: { user: { id: OWNER_USER_ID, email: "owner@example.com" } },
                  error: null,
                };
              }
              if (token === "non-owner-jwt") {
                return {
                  data: { user: { id: "attacker-user-id", email: "attacker@example.com" } },
                  error: null,
                };
              }
              return {
                data: { user: null },
                error: { message: "Invalid token", status: 401 },
              };
            }),
          },
        } as unknown as supabaseModule.UserSupabaseClient;
      });

      // Mock createServiceClient (property lookup, conflict pre-checks, cache insert)
      vi.spyOn(supabaseModule, "createServiceClient").mockImplementation(() => {
        return {
          from: vi.fn().mockImplementation((table: string) => {
            if (table === "properties") {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: {
                          id: PROPERTY_ID,
                          owner_user_id: mockPropertyOwnerId,
                          chain_asset_id: ASSET_ID,
                        },
                        error: null,
                      }),
                    }),
                  }),
                }),
              };
            }
            if (table === "revenue_epochs") {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockImplementation((col2: string) => ({
                      limit: vi.fn().mockReturnValue({
                        maybeSingle: vi.fn().mockImplementation(async () => {
                          if (col2 === "period") {
                            return { data: existingPeriodRow, error: null };
                          }
                          if (col2 === "chain_epoch_id") {
                            return { data: existingEpochRow, error: null };
                          }
                          return { data: null, error: null };
                        }),
                      }),
                    })),
                  }),
                }),
                insert: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
                  insertCalls.push(payload);
                  return {
                    select: vi.fn().mockReturnValue({
                      single: vi.fn().mockImplementation(async () => {
                        if (insertError) {
                          return { data: null, error: insertError };
                        }
                        return {
                          data: {
                            id: "rev-epoch-uuid-999",
                            ...payload,
                            created_at: "2026-08-22T00:00:00Z",
                          },
                          error: null,
                        };
                      }),
                    }),
                  };
                }),
              };
            }
            return {};
          }),
        } as unknown as supabaseModule.UserSupabaseClient;
      });

      // Default mock for viem createPublicClient (Arbitrum Sepolia + success receipt)
      vi.mocked(createPublicClient).mockReturnValue({
        getChainId: vi.fn().mockResolvedValue(421614),
        getTransactionReceipt: vi.fn().mockResolvedValue({
          status: "success",
          logs: [
            buildRevenuePublishedLog({
              epochId: 7n,
              assetId: ASSET_ID,
              amount: 5_000_000n,
              evidenceHash: EVIDENCE_HASH,
              claimDeadline: 1_700_000_000n,
            }),
          ],
        }),
      } as unknown as ReturnType<typeof createPublicClient>);
    });

    it("records a verified revenue epoch and returns 201 with revenueEpoch DTO", async () => {
      const request = makeRequest(validBody, "valid-owner-jwt");
      const response = await recordRevenue(request);

      expect(response.status).toBe(201);
      const json = await response.json();

      expect(json.revenueEpoch.id).toBe("rev-epoch-uuid-999");
      expect(json.revenueEpoch.period).toBe("2026-Q3");
      expect(json.revenueEpoch.distributableRevenue).toBe("5000000");
      expect(json.revenueEpoch.txHash).toBe(TX_HASH);
      expect(json.revenueEpoch.evidenceHash).toBe(EVIDENCE_HASH);

      // Verified service-role insert was invoked exactly once with decoded event data
      expect(insertCalls).toHaveLength(1);
      expect(insertCalls[0]?.property_id).toBe(PROPERTY_ID);
      expect(insertCalls[0]?.period).toBe("2026-Q3");
      expect(insertCalls[0]?.chain_epoch_id).toBe("7");
      expect(insertCalls[0]?.claim_deadline).toBe("1700000000");
    });

    it("rejects replay of the same verified on-chain epoch under a second period (409 conflict, performs no second insert)", async () => {
      // Simulate that chain_epoch_id '7' was already recorded under an earlier period
      existingEpochRow = { id: "epoch-uuid-previously-recorded" };

      // Caller attempts to reuse the same receipt/epoch under a different period "2026-Q4"
      const replayRequest = makeRequest(
        { ...validBody, period: "2026-Q4" },
        "valid-owner-jwt",
      );
      const response = await recordRevenue(replayRequest);

      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json).toEqual({
        error: {
          code: "conflict",
          message: "This on-chain revenue epoch has already been recorded for this property.",
        },
      });

      // Crucial: no second insert is performed!
      expect(insertCalls).toHaveLength(0);
    });

    it("rejects duplicate period submission (409 conflict, performs no insert)", async () => {
      // Simulate that period '2026-Q3' is already recorded
      existingPeriodRow = { id: "epoch-uuid-existing-period" };

      const request = makeRequest(validBody, "valid-owner-jwt");
      const response = await recordRevenue(request);

      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json).toEqual({
        error: {
          code: "conflict",
          message: "This period has already been recorded for this property.",
        },
      });

      expect(insertCalls).toHaveLength(0);
    });

    it("rejects concurrent replay via database unique constraint violation (409 conflict)", async () => {
      // Pre-checks pass, but concurrent write causes unique violation on insert
      insertError = {
        code: "23505",
        message: 'duplicate key value violates unique constraint "revenue_epochs_one_per_chain_epoch"',
      };

      const request = makeRequest(validBody, "valid-owner-jwt");
      const response = await recordRevenue(request);

      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json).toEqual({
        error: {
          code: "conflict",
          message: "This transaction or revenue epoch has already been recorded.",
        },
      });
    });

    it("rejects request when RPC reports foreign chain ID (502 chain_mismatch, no insert)", async () => {
      vi.mocked(createPublicClient).mockReturnValue({
        getChainId: vi.fn().mockResolvedValue(1), // Ethereum Mainnet
        getTransactionReceipt: vi.fn(),
      } as unknown as ReturnType<typeof createPublicClient>);

      const request = makeRequest(validBody, "valid-owner-jwt");
      const response = await recordRevenue(request);

      expect(response.status).toBe(502);
      const json = await response.json();
      expect(json).toEqual({
        error: {
          code: "chain_mismatch",
          message: "The RPC reports chain ID 1, but 421614 is required.",
        },
      });
      expect(insertCalls).toHaveLength(0);
    });

    it("rejects request when referenced transaction reverted on-chain (409 chain_reverted, no insert)", async () => {
      vi.mocked(createPublicClient).mockReturnValue({
        getChainId: vi.fn().mockResolvedValue(421614),
        getTransactionReceipt: vi.fn().mockResolvedValue({
          status: "reverted",
          logs: [],
        }),
      } as unknown as ReturnType<typeof createPublicClient>);

      const request = makeRequest(validBody, "valid-owner-jwt");
      const response = await recordRevenue(request);

      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json).toEqual({
        error: {
          code: "chain_reverted",
          message: "The referenced transaction reverted.",
        },
      });
      expect(insertCalls).toHaveLength(0);
    });

    it("rejects request when event amount does not match submitted amount (409 amount_mismatch, no insert)", async () => {
      // Client submits amount 9999999, but on-chain event has 5000000
      const request = makeRequest({ ...validBody, amount: "9999999" }, "valid-owner-jwt");
      const response = await recordRevenue(request);

      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json).toEqual({
        error: {
          code: "amount_mismatch",
          message: "The amount does not match the chain event.",
        },
      });
      expect(insertCalls).toHaveLength(0);
    });

    it("rejects non-owner authenticated caller (403 forbidden, no insert)", async () => {
      const request = makeRequest(validBody, "non-owner-jwt");
      const response = await recordRevenue(request);

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json).toEqual({
        error: {
          code: "forbidden",
          message: "Only the property owner may record a revenue epoch.",
        },
      });
      expect(insertCalls).toHaveLength(0);
    });

    it("rejects unauthenticated request (401 unauthorized, no insert)", async () => {
      const request = makeRequest(validBody); // no authorization header
      const response = await recordRevenue(request);

      expect(response.status).toBe(401);
      expect(insertCalls).toHaveLength(0);
    });
  });
});
