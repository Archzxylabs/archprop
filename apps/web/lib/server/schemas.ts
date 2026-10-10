/**
 * Request validation for property and document routes.
 *
 * Numeric fields arrive as canonical base-10 strings and stay strings through
 * validation; conversion to bigint happens in the route after the schema has
 * confirmed the shape, so an invalid number can never reach a query.
 */

import { z } from "zod";
import {
  isCanonicalUnsignedInt,
  parseCanonicalUnsignedInt,
  UINT256_MAX,
} from "./numbers";

/** Canonical unsigned base-10 string that also fits a uint256. */
const uint256String = z
  .string({ required_error: "a canonical unsigned integer string is required" })
  .refine(isCanonicalUnsignedInt, "must be a canonical base-10 unsigned integer")
  .refine((value) => {
    // parseCanonicalUnsignedInt returns null for anything non-canonical, so a
    // malformed value can never reach BigInt() and throw out of the refine.
    const parsed = parseCanonicalUnsignedInt(value);
    return parsed !== null && parsed <= UINT256_MAX;
  }, "must fit within an unsigned 256-bit integer");

/** lowercase 0x + 64 hex chars (bytes32: asset ids and hashes). */
const bytes32String = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/, "must be a lowercase 0x-prefixed 32-byte hex value");

/** lowercase 0x + 64 hex chars (transaction hashes). */
const txHashString = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/, "must be a lowercase 0x-prefixed 32-byte hash");

const documentTypeSchema = z.enum([
  "LAND_RIGHT",
  "APPRAISAL",
  "BUILDING_PERMIT",
  "ECONOMIC_RIGHTS_AGREEMENT",
]);

export const createPropertySchema = z
  .object({
    externalId: z
      .string()
      .trim()
      .min(3, "must be at least 3 characters")
      .max(64, "must be at most 64 characters")
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "may contain letters, digits, dot, underscore, dash"),
    name: z.string().trim().min(2, "must be at least 2 characters").max(160),
    location: z.string().trim().min(2, "must be at least 2 characters").max(160),
    propertyType: z.string().trim().min(2, "must be at least 2 characters").max(64),
    issuerName: z.string().trim().min(2, "must be at least 2 characters").max(160),
    indicativeValue: uint256String,
    offeringTarget: uint256String,
    tokenSupply: uint256String,
    tokenPrice: uint256String,
    economicRightsBps: z
      .number()
      .int("must be an integer number of basis points")
      .min(1, "must be at least 1 bp")
      .max(10_000, "must be at most 10000 bp (100%)"),
    description: z.string().trim().min(1, "is required").max(4_000),
  })
  .superRefine((value, ctx) => {
    // Frozen invariant: the offering target equals supply x price exactly.
    // Enforced here so the API never persists a property whose economics
    // disagree, and never relies on the DB check alone to explain it.
    // The parsed values are re-checked because superRefine runs even when an
    // inner refinement already failed, so a non-canonical number must not be
    // handed to BigInt() (which throws) instead of reported as invalid.
    const supply = parseCanonicalUnsignedInt(value.tokenSupply);
    const price = parseCanonicalUnsignedInt(value.tokenPrice);
    const target = parseCanonicalUnsignedInt(value.offeringTarget);
    if (supply === null || price === null || target === null) {
      return;
    }
    if (supply * price !== target) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["offeringTarget"],
        message: "must equal tokenSupply x tokenPrice exactly",
      });
    }
    if (supply === 0n || price === 0n) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tokenSupply"],
        message: "tokenSupply and tokenPrice must both be greater than zero",
      });
    }
  });

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;

export const listPropertiesQuerySchema = z.object({
  status: z
    .enum([
      "DRAFT",
      "COMING_SOON",
      "VERIFICATION_PENDING",
      "SUBMITTED",
      "UNDER_VERIFICATION",
      "VERIFIED",
      "ISSUANCE_READY",
      "OFFERING",
      "FUNDED",
      "ACTIVE",
      "REJECTED",
      "FAILED",
    ])
    .optional(),
  q: z.string().trim().min(1).max(120).optional(),
});

export type ListPropertiesQuery = z.infer<typeof listPropertiesQuerySchema>;

export const uploadDocumentSchema = z.object({
  documentType: documentTypeSchema,
});

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;

export const revenueEpochSchema = z.object({
  assetId: bytes32String,
  period: z
    .string()
    .trim()
    .min(1, "is required")
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "may contain letters, digits, dot, underscore, dash"),
  amount: uint256String,
  evidenceHash: bytes32String,
  txHash: txHashString,
});

export type RevenueEpochInput = z.infer<typeof revenueEpochSchema>;

/** 65-byte hex signature (0x + 130 hex characters). */
const signatureHex = z
  .string({ required_error: "signature is required" })
  .regex(/^0x[0-9a-fA-F]{130}$/, "must be a 65-byte hex signature");

/** Exact 32-byte hash/asset id (0x + 64 hex characters). */
const bytes32Hex = z
  .string({ required_error: "32-byte hex string is required" })
  .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte hex value");

export const bindPropertyChainSchema = z
  .object({
    txHash: bytes32Hex,
    chainAssetId: bytes32Hex,
    signature: signatureHex,
    issuedAtMs: z
      .string({ required_error: "issuedAtMs is required" })
      .refine(isCanonicalUnsignedInt, "must be a canonical base-10 unsigned integer string"),
  })
  .superRefine((val, ctx) => {
    const parsed = parseCanonicalUnsignedInt(val.issuedAtMs);
    if (parsed === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["issuedAtMs"],
        message: "must be a canonical base-10 unsigned integer string",
      });
      return;
    }
    const ms = Number(parsed);
    if (!Number.isSafeInteger(ms)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["issuedAtMs"],
        message: "timestamp exceeds safe integer range",
      });
      return;
    }
    const now = Date.now();
    const TEN_MINUTES_MS = 10 * 60 * 1000;
    const SIXTY_SECONDS_MS = 60 * 1000;
    if (ms < now - TEN_MINUTES_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["issuedAtMs"],
        message: "timestamp is older than 10 minutes",
      });
    } else if (ms > now + SIXTY_SECONDS_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["issuedAtMs"],
        message: "timestamp is more than 60 seconds in the future",
      });
    }
  });

export type BindPropertyChainInput = z.infer<typeof bindPropertyChainSchema>;

export const verifierEvidenceAccessSchema = z
  .object({
    role: z.enum(["LEGAL", "VALUATION"], {
      required_error: "role is required",
      invalid_type_error: "role must be LEGAL or VALUATION",
    }),
    issuedAtMs: z
      .string({ required_error: "issuedAtMs is required" })
      .refine(isCanonicalUnsignedInt, "must be a canonical base-10 unsigned integer string"),
    signature: signatureHex,
  })
  .superRefine((val, ctx) => {
    const parsed = parseCanonicalUnsignedInt(val.issuedAtMs);
    if (parsed === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["issuedAtMs"],
        message: "must be a canonical base-10 unsigned integer string",
      });
      return;
    }
    const ms = Number(parsed);
    if (!Number.isSafeInteger(ms)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["issuedAtMs"],
        message: "timestamp exceeds safe integer range",
      });
      return;
    }
    const now = Date.now();
    const TEN_MINUTES_MS = 10 * 60 * 1000;
    const SIXTY_SECONDS_MS = 60 * 1000;
    if (ms < now - TEN_MINUTES_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["issuedAtMs"],
        message: "timestamp is older than 10 minutes",
      });
    } else if (ms > now + SIXTY_SECONDS_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["issuedAtMs"],
        message: "timestamp is more than 60 seconds in the future",
      });
    }
  });

export type VerifierEvidenceAccessInput = z.infer<typeof verifierEvidenceAccessSchema>;
