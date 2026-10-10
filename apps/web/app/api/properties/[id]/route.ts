/**
 * GET /api/properties/:id
 *
 * `:id` is either the property UUID or the lowercase bytes32 chain asset id.
 * Documents are owner-private: the query runs as the caller and RLS returns
 * only their own rows, so a non-owner legitimately sees `documents: []` rather
 * than an error. `chainCache` is always a distinct object so no client can
 * mistake cached rows for chain truth.
 */

import type { NextRequest } from "next/server";
import { loadConfig, describe } from "@/lib/server/config";
import { createUserClient } from "@/lib/server/supabase";
import { jsonError, notFound, serviceUnavailable, optionalBearerToken } from "@/lib/server/http";
import {
  toPropertyDto,
  toDocumentDto,
  toChainTransactionDto,
  type ChainTransactionDto,
  type DocumentDto,
  type PropertyDto,
  type PropertyDocumentRow,
  type PropertyRow,
  type ChainTransactionRow,
} from "@/lib/server/properties";

const PUBLIC_PROPERTY_COLUMNS =
  "id, chain_asset_id, external_id, name, slug, property_type, location, issuer_name, description, indicative_value, offering_target, token_supply, token_price, economic_rights_bps, status_cache, token_address, created_at";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASSET_ID_PATTERN = /^0x[0-9a-f]{64}$/;

function unavailable(error: unknown) {
  return serviceUnavailable(`Configuration error: ${describe(error)}`);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const configResult = loadConfig();
  if (!configResult.ok) {
    return unavailable(configResult.error);
  }

  const { id } = await params;
  const isUuid = UUID_PATTERN.test(id);
  const isAssetId = ASSET_ID_PATTERN.test(id);
  if (!isUuid && !isAssetId) {
    return notFound("Property not found.");
  }

  // The property row is public presentation data, so the anon client reads it
  // under the properties_select_public policy.
  const anonClient = createUserClient(configResult.config.supabase, "");

  const propertyQuery = anonClient
    .from("properties")
    .select(PUBLIC_PROPERTY_COLUMNS)
    .limit(1);
  const { data: propertyData, error: propertyError } = isUuid
    ? await propertyQuery.eq("id", id).single()
    : await propertyQuery.eq("chain_asset_id", id).single();

  if (propertyError || !propertyData) {
    return notFound("Property not found.");
  }
  const property = toPropertyDto(propertyData as unknown as PropertyRow);

  // Documents and chain references are private, so they must be read with the
  // caller's own client: RLS then returns the owner's rows and nothing else.
  // The anon client cannot see them at all, which would make the field
  // permanently empty for everyone including the owner. The route stays public
  // — an anonymous caller gets `documents: []` rather than a 401 — so the
  // token is optional and an invalid one degrades instead of failing the read.
  const callerClient = createUserClient(
    configResult.config.supabase,
    optionalBearerToken(request) ?? "",
  );

  const { data: documentData, error: documentError } = await callerClient
    .from("property_documents")
    .select("id, property_id, document_type, document_hash, storage_path, is_demo, created_at")
    .eq("property_id", property.id)
    .order("created_at", { ascending: true });

  if (documentError) {
    return jsonError(500, "query_failed", "Documents could not be loaded.");
  }
  const documents = ((documentData ?? []) as unknown as PropertyDocumentRow[]).map(toDocumentDto);

  const { data: transactionData, error: transactionError } = await callerClient
    .from("chain_transactions")
    .select("id, tx_hash, event_name, block_number")
    .eq("property_id", property.id)
    .order("created_at", { ascending: true });

  if (transactionError) {
    return jsonError(500, "query_failed", "Chain references could not be loaded.");
  }
  const chainCache = ((transactionData ?? []) as unknown as ChainTransactionRow[]).map(
    toChainTransactionDto,
  );

  return Response.json({
    property,
    documents,
    chainCache,
  } satisfies {
    property: PropertyDto;
    documents: DocumentDto[];
    chainCache: ChainTransactionDto[];
  });
}
