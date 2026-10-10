/**
 * Uniform JSON envelope and auth helpers for API route handlers.
 *
 * Every response — success or failure — uses one of the shapes documented in
 * docs/INTERFACES.md:
 *   success: { ...payload }
 *   failure: { "error": { "code": string, "message": string, "fields"?: object } }
 *
 * `code` values are stable machine-readable slugs; `message` is human text and
 * must never contain credentials, tokens, or raw internal error detail.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import type { UserSupabaseClient } from "./supabase";

export type FieldErrors = Record<string, string[]>;

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: FieldErrors };
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  fields?: FieldErrors,
): NextResponse<ApiErrorBody> {
  const body: ApiErrorBody = {
    error: fields ? { code, message, fields } : { code, message },
  };
  return NextResponse.json(body, { status });
}

export const badRequest = (message = "The request could not be processed.") =>
  jsonError(400, "bad_request", message);

export const unauthorized = (message = "Authentication is required.") =>
  jsonError(401, "unauthorized", message);

export const forbidden = (message = "You do not have access to this resource.") =>
  jsonError(403, "forbidden", message);

export const notFound = (message = "Resource not found.") =>
  jsonError(404, "not_found", message);

export const payloadTooLarge = (message: string) =>
  jsonError(413, "payload_too_large", message);

export const unsupportedMediaType = (message: string) =>
  jsonError(415, "unsupported_media_type", message);

export const serviceUnavailable = (message = "A required service is unavailable.") =>
  jsonError(503, "service_unavailable", message);

/** Validation failures from zod, mapped onto the documented `fields` shape. */
export function validationError(error: z.ZodError): NextResponse<ApiErrorBody> {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_root";
    const list = fields[key] ?? [];
    list.push(issue.message);
    fields[key] = list;
  }
  return jsonError(422, "validation_failed", "The submitted fields are invalid.", fields);
}

/** Reads and parses a JSON body, rejecting non-JSON rather than guessing. */
export async function readJsonBody(request: Request): Promise<
  { ok: true; value: unknown } | { ok: false; response: NextResponse<ApiErrorBody> }
> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, response: badRequest("The request body could not be read.") };
  }
  if (raw.trim() === "") {
    return { ok: false, response: badRequest("A JSON request body is required.") };
  }
  if (raw.length > 1_000_000) {
    return { ok: false, response: payloadTooLarge("The request body is too large.") };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, response: badRequest("The request body is not valid JSON.") };
  }
}

export interface AuthContext {
  userId: string;
  email: string | null;
  accessToken: string;
}

export type AuthResult =
  | { ok: true; auth: AuthContext }
  | { ok: false; response: NextResponse<ApiErrorBody> };

/**
 * Resolves the caller from the `Authorization: Bearer <jwt>` header.
 *
 * `getUser` verifies the JWT signature against the project's signing keys, so
 * a forged or expired token cannot establish an identity. A missing header is
 * a 401, not a fallback anonymous identity.
 */
export async function requireAuth(client: UserSupabaseClient, request: Request): Promise<AuthResult> {
  const header = request.headers.get("authorization");
  if (!header) {
    return { ok: false, response: unauthorized() };
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    return { ok: false, response: unauthorized("Malformed authorization header.") };
  }
  const accessToken = match[1];
  if (accessToken === undefined || accessToken === "") {
    return { ok: false, response: unauthorized("Malformed authorization header.") };
  }

  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) {
    return { ok: false, response: unauthorized("The session is invalid or has expired.") };
  }
  return {
    ok: true,
    auth: {
      userId: data.user.id,
      email: data.user.email ?? null,
      accessToken,
    },
  };
}

/**
 * Extracts a bearer token without requiring it to be valid.
 *
 * `GET /api/properties/:id` is a public route by contract: the property itself
 * is readable anonymously, while the owner-private tables in the same response
 * are simply empty for a caller who sent no usable token. So this must not
 * reject the request — it returns null and the route degrades to the anon view.
 *
 * Anything malformed yields null rather than being passed through, so a value
 * like `Basic xyz` can never reach Supabase as a credential.
 */
export function optionalBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1];
  return token !== undefined && token !== "" ? token : null;
}

/** Supabase/PostgREST errors carry the codes this API maps onto HTTP statuses. */
export function postgresErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/** True when the failure is a unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return postgresErrorCode(error) === "23505";
}

/** True when the failure is a foreign-key or check-constraint violation. */
export function isConstraintViolation(error: unknown): boolean {
  const code = postgresErrorCode(error);
  return code === "23503" || code === "23514";
}

/** True when RLS or a column grant denied the operation. */
export function isPermissionDenied(error: unknown): boolean {
  const code = postgresErrorCode(error);
  return code === "42501" || code === "42503";
}
