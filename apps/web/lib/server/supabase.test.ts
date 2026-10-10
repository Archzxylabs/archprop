import { describe, expect, it } from "vitest";
import { createUserClient, createServiceClient } from "./supabase";
import type { SupabaseConfig } from "./config";

const mockConfig: SupabaseConfig = {
  url: "https://example.supabase.co",
  anonKey: "test-anon-key-12345",
  serviceRoleKey: "test-service-role-key-67890",
};

type SupabaseClientInternals = {
  rest: {
    headers: Record<string, string | undefined>;
  };
  supabaseKey: string;
};

function getInternals(client: unknown): SupabaseClientInternals {
  return client as unknown as SupabaseClientInternals;
}

describe("createUserClient headers inspection", () => {
  it("omits custom Authorization header when created with no token (anonymous)", () => {
    const client = createUserClient(mockConfig);
    const headers = getInternals(client).rest.headers;

    // Must NOT have Authorization header so supabase-js supplies the anon key normally
    expect(headers.Authorization).toBeUndefined();
    expect(headers["authorization"]).toBeUndefined();
  });

  it("omits custom Authorization header when created with empty string", () => {
    const client = createUserClient(mockConfig, "");
    const headers = getInternals(client).rest.headers;

    expect(headers.Authorization).toBeUndefined();
    expect(headers["authorization"]).toBeUndefined();
  });

  it("omits custom Authorization header when created with whitespace-only string", () => {
    const client = createUserClient(mockConfig, "   ");
    const headers = getInternals(client).rest.headers;

    expect(headers.Authorization).toBeUndefined();
    expect(headers["authorization"]).toBeUndefined();
  });

  it("omits custom Authorization header when created with null", () => {
    const client = createUserClient(mockConfig, null);
    const headers = getInternals(client).rest.headers;

    expect(headers.Authorization).toBeUndefined();
    expect(headers["authorization"]).toBeUndefined();
  });

  it("never produces 'Bearer ' with an empty token", () => {
    for (const emptyToken of ["", " ", "   ", undefined, null]) {
      const client = createUserClient(mockConfig, emptyToken);
      const internals = getInternals(client);
      const authHeader = internals.rest.headers.Authorization ?? internals.rest.headers["authorization"];
      expect(authHeader).not.toBe("Bearer ");
      expect(authHeader).not.toBe("Bearer");
      expect(authHeader).toBeUndefined();
    }
  });

  it("attaches trimmed 'Bearer <token>' header when a valid token is provided", () => {
    const client = createUserClient(mockConfig, "my-jwt-token-xyz");
    const headers = getInternals(client).rest.headers;

    expect(headers.Authorization).toBe("Bearer my-jwt-token-xyz");
  });

  it("trims whitespace from token when setting Bearer header", () => {
    const client = createUserClient(mockConfig, "  padded-token-123  ");
    const headers = getInternals(client).rest.headers;

    expect(headers.Authorization).toBe("Bearer padded-token-123");
  });
});

describe("createServiceClient", () => {
  it("creates service client with service role key", () => {
    const client = createServiceClient(mockConfig);
    expect(client).toBeDefined();
    // service client default supabase key is serviceRoleKey
    expect(getInternals(client).supabaseKey).toBe(mockConfig.serviceRoleKey);
  });
});
