import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as propertyPage from "./page";

const chainReads = vi.hoisted(() => ({
  getClientChainConfig: vi.fn(),
  getArchpropPublicClient: vi.fn(),
  fetchAttestationRecords: vi.fn(),
  deriveOfferingForAsset: vi.fn(),
}));

vi.mock("@/lib/client/chain-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/client/chain-client")>(),
  ...chainReads,
}));
vi.mock("@/components/investment-panel", () => ({ InvestmentPanel: () => null }));

/**
 * Property detail rendering freshness.
 *
 * Lifecycle, attestation, and offering state come from the chain, so the page
 * is rendered on every request instead of being frozen into a build-time
 * snapshot whose offering state would age into a false claim.
 */
describe("property detail runtime freshness", () => {
  it("is rendered on every request rather than frozen into the build", () => {
    expect(propertyPage.dynamic).toBe("force-dynamic");
  });

  it("does not opt into any static revalidation window", () => {
    expect((propertyPage as { revalidate?: number | false }).revalidate).toBeUndefined();
  });
});

describe("property detail independent chain reads", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    chainReads.getClientChainConfig.mockReturnValue({
      addresses: { registry: "0x1111111111111111111111111111111111111111" },
    });
    chainReads.getArchpropPublicClient.mockReturnValue({});
    chainReads.fetchAttestationRecords.mockResolvedValue({
      ownership: {
        verifier: "0x2222222222222222222222222222222222222222",
        evidenceHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        value: 0n,
        valid: true,
      },
      valuation: null,
    });
    chainReads.deriveOfferingForAsset.mockResolvedValue({
      offeringId: 42n,
      raised: 1_000_000_000n,
      target: 3_000_000_000n,
      remainingCap: 2_000_000_000n,
      status: "OPEN",
      fundsReleased: false,
    });
  });

  async function renderPage() {
    return renderToStaticMarkup(await propertyPage.default({
      params: Promise.resolve({ assetId: "ARCHPROP-001" }),
    }));
  }

  it("keeps confirmed verification visible when the offering RPC read fails", async () => {
    chainReads.deriveOfferingForAsset.mockRejectedValue(new Error("offering RPC unavailable"));
    const html = await renderPage();

    expect(html).toContain("Confirmed On-Chain");
    expect(html).toContain("Failed to read offering accounting: offering RPC unavailable");
    expect(html).not.toContain("Failed to read attestations");
  });

  it("keeps confirmed offering accounting visible when the attestation read fails", async () => {
    chainReads.fetchAttestationRecords.mockRejectedValue(new Error("registry RPC unavailable"));
    const html = await renderPage();

    expect(html).toContain("Failed to read attestations: registry RPC unavailable");
    expect(html).toContain("33.33%");
    expect(html).not.toContain("Failed to read offering accounting");
  });

  it("shows separate reasons when both chain reads fail", async () => {
    chainReads.fetchAttestationRecords.mockRejectedValue(new Error("registry RPC unavailable"));
    chainReads.deriveOfferingForAsset.mockRejectedValue(new Error("offering RPC unavailable"));
    const html = await renderPage();

    expect(html).toContain("Failed to read attestations: registry RPC unavailable");
    expect(html).toContain("Failed to read offering accounting: offering RPC unavailable");
  });

  it("keeps absent attestations and offerings explicitly unavailable", async () => {
    chainReads.fetchAttestationRecords.mockResolvedValue({ ownership: null, valuation: null });
    chainReads.deriveOfferingForAsset.mockResolvedValue(null);
    const html = await renderPage();

    expect(html).toContain("No confirmed attestations found on-chain");
    expect(html).toContain("No on-chain offering found in OfferingEscrow");
    expect(html).not.toContain("Confirmed On-Chain");
  });
});
