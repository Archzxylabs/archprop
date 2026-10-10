/**
 * Route-level integration tests for POST /api/properties/:id/documents/:documentId/access.
 *
 * Verifies:
 *  - Authentication gates (401 missing/invalid JWT)
 *  - Validation gates (404 malformed UUIDs, 422 missing/invalid fields, stale/future timestamps)
 *  - Property and document lookup (404 property/document not found, wrong pairing, 409 unbound)
 *  - Document type authorization per role (403 for illegal pairings, 403 for ECONOMIC_RIGHTS_AGREEMENT)
 *  - Chain verification (502 chain mismatch, 502 RPC error)
 *  - Asset status check (409 non-UNDER_VERIFICATION state)
 *  - Signature recovery and owner self-access rejection (403 owner self-access)
 *  - On-chain verifier role check (403 missing role, 502 RPC error)
 *  - Storage integrity verification (502 download error, 500 resting-hash mismatch)
 *  - Signed URL creation and headers (200 success with 60s expiration and Cache-Control: no-store)
 *  - Invariant: unauthorized cases NEVER invoke createSignedUrl.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createPublicClient, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildVerifierEvidenceAccessMessage,
  type AssetId,
} from "@archprop/shared";
import * as supabaseModule from "./supabase";
import { hashBuffer } from "./documents";
import {
  LEGAL_VERIFIER_ROLE,
  VALUATION_VERIFIER_ROLE,
  RegistryAssetStatus,
} from "./chain";
import { POST as accessDocument } from "../../app/api/properties/[id]/documents/[documentId]/access/route";

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(),
  };
});

const REGISTRY_ADDRESS: `0x${string}` = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const PROPERTY_ID = "11111111-2222-3333-4444-555555555555";
const DOCUMENT_ID = "22222222-3333-4444-5555-666666666666";
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

const samplePdfBuffer = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n",
);
const samplePdfHash = hashBuffer(samplePdfBuffer).sha256;

async function signAccess(args: {
  account: typeof legalVerifierAccount;
  propertyId: string;
  documentId: string;
  assetId: AssetId;
  role: "LEGAL" | "VALUATION";
  userId: string;
  issuedAtMs: string;
}): Promise<Hex> {
  const message = buildVerifierEvidenceAccessMessage({
    propertyId: args.propertyId,
    documentId: args.documentId,
    assetId: args.assetId,
    role: args.role,
    userId: args.userId,
    issuedAtMs: args.issuedAtMs,
  });
  return args.account.signMessage({ message });
}

function makeAccessRequest(
  propertyId: string,
  documentId: string,
  body: Record<string, unknown>,
  token?: string,
): NextRequest {
  return new NextRequest(
    `http://localhost/api/properties/${propertyId}/documents/${documentId}/access`,
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
  process.env.NEXT_PUBLIC_REVENUE_DISTRIBUTOR_ADDRESS = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
});

describe("POST /api/properties/:id/documents/:documentId/access", () => {
  let propertyRow: Record<string, unknown> | null;
  let documentRow: Record<string, unknown> | null;
  let currentRegistryAsset: {
    owner: `0x${string}`;
    metadataHash: `0x${string}`;
    agreementHash: `0x${string}`;
    status: number;
    token: `0x${string}`;
  };
  let rpcChainId: number;
  let storedFileBuffer: Buffer;
  let downloadError: { message: string } | null;
  let signedUrlResult: { data: { signedUrl: string } | null; error: { message: string } | null };
  let mockCreateSignedUrl: ReturnType<typeof vi.fn>;
  let rolesHeld: Record<string, boolean>;

  beforeEach(() => {
    propertyRow = {
      id: PROPERTY_ID,
      owner_user_id: OWNER_USER_ID,
      status_cache: "UNDER_VERIFICATION",
      chain_asset_id: CHAIN_ASSET_ID,
    };

    documentRow = {
      id: DOCUMENT_ID,
      property_id: PROPERTY_ID,
      document_type: "LAND_RIGHT",
      document_hash: samplePdfHash,
      storage_path: `${PROPERTY_ID}/land_right-sample.pdf`,
      is_demo: true,
    };

    currentRegistryAsset = {
      owner: ownerAccount.address,
      metadataHash: `0x${"22".repeat(32)}`,
      agreementHash: `0x${"00".repeat(32)}`,
      status: RegistryAssetStatus.UNDER_VERIFICATION,
      token: `0x${"00".repeat(20)}`,
    };

    rpcChainId = 421614;
    storedFileBuffer = samplePdfBuffer;
    downloadError = null;
    signedUrlResult = {
      data: { signedUrl: "https://example.supabase.co/storage/v1/object/sign/property-documents/test.pdf?token=abc" },
      error: null,
    };
    mockCreateSignedUrl = vi.fn().mockImplementation(async () => signedUrlResult);

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
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: documentRow,
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
        storage: {
          from: vi.fn().mockImplementation((bucket: string) => {
            if (bucket !== "property-documents") {
              throw new Error(`Unexpected bucket ${bucket}`);
            }
            return {
              download: vi.fn().mockImplementation(async () => {
                if (downloadError) {
                  return { data: null, error: downloadError };
                }
                return {
                  data: {
                    arrayBuffer: async () =>
                      storedFileBuffer.buffer.slice(
                        storedFileBuffer.byteOffset,
                        storedFileBuffer.byteOffset + storedFileBuffer.byteLength,
                      ),
                  },
                  error: null,
                };
              }),
              createSignedUrl: mockCreateSignedUrl,
            };
          }),
        },
      } as unknown as supabaseModule.UserSupabaseClient;
    });

    // Mock PublicClient for chain calls
    vi.mocked(createPublicClient).mockImplementation(() => {
      return {
        getChainId: vi.fn().mockImplementation(async () => rpcChainId),
        readContract: vi.fn().mockImplementation(async (args: {
          address: `0x${string}`;
          functionName: string;
          args: readonly unknown[];
        }) => {
          if (args.functionName === "getAsset") {
            return currentRegistryAsset;
          }
          if (args.functionName === "hasRole") {
            const role = String(args.args[0]).toLowerCase();
            const account = String(args.args[1]).toLowerCase();
            return Boolean(rolesHeld[`${role}:${account}`]);
          }
          throw new Error(`Unexpected readContract functionName ${args.functionName}`);
        }),
      } as unknown as ReturnType<typeof createPublicClient>;
    });
  });

  // 1. Authentication
  it("rejects request without authorization header with 401", async () => {
    const signature = await signAccess({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: Date.now().toString(),
    });

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "LEGAL", issuedAtMs: Date.now().toString(), signature },
      undefined,
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("unauthorized");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects request with invalid JWT with 401", async () => {
    const signature = await signAccess({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: Date.now().toString(),
    });

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "LEGAL", issuedAtMs: Date.now().toString(), signature },
      "expired-or-bad-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(401);
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  // 2. Validation
  it("rejects malformed property UUID in URL with 404", async () => {
    const req = makeAccessRequest(
      "not-a-uuid",
      DOCUMENT_ID,
      { role: "LEGAL", issuedAtMs: Date.now().toString(), signature: "0x" + "11".repeat(65) },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: "not-a-uuid", documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(404);
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects malformed document UUID in URL with 404", async () => {
    const req = makeAccessRequest(
      PROPERTY_ID,
      "invalid-doc-id",
      { role: "LEGAL", issuedAtMs: Date.now().toString(), signature: "0x" + "11".repeat(65) },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: "invalid-doc-id" }),
    });

    expect(res.status).toBe(404);
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects invalid role with 422", async () => {
    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "ADMIN", issuedAtMs: Date.now().toString(), signature: "0x" + "11".repeat(65) },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects malformed signature length with 422", async () => {
    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "LEGAL", issuedAtMs: Date.now().toString(), signature: "0x1234" },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(422);
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects stale issuedAtMs older than 10 minutes with 422", async () => {
    const staleTime = (Date.now() - 11 * 60 * 1000).toString();
    const signature = await signAccess({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: staleTime,
    });

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "LEGAL", issuedAtMs: staleTime, signature },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.fields?.issuedAtMs).toBeDefined();
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects future issuedAtMs greater than 60s with 422", async () => {
    const futureTime = (Date.now() + 120 * 1000).toString();
    const signature = await signAccess({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: futureTime,
    });

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "LEGAL", issuedAtMs: futureTime, signature },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(422);
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  // 3. Property & Document Lookup
  it("rejects nonexistent property with 404", async () => {
    propertyRow = null;
    const now = Date.now().toString();
    const signature = await signAccess({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects unbound property (chain_asset_id is null) with 409", async () => {
    propertyRow!.chain_asset_id = null;
    const now = Date.now().toString();
    const signature = await signAccess({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("unbound_asset");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects nonexistent document with 404", async () => {
    documentRow = null;
    const now = Date.now().toString();
    const signature = await signAccess({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(404);
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects wrong property/document pairing with 404", async () => {
    documentRow!.property_id = FOREIGN_PROPERTY_ID;
    const now = Date.now().toString();
    const signature = await signAccess({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(404);
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  // 4. Document Type Authorization
  it("rejects LEGAL role requesting APPRAISAL document with 403", async () => {
    documentRow!.document_type = "APPRAISAL";
    const now = Date.now().toString();
    const signature = await signAccess({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects LEGAL role requesting ECONOMIC_RIGHTS_AGREEMENT with 403", async () => {
    documentRow!.document_type = "ECONOMIC_RIGHTS_AGREEMENT";
    const now = Date.now().toString();
    const signature = await signAccess({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(403);
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects VALUATION role requesting LAND_RIGHT with 403", async () => {
    documentRow!.document_type = "LAND_RIGHT";
    const now = Date.now().toString();
    const signature = await signAccess({
      account: valuationVerifierAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
      assetId: CHAIN_ASSET_ID,
      role: "VALUATION",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "VALUATION", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(403);
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects VALUATION role requesting BUILDING_PERMIT with 403", async () => {
    documentRow!.document_type = "BUILDING_PERMIT";
    const now = Date.now().toString();
    const signature = await signAccess({
      account: valuationVerifierAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
      assetId: CHAIN_ASSET_ID,
      role: "VALUATION",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "VALUATION", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(403);
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects VALUATION role requesting ECONOMIC_RIGHTS_AGREEMENT with 403", async () => {
    documentRow!.document_type = "ECONOMIC_RIGHTS_AGREEMENT";
    const now = Date.now().toString();
    const signature = await signAccess({
      account: valuationVerifierAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
      assetId: CHAIN_ASSET_ID,
      role: "VALUATION",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "VALUATION", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(403);
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  // 5. Chain and On-Chain State Checks
  it("rejects wrong RPC chain ID with 502", async () => {
    rpcChainId = 1;
    const now = Date.now().toString();
    const signature = await signAccess({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("chain_mismatch");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects on-chain asset status that is not UNDER_VERIFICATION with 409", async () => {
    currentRegistryAsset.status = RegistryAssetStatus.SUBMITTED; // status 0
    const now = Date.now().toString();
    const signature = await signAccess({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_status");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  // 6. Signer & Role Checks
  it("rejects when signature cannot be recovered with 422", async () => {
    const now = Date.now().toString();
    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      {
        role: "LEGAL",
        issuedAtMs: now,
        // valid hex format but invalid recovery values
        signature: "0x" + "00".repeat(64) + "00",
      },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_signature");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects owner self-access with 403 when recovered signer is the asset owner", async () => {
    const now = Date.now().toString();
    // Asset owner signs the request
    const signature = await signAccess({
      account: ownerAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
    expect(body.error.message).toContain("owner");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects with 403 when signer does not hold the required verifier role on-chain", async () => {
    const now = Date.now().toString();
    // Sign with an account that has no verifier role
    const signature = await signAccess({
      account: foreignAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects with 502 when on-chain hasRole call fails", async () => {
    const now = Date.now().toString();
    const signature = await signAccess({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
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

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("chain_unavailable");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  // 7. Storage Integrity & Failures
  it("rejects with 502 when storage download fails", async () => {
    downloadError = { message: "Object not found in storage bucket" };
    const now = Date.now().toString();
    const signature = await signAccess({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("storage_failed");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects with 500 when resting PDF hash does not match recorded document_hash", async () => {
    // Tampered resting file content
    storedFileBuffer = Buffer.from("%PDF-1.4\ncorrupted or modified content\n%%EOF\n");
    const now = Date.now().toString();
    const signature = await signAccess({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("integrity_failed");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects with 502 when createSignedUrl fails", async () => {
    signedUrlResult = {
      data: null,
      error: { message: "Storage signed URL failed" },
    };
    const now = Date.now().toString();
    const signature = await signAccess({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("storage_failed");
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(1);
  });

  // 8. Successful Access
  it("grants 60-second signed URL for LEGAL verifier accessing LAND_RIGHT with Cache-Control: no-store", async () => {
    const now = Date.now().toString();
    const signature = await signAccess({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = await res.json();
    expect(body).toEqual({
      url: signedUrlResult.data!.signedUrl,
      expiresIn: 60,
      document: {
        id: DOCUMENT_ID,
        documentType: "LAND_RIGHT",
        sha256: samplePdfHash,
        isDemo: true,
      },
    });

    // Storage path must never be exposed in the response
    expect(body.storage_path).toBeUndefined();
    expect(body.storagePath).toBeUndefined();
    expect(body.document.storage_path).toBeUndefined();
    expect(body.document.storagePath).toBeUndefined();

    expect(mockCreateSignedUrl).toHaveBeenCalledWith(documentRow!.storage_path, 60);
  });

  it("grants 60-second signed URL for LEGAL verifier accessing BUILDING_PERMIT", async () => {
    documentRow!.document_type = "BUILDING_PERMIT";
    const now = Date.now().toString();
    const signature = await signAccess({
      account: legalVerifierAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
      assetId: CHAIN_ASSET_ID,
      role: "LEGAL",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "LEGAL", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.document.documentType).toBe("BUILDING_PERMIT");
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(1);
  });

  it("grants 60-second signed URL for VALUATION verifier accessing APPRAISAL", async () => {
    documentRow!.document_type = "APPRAISAL";
    const now = Date.now().toString();
    const signature = await signAccess({
      account: valuationVerifierAccount,
      propertyId: PROPERTY_ID,
      documentId: DOCUMENT_ID,
      assetId: CHAIN_ASSET_ID,
      role: "VALUATION",
      userId: VERIFIER_USER_ID,
      issuedAtMs: now,
    });

    const req = makeAccessRequest(
      PROPERTY_ID,
      DOCUMENT_ID,
      { role: "VALUATION", issuedAtMs: now, signature },
      "valid-verifier-jwt",
    );
    const res = await accessDocument(req, {
      params: Promise.resolve({ id: PROPERTY_ID, documentId: DOCUMENT_ID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.document.documentType).toBe("APPRAISAL");
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(1);
  });
});
