/**
 * GET /api/properties, POST /api/properties
 *
 * GET is public presentation data. POST requires a signed-in owner and creates
 * the off-chain property record; it deliberately does NOT submit anything
 * on-chain — `chainAssetId` stays null until a wallet does that itself.
 */

import type { NextRequest } from "next/server";
import { loadConfig, describe } from "../../../lib/server/config";
import { createUserClient } from "../../../lib/server/supabase";
import {
  readJsonBody,
  requireAuth,
  optionalBearerToken,
  serviceUnavailable,
  forbidden,
  validationError,
  isUniqueViolation,
  isConstraintViolation,
  isPermissionDenied,
  jsonError,
  badRequest,
} from "../../../lib/server/http";
import { createPropertySchema, listPropertiesQuerySchema } from "../../../lib/server/schemas";
import { deriveSlugWithSuffix } from "../../../lib/server/slug";
import {
  toPropertyDto,
  type PropertyDto,
  type PropertyRow,
} from "../../../lib/server/properties";

/** Columns safe for the public presentation contract. */
const PUBLIC_PROPERTY_COLUMNS =
  "id, chain_asset_id, external_id, name, slug, property_type, location, issuer_name, description, indicative_value, offering_target, token_supply, token_price, economic_rights_bps, status_cache, token_address, created_at";

function unavailable(error: unknown) {
  return serviceUnavailable(`Configuration error: ${describe(error)}`);
}

export async function GET(request: NextRequest) {
  const configResult = loadConfig();
  if (!configResult.ok) {
    return unavailable(configResult.error);
  }

  const parsedQuery = listPropertiesQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries()),
  );
  if (!parsedQuery.success) {
    return validationError(parsedQuery.error);
  }
  const { status, q } = parsedQuery.data;

  // Reads run as the caller when they are signed in, so RLS applies; otherwise
  // the anon client, which can only see the public presentation columns.
  const token = optionalBearerToken(request);
  const client = createUserClient(configResult.config.supabase, token);

  let query = client
    .from("properties")
    .select(PUBLIC_PROPERTY_COLUMNS)
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status_cache", status);
  }
  if (q) {
    // Case-insensitive substring match on name, location, or issuer. The
    // pattern is escaped so `%` and `_` in user input are literal characters.
    const escaped = q.replace(/[\\%_]/g, (character) => `\\${character}`);
    query = query.or(
      `name.ilike.%${escaped}%,location.ilike.%${escaped}%,issuer_name.ilike.%${escaped}%`,
    );
  }

  const { data, error } = await query;
  if (error) {
    return jsonError(500, "query_failed", "Properties could not be loaded.");
  }

  const properties = ((data ?? []) as unknown as PropertyRow[]).map(toPropertyDto);
  return Response.json({ properties } satisfies { properties: PropertyDto[] });
}

export async function POST(request: NextRequest) {
  const configResult = loadConfig();
  if (!configResult.ok) {
    return unavailable(configResult.error);
  }

  const anonClient = createUserClient(configResult.config.supabase);
  const auth = await requireAuth(anonClient, request);
  if (!auth.ok) {
    return auth.response;
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    return body.response;
  }
  const parsed = createPropertySchema.safeParse(body.value);
  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const input = parsed.data;
  // The row is inserted through the caller's own client, so the
  // properties_insert_own policy (owner_user_id = auth.uid()) is what
  // authorizes the write — not a server-side check that could drift.
  const userClient = createUserClient(configResult.config.supabase, auth.auth.accessToken);

  const insertProperty = (slug: string) =>
    userClient
      .from("properties")
      .insert({
        owner_user_id: auth.auth.userId,
        external_id: input.externalId,
        name: input.name,
        slug,
        property_type: input.propertyType,
        location: input.location,
        issuer_name: input.issuerName,
        description: input.description,
        indicative_value: input.indicativeValue,
        offering_target: input.offeringTarget,
        token_supply: input.tokenSupply,
        token_price: input.tokenPrice,
        economic_rights_bps: input.economicRightsBps,
        status_cache: "DRAFT",
      })
      .select(PUBLIC_PROPERTY_COLUMNS)
      .single();

  // `slug` is derived server-side from the name: the column is `not null unique`
  // and format-constrained, and a client-supplied slug could squat a URL. Two
  // properties can legitimately share a name, so a collision on the derived
  // slug is retried with a numeric suffix rather than surfaced as a conflict —
  // a real duplicate `external_id` is the caller's fault and is still a 409.
  const MAX_SLUG_ATTEMPTS = 8;
  let data: unknown;
  let error: unknown;
  for (let attempt = 1; ; attempt += 1) {
    ({ data, error } = await insertProperty(deriveSlugWithSuffix(input.name, attempt)));

    const code = (error as { code?: string } | null)?.code;
    const message = (error as { message?: string } | null)?.message ?? "";
    const isSlugCollision =
      error !== null &&
      code === "23505" &&
      (message.includes("slug") || message.includes("properties_slug_key"));
    if (!isSlugCollision || attempt >= MAX_SLUG_ATTEMPTS) {
      break;
    }
  }

  if (error) {
    if (isUniqueViolation(error)) {
      return jsonError(409, "conflict", "A property with this external id already exists.");
    }
    if (isConstraintViolation(error)) {
      return badRequest("The submitted property values are inconsistent.");
    }
    if (isPermissionDenied(error)) {
      return forbidden();
    }
    return jsonError(500, "insert_failed", "The property could not be created.");
  }

  const row = data as unknown as PropertyRow;
  return Response.json({ property: toPropertyDto(row) }, { status: 201 });
}
