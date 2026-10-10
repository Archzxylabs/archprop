import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PropertyDetailsForm } from "@/components/property-details-form";
import { InvestmentPanel } from "@/components/investment-panel";
import {
  chainError,
  chainLoading,
  chainUnavailable,
} from "@/lib/client/view-models";

describe("PropertyDetailsForm component", () => {
  it("renders all 11 frozen CreatePropertyRequest fields with matching labels and inputs", () => {
    const html = renderToStaticMarkup(<PropertyDetailsForm />);

    const requiredFields = [
      "externalId",
      "name",
      "location",
      "propertyType",
      "issuerName",
      "indicativeValue",
      "offeringTarget",
      "tokenSupply",
      "tokenPrice",
      "economicRightsBps",
      "description",
    ];

    for (const field of requiredFields) {
      expect(html, `missing input for field ${field}`).toContain(`name="${field}"`);
      expect(html, `missing id for field ${field}`).toContain(`id="${field}"`);
      expect(html, `missing label for field ${field}`).toContain(`for="${field}"`);
    }
  });

  it("populates default values from canonical Villa Nusa preset", () => {
    const html = renderToStaticMarkup(<PropertyDetailsForm />);

    expect(html).toContain('value="ARCHPROP-001"');
    expect(html).toContain('value="Villa Nusa"');
    expect(html).toContain('value="Bali"');
    expect(html).toContain('value="Villa"');
    expect(html).toContain('value="PT Nusa Properties"');
    expect(html).toContain('value="10000000000"');
    expect(html).toContain('value="3000000000"');
    expect(html).toContain('value="300000"');
    expect(html).toContain('value="10000"');
    expect(html).toContain('value="3000"');
    expect(html).toContain("30% participation");
  });

  it("renders the live invariant verification indicator confirming target == supply * price", () => {
    const html = renderToStaticMarkup(<PropertyDetailsForm />);

    expect(html).toContain("Target == Supply × Price");
    expect(html).toContain("Invariant Satisfied");
    expect(html).toContain("matches offering target");
  });

  it("keeps the register action disabled and cites required owner wallet", () => {
    const html = renderToStaticMarkup(<PropertyDetailsForm />);

    expect(html).toContain("disabled");
    expect(html).toContain("Register property");
    expect(html).toContain("a connected owner wallet on Arbitrum Sepolia");
  });

  it("keeps the live invariant verification unsatisfied and shows warnings for non-canonical or mismatched values", () => {
    const htmlWithCommas = renderToStaticMarkup(
      <PropertyDetailsForm initialValues={{ offeringTarget: "3,000,000,000" }} />,
    );
    expect(htmlWithCommas).not.toContain("Invariant Satisfied");
    expect(htmlWithCommas).toContain("⚠ Invariant Check:");
    expect(htmlWithCommas).toContain("Offering target must be a canonical unsigned base-10 integer string");

    const htmlWithLeadingSpace = renderToStaticMarkup(
      <PropertyDetailsForm initialValues={{ tokenSupply: " 300000" }} />,
    );
    expect(htmlWithLeadingSpace).not.toContain("Invariant Satisfied");
    expect(htmlWithLeadingSpace).toContain("Token supply must be a positive canonical unsigned base-10 integer string");

    const htmlMismatched = renderToStaticMarkup(
      <PropertyDetailsForm initialValues={{ offeringTarget: "4000000000" }} />,
    );
    expect(htmlMismatched).not.toContain("Invariant Satisfied");
    expect(htmlMismatched).toContain("does not match offering target");
  });

  it("visibly displays invalid state for malformed economic rights BPS inputs (3000abc, 3.5, empty, out of range)", () => {
    const malformedBpsList = ["3000abc", "3.5", "", "0", "10001"];
    for (const bps of malformedBpsList) {
      const html = renderToStaticMarkup(
        <PropertyDetailsForm initialValues={{ economicRightsBps: bps }} />,
      );
      expect(html, `expected ${bps} to have aria-invalid="true"`).toContain('id="economicRightsBps"');
      expect(html, `expected ${bps} to have aria-invalid="true"`).toMatch(/id="economicRightsBps"[^>]*aria-invalid="true"/);
      expect(html, `expected ${bps} to have economicRightsBps-error`).toContain('id="economicRightsBps-error"');
      expect(html).not.toContain("30% participation");
    }
  });

  it("renders legal title disclaimer and no h1 tags", () => {
    const html = renderToStaticMarkup(<PropertyDetailsForm />);

    expect(html).toContain("does not represent direct legal title to the land");
    expect(html).not.toContain("<h1");
  });
});

describe("InvestmentPanel component", () => {
  const tokenPrice = 10_000n;
  const offeringTarget = 3_000_000_000n;

  it("renders amount input in mIDR and clear demo-currency labels", () => {
    const html = renderToStaticMarkup(
      <InvestmentPanel
        tokenPrice={tokenPrice}
        tokenSymbol="AVNUSA"
        offeringTarget={offeringTarget}
      />,
    );

    expect(html).toContain('id="investment-amount"');
    expect(html).toContain('for="investment-amount"');
    expect(html).toContain("mIDR — Demo Currency — No Real Monetary Value");
    expect(html).toContain("economic participation rights in rental distributions");
    expect(html).toContain("not direct legal title to the land");
  });

  it("previews calculated AVNUSA allocation correctly (1,000,000 mIDR -> 100 AVNUSA)", () => {
    const html = renderToStaticMarkup(
      <InvestmentPanel
        tokenPrice={tokenPrice}
        tokenSymbol="AVNUSA"
        offeringTarget={offeringTarget}
      />,
    );

    // Initial default amount is 1,000,000 mIDR
    expect(html).toContain('value="1000000"');
    expect(html).toContain("100");
    expect(html).toContain("AVNUSA");
    expect(html).toContain("1 000 000 mIDR ÷ 10 000 mIDR per token = 100 AVNUSA");
  });

  it("keeps transaction action disabled while no live wallet/chain adapter exists", () => {
    const html = renderToStaticMarkup(
      <InvestmentPanel
        tokenPrice={tokenPrice}
        tokenSymbol="AVNUSA"
        offeringTarget={offeringTarget}
      />,
    );

    expect(html).toContain("disabled");
    expect(html).toContain("Invest in AVNUSA");
    expect(html).toContain("connected investor wallet on Arbitrum Sepolia");
    expect(html).toContain("live chain adapter pending FE-002");
  });

  it("presents unavailable chain state clearly", () => {
    const html = renderToStaticMarkup(
      <InvestmentPanel
        tokenPrice={tokenPrice}
        tokenSymbol="AVNUSA"
        offeringTarget={offeringTarget}
        chainState={chainUnavailable("Escrow read pending wallet connection.")}
      />,
    );

    expect(html).toContain("Chain adapter status");
    expect(html).toContain("Escrow read pending wallet connection.");
  });

  it("presents loading chain state clearly", () => {
    const html = renderToStaticMarkup(
      <InvestmentPanel
        tokenPrice={tokenPrice}
        tokenSymbol="AVNUSA"
        offeringTarget={offeringTarget}
        chainState={chainLoading()}
      />,
    );

    expect(html).toContain("Loading offering accounting from escrow…");
  });

  it("presents error chain state clearly", () => {
    const html = renderToStaticMarkup(
      <InvestmentPanel
        tokenPrice={tokenPrice}
        tokenSymbol="AVNUSA"
        offeringTarget={offeringTarget}
        chainState={chainError("Contract reverted: Offering closed.")}
      />,
    );

    expect(html).toContain("Escrow read error:");
    expect(html).toContain("Contract reverted: Offering closed.");
  });

  it("never contains fake transaction hashes, fake balances, or simulated success", () => {
    const html = renderToStaticMarkup(
      <InvestmentPanel
        tokenPrice={tokenPrice}
        tokenSymbol="AVNUSA"
        offeringTarget={offeringTarget}
      />,
    );

    expect(html).not.toMatch(/0x[a-fA-F0-9]{64}/);
    expect(html).not.toContain("Confirmed");
    expect(html).not.toContain("Success");
    expect(html).not.toContain("<h1");
  });
});
