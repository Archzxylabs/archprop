/**
 * Verification tests for synthetic demo PDF fixtures.
 *
 * Confirms that all required fixtures exist under supabase/fixtures/,
 * adhere to the PDF file specification, contain the mandatory
 * "DEMO / SYNTHETIC DOCUMENT" watermark, and include the hackathon
 * synthetic data disclosure.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DocumentType } from "@archprop/shared";
import {
  MAX_DOCUMENT_BYTES,
  demoFileNameFor,
  hashBuffer,
  isPdfContent,
} from "./documents";

const FIXTURES_DIR = resolve(__dirname, "../../../../supabase/fixtures");

const REQUIRED_FIXTURES: Array<{
  documentType: DocumentType;
  fileName: string;
  expectedTitle: string;
}> = [
  {
    documentType: "LAND_RIGHT",
    fileName: "LAND_RIGHT_DEMO.pdf",
    expectedTitle: "LAND RIGHT CERTIFICATE",
  },
  {
    documentType: "APPRAISAL",
    fileName: "APPRAISAL_DEMO.pdf",
    expectedTitle: "PROPERTY APPRAISAL REPORT",
  },
  {
    documentType: "BUILDING_PERMIT",
    fileName: "BUILDING_PERMIT_DEMO.pdf",
    expectedTitle: "BUILDING PERMIT APPROVAL",
  },
  {
    documentType: "ECONOMIC_RIGHTS_AGREEMENT",
    fileName: "ECONOMIC_RIGHTS_AGREEMENT_DEMO.pdf",
    expectedTitle: "ECONOMIC RIGHTS PARTICIPATION AGREEMENT",
  },
];

describe("Synthetic Demo PDF Fixtures (supabase/fixtures/**)", () => {
  it("includes all four required canonical demo fixtures", () => {
    for (const fixture of REQUIRED_FIXTURES) {
      expect(demoFileNameFor(fixture.documentType)).toBe(fixture.fileName);
      const filePath = resolve(FIXTURES_DIR, fixture.fileName);
      expect(existsSync(filePath), `Fixture file ${fixture.fileName} must exist`).toBe(true);
    }
  });

  for (const fixture of REQUIRED_FIXTURES) {
    describe(`fixture: ${fixture.fileName}`, () => {
      const filePath = resolve(FIXTURES_DIR, fixture.fileName);
      const buffer = readFileSync(filePath);

      it("is a valid PDF file accepted by isPdfContent", () => {
        expect(isPdfContent(buffer)).toBe(true);
        expect(buffer.toString("latin1").startsWith("%PDF-1.")).toBe(true);
      });

      it("is strictly within the 10 MiB upload ceiling", () => {
        expect(buffer.byteLength).toBeGreaterThan(0);
        expect(buffer.byteLength).toBeLessThanOrEqual(MAX_DOCUMENT_BYTES);
      });

      it("visibly contains the DEMO / SYNTHETIC DOCUMENT watermark", () => {
        const text = buffer.toString("utf8");
        expect(text).toContain("DEMO / SYNTHETIC DOCUMENT");
      });

      it("contains the Hackathon Demo synthetic disclosure", () => {
        const text = buffer.toString("utf8");
        expect(text).toContain("Synthetic / Simulated Data");
        expect(text).toContain("This token does not represent direct legal title to the land");
      });

      it("contains the expected fixture title", () => {
        const text = buffer.toString("utf8");
        expect(text).toContain(fixture.expectedTitle);
      });

      it("produces a valid canonical SHA-256 evidence hash", () => {
        const hashResult = hashBuffer(buffer);
        expect(hashResult.byteLength).toBe(buffer.byteLength);
        expect(hashResult.sha256).toMatch(/^0x[0-9a-f]{64}$/);

        // Hashing must be deterministic
        expect(hashBuffer(buffer).sha256).toBe(hashResult.sha256);
      });
    });
  }
});
