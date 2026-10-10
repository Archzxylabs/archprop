/**
 * Route-level integration tests for POST /api/properties/:id/documents/discover.
 *
 * Verifies:
 *  - Authentication gates (401 missing/invalid JWT)
 *  - Validation gates (404 malformed property UUID, 422 missing/invalid fields, stale/future timestamps)
 *  - Property lookup and binding state (404 property not found, 409 unbound asset)
 *  - Chain verification (502 chain mismatch, 502 RPC error)
 *  - Asset status check (409 non-UNDER_VERIFICATION state)
 *  - Signer recovery and owner self-access rejection (403 owner self-access)
 *  - On-chain verifier role check (403 missing/wrong role, 502 RPC error)
 *  - Role-based document type filtering:
 *      LEGAL sees LAND_RIGHT and BUILDING_PERMIT;
 *      VALUATION sees APPRAISAL;
 *      Neither sees ECONOMIC_RIGHTS_AGREEMENT.
 *  - No cross-property document leakage
 *  - Never returns storage_path, PDF bytes, public URL, or signed URL
 *  - Never calls createSignedUrl
 *  - Sets Cache-Control: no-store on success and authorization-sensitive errors
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createPublicClient, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildVerifierEvidenceIndexMessage,
  type AssetId,
} from "@archprop/shared";
import * as supabaseModule from "./supabase";
import {
  LEGAL_VERIFIER_ROLE,
  VALUATION_VERIFIER_ROLE,
  RegistryAssetStatus,
} from "./chain";
import { POST as discoverDocuments } from "../../app/api/properties/[id]/documents/discover/route";

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
const FOREIGN_PROPERTY_ID = "88888888-9999-aaaa-bbbb-cccccccccccc";
const CHAIN_ASSET_ID = "0x1756428cf9ce005285ddcf87c75240c798535bed95c6aeca6a5a7d3eb7b364ae" as AssetId;
const VERIFIER_USER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OWNER_USER_ID = "33333333-4444-5555-6666-777777777777";

// Accounts for testing
const ownerAccount = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const legalVerifierAccount = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const valuationVerifierAccount = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);
const foreignAccount = privateKeyToAccount(
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
);

async function signDiscovery(args: {
  account: typeof legalVerifierAccount;
  propertyId: string;
  assetId: AssetId;
  role: "LEGAL" | "VALUATION";
  userId: string;
  issuedAtMs: string;
}): Promise<Hex> {
  const message = buildVerifierEvidenceIndexMessage({
    propertyId: args.propertyId,
    assetId: args.assetId,
    role: args.role,
    userId: args.userId,
    issuedAtMs: args.issuedAtMs,
  });
  return args.account.signMessage({ message });
}

function makeDiscoverRequest(
  propertyId: string,
  body: Record<string, unknown>,
  token?: string,
): NextRequest {
  return new NextRequest(
    `http://localhost/api/properties/${propertyId}/documents/discover`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    },
  );
}

beforeAll(() => {
  process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL = "https://sepolia-rollup.arbitrum.io/rpc";
  process.env.NEXT_PUBLIC_ARCHPROP_REGISTRY_ADDRESS = REGISTRY_ADDRESS;
  process.env.NEXT_PUBLIC_REVENUE_DISTRIBUTOR_ADDRESS = DISTRIBUTOR_ADDRESS;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
});

describe("POST /api/properties/:id/documents/discover", () => {
  let propertyRow: Record<string, unknown> | null;
  let allDocumentRows: Array<Record<string, unknown>>;
  let currentRegistryAsset: {
    owner: `0x${string}`;
    metadataHash: `0x${string}`;
    agreementHash: `0x${string}`;
    status: number;
    token: `0x${string}`;
  };
  let rpcChainId: number;
  let mockCreateSignedUrl: ReturnType<typeof vi.fn>;
  let rolesHeld: Record<string, boolean>;

  beforeEach(() => {
    propertyRow = {
      id: PROPERTY_ID,
      owner_user_id: OWNER_USER_ID,
      status_cache: "UNDER_VERIFICATION",
      chain_asset_id: CHAIN_ASSET_ID,
    };

    allDocumentRows = [
      {
        id: "11111111-0001-0000-0000-000000000000",
        property_id: PROPERTY_ID,
        document_type: "LAND_RIGHT",
        document_hash: "0x" + "11".repeat(32),
        storage_path: `${PROPERTY_ID}/land_right.pdf`,
        is_demo: true,
        created_at: "2026-08-22T00:00:00Z",
      },
      {
        id: "11111111-0002-0000-0000-000000000000",
        property_id: PROPERTY_ID,
        document_type: "BUILDING_PERMIT",
        document_hash: "0x" + "22".repeat(32),
        storage_path: `${PROPERTY_ID}/building_permit.pdf`,
        is_demo: true,
        created_at: "2026-08-22T00:01:00Z",
      },
      {
        id: "11111111-0003-0000-0000-000000000000",
        property_id: PROPERTY_ID,
        document_type: "APPRAISAL",
        document_hash: "0x" + "33".repeat(32),
        storage_path: `${PROPERTY_ID}/appraisal.pdf`,
        is_demo: true,
        created_at: "2026-08-22T00:02:00Z",
      },
      {
        id: "11111111-0004-0000-0000-000000000000",
        property_id: PROPERTY_ID,
        document_type: "ECONOMIC_RIGHTS_AGREEMENT",
        document_hash: "0x" + "44".repeat(32),
        storage_path: `${PROPERTY_ID}/agreement.pdf`,
        is_demo: true,
        created_at: "2026-08-22T00:03:00Z",
      },
      // Cross-property document that must never leak
      {
        id: "22222222-0001-0000-0000-000000000000",
        property_id: FOREIGN_PROPERTY_ID,
        document_type: "LAND_RIGHT",
        document_hash: "0x" + "55".repeat(32),
        storage_path: `${FOREIGN_PROPERTY_ID}/foreign_land_right.pdf`,
        is_demo: true,
        created_at: "2026-08-22T00:00:00Z",
      },
    ];

    currentRegistryAsset = {
      owner: ownerAccount.address,
      metadataHash: `0x${"22".repeat(32)}`,
      agreementHash: `0x${"00".repeat(32)}`,
      status: RegistryAssetStatus.UNDER_VERIFICATION,
      token: `0x${"00".repeat(20)}`,
    };

    rpcChainId = 421614;
    mockCreateSignedUrl = vi.fn();

    rolesHeld = {
      [`${LEGAL_VERIFIER_ROLE.toLowerCase()}:${legalVerifierAccount.address.toLowerCase()}`]: true,
      [`${VALUATION_VERIFIER_ROLE.toLowerCase()}:${valuationVerifierAccount.address.toLowerCase()}`]: true,
    };

    // Mock Supabase clients
    vi.spyOn(supabaseModule, "createUserClient").mockImplementation(() => {
      return {
        auth: {
          getUser: vi.fn().mockImplementation(async (jwt: string) => {
            if (jwt === "valid-verifier-jwt") {
              return {
                data: { user: { id: VERIFIER_USER_ID, email: "verifier@example.com" } },
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
            };
          }
          if (table === "property_documents") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockImplementation((col: string, val: string) => {
                  return {
                    in: vi.fn().mockImplementation((typeCol: string, types: string[]) => {
                      return {
                        order: vi.fn().mockImplementation(() => {
                          const filtered = allDocumentRows.filter(
                            (d) => d[col] === val && types.includes(String(d[typeCol])),
                          );
                          return Promise.resolve({ data: filtered, error: null });
                        }),
                      };
                    }),
                  };
                }),
              }),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
        storage: {
          from: vi.fn().mockReturnValue({
            createSignedUrl: mockCreateSignedUrl,
          }),
        },
      } as unknown as supabaseModule.UserSupabaseClient;
    });

    // Mock PublicClient for chain calls
    vi.mocked(createPublicClient).mockImplementation(() => {
      return {
        getChainId: vi.fn().mockImplementation(async () => rpcChainId),
        readContract: vi.fn().mockImplementation(async (args: {
          functionName: string;
          args?: readonly unknown[];
        }) => {
          if (args.functionName === "getAsset") {
            return currentRegistryAsset;
          }
          if (args.functionName === "hasRole") {
            const role = String(args.args?.[0]).toLowerCase();
            const account = String(args.args?.[1]).toLowerCase();
            return Boolean(rolesHeld[`${role}:${account}`]);
          }
          throw new Error(`Unexpected readContract functionName ${args.functionName}`);
        }),
      } as unknown as ReturnType<typeof createPublicClient>;
    });
  });

  // 1. Authentication
  it("rejects request without authorization header with 401 and Cache-Control: no-store", async () => {
    const signature = await signDiscovery({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: Date.now().toString(),
    });

    const req = makeDiscoverRequest(
      PROPERTY_ID,
      { role: "LEGAL", issuedAtMs: Date.now().toString(), signature },
      undefined,
    );
    const res = await discoverDocuments(req, {
      params: Promise.resolve({ id: PROPERTY_ID }),
    });

    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("unauthorized");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects request with invalid JWT with 401", async () => {
    const signature = await signDiscovery({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: Date.now().toString(),
    });

    const req = makeDiscoverRequest(
      PROPERTY_ID,
      { role: "LEGAL", issuedAtMs: Date.now().toString(), signature },
      "expired-jwt",
    );
    const res = await discoverDocuments(req, {
      params: Promise.resolve({ id: PROPERTY_ID }),
    });

    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  // 2. Validation
  it("rejects malformed property UUID in URL with 404", async () => {
    const req = makeDiscoverRequest(
      "invalid-property-uuid",
      { role: "LEGAL", issuedAtMs: Date.now().toString(), signature: "0x" + "11".repeat(65) },
      "valid-verifier-jwt",
    );
    const res = await discoverDocuments(req, {
      params: Promise.resolve({ id: "invalid-property-uuid" }),
    });

    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects invalid role with 422", async () => {
    const req = makeDiscoverRequest(
      PROPERTY_ID,
      { role: "INVALID_ROLE", issuedAtMs: Date.now().toString(), signature: "0x" + "11".repeat(65) },
      "valid-verifier-jwt",
    );
    const res = await discoverDocuments(req, {
      params: Promise.resolve({ id: PROPERTY_ID }),
    });

    expect(res.status).toBe(422);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects stale issuedAtMs older than 10 minutes with 422", async () => {
    const staleTime = (Date.now() - 11 * 60 * 1000).toString();
    const signature = await signDiscovery({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: staleTime,
    });

    const req = makeDiscoverRequest(
      PROPERTY_ID,
      { role: "LEGAL", issuedAtMs: staleTime, signature },
      "valid-verifier-jwt",
    );
    const res = await discoverDocuments(req, {
      params: Promise.resolve({ id: PROPERTY_ID }),
    });

    expect(res.status).toBe(422);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects future issuedAtMs greater than 60s with 422", async () => {
    const futureTime = (Date.now() + 120 * 1000).toString();
    const signature = await signDiscovery({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: futureTime,
    });

    const req = makeDiscoverRequest(
      PROPERTY_ID,
      { role: "LEGAL", issuedAtMs: futureTime, signature },
      "valid-verifier-jwt",
    );
    const res = await discoverDocuments(req, {
      params: Promise.resolve({ id: PROPERTY_ID }),
    });

    expect(res.status).toBe(422);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  // 3. Property & Chain State
  it("rejects nonexistent property with 404", async () => {
    propertyRow = null;
    const now = Date.now().toString();
    const signature = await signDiscovery({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeDiscoverRequest(
      PROPERTY_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await discoverDocuments(req, {
      params: Promise.resolve({ id: PROPERTY_ID }),
    });

    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects unbound property (chain_asset_id is null) with 409", async () => {
    propertyRow!.chain_asset_id = null;
    const now = Date.now().toString();
    const signature = await signDiscovery({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeDiscoverRequest(
      PROPERTY_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await discoverDocuments(req, {
      params: Promise.resolve({ id: PROPERTY_ID }),
    });

    expect(res.status).toBe(409);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("unbound_asset");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects wrong RPC chain ID with 502", async () => {
    rpcChainId = 1;
    const now = Date.now().toString();
    const signature = await signDiscovery({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeDiscoverRequest(
      PROPERTY_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await discoverDocuments(req, {
      params: Promise.resolve({ id: PROPERTY_ID }),
    });

    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("chain_mismatch");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects on-chain asset status that is not UNDER_VERIFICATION with 409", async () => {
    currentRegistryAsset.status = RegistryAssetStatus.SUBMITTED; // status 0
    const now = Date.now().toString();
    const signature = await signDiscovery({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeDiscoverRequest(
      PROPERTY_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await discoverDocuments(req, {
      params: Promise.resolve({ id: PROPERTY_ID }),
    });

    expect(res.status).toBe(409);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("invalid_status");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  // 4. Signer & Role Checks
  it("rejects owner self-access with 403 when recovered signer is the asset owner", async () => {
    const now = Date.now().toString();
    // Asset owner signs the request
    const signature = await signDiscovery({
      account: ownerAccount,
      propertyId: PROPERTY_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeDiscoverRequest(
      PROPERTY_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await discoverDocuments(req, {
      params: Promise.resolve({ id: PROPERTY_ID }),
    });

    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
    expect(body.error.message).toContain("owner");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects with 403 when signer does not hold the required verifier role on-chain", async () => {
    const now = Date.now().toString();
    // Sign with an account without verifier role
    const signature = await signDiscovery({
      account: foreignAccount,
      propertyId: PROPERTY_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeDiscoverRequest(
      PROPERTY_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await discoverDocuments(req, {
      params: Promise.resolve({ id: PROPERTY_ID }),
    });

    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects with 502 when on-chain hasRole check returns rpc_error", async () => {
    const now = Date.now().toString();
    const signature = await signDiscovery({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    vi.mocked(createPublicClient).mockImplementation(() => {
      return {
        getChainId: vi.fn().mockImplementation(async () => rpcChainId),
        readContract: vi.fn().mockImplementation(async (args: { functionName: string }) => {
          if (args.functionName === "getAsset") {
            return currentRegistryAsset;
          }
          if (args.functionName === "hasRole") {
            throw new Error("RPC error during hasRole");
          }
          throw new Error("Unexpected call");
        }),
      } as unknown as ReturnType<typeof createPublicClient>;
    });

    const req = makeDiscoverRequest(
      PROPERTY_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await discoverDocuments(req, {
      params: Promise.resolve({ id: PROPERTY_ID }),
    });

    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  // 5. Successful Discovery with Role Filtering
  it("returns LAND_RIGHT and BUILDING_PERMIT for LEGAL verifier; excludes APPRAISAL, AGREEMENT, foreign docs", async () => {
    const now = Date.now().toString();
    const signature = await signDiscovery({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeDiscoverRequest(
      PROPERTY_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await discoverDocuments(req, {
      params: Promise.resolve({ id: PROPERTY_ID }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = await res.json();
    expect(body.documents).toBeDefined();
    expect(body.documents).toHaveLength(2);

    const types = body.documents.map((d: { documentType: string }) => d.documentType);
    expect(types).toEqual(["LAND_RIGHT", "BUILDING_PERMIT"]);
    expect(types).not.toContain("APPRAISAL");
    expect(types).not.toContain("ECONOMIC_RIGHTS_AGREEMENT");

    // Every item has only id, documentType, sha256, isDemo
    for (const doc of body.documents) {
      expect(doc.id).toBeDefined();
      expect(doc.documentType).toBeDefined();
      expect(doc.sha256).toMatch(/^0x[0-9a-fA-F]{64}$/);
      expect(doc.isDemo).toBe(true);

      // Must never leak storage paths or URLs
      expect((doc as Record<string, unknown>).storage_path).toBeUndefined();
      expect((doc as Record<string, unknown>).storagePath).toBeUndefined();
      expect((doc as Record<string, unknown>).url).toBeUndefined();
      expect((doc as Record<string, unknown>).signedUrl).toBeUndefined();
    }

    // Top-level body must never leak storage paths or URLs
    expect(body.storage_path).toBeUndefined();
    expect(body.url).toBeUndefined();

    // Must never call createSignedUrl in discovery
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("returns APPRAISAL for VALUATION verifier; excludes LAND_RIGHT, BUILDING_PERMIT, AGREEMENT", async () => {
    const now = Date.now().toString();
    const signature = await signDiscovery({
      account: valuationVerifierAccount,
      propertyId: PROPERTY_ID,
      assetId: CHAIN_ASSET_ID,
      role: "VALUATION",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeDiscoverRequest(
      PROPERTY_ID,
      { role: "VALUATION", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await discoverDocuments(req, {
      params: Promise.resolve({ id: PROPERTY_ID }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = await res.json();
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].documentType).toBe("APPRAISAL");
    expect(body.documents[0].sha256).toBe("0x" + "33".repeat(32));
    expect(body.documents[0].isDemo).toBe(true);

    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });
});
