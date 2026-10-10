/**
 * POST /api/properties/:id/documents/discover
 *
 * Discovers role-appropriate evidence document metadata (IDs and hashes)
 * for independent legal or valuation verifiers.
 *
 * Invariants enforced:
 *   - Requires Supabase JWT authentication (401 unauthorized).
 *   - Validates UUID property ID and request body (422 validation_failed).
 *   - Enforces issuedAtMs freshness within [-10m, +60s].
 *   - Loads property server-side; requires a bound chain asset (409 unbound_asset).
 *   - Verifies Arbitrum Sepolia RPC chain ID 421614 (502 chain_mismatch/chain_unavailable).
 *   - Reads on-chain registry asset; requires UNDER_VERIFICATION status (409 invalid_status).
 *   - Recovers EIP-191 signer over buildVerifierEvidenceIndexMessage.
 *   - Rejects if recovered signer is the on-chain asset owner (403 forbidden).
 *   - Verifies recovered signer holds the live on-chain role via hasRole (403 forbidden).
 *   - Queries documents belonging to this property only after authorization, filtering
 *     by role: LEGAL sees LAND_RIGHT and BUILDING_PERMIT; VALUATION sees APPRAISAL;
 *     never returns ECONOMIC_RIGHTS_AGREEMENT.
 *   - Returns only id, documentType, sha256, and isDemo: true. Never returns storage path,
 *     public URL, signed URL, or PDF bytes. Never invokes createSignedUrl.
 *   - Sets Cache-Control: no-store on success and errors.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createPublicClient, http, recoverMessageAddress } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { buildVerifierEvidenceIndexMessage, type AssetId } from "@archprop/shared";
import { loadConfig, describe } from "../../../../../../lib/server/config";
import { createServiceClient, createUserClient } from "../../../../../../lib/server/supabase";
import {
  jsonError,
  validationError,
  requireAuth,
  serviceUnavailable,
  readJsonBody,
} from "../../../../../../lib/server/http";
import { verifierEvidenceIndexSchema } from "../../../../../../lib/server/schemas";
import {
  verifyRpcChainId,
  fetchRegistryAsset,
  checkRegistryRole,
  RegistryAssetStatus,
  LEGAL_VERIFIER_ROLE,
  VALUATION_VERIFIER_ROLE,
} from "../../../../../../lib/server/chain";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGAL_ALLOWED_TYPES = ["LAND_RIGHT", "BUILDING_PERMIT"];
const VALUATION_ALLOWED_TYPES = ["APPRAISAL"];

function withNoStore<T>(response: NextResponse<T>): NextResponse<T> {
  response.headers.set("cache-control", "no-store");
  return response;
}

function errorNoStore(status: number, code: string, message: string) {
  return withNoStore(jsonError(status, code, message));
}

function unavailable(error: unknown) {
  return withNoStore(serviceUnavailable(`Configuration error: ${describe(error)}`));
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
    return errorNoStore(404, "not_found", "Property not found.");
  }

  // 1. Authenticate caller via Supabase JWT
  const anonClient = createUserClient(config.supabase);
  const auth = await requireAuth(anonClient, request);
  if (!auth.ok) {
    return withNoStore(auth.response);
  }

  // 2. Parse and validate request body
  const body = await readJsonBody(request);
  if (!body.ok) {
    return withNoStore(body.response);
  }
  const parsed = verifierEvidenceIndexSchema.safeParse(body.value);
  if (!parsed.success) {
    return withNoStore(validationError(parsed.error));
  }
  const input = parsed.data;

  // 3. Load property server-side via service client
  const serviceClient = createServiceClient(config.supabase);
  const { data: property, error: propertyError } = await serviceClient
    .from("properties")
    .select("id, chain_asset_id, status_cache")
    .eq("id", id)
    .limit(1)
    .maybeSingle();

  if (propertyError) {
    return errorNoStore(500, "query_failed", "The property could not be resolved.");
  }
  if (!property) {
    return errorNoStore(404, "not_found", "Property not found.");
  }
  if (!property.chain_asset_id) {
    return errorNoStore(409, "unbound_asset", "The property does not have a bound chain asset.");
  }

  // 4. Connect to RPC and verify chain ID (421614)
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
      return errorNoStore(
        502,
        "chain_mismatch",
        `The RPC reports chain ID ${chainIdCheck.chainId}, but ${config.chain.chainId} is required.`,
      );
    }
    return errorNoStore(502, "chain_unavailable", "The chain could not be reached.");
  }

  // 5. Read current registry asset and require UNDER_VERIFICATION status
  const assetCheck = await fetchRegistryAsset(
    (args) => client.readContract(args),
    config.chain.registryAddress,
    property.chain_asset_id,
  );
  if (!assetCheck.ok) {
    return errorNoStore(502, "chain_unavailable", "The on-chain asset could not be read from the registry.");
  }

  const asset = assetCheck.asset;
  if (asset.status !== RegistryAssetStatus.UNDER_VERIFICATION) {
    return errorNoStore(409, "invalid_status", "The on-chain asset is not UNDER_VERIFICATION.");
  }

  // 6. Recover EIP-191 signer over buildVerifierEvidenceIndexMessage
  const message = buildVerifierEvidenceIndexMessage({
    propertyId: id,
    assetId: property.chain_asset_id as AssetId,
    role: input.role,
    userId: auth.auth.userId,
    issuedAtMs: input.issuedAtMs,
  });

  let recoveredSigner: `0x${string}`;
  try {
    recoveredSigner = await recoverMessageAddress({
      message,
      signature: input.signature as `0x${string}`,
    });
  } catch {
    return errorNoStore(422, "invalid_signature", "The signature could not be recovered.");
  }

  // 7. Reject if recovered signer is the asset owner
  if (recoveredSigner.toLowerCase() === asset.owner.toLowerCase()) {
    return errorNoStore(403, "forbidden", "The asset owner cannot access evidence as a verifier.");
  }

  // 8. Check signer's live on-chain role on ArchpropRegistry
  const requiredRole =
    input.role === "LEGAL" ? LEGAL_VERIFIER_ROLE : VALUATION_VERIFIER_ROLE;

  const roleCheck = await checkRegistryRole(
    (args) => client.readContract(args),
    config.chain.registryAddress,
    requiredRole,
    recoveredSigner,
  );
  if (!roleCheck.ok) {
    return errorNoStore(502, "chain_unavailable", "The verifier role could not be verified on-chain.");
  }
  if (!roleCheck.hasRole) {
    return errorNoStore(403, "forbidden", "The signer does not hold the required verifier role on-chain.");
  }

  // 9. Query role-appropriate documents belonging to this property
  const allowedTypes =
    input.role === "LEGAL" ? LEGAL_ALLOWED_TYPES : VALUATION_ALLOWED_TYPES;

  const { data: documents, error: docsError } = await serviceClient
    .from("property_documents")
    .select("id, document_type, document_hash, is_demo")
    .eq("property_id", id)
    .in("document_type", allowedTypes)
    .order("created_at", { ascending: true });

  if (docsError) {
    return errorNoStore(500, "query_failed", "The property documents could not be resolved.");
  }

  const items = (documents ?? []).map((doc) => ({
    id: doc.id,
    documentType: doc.document_type,
    sha256: doc.document_hash,
    isDemo: true as const,
  }));

  return NextResponse.json(
    { documents: items },
    {
      status: 200,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
