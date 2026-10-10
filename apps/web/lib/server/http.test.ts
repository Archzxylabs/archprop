import { describe, expect, it } from "vitest";
import { optionalBearerToken } from "./http";

function requestWith(header: string | null): Request {
  return new Request("http://localhost/api/properties/x", {
    headers: header === null ? {} : { authorization: header },
  });
}

describe("optionalBearerToken", () => {
  it("extracts a bearer token", () => {
    expect(optionalBearerToken(requestWith("Bearer abc.def.ghi"))).toBe("abc.def.ghi");
  });

  it("is case-insensitive about the scheme and tolerates padding", () => {
    expect(optionalBearerToken(requestWith("bearer   token"))).toBe("token");
  });

  it("returns null when no authorization header is present", () => {
    // The property detail route is public: a caller with no token reads the
    // property and simply sees no private rows, rather than being rejected.
    expect(optionalBearerToken(requestWith(null))).toBeNull();
  });

  it("returns null for a non-bearer scheme", () => {
    // `Basic xyz` must never be forwarded to Supabase as a credential.
    expect(optionalBearerToken(requestWith("Basic dXNlcjpwYXNz"))).toBeNull();
  });

  it("returns null for an empty or malformed bearer value", () => {
    expect(optionalBearerToken(requestWith("Bearer"))).toBeNull();
    expect(optionalBearerToken(requestWith("Bearer    "))).toBeNull();
  });

  it("keeps a token containing spaces", () => {
    // JWTs do not contain spaces, but a session token might; only leading and
    // trailing whitespace is trimmed.
    expect(optionalBearerToken(requestWith("Bearer a b c"))).toBe("a b c");
  });
});
