/**
 * POST /api/properties/:id/documents
 *
 * Accepts `multipart/form-data` with `file` and `documentType`. The handler:
 *   - authenticates the caller,
 *   - explicitly verifies property ownership via the server service client
 *     before any storage write,
 *   - hashes the exact received bytes itself and never reads a client hash,
 *   - refuses anything that is not a PDF over 10 MiB,
 *   - checks the bytes are a PDF by magic bytes, not just a `.pdf` name,
 *   - generates the storage path server-side so writes stay inside the
 *     property prefix,
 *   - uploads through the server service client,
 *   - re-hashes the stored object before inserting the row, so the database
 *     hash always describes the bytes actually at rest,
 *   - inserts the document row via the service client,
 *   - cleans up any orphaned storage object if validation or insert fails.
 *
 * It performs no wallet write and mints nothing. The on-chain evidence hash is
 * submitted separately by the owner's wallet.
 */

import type { NextRequest } from "next/server";
import { loadConfig, describe } from "../../../../../lib/server/config";
import { createServiceClient, createUserClient } from "../../../../../lib/server/supabase";
import {
  jsonError,
  notFound,
  forbidden,
  payloadTooLarge,
  unsupportedMediaType,
  badRequest,
  validationError,
  requireAuth,
  isUniqueViolation,
  serviceUnavailable,
} from "../../../../../lib/server/http";
import { uploadDocumentSchema } from "../../../../../lib/server/schemas";
import {
  MAX_DOCUMENT_BYTES,
  buildStoragePath,
  hashBuffer,
  isPdfContent,
  readToBuffer,
  validateUpload,
} from "../../../../../lib/server/documents";
import { toDocumentDto, type PropertyDocumentRow } from "../../../../../lib/server/properties";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Documents this route accepts. The bucket policy enforces the same list. */
const DOCUMENT_BUCKET = "property-documents";

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

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return notFound("Property not found.");
  }

  const anonClient = createUserClient(configResult.config.supabase);
  const auth = await requireAuth(anonClient, request);
  if (!auth.ok) {
    return auth.response;
  }

  // Explicitly check property ownership using the server service client
  // BEFORE any storage write or file processing. The restricted client
  // cannot read owner_user_id due to least-privilege column grants.
  const serviceClient = createServiceClient(configResult.config.supabase);
  const { data: property, error: propertyError } = await serviceClient
    .from("properties")
    .select("id, owner_user_id")
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

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return unsupportedMediaType("multipart/form-data is required.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest("The multipart body could not be parsed.");
  }

  const fileValue = form.get("file");
  if (!(fileValue instanceof File)) {
    return badRequest("A file field is required.");
  }
  const documentTypeValue = form.get("documentType");
  const parsedType = uploadDocumentSchema.safeParse({
    documentType: typeof documentTypeValue === "string" ? documentTypeValue : undefined,
  });
  if (!parsedType.success) {
    return validationError(parsedType.error);
  }
  const documentType = parsedType.data.documentType;

  const read = await readToBuffer(fileValue.stream(), MAX_DOCUMENT_BYTES);
  if (!read.ok) {
    return payloadTooLarge("Documents are limited to 10 MiB.");
  }

  const uploadCheck = validateUpload({
    fileName: fileValue.name || "",
    contentType: fileValue.type,
    byteLength: read.buffer.byteLength,
  });
  if (!uploadCheck.ok) {
    if (uploadCheck.reason === "too_large") {
      return payloadTooLarge("Documents are limited to 10 MiB.");
    }
    if (uploadCheck.reason === "empty") {
      return badRequest("The uploaded file is empty.");
    }
    return unsupportedMediaType("Only PDF documents are accepted.");
  }

  // Check magic bytes: the filename and content type are both client-controlled,
  // so neither proves the bytes are a real PDF.
  if (!isPdfContent(read.buffer)) {
    return unsupportedMediaType("Only PDF documents are accepted.");
  }

  // Pre-check for duplicate document type before storage upload
  const { data: existingDoc, error: existingDocError } = await serviceClient
    .from("property_documents")
    .select("id")
    .eq("property_id", id)
    .eq("document_type", documentType)
    .limit(1)
    .maybeSingle();

  if (existingDocError) {
    return jsonError(500, "query_failed", "Existing documents could not be checked.");
  }
  if (existingDoc) {
    return jsonError(409, "conflict", "A document of this type already exists.");
  }

  // The storage path is generated server-side, never taken from the client.
  const storagePath = buildStoragePath(id, documentType, fileValue.name || "document.pdf");

  // Only after ownership check and PDF validation may the server service client upload
  const { error: uploadError } = await serviceClient.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, read.buffer, {
      contentType: "application/pdf",
      upsert: false,
      cacheControl: "3600",
    });

  if (uploadError) {
    return jsonError(502, "storage_failed", "The document could not be stored.");
  }

  // Re-read and re-hash what is actually at rest before recording a row, so
  // the recorded hash cannot describe bytes the store rejected.
  const { data: stored, error: downloadError } = await serviceClient.storage
    .from(DOCUMENT_BUCKET)
    .download(storagePath);
  if (downloadError || !stored) {
    await removeQuietly(serviceClient, storagePath);
    return jsonError(502, "storage_failed", "The stored document could not be verified.");
  }

  const storedBuffer = Buffer.from(await stored.arrayBuffer());
  const storedHash = hashBuffer(storedBuffer).sha256;
  const receivedHash = hashBuffer(read.buffer).sha256;
  if (storedHash !== receivedHash) {
    await removeQuietly(serviceClient, storagePath);
    return jsonError(500, "integrity_failed", "The stored document did not match the upload.");
  }

  const { data: row, error: insertError } = await serviceClient
    .from("property_documents")
    .insert({
      property_id: id,
      document_type: documentType,
      storage_path: storagePath,
      document_hash: receivedHash,
      is_demo: true,
      uploaded_by: auth.auth.userId,
    })
    .select("id, property_id, document_type, document_hash, storage_path, is_demo, created_at")
    .single();

  if (insertError) {
    await removeQuietly(serviceClient, storagePath);
    if (isUniqueViolation(insertError)) {
      return jsonError(409, "conflict", "A document of this type already exists.");
    }
    return jsonError(500, "insert_failed", "The document record could not be created.");
  }

  return Response.json(
    { document: toDocumentDto(row as unknown as PropertyDocumentRow) },
    { status: 201 },
  );
}

/** Best-effort cleanup of an orphaned object; failures are non-fatal. */
async function removeQuietly(
  client: ReturnType<typeof createServiceClient>,
  storagePath: string,
): Promise<void> {
  try {
    await client.storage.from(DOCUMENT_BUCKET).remove([storagePath]);
  } catch {
    // An orphaned object is harmless; the row is what authorizes access.
  }
}
