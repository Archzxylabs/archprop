import { describe, expect, it } from "vitest";
import { isPdfContent, validateUpload } from "./documents";

/** Minimal real PDF header, the part the magic-byte check actually reads. */
const PDF_HEADER = "%PDF-1.7\n";
const PDF_BODY = Buffer.from(
  `${PDF_HEADER}1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
  "latin1",
);

function buildFile(params: {
  name?: string;
  contentType?: string;
  content?: Buffer;
}) {
  return {
    fileName: params.name ?? "deed.pdf",
    contentType: params.contentType ?? "application/pdf",
    byteLength: (params.content ?? PDF_BODY).byteLength,
  };
}

describe("validateUpload", () => {
  it("accepts a normal PDF", () => {
    expect(validateUpload(buildFile({})).ok).toBe(true);
  });

  it("rejects an empty upload", () => {
    expect(validateUpload({ fileName: "a.pdf", contentType: "application/pdf", byteLength: 0 })).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("rejects a file over the size limit", () => {
    expect(
      validateUpload({ fileName: "a.pdf", contentType: "application/pdf", byteLength: 10 * 1024 * 1024 + 1 })
        .ok,
    ).toBe(false);
  });

  it("rejects a name and type that are both non-PDF", () => {
    const result = validateUpload(buildFile({ name: "deed.txt", contentType: "text/plain" }));
    expect(result).toEqual({ ok: false, reason: "wrong_type" });
  });
});

describe("isPdfContent", () => {
  it("accepts a real PDF body", () => {
    expect(isPdfContent(PDF_BODY)).toBe(true);
  });

  it("accepts a PDF whose version is 2.0", () => {
    expect(isPdfContent(Buffer.from("%PDF-2.0\n", "latin1"))).toBe(true);
  });

  it("accepts a PDF preceded by junk inside the scan window", () => {
    // Some generators emit leading bytes before the marker; real readers
    // tolerate it, so the check searches rather than requiring offset 0.
    const junk = Buffer.from("\n\n", "latin1");
    expect(isPdfContent(Buffer.concat([junk, PDF_BODY]))).toBe(true);
  });

  it("rejects a non-PDF that claims a .pdf name and content type", () => {
    // This is the attack the filename/type check cannot catch: the metadata
    // says PDF, the bytes say HTML.
    const html = Buffer.from("<!doctype html><html><body>not a pdf</body></html>", "utf8");
    expect(isPdfContent(html)).toBe(false);
  });

  it("rejects an executable", () => {
    expect(isPdfContent(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]))).toBe(false);
  });

  it("rejects an empty and a truncated buffer", () => {
    expect(isPdfContent(Buffer.alloc(0))).toBe(false);
    expect(isPdfContent(Buffer.from("%PDF-", "latin1"))).toBe(false);
  });

  it("rejects a marker that appears only beyond the scan window", () => {
    // A marker buried after 1024 bytes means the file is not a PDF at its head,
    // and scanning further would let a large non-PDF pay for a long search.
    const filler = Buffer.alloc(2048, 0x41);
    expect(isPdfContent(Buffer.concat([filler, PDF_BODY]))).toBe(false);
  });
});
