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
import { GET as listProperties, POST as createProperty } from "../../app/api/properties/route";
import { GET as getPropertyDetail } from "../../app/api/properties/[id]/route";
import { POST as uploadDocument } from "../../app/api/properties/[id]/documents/route";
import { hashBuffer } from "./documents";

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

describe("POST /api/properties route-level tests", () => {
  it("creates property with DRAFT status and omits status_cache from client insert payload", async () => {
    let capturedInsertPayload: Record<string, unknown> | null = null;

    vi.spyOn(supabaseModule, "createUserClient").mockImplementation((_config, token) => {
      if (!token) {
        // anonClient used by requireAuth
        return {
          auth: {
            getUser: vi.fn().mockImplementation(async (jwt: string) => {
              if (jwt === "valid-owner-jwt") {
                return {
                  data: {
                    user: {
                      id: "11111111-1111-1111-1111-111111111111",
                      email: "owner@example.com",
                    },
                  },
                  error: null,
                };
              }
              return { data: { user: null }, error: { message: "Invalid session" } };
            }),
          },
        } as unknown as supabaseModule.UserSupabaseClient;
      }

      // userClient used to insert property
      return {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "properties") {
            return {
              insert: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
                capturedInsertPayload = payload;
                return {
                  select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        ...samplePropertyRow,
                        external_id: payload.external_id,
                        name: payload.name,
                        slug: payload.slug,
                        status_cache: "DRAFT",
                      },
                      error: null,
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

    const createBody = {
      externalId: "ARCHPROP-TEST-CREATE",
      name: "Villa Test Create",
      propertyType: "RESIDENTIAL",
      location: "Bali, Indonesia",
      issuerName: "PT Bali Test",
      description: "A luxury test villa.",
      indicativeValue: "10000000000",
      offeringTarget: "3000000000",
      tokenSupply: "300000",
      tokenPrice: "10000",
      economicRightsBps: 3000,
    };

    const request = new NextRequest("http://localhost/api/properties", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer valid-owner-jwt",
      },
      body: JSON.stringify(createBody),
    });

    const response = await createProperty(request);
    expect(response.status).toBe(201);
    const json = await response.json();

    // Verify response DTO contains statusCache: "DRAFT"
    expect(json.property.statusCache).toBe("DRAFT");
    expect(json.property.externalId).toBe("ARCHPROP-TEST-CREATE");

    // CRITICAL: Ensure client-supplied insert payload strictly omits status_cache
    // so PostgreSQL column-level INSERT privileges and DB defaults are respected.
    const payload = capturedInsertPayload as Record<string, unknown> | null;
    expect(payload).not.toBeNull();
    expect(payload).not.toHaveProperty("status_cache");
    expect(payload?.owner_user_id).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("rejects unauthenticated creation request with 401", async () => {
    const request = new NextRequest("http://localhost/api/properties", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Unauth Property" }),
    });

    const response = await createProperty(request);
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error.code).toBe("unauthorized");
  });
});

describe("POST /api/properties/:id/documents route-level tests", () => {
  const propertyId = "11111111-2222-3333-4444-555555555555";
  const validOwnerId = "11111111-1111-1111-1111-111111111111";
  const nonOwnerId = "99999999-9999-9999-9999-999999999999";
  const validPdfBytes = Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Title (Test Deed) >>\nendobj\ntrailer\n<<>>\n%%EOF",
  );

  function makeDocRequest(options: {
    token?: string | undefined;
    fileBytes?: Buffer | undefined;
    fileName?: string | undefined;
    contentType?: string | undefined;
    documentType?: string | undefined;
  }): NextRequest {
    const form = new FormData();
    const bytes = options.fileBytes ?? validPdfBytes;
    const name = options.fileName ?? "deed.pdf";
    const type = options.contentType ?? "application/pdf";
    form.append("file", new File([new Uint8Array(bytes)], name, { type }));
    if (options.documentType !== undefined) {
      form.append("documentType", options.documentType);
    } else {
      form.append("documentType", "LAND_RIGHT");
    }

    return new NextRequest(`http://localhost/api/properties/${propertyId}/documents`, {
      method: "POST",
      headers: {
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body: form,
    });
  }

  it("rejects unauthenticated request with 401 without performing any service client write", async () => {
    const serviceSpy = vi.spyOn(supabaseModule, "createServiceClient");

    const request = makeDocRequest({ token: undefined });
    const response = await uploadDocument(request, {
      params: Promise.resolve({ id: propertyId }),
    });

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error.code).toBe("unauthorized");
    expect(serviceSpy).not.toHaveBeenCalled();
  });

  it("rejects non-owner caller with 403 before any storage write", async () => {
    vi.spyOn(supabaseModule, "createUserClient").mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: nonOwnerId, email: "nonowner@example.com" } },
          error: null,
        }),
      },
    } as unknown as supabaseModule.UserSupabaseClient);

    const storageUploadSpy = vi.fn();
    vi.spyOn(supabaseModule, "createServiceClient").mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "properties") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: propertyId, owner_user_id: validOwnerId },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
      storage: {
        from: vi.fn().mockReturnValue({
          upload: storageUploadSpy,
        }),
      },
    } as unknown as supabaseModule.UserSupabaseClient);

    const request = makeDocRequest({ token: "valid-non-owner-jwt" });
    const response = await uploadDocument(request, {
      params: Promise.resolve({ id: propertyId }),
    });

    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.error.code).toBe("forbidden");
    expect(json.error.message).toBe("You do not own this property.");
    expect(storageUploadSpy).not.toHaveBeenCalled();
  });

  it("rejects non-PDF content with 415 before storage upload or document insert", async () => {
    vi.spyOn(supabaseModule, "createUserClient").mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: validOwnerId, email: "owner@example.com" } },
          error: null,
        }),
      },
    } as unknown as supabaseModule.UserSupabaseClient);

    const storageUploadSpy = vi.fn();
    const documentInsertSpy = vi.fn();
    vi.spyOn(supabaseModule, "createServiceClient").mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "properties") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: propertyId, owner_user_id: validOwnerId },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "property_documents") {
          return {
            insert: documentInsertSpy,
          };
        }
        return {};
      }),
      storage: {
        from: vi.fn().mockReturnValue({
          upload: storageUploadSpy,
        }),
      },
    } as unknown as supabaseModule.UserSupabaseClient);

    // Provide non-PDF bytes (even with a .pdf extension)
    const request = makeDocRequest({
      token: "valid-owner-jwt",
      fileBytes: Buffer.from("PLAIN TEXT NOT A PDF DOCUMENT"),
      fileName: "fake.pdf",
    });

    const response = await uploadDocument(request, {
      params: Promise.resolve({ id: propertyId }),
    });

    expect(response.status).toBe(415);
    const json = await response.json();
    expect(json.error.code).toBe("unsupported_media_type");
    expect(json.error.message).toBe("Only PDF documents are accepted.");
    expect(storageUploadSpy).not.toHaveBeenCalled();
    expect(documentInsertSpy).not.toHaveBeenCalled();
  });

  it("rejects duplicate document type with 409 conflict before storage upload", async () => {
    vi.spyOn(supabaseModule, "createUserClient").mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: validOwnerId, email: "owner@example.com" } },
          error: null,
        }),
      },
    } as unknown as supabaseModule.UserSupabaseClient);

    const storageUploadSpy = vi.fn();
    vi.spyOn(supabaseModule, "createServiceClient").mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "properties") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: propertyId, owner_user_id: validOwnerId },
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
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { id: "existing-doc-id" },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
      storage: {
        from: vi.fn().mockReturnValue({
          upload: storageUploadSpy,
        }),
      },
    } as unknown as supabaseModule.UserSupabaseClient);

    const request = makeDocRequest({
      token: "valid-owner-jwt",
      documentType: "LAND_RIGHT",
    });

    const response = await uploadDocument(request, {
      params: Promise.resolve({ id: propertyId }),
    });

    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.error.code).toBe("conflict");
    expect(json.error.message).toBe("A document of this type already exists.");
    expect(storageUploadSpy).not.toHaveBeenCalled();
  });

  it("uploads valid PDF via service client, verifies stored SHA-256, inserts document row, and returns 201", async () => {
    vi.spyOn(supabaseModule, "createUserClient").mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: validOwnerId, email: "owner@example.com" } },
          error: null,
        }),
      },
    } as unknown as supabaseModule.UserSupabaseClient);

    let capturedStorageUploadPath: string | null = null;
    let capturedDocInsertPayload: Record<string, unknown> | null = null;

    vi.spyOn(supabaseModule, "createServiceClient").mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "properties") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: propertyId, owner_user_id: validOwnerId },
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
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: null,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
            insert: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
              capturedDocInsertPayload = payload;
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "new-doc-id-123",
                      property_id: propertyId,
                      document_type: payload.document_type,
                      document_hash: payload.document_hash,
                      storage_path: payload.storage_path,
                      is_demo: payload.is_demo,
                      created_at: "2026-08-22T00:00:00Z",
                    },
                    error: null,
                  }),
                }),
              };
            }),
          };
        }
        return {};
      }),
      storage: {
        from: vi.fn().mockReturnValue({
          upload: vi.fn().mockImplementation((path: string) => {
            capturedStorageUploadPath = path;
            return Promise.resolve({ data: { path }, error: null });
          }),
          download: vi.fn().mockResolvedValue({
            data: new Blob([new Uint8Array(validPdfBytes)]),
            error: null,
          }),
          remove: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      },
    } as unknown as supabaseModule.UserSupabaseClient);

    const request = makeDocRequest({
      token: "valid-owner-jwt",
      documentType: "LAND_RIGHT",
      fileName: "authentic_land_deed.pdf",
    });

    const response = await uploadDocument(request, {
      params: Promise.resolve({ id: propertyId }),
    });

    expect(response.status).toBe(201);
    const json = await response.json();

    const expectedHash = hashBuffer(validPdfBytes).sha256;

    // Verify response DTO
    expect(json.document.id).toBe("new-doc-id-123");
    expect(json.document.documentType).toBe("LAND_RIGHT");
    expect(json.document.sha256).toBe(expectedHash);
    expect(json.document.isDemo).toBe(true);

    // Verify storage write occurred under property UUID prefix
    const uploadPath = capturedStorageUploadPath as string | null;
    expect(uploadPath).not.toBeNull();
    expect(uploadPath?.startsWith(`${propertyId}/land_right-`)).toBe(true);

    // Verify service client insert payload
    const docPayload = capturedDocInsertPayload as Record<string, unknown> | null;
    expect(docPayload).not.toBeNull();
    expect(docPayload?.property_id).toBe(propertyId);
    expect(docPayload?.document_type).toBe("LAND_RIGHT");
    expect(docPayload?.document_hash).toBe(expectedHash);
    expect(docPayload?.uploaded_by).toBe(validOwnerId);
    expect(docPayload?.is_demo).toBe(true);
  });
});
