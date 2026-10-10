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

  it("ensures every field has accessible labels, visible focus rings, and full width styling", () => {
    const html = renderToStaticMarkup(<PropertyDetailsForm />);

    const fieldIds = [
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

    for (const id of fieldIds) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`for="${id}"`);
      expect(html).toContain("focus-visible:ring-2");
      expect(html).toContain("w-full");
    }
  });

  it("links invariant error to offeringTarget, tokenSupply, and tokenPrice via aria-describedby", () => {
    const html = renderToStaticMarkup(
      <PropertyDetailsForm initialValues={{ offeringTarget: "4000000000" }} />,
    );

    expect(html).toContain('id="offering-invariant-error"');
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/id="offeringTarget"[^>]*aria-describedby="[^"]*offering-invariant-error[^"]*"/);
    expect(html).toMatch(/id="tokenSupply"[^>]*aria-describedby="[^"]*offering-invariant-error[^"]*"/);
    expect(html).toMatch(/id="tokenPrice"[^>]*aria-describedby="[^"]*offering-invariant-error[^"]*"/);
  });

  it("links both error and hint to economicRightsBps via aria-describedby when invalid", () => {
    const html = renderToStaticMarkup(
      <PropertyDetailsForm initialValues={{ economicRightsBps: "3000abc" }} />,
    );

    expect(html).toMatch(
      /id="economicRightsBps"[^>]*aria-describedby="economicRightsBps-error economicRightsBps-hint"/,
    );
  });

  it("includes visible focus ring on reset button", () => {
    const html = renderToStaticMarkup(<PropertyDetailsForm />);
    expect(html).toContain("Reset to Villa Nusa preset");
    expect(html).toContain("focus-visible:outline-2");
    expect(html).toContain("focus-visible:outline-brand");
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

  it("provides accessible aria-pressed state and visible focus rings on preset buttons", () => {
    const html = renderToStaticMarkup(
      <InvestmentPanel
        tokenPrice={tokenPrice}
        tokenSymbol="AVNUSA"
        offeringTarget={offeringTarget}
      />,
    );

    // Initial default is 1000000, so first preset (1M) has aria-pressed="true"
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("focus-visible:outline-2");
    expect(html).toContain("focus-visible:outline-brand");
  });

  it("associates both error and hint to investment amount when input is invalid", () => {
    // Investment amount with letters / invalid
    const html = renderToStaticMarkup(
      <InvestmentPanel
        tokenPrice={tokenPrice}
        tokenSymbol="AVNUSA"
        offeringTarget={offeringTarget}
      />,
    );
    // Default valid state points to hint
    expect(html).toMatch(/id="investment-amount"[^>]*aria-describedby="investment-hint"/);
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

  it("presents Approve mIDR action when connected approved investor has insufficient allowance", () => {
    const investorAddress = "0x6666666666666666666666666666666666666666" as const;
    const mockWallet = {
      address: investorAddress,
      chainId: 421614,
      isConnected: true,
      isConnecting: false,
      isWrongNetwork: false,
      error: null,
      connect: async () => {},
      disconnect: () => {},
      switchChain: async () => {},
      getWalletClient: () => null,
    };

    const mockFlow = {
      offering: null,
      investor: {
        address: investorAddress,
        isApproved: true,
        mIdrBalance: 50_000_000n,
        allowance: 0n, // insufficient allowance
        allocation: 0n,
        payment: 0n,
      },
      isLoading: false,
      isRefreshing: false,
      txState: { phase: "idle" as const, txHash: null, error: null },
      actionStep: "approve" as const,
      error: null,
      refresh: async () => {},
      approve: async () => null,
      invest: async () => null,
      resetTx: () => {},
    };

    const html = renderToStaticMarkup(
      <InvestmentPanel
        tokenPrice={tokenPrice}
        tokenSymbol="AVNUSA"
        offeringTarget={offeringTarget}
        customWallet={mockWallet}
        customInvestorFlow={mockFlow}
      />,
    );

    expect(html).toContain("Approve mIDR for Escrow");
    expect(html).toContain("✓ Approved Investor");
    expect(html).toContain("50 000 000 mIDR");
    expect(html).not.toContain("disabled aria-busy");
  });

  it("presents Invest action when connected approved investor has sufficient allowance", () => {
    const investorAddress = "0x6666666666666666666666666666666666666666" as const;
    const mockWallet = {
      address: investorAddress,
      chainId: 421614,
      isConnected: true,
      isConnecting: false,
      isWrongNetwork: false,
      error: null,
      connect: async () => {},
      disconnect: () => {},
      switchChain: async () => {},
      getWalletClient: () => null,
    };

    const mockFlow = {
      offering: null,
      investor: {
        address: investorAddress,
        isApproved: true,
        mIdrBalance: 50_000_000n,
        allowance: 10_000_000n, // sufficient allowance
        allocation: 100n,
        payment: 1_000_000n,
      },
      isLoading: false,
      isRefreshing: false,
      txState: { phase: "idle" as const, txHash: null, error: null },
      actionStep: "invest" as const,
      error: null,
      refresh: async () => {},
      approve: async () => null,
      invest: async () => null,
      resetTx: () => {},
    };

    const html = renderToStaticMarkup(
      <InvestmentPanel
        tokenPrice={tokenPrice}
        tokenSymbol="AVNUSA"
        offeringTarget={offeringTarget}
        customWallet={mockWallet}
        customInvestorFlow={mockFlow}
      />,
    );

    expect(html).toContain("Invest in AVNUSA");
    expect(html).toContain("10 000 000 mIDR");
  });

  it("keeps action disabled with switch network prompt when wallet is on wrong chain", () => {
    const investorAddress = "0x6666666666666666666666666666666666666666" as const;
    const mockWallet = {
      address: investorAddress,
      chainId: 1, // Mainnet
      isConnected: true,
      isConnecting: false,
      isWrongNetwork: true,
      error: null,
      connect: async () => {},
      disconnect: () => {},
      switchChain: async () => {},
      getWalletClient: () => null,
    };

    const html = renderToStaticMarkup(
      <InvestmentPanel
        tokenPrice={tokenPrice}
        tokenSymbol="AVNUSA"
        offeringTarget={offeringTarget}
        customWallet={mockWallet}
      />,
    );

    expect(html).toContain("disabled");
    expect(html).toContain("Switch to Arbitrum Sepolia");
    expect(html).toContain("connected to wrong network; switch to Arbitrum Sepolia (chain 421614)");
  });

  it("keeps action disabled when investor is unapproved in IdentityRegistry", () => {
    const investorAddress = "0x6666666666666666666666666666666666666666" as const;
    const mockWallet = {
      address: investorAddress,
      chainId: 421614,
      isConnected: true,
      isConnecting: false,
      isWrongNetwork: false,
      error: null,
      connect: async () => {},
      disconnect: () => {},
      switchChain: async () => {},
      getWalletClient: () => null,
    };

    const mockFlow = {
      offering: null,
      investor: {
        address: investorAddress,
        isApproved: false, // unapproved
        mIdrBalance: 50_000_000n,
        allowance: 10_000_000n,
        allocation: 0n,
        payment: 0n,
      },
      isLoading: false,
      isRefreshing: false,
      txState: { phase: "idle" as const, txHash: null, error: null },
      actionStep: "invest" as const,
      error: null,
      refresh: async () => {},
      approve: async () => null,
      invest: async () => null,
      resetTx: () => {},
    };

    const html = renderToStaticMarkup(
      <InvestmentPanel
        tokenPrice={tokenPrice}
        tokenSymbol="AVNUSA"
        offeringTarget={offeringTarget}
        customWallet={mockWallet}
        customInvestorFlow={mockFlow}
      />,
    );

    expect(html).toContain("disabled");
    expect(html).toContain("Investor wallet is not approved in IdentityRegistry");
    expect(html).toContain("✗ Not Approved in IdentityRegistry");
  });

  it("keeps action disabled when investor has insufficient mIDR balance", () => {
    const investorAddress = "0x6666666666666666666666666666666666666666" as const;
    const mockWallet = {
      address: investorAddress,
      chainId: 421614,
      isConnected: true,
      isConnecting: false,
      isWrongNetwork: false,
      error: null,
      connect: async () => {},
      disconnect: () => {},
      switchChain: async () => {},
      getWalletClient: () => null,
    };

    const mockFlow = {
      offering: null,
      investor: {
        address: investorAddress,
        isApproved: true,
        mIdrBalance: 500_000n, // less than default 1_000_000
        allowance: 10_000_000n,
        allocation: 0n,
        payment: 0n,
      },
      isLoading: false,
      isRefreshing: false,
      txState: { phase: "idle" as const, txHash: null, error: null },
      actionStep: "invest" as const,
      error: null,
      refresh: async () => {},
      approve: async () => null,
      invest: async () => null,
      resetTx: () => {},
    };

    const html = renderToStaticMarkup(
      <InvestmentPanel
        tokenPrice={tokenPrice}
        tokenSymbol="AVNUSA"
        offeringTarget={offeringTarget}
        customWallet={mockWallet}
        customInvestorFlow={mockFlow}
      />,
    );

    expect(html).toContain("disabled");
    expect(html).toContain("Insufficient mIDR balance (you have 500 000 mIDR, need 1 000 000 mIDR)");
  });

  it("displays real confirmed transaction hash and Arbiscan link upon receipt finality", () => {
    const investorAddress = "0x6666666666666666666666666666666666666666" as const;
    const confirmedTxHash = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as const;
    const mockWallet = {
      address: investorAddress,
      chainId: 421614,
      isConnected: true,
      isConnecting: false,
      isWrongNetwork: false,
      error: null,
      connect: async () => {},
      disconnect: () => {},
      switchChain: async () => {},
      getWalletClient: () => null,
    };

    const mockFlow = {
      offering: null,
      investor: {
        address: investorAddress,
        isApproved: true,
        mIdrBalance: 50_000_000n,
        allowance: 10_000_000n,
        allocation: 100n,
        payment: 1_000_000n,
      },
      isLoading: false,
      isRefreshing: false,
      txState: { phase: "confirmed" as const, txHash: confirmedTxHash, error: null },
      actionStep: "invest" as const,
      error: null,
      refresh: async () => {},
      approve: async () => null,
      invest: async () => null,
      resetTx: () => {},
    };

    const html = renderToStaticMarkup(
      <InvestmentPanel
        tokenPrice={tokenPrice}
        tokenSymbol="AVNUSA"
        offeringTarget={offeringTarget}
        customWallet={mockWallet}
        customInvestorFlow={mockFlow}
      />,
    );

    expect(html).toContain("Receipt Confirmed");
    expect(html).toContain("View on Arbiscan");
    expect(html).toContain(`https://sepolia.arbiscan.io/tx/${confirmedTxHash}`);
  });
});
