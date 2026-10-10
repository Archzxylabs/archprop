/**
 * Focused tests for duplicate revenue period behavior and error handling.
 *
 * Isolated without requiring a live Supabase database instance.
 */

import { describe, expect, it } from "vitest";
import { isUniqueViolation, jsonError, isConstraintViolation } from "./http";

describe("Duplicate revenue period isolation and conflict handling", () => {
  describe("PostgreSQL error code classification", () => {
    it("identifies code 23505 as unique violation", () => {
      expect(isUniqueViolation({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe(true);
      expect(isUniqueViolation({ code: "23505" })).toBe(true);
    });

    it("rejects non-23505 codes as unique violations", () => {
      expect(isUniqueViolation({ code: "23503" })).toBe(false); // foreign key
      expect(isUniqueViolation({ code: "23514" })).toBe(false); // check constraint
      expect(isUniqueViolation({ code: "42501" })).toBe(false); // permission denied
      expect(isUniqueViolation(null)).toBe(false);
      expect(isUniqueViolation(undefined)).toBe(false);
      expect(isUniqueViolation("23505")).toBe(false);
      expect(isUniqueViolation({})).toBe(false);
    });

    it("identifies foreign key and check constraint violations", () => {
      expect(isConstraintViolation({ code: "23503" })).toBe(true);
      expect(isConstraintViolation({ code: "23514" })).toBe(true);
      expect(isConstraintViolation({ code: "23505" })).toBe(false);
    });
  });

  describe("Duplicate revenue period conflict responses", () => {
    it("generates correct 409 conflict envelope for pre-existing period", async () => {
      const response = jsonError(
        409,
        "conflict",
        "This period has already been recorded for this property.",
      );

      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json).toEqual({
        error: {
          code: "conflict",
          message: "This period has already been recorded for this property.",
        },
      });
    });

    it("simulates pre-check detection for duplicate (property_id, period)", async () => {
      // Mock existing query outcome: existing epoch found
      const existingEpoch = { id: "987fcdeb-51a2-43d7-9012-3456789abcde" };

      const checkPeriodConflict = (existing: { id: string } | null) => {
        if (existing) {
          return jsonError(409, "conflict", "This period has already been recorded for this property.");
        }
        return null;
      };

      const conflictResponse = checkPeriodConflict(existingEpoch);
      expect(conflictResponse).not.toBeNull();
      expect(conflictResponse?.status).toBe(409);

      const json = await conflictResponse?.json();
      expect(json).toEqual({
        error: {
          code: "conflict",
          message: "This period has already been recorded for this property.",
        },
      });

      // When no existing record is found, proceeds without error
      const okResponse = checkPeriodConflict(null);
      expect(okResponse).toBeNull();
    });

    it("simulates insert race-condition handling via unique constraint violation", async () => {
      // If two requests pass pre-check concurrently, DB constraint `revenue_epochs_one_per_period`
      // throws code 23505. Handler must catch and return 409 conflict.
      const handleInsertResult = (insertError: unknown) => {
        if (insertError) {
          if (isUniqueViolation(insertError)) {
            return jsonError(409, "conflict", "This transaction has already been recorded.");
          }
          return jsonError(500, "insert_failed", "The revenue epoch could not be recorded.");
        }
        return { status: 201 };
      };

      const uniqueViolationError = {
        code: "23505",
        message: 'duplicate key value violates unique constraint "revenue_epochs_one_per_period"',
        detail: "Key (property_id, period)=(123, 2026-Q3) already exists.",
      };

      const response = handleInsertResult(uniqueViolationError);
      expect("status" in response && response.status).toBe(409);
      const json = await (response as { json: () => Promise<unknown> }).json();
      expect(json).toEqual({
        error: {
          code: "conflict",
          message: "This transaction has already been recorded.",
        },
      });

      // Generic error returns 500
      const genericError = { code: "58000", message: "system error" };
      const errResponse = handleInsertResult(genericError);
      expect("status" in errResponse && errResponse.status).toBe(500);
    });
  });
});
