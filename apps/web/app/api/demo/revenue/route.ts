/**
 * POST /api/demo/revenue
 *
 * Records a revenue epoch that has already been published on-chain.
 *
 * This route never writes a transaction, never funds a distribution, and never
 * makes a distribution authoritative off-chain. It only accepts a reference to
 * a chain event that already happened: the receipt must be successful and must
 * contain a `RevenuePublished` log from the configured distributor whose
 * `assetId`, `amount`, and `evidenceHash` all match the request. Any mismatch
 * is a 409 — the database must not claim a distribution the chain contradicts.
 */

import type { NextRequest } from "next/server";
import { createPublicClient, http } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { loadConfig, describe } from "../../../../lib/server/config";
import { createServiceClient, createUserClient } from "../../../../lib/server/supabase";
import {
  readJsonBody,
  requireAuth,
  forbidden,
  notFound,
  jsonError,
  isUniqueViolation,
  serviceUnavailable,
} from "../../../../lib/server/http";
import { revenueEpochSchema } from "../../../../lib/server/schemas";
import {
  decodeRevenuePublishedLogs,
  fetchVerifiedReceipt,
  receiptGetterFromClient,
  verifyRpcChainId,
} from "../../../../lib/server/chain";
import {
  toRevenueEpochDto,
  type RevenueEpochRow,
} from "../../../../lib/server/properties";

function unavailable(error: unknown) {
  return serviceUnavailable(`Configuration error: ${describe(error)}`);
}

export async function POST(request: NextRequest) {
  const configResult = loadConfig();
  if (!configResult.ok) {
    return unavailable(configResult.error);
  }
  const config = configResult.config;

  const anonClient = createUserClient(config.supabase);
  const auth = await requireAuth(anonClient, request);
  if (!auth.ok) {
    return auth.response;
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    return body.response;
  }
  const parsed = revenueEpochSchema.safeParse(body.value);
  if (!parsed.success) {
    return jsonError(
      422,
      "validation_failed",
      "The submitted fields are invalid.",
      Object.fromEntries(
        parsed.error.issues.map((issue) => [
          issue.path.length > 0 ? issue.path.join(".") : "_root",
          [issue.message],
        ]),
      ),
    );
  }
  const input = parsed.data;

  // Resolve the property the caller must own through the server service client
  // after authentication. The restricted authenticated client cannot select
  // owner_user_id due to least-privilege column grants. We compare owner_user_id
  // with the authenticated user directly; client-supplied owners are never trusted.
  const serviceClient = createServiceClient(config.supabase);
  const { data: property, error: propertyError } = await serviceClient
    .from("properties")
    .select("id, owner_user_id, chain_asset_id")
    .eq("chain_asset_id", input.assetId)
    .limit(1)
    .maybeSingle();

  if (propertyError) {
    return jsonError(500, "query_failed", "The property could not be resolved.");
  }
  if (!property) {
    return notFound("No property is registered for this asset id.");
  }
  if (property.owner_user_id !== auth.auth.userId) {
    return forbidden("Only the property owner may record a revenue epoch.");
  }

  // ---- Chain verification -------------------------------------------------
  // The receipt is fetched from the configured RPC. Before trusting any
  // receipt, we MUST verify the RPC reports the exact expected chain ID (421614).
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

  const matchingLogs = decodeRevenuePublishedLogs(
    receiptCheck.logs,
    config.chain.revenueDistributorAddress,
    input.assetId,
  );
  if (matchingLogs.length === 0) {
    return jsonError(
      409,
      "no_matching_event",
      "The transaction contains no RevenuePublished event for this asset.",
    );
  }

  const epochLog = matchingLogs[0];
  if (epochLog === undefined) {
    return jsonError(409, "no_matching_event", "The matching event could not be decoded.");
  }

  // Every amount and hash must agree with the chain. A client that posts a
  // larger amount or different evidence hash is rejected outright.
  if (epochLog.amount !== BigInt(input.amount)) {
    return jsonError(409, "amount_mismatch", "The amount does not match the chain event.");
  }
  if (epochLog.evidenceHash.toLowerCase() !== input.evidenceHash) {
    return jsonError(409, "evidence_mismatch", "The evidence hash does not match the chain event.");
  }

  // ---- Record the reference ----------------------------------------------
  // The insert runs through the server service client because client roles
  // (anon and authenticated) have no INSERT privilege on revenue_epochs to
  // prevent cache spoofing. This write is strictly authorized by the ownership
  // check, chain ID 421614 verification, valid receipt, and matching event log.
  // chain_epoch_id is taken from the decoded log, never from the request.

  // Pre-check 1: one epoch per (property, period).
  const { data: existingPeriod, error: periodCheckError } = await serviceClient
    .from("revenue_epochs")
    .select("id")
    .eq("property_id", property.id)
    .eq("period", input.period)
    .limit(1)
    .maybeSingle();
  if (periodCheckError) {
    return jsonError(500, "query_failed", "Existing revenue records could not be checked.");
  }
  if (existingPeriod) {
    return jsonError(409, "conflict", "This period has already been recorded for this property.");
  }

  // Pre-check 2: one record per verified (property, chain_epoch_id) to prevent replay
  // of an on-chain epoch under a different off-chain period.
  const chainEpochIdStr = epochLog.epochId.toString(10);
  const { data: existingEpoch, error: epochCheckError } = await serviceClient
    .from("revenue_epochs")
    .select("id")
    .eq("property_id", property.id)
    .eq("chain_epoch_id", chainEpochIdStr)
    .limit(1)
    .maybeSingle();
  if (epochCheckError) {
    return jsonError(500, "query_failed", "Existing revenue records could not be checked.");
  }
  if (existingEpoch) {
    return jsonError(
      409,
      "conflict",
      "This on-chain revenue epoch has already been recorded for this property.",
    );
  }

  const { data: row, error: insertError } = await serviceClient
    .from("revenue_epochs")
    .insert({
      property_id: property.id,
      period: input.period,
      distributable_revenue: input.amount,
      evidence_hash: input.evidenceHash,
      chain_tx_hash: input.txHash,
      chain_epoch_id: chainEpochIdStr,
      chain_block_number: epochLog.blockNumber,
      // The claim deadline is read from the decoded event, never from the
      // request. It is the one column the client cannot influence, and leaving
      // it null would silently drop chain state the schema already models.
      claim_deadline: epochLog.claimDeadline.toString(10),
    })
    .select(
      "id, period, distributable_revenue, evidence_hash, chain_tx_hash, chain_epoch_id, chain_block_number, created_at",
    )
    .single();

  if (insertError) {
    if (isUniqueViolation(insertError)) {
      return jsonError(409, "conflict", "This transaction or revenue epoch has already been recorded.");
    }
    return jsonError(500, "insert_failed", "The revenue epoch could not be recorded.");
  }

  return Response.json(
    { revenueEpoch: toRevenueEpochDto(row as unknown as RevenueEpochRow) },
    { status: 201 },
  );
}
