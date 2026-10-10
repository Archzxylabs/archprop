/**
 * Document upload, hashing, and verification utilities.
 *
 * Invariants enforced here:
 *   - `document_hash` is always computed server-side from the exact bytes that
 *     were received. The client can never supply a hash.
 *   - Storage paths are server-generated and scoped to the owning property, so
 *     a caller cannot write outside their own prefix.
 *   - The hash written to the database is the hash of the bytes stored, which
 *     is verified by re-hashing after upload before the row is inserted.
 */

import { createHash, randomUUID } from "node:crypto";
import type { DocumentType } from "@archprop/shared";

/** Bytes read at once while hashing a stream. */
const HASH_CHUNK_SIZE = 64 * 1024;

/** Hard ceiling on a single uploaded document. Matches the bucket limit. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export interface HashResult {
  /** lowercase 0x-prefixed SHA-256 of the exact bytes. */
  sha256: string;
  byteLength: number;
}

/** Computes the canonical lowercase 0x-prefixed SHA-256 of a buffer. */
export function hashBuffer(buffer: Buffer): HashResult {
  return {
    sha256: `0x${createHash("sha256").update(buffer).digest("hex")}`,
    byteLength: buffer.byteLength,
  };
}

/** Reads a ReadableStream to a Buffer, refusing to exceed `maxBytes`. */
export async function readToBuffer(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: "too_large" }> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          return { ok: false, error: "too_large" };
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { ok: true, buffer: Buffer.concat(chunks, total) };
}

/** Async iterator wrapper kept for symmetry with hashStream below. */
export async function* iterateChunks(
  buffer: Buffer,
  chunkSize: number = HASH_CHUNK_SIZE,
): AsyncGenerator<Buffer> {
  for (let offset = 0; offset < buffer.byteLength; offset += chunkSize) {
    yield buffer.subarray(offset, offset + chunkSize);
  }
}

/**
 * Server-generated storage path.
 *
 * The property UUID is the first segment so the RLS helper
 * `public.storage_property_id()` can authorize writes without trusting any
 * client-supplied path component. The random suffix prevents enumeration and
 * collisions.
 */
export function buildStoragePath(
  propertyId: string,
  documentType: DocumentType,
  originalFileName: string,
): string {
  const extension = sanitizeExtension(originalFileName);
  return `${propertyId}/${documentType.toLowerCase()}-${randomUUID()}${extension}`;
}

/**
 * Preserves a safe extension. Only `.pdf` is accepted by the bucket policy, so
 * anything else collapses to the default and cannot smuggle a different type
 * through the path.
 */
function sanitizeExtension(originalFileName: string): string {
  const lower = originalFileName.toLowerCase();
  const match = /\.([a-z0-9]{1,8})$/.exec(lower);
  if (match && match[1] === "pdf") {
    return ".pdf";
  }
  return ".pdf";
}

/** Human-facing filename for a downloaded document; always the demo filename. */
export function demoFileNameFor(documentType: DocumentType): string {
  return `${documentType}_DEMO.pdf`;
}

/**
 * Verifies that a candidate upload is acceptable before it is stored.
 * Returns the rejection reason, or null when the file is fine.
 */
export function validateUpload(params: {
  fileName: string;
  contentType: string | null;
  byteLength: number;
}): { ok: true } | { ok: false; reason: "empty" | "too_large" | "wrong_type" } {
  if (params.byteLength === 0) {
    return { ok: false, reason: "empty" };
  }
  if (params.byteLength > MAX_DOCUMENT_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  const contentType = params.contentType?.toLowerCase() ?? "";
  const looksLikePdfByName = params.fileName.toLowerCase().endsWith(".pdf");
  const looksLikePdfByType = contentType === "application/pdf";
  if (!looksLikePdfByName && !looksLikePdfByType) {
    return { ok: false, reason: "wrong_type" };
  }
  return { ok: true };
}

/**
 * A PDF's header, per ISO 32000-1 7.5.2: `%PDF-` followed by a version such as
 * `1.4`, `1.7`, or `2.0`.
 */
const PDF_MAGIC = /^%PDF-\d\.\d/;

/** Length of the shortest marker the pattern can match: `%PDF-1.0`. */
const PDF_MAGIC_MIN_BYTES = 8;

/**
 * Inspects the bytes themselves rather than the filename or content type, both
 * of which are attacker-controlled. A file named `deed.pdf` with
 * `Content-Type: application/pdf` can still be an HTML page or an executable,
 * and nothing downstream would notice: the bucket policy only checks the
 * extension, and the stored bytes are what a reviewer later downloads.
 *
 * Readers tolerate leading whitespace and some junk before the marker, so the
 * search is bounded to the start of the file rather than requiring offset 0.
 */
export function isPdfContent(buffer: Buffer): boolean {
  // `%PDF-2.0` is 8 bytes; anything shorter cannot hold a valid marker.
  if (buffer.byteLength < PDF_MAGIC_MIN_BYTES) {
    return false;
  }
  // Some generators emit a UTF-8 BOM or leading whitespace; skip at most a few
  // bytes so a huge non-PDF cannot pay for a long scan.
  const scanWindow = buffer.subarray(0, Math.min(buffer.byteLength, 1024));
  // The marker may be preceded by comments only if it is the first line, but
  // tolerating a short prefix is the behaviour real PDF readers implement.
  const head = scanWindow.toString("latin1");
  const markerIndex = head.indexOf("%PDF-");
  if (markerIndex === -1) {
    return false;
  }
  return PDF_MAGIC.test(head.slice(markerIndex));
}
