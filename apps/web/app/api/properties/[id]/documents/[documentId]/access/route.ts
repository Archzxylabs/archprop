/**
 * POST /api/properties/:id/documents/:documentId/access
 *
 * Provides short-lived (60-second) signed URL access to one exact private
 * synthetic PDF for independent legal or valuation verifiers.
 *
 * Invariants enforced:
 *   - Requires Supabase JWT authentication (401 unauthorized).
 *   - Validates UUID path parameters and request body (422 validation_failed).
 *   - Enforces issuedAtMs freshness within [-10m, +60s].
 *   - Loads property and document server-side; verifies document belongs to
 *     the specified property and property has a bound chain asset (409 conflict/unbound).
 *   - Restricts document types by verifier role: LEGAL may access LAND_RIGHT
 *     and BUILDING_PERMIT; VALUATION may access APPRAISAL; neither receives
 *     ECONOMIC_RIGHTS_AGREEMENT (403 forbidden).
 *   - Verifies RPC chain ID 421614 (502 chain_mismatch/chain_unavailable).
 *   - Reads on-chain registry asset and requires UNDER_VERIFICATION status (409 invalid_status).
 *   - Recovers EIP-191 signer over buildVerifierEvidenceAccessMessage.
 *   - Rejects if recovered signer is the on-chain asset owner (403 forbidden).
 *   - Verifies recovered signer holds the required live on-chain role via hasRole (403 forbidden).
 *   - Only after all authorization checks pass, downloads resting PDF via
 *     service-role client to verify its SHA-256 matches the database (500 integrity_failed).
 *   - Generates 60-second signed URL via service-role client (502 storage_failed).
 *   - Returns 200 { url, expiresIn: 60, document: { id, documentType, sha256, isDemo: true } }
 *     with Cache-Control: no-store, never returning private storage path or public URL.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createPublicClient, http, recoverMessageAddress } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { buildVerifierEvidenceAccessMessage, type AssetId } from "@archprop/shared";
import { loadConfig, describe } from "../../../../../../../lib/server/config";
import { createServiceClient, createUserClient } from "../../../../../../../lib/server/supabase";
import {
  jsonError,
  notFound,
  forbidden,
  validationError,
  requireAuth,
  serviceUnavailable,
  readJsonBody,
} from "../../../../../../../lib/server/http";
import { verifierEvidenceAccessSchema } from "../../../../../../../lib/server/schemas";
import { hashBuffer } from "../../../../../../../lib/server/documents";
import {
  verifyRpcChainId,
  fetchRegistryAsset,
  checkRegistryRole,
  RegistryAssetStatus,
  LEGAL_VERIFIER_ROLE,
  VALUATION_VERIFIER_ROLE,
} from "../../../../../../../lib/server/chain";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOCUMENT_BUCKET = "property-documents";
const LEGAL_ALLOWED_TYPES = ["LAND_RIGHT", "BUILDING_PERMIT"];
const VALUATION_ALLOWED_TYPES = ["APPRAISAL"];

function unavailable(error: unknown) {
  return serviceUnavailable(`Configuration error: ${describe(error)}`);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  const configResult = loadConfig();
  if (!configResult.ok) {
    return unavailable(configResult.error);
  }
  const config = configResult.config;

  const { id, documentId } = await params;
  if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(documentId)) {
    return notFound("Property or document not found.");
  }

  // 1. Authenticate caller via Supabase JWT
  const anonClient = createUserClient(config.supabase);
  const auth = await requireAuth(anonClient, request);
  if (!auth.ok) {
    return auth.response;
  }

  // 2. Parse and validate request body
  const body = await readJsonBody(request);
  if (!body.ok) {
    return body.response;
  }
  const parsed = verifierEvidenceAccessSchema.safeParse(body.value);
  if (!parsed.success) {
    return validationError(parsed.error);
  }
  const input = parsed.data;

  // 3. Load property server-side via service-role client
  const serviceClient = createServiceClient(config.supabase);
  const { data: property, error: propertyError } = await serviceClient
    .from("properties")
    .select("id, chain_asset_id, status_cache")
    .eq("id", id)
    .limit(1)
    .maybeSingle();

  if (propertyError) {
    return jsonError(500, "query_failed", "The property could not be resolved.");
  }
  if (!property) {
    return notFound("Property not found.");
  }
  if (!property.chain_asset_id) {
    return jsonError(409, "unbound_asset", "The property does not have a bound chain asset.");
  }

  // 4. Load document server-side and verify it belongs to this property
  const { data: document, error: docError } = await serviceClient
    .from("property_documents")
    .select("id, property_id, document_type, document_hash, storage_path, is_demo")
    .eq("id", documentId)
    .limit(1)
    .maybeSingle();

  if (docError) {
    return jsonError(500, "query_failed", "The document could not be resolved.");
  }
  if (!document) {
    return notFound("Document not found.");
  }
  if (document.property_id !== property.id) {
    return notFound("The document does not belong to the specified property.");
  }

  // 5. Restrict document types by verifier role
  const isAllowed =
    (input.role === "LEGAL" && LEGAL_ALLOWED_TYPES.includes(document.document_type)) ||
    (input.role === "VALUATION" && VALUATION_ALLOWED_TYPES.includes(document.document_type));

  if (!isAllowed) {
    return forbidden("The requested verifier role is not authorized to access this document type.");
  }

  // 6. Connect to RPC and verify chain ID (421614)
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

  // 7. Read current registry asset and require UNDER_VERIFICATION status
  const assetCheck = await fetchRegistryAsset(
    (args) => client.readContract(args),
    config.chain.registryAddress,
    property.chain_asset_id,
  );
  if (!assetCheck.ok) {
    return jsonError(502, "chain_unavailable", "The on-chain asset could not be read from the registry.");
  }

  const asset = assetCheck.asset;
  if (asset.status !== RegistryAssetStatus.UNDER_VERIFICATION) {
    return jsonError(409, "invalid_status", "The on-chain asset is not UNDER_VERIFICATION.");
  }

  // 8. Recover EIP-191 signer over the exact shared message
  const message = buildVerifierEvidenceAccessMessage({
    propertyId: id,
    documentId: document.id,
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
    return jsonError(422, "invalid_signature", "The signature could not be recovered.");
  }

  // 9. Reject if recovered signer is the asset owner
  if (recoveredSigner.toLowerCase() === asset.owner.toLowerCase()) {
    return forbidden("The asset owner cannot access evidence as a verifier.");
  }

  // 10. Check signer's live on-chain role on ArchpropRegistry
  const requiredRole =
    input.role === "LEGAL" ? LEGAL_VERIFIER_ROLE : VALUATION_VERIFIER_ROLE;

  const roleCheck = await checkRegistryRole(
    (args) => client.readContract(args),
    config.chain.registryAddress,
    requiredRole,
    recoveredSigner,
  );
  if (!roleCheck.ok) {
    return jsonError(502, "chain_unavailable", "The verifier role could not be verified on-chain.");
  }
  if (!roleCheck.hasRole) {
    return forbidden("The signer does not hold the required verifier role on-chain.");
  }

  // 11. Verify resting PDF hash before creating signed URL (fail closed)
  const { data: stored, error: downloadError } = await serviceClient.storage
    .from(DOCUMENT_BUCKET)
    .download(document.storage_path);

  if (downloadError || !stored) {
    return jsonError(502, "storage_failed", "The stored document could not be retrieved.");
  }

  const storedBuffer = Buffer.from(await stored.arrayBuffer());
  const storedHash = hashBuffer(storedBuffer).sha256;
  if (storedHash.toLowerCase() !== document.document_hash.toLowerCase()) {
    return jsonError(500, "integrity_failed", "The resting document did not match the recorded hash.");
  }

  // 12. Generate 60-second signed URL via service client
  const { data: signedData, error: signError } = await serviceClient.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(document.storage_path, 60);

  if (signError || !signedData?.signedUrl) {
    return jsonError(502, "storage_failed", "Could not generate signed access URL.");
  }

  return NextResponse.json(
    {
      url: signedData.signedUrl,
      expiresIn: 60,
      document: {
        id: document.id,
        documentType: document.document_type,
        sha256: document.document_hash,
        isDemo: true,
      },
    },
    {
      status: 200,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
