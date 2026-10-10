/**
 * Route-level integration tests for property API endpoints.
 *
 * Exercises the actual Next.js route handlers with mocked Supabase client
 * responses to verify:
 *  - GET /api/properties works without an Authorization header.
 *  - GET /api/properties/:id returns public property and public chainCache
 *    data to anon callers, with documents: [], without querying private
 *    property_documents as anon.
 *  - For an authenticated owner, documents are read under that user's JWT.
 *  - A malformed/invalid optional token does not turn a public detail request
 *    into a 500 or expose documents.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as supabaseModule from "./supabase";
import { GET as listProperties } from "../../app/api/properties/route";
import { GET as getPropertyDetail } from "../../app/api/properties/[id]/route";

const samplePropertyRow = {
  id: "11111111-2222-3333-4444-555555555555",
  chain_asset_id: "0x1756428cf9ce005285ddcf87c75240c798535bed95c6aeca6a5a7d3eb7b364ae",
  external_id: "ARCHPROP-001",
  name: "Villa Nusa",
  slug: "villa-nusa",
  property_type: "RESIDENTIAL",
  location: "Bali, Indonesia",
  issuer_name: "PT Nusa Properties",
  description: "A luxury villa in Bali offering 30% economic rights participation.",
  indicative_value: "10000000000",
  offering_target: "3000000000",
  token_supply: "300000",
  token_price: "10000",
  economic_rights_bps: 3000,
  status_cache: "DRAFT",
  token_address: null,
  created_at: "2026-08-22T00:00:00Z",
};

const sampleChainTransactionRow = {
  id: "22222222-3333-4444-5555-666666666666",
  tx_hash: "0x" + "aa".repeat(32),
  event_name: "AssetCreated",
  block_number: 12345,
};

const sampleDocumentRow = {
  id: "33333333-4444-5555-6666-777777777777",
  property_id: "11111111-2222-3333-4444-555555555555",
  document_type: "LAND_RIGHT",
  document_hash: "0x" + "bb".repeat(32),
  storage_path: "11111111-2222-3333-4444-555555555555/land_right.pdf",
  is_demo: true,
  created_at: "2026-08-22T00:00:00Z",
};

beforeAll(() => {
  process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL = "https://sepolia-rollup.arbitrum.io/rpc";
  process.env.NEXT_PUBLIC_ARCHPROP_REGISTRY_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  process.env.NEXT_PUBLIC_REVENUE_DISTRIBUTOR_ADDRESS = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
});

describe("GET /api/properties route-level tests", () => {
  it("works without an Authorization header (anonymous request)", async () => {
    const fromSpy = vi.fn().mockImplementation((table: string) => {
      if (table === "properties") {
        return {
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [samplePropertyRow],
              error: null,
            }),
          }),
        };
      }
      return {};
    });

    vi.spyOn(supabaseModule, "createUserClient").mockReturnValue({
      from: fromSpy,
    } as unknown as supabaseModule.UserSupabaseClient);

    const request = new NextRequest("http://localhost/api/properties");
    const response = await listProperties(request);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.properties).toHaveLength(1);
    expect(json.properties[0].name).toBe("Villa Nusa");
    expect(json.properties[0].externalId).toBe("ARCHPROP-001");
    // Verify no private columns returned
    expect(json.properties[0].owner_user_id).toBeUndefined();
    expect(json.properties[0].address_private).toBeUndefined();
  });
});

describe("GET /api/properties/:id route-level tests", () => {
  it("returns public property and chainCache to anon caller with documents: [] without querying property_documents", async () => {
    const queriedTables: string[] = [];

    const mockFrom = (table: string) => {
      queriedTables.push(table);
      if (table === "properties") {
        return {
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: samplePropertyRow,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "chain_transactions") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [sampleChainTransactionRow],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "property_documents") {
        // If queried as anon, this test should notice!
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "permission denied for table property_documents", code: "42501" },
              }),
            }),
          }),
        };
      }
      return {};
    };

    vi.spyOn(supabaseModule, "createUserClient").mockReturnValue({
      from: vi.fn().mockImplementation(mockFrom),
    } as unknown as supabaseModule.UserSupabaseClient);

    // Anonymous request: no Authorization header
    const request = new NextRequest("http://localhost/api/properties/11111111-2222-3333-4444-555555555555");
    const response = await getPropertyDetail(request, {
      params: Promise.resolve({ id: "11111111-2222-3333-4444-555555555555" }),
    });

    expect(response.status).toBe(200);
    const json = await response.json();

    // Must return public property and public chainCache
    expect(json.property.name).toBe("Villa Nusa");
    expect(json.chainCache).toHaveLength(1);
    expect(json.chainCache[0].eventName).toBe("AssetCreated");

    // Documents MUST be empty array
    expect(json.documents).toEqual([]);

    // CRITICAL: Must NEVER have queried property_documents as anon!
    expect(queriedTables).toContain("properties");
    expect(queriedTables).toContain("chain_transactions");
    expect(queriedTables).not.toContain("property_documents");
  });

  it("reads documents under authenticated owner token and returns them", async () => {
    const clientMap = new Map<string | undefined, string[]>();

    vi.spyOn(supabaseModule, "createUserClient").mockImplementation(
      (_config, token) => {
        const tokenKey = token ?? "anon";
        clientMap.set(tokenKey, []);

        return {
          from: vi.fn().mockImplementation((table: string) => {
            clientMap.get(tokenKey)?.push(table);
            if (table === "properties") {
              return {
                select: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({
                        data: samplePropertyRow,
                        error: null,
                      }),
                    }),
                  }),
                }),
              };
            }
            if (table === "chain_transactions") {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({
                      data: [sampleChainTransactionRow],
                      error: null,
                    }),
                  }),
                }),
              };
            }
            if (table === "property_documents") {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({
                      data: [sampleDocumentRow],
                      error: null,
                    }),
                  }),
                }),
              };
            }
            return {};
          }),
        } as unknown as supabaseModule.UserSupabaseClient;
      },
    );

    const request = new NextRequest(
      "http://localhost/api/properties/11111111-2222-3333-4444-555555555555",
      {
        headers: { authorization: "Bearer valid-owner-jwt-token" },
      },
    );

    const response = await getPropertyDetail(request, {
      params: Promise.resolve({ id: "11111111-2222-3333-4444-555555555555" }),
    });

    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.property.name).toBe("Villa Nusa");
    expect(json.documents).toHaveLength(1);
    expect(json.documents[0].documentType).toBe("LAND_RIGHT");
    expect(json.documents[0].sha256).toBe(sampleDocumentRow.document_hash);

    // Verify property_documents was queried with the authenticated client
    expect(clientMap.get("valid-owner-jwt-token")).toContain("property_documents");
  });

  it("gracefully degrades to documents: [] on invalid/malformed optional token without throwing 500", async () => {
    vi.spyOn(supabaseModule, "createUserClient").mockImplementation(
      () => {
        return {
          from: vi.fn().mockImplementation((table: string) => {
            if (table === "properties") {
              return {
                select: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({
                        data: samplePropertyRow,
                        error: null,
                      }),
                    }),
                  }),
                }),
              };
            }
            if (table === "chain_transactions") {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({
                      data: [sampleChainTransactionRow],
                      error: null,
                    }),
                  }),
                }),
              };
            }
            if (table === "property_documents") {
              // Simulated PostgREST / Supabase auth error for invalid token
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({
                      data: null,
                      error: { message: "Invalid JWT: token signature invalid", code: "PGRST301" },
                    }),
                  }),
                }),
              };
            }
            return {};
          }),
        } as unknown as supabaseModule.UserSupabaseClient;
      },
    );

    const request = new NextRequest(
      "http://localhost/api/properties/11111111-2222-3333-4444-555555555555",
      {
        headers: { authorization: "Bearer invalid.malformed.expired.jwt" },
      },
    );

    const response = await getPropertyDetail(request, {
      params: Promise.resolve({ id: "11111111-2222-3333-4444-555555555555" }),
    });

    // Must NOT be a 500 query_failed!
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.property.name).toBe("Villa Nusa");
    expect(json.chainCache).toHaveLength(1);
    // Documents safely degrades to [] and is never exposed
    expect(json.documents).toEqual([]);
  });
});
