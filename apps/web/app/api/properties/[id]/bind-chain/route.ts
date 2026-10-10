/**
 * POST /api/properties/:id/bind-chain
 *
 * Binds an authenticated owner's existing DRAFT property UUID to an
 * already-confirmed Arbitrum Sepolia createAsset transaction.
 *
 * Invariants enforced:
 *   - Authenticates the draft owner via Supabase JWT.
 *   - Verifies the property is in DRAFT state and has no chain_asset_id.
 *   - Validates the frozen request fields (32-byte txHash and chainAssetId,
 *     65-byte signature, canonical decimal issuedAtMs within [now-10m, now+60s]).
 *   - Validates chainAssetId == keccak256(UTF-8 property.external_id).
 *   - Confirms RPC reports chain ID 421614.
 *   - Confirms the transaction succeeded and emitted AssetCreated from the
 *     configured ArchpropRegistry for this asset with a nonzero metadata hash.
 *   - Recovers the EIP-191 signer from buildPropertyBindingMessage and verifies
 *     the signer equals the event owner.
 *   - Reads the current registry asset and requires current owner and metadataHash
 *     to match the event and status to be SUBMITTED.
 *   - Performs one conditional service-role update setting chain_asset_id and
 *     status_cache = SUBMITTED, returning standard 409 on zero rows or unique races.
 *   - Never broadcasts a transaction or treats the DB as lifecycle authority.
 */

import type { NextRequest } from "next/server";
import { createPublicClient, http, keccak256, recoverMessageAddress, toHex } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { buildPropertyBindingMessage, type AssetId, type TxHash } from "@archprop/shared";
import { loadConfig, describe } from "../../../../../lib/server/config";
import { createServiceClient, createUserClient } from "../../../../../lib/server/supabase";
import {
  jsonError,
  notFound,
  forbidden,
  validationError,
  requireAuth,
  isUniqueViolation,
  serviceUnavailable,
  readJsonBody,
} from "../../../../../lib/server/http";
import { bindPropertyChainSchema } from "../../../../../lib/server/schemas";
import {
  PUBLIC_PROPERTY_COLUMNS,
  toPropertyDto,
  type PropertyRow,
} from "../../../../../lib/server/properties";
import {
  verifyRpcChainId,
  fetchVerifiedReceipt,
  receiptGetterFromClient,
  decodeAssetCreatedLogs,
  fetchRegistryAsset,
} from "../../../../../lib/server/chain";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unavailable(error: unknown) {
  return serviceUnavailable(`Configuration error: ${describe(error)}`);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const configResult = loadConfig();
  if (!configResult.ok) {
    return unavailable(configResult.error);
  }
  const config = configResult.config;

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return notFound("Property not found.");
  }

  // 1. Authenticate the caller
  const anonClient = createUserClient(config.supabase);
  const auth = await requireAuth(anonClient, request);
  if (!auth.ok) {
    return auth.response;
  }

  // 2. Parse and validate the request body
  const body = await readJsonBody(request);
  if (!body.ok) {
    return body.response;
  }
  const parsed = bindPropertyChainSchema.safeParse(body.value);
  if (!parsed.success) {
    return validationError(parsed.error);
  }
  const input = parsed.data;

  // 3. Load the property through the server service client
  const serviceClient = createServiceClient(config.supabase);
  const { data: property, error: propertyError } = await serviceClient
    .from("properties")
    .select("id, owner_user_id, status_cache, chain_asset_id, external_id")
    .eq("id", id)
    .limit(1)
    .maybeSingle();

  if (propertyError) {
    return jsonError(500, "query_failed", "The property could not be resolved.");
  }
  if (!property) {
    return notFound("Property not found.");
  }
  if (property.owner_user_id !== auth.auth.userId) {
    return forbidden("You do not own this property.");
  }
  if (property.status_cache !== "DRAFT" || property.chain_asset_id !== null) {
    return jsonError(
      409,
      "conflict",
      "The property is already bound or is not in draft state.",
    );
  }

  // 4. Verify chainAssetId == keccak256(UTF-8 property.external_id)
  const expectedAssetId = keccak256(toHex(property.external_id));
  if (input.chainAssetId.toLowerCase() !== expectedAssetId.toLowerCase()) {
    return jsonError(
      409,
      "asset_id_mismatch",
      "The chain asset id does not match the property external id.",
    );
  }

  // 5. Connect to RPC and verify chain ID (421614)
  const client = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(config.chain.rpcUrl),
  });

  const chainIdCheck = await verifyRpcChainId(
    () => client.getChainId(),
    config.chain.chainId,
  );
  if (!chainIdCheck.ok) {
    if (chainIdCheck.reason === "mismatch") {
      return jsonError(
        502,
        "chain_mismatch",
        `The RPC reports chain ID ${chainIdCheck.chainId}, but ${config.chain.chainId} is required.`,
      );
    }
    return jsonError(502, "chain_unavailable", "The chain could not be reached.");
  }

  // 6. Fetch verified transaction receipt
  const receiptCheck = await fetchVerifiedReceipt(
    receiptGetterFromClient(client),
    input.txHash,
  );
  if (!receiptCheck.ok) {
    if (receiptCheck.reason === "reverted") {
      return jsonError(409, "chain_reverted", "The referenced transaction reverted.");
    }
    if (receiptCheck.reason === "not_found") {
      return notFound("The referenced transaction was not found.");
    }
    return jsonError(502, "chain_unavailable", "The chain could not be reached.");
  }

  // 7. Decode AssetCreated log emitted by the configured ArchpropRegistry
  const matchingEvents = decodeAssetCreatedLogs(
    receiptCheck.logs,
    config.chain.registryAddress,
    input.chainAssetId,
  );
  if (matchingEvents.length === 0) {
    return jsonError(
      409,
      "event_not_found",
      "The transaction did not emit an AssetCreated event for this asset from the registry.",
    );
  }
  const event = matchingEvents[0];
  if (!event) {
    return jsonError(
      409,
      "event_not_found",
      "The transaction did not emit an AssetCreated event for this asset from the registry.",
    );
  }

  // Require nonzero metadata hash
  if (!event.metadataHash || BigInt(event.metadataHash) === 0n) {
    return jsonError(
      409,
      "invalid_metadata_hash",
      "The on-chain metadata hash must be nonzero.",
    );
  }

  // 8. Recover EIP-191 signer from buildPropertyBindingMessage
  const message = buildPropertyBindingMessage({
    propertyId: id,
    userId: auth.auth.userId,
    chainAssetId: input.chainAssetId.toLowerCase() as AssetId,
    txHash: input.txHash.toLowerCase() as TxHash,
    issuedAtMs: input.issuedAtMs,
  });

  let recoveredSigner: `0x${string}`;
  try {
    recoveredSigner = await recoverMessageAddress({
      message,
      signature: input.signature as `0x${string}`,
    });
  } catch {
    return jsonError(422, "invalid_signature", "The signature could not be recovered.");
  }

  if (recoveredSigner.toLowerCase() !== event.owner.toLowerCase()) {
    return jsonError(
      403,
      "signer_mismatch",
      "The signature does not match the on-chain asset owner.",
    );
  }

  // 9. Read the current registry asset and require current owner and metadataHash
  // to match the event, and current status to be SUBMITTED (0).
  const assetCheck = await fetchRegistryAsset(
    (args) => client.readContract(args),
    config.chain.registryAddress,
    input.chainAssetId,
  );
  if (!assetCheck.ok) {
    return jsonError(
      502,
      "chain_unavailable",
      "The on-chain asset could not be read from the registry.",
    );
  }

  const currentAsset = assetCheck.asset;
  if (currentAsset.owner.toLowerCase() !== event.owner.toLowerCase()) {
    return jsonError(
      409,
      "owner_mismatch",
      "The current on-chain asset owner does not match the creation event.",
    );
  }
  if (currentAsset.metadataHash.toLowerCase() !== event.metadataHash.toLowerCase()) {
    return jsonError(
      409,
      "metadata_mismatch",
      "The current on-chain metadata hash does not match the creation event.",
    );
  }
  // AssetStatus.SUBMITTED is 0
  if (currentAsset.status !== 0) {
    return jsonError(
      409,
      "invalid_status",
      "The on-chain asset status must be SUBMITTED.",
    );
  }

  // 10. Conditional service-role DB update
  const { data: updatedRows, error: updateError } = await serviceClient
    .from("properties")
    .update({
      chain_asset_id: input.chainAssetId.toLowerCase(),
      status_cache: "SUBMITTED",
    })
    .eq("id", id)
    .eq("owner_user_id", auth.auth.userId)
    .eq("status_cache", "DRAFT")
    .is("chain_asset_id", null)
    .select(PUBLIC_PROPERTY_COLUMNS);

  if (updateError) {
    if (isUniqueViolation(updateError)) {
      return jsonError(
        409,
        "conflict",
        "This on-chain asset is already bound to a property.",
      );
    }
    return jsonError(500, "update_failed", "The property could not be bound.");
  }

  if (!updatedRows || updatedRows.length === 0) {
    return jsonError(
      409,
      "conflict",
      "The property has already been bound or is not in draft state.",
    );
  }

  const row = updatedRows[0] as unknown as PropertyRow;
  return Response.json({ property: toPropertyDto(row) }, { status: 200 });
}
