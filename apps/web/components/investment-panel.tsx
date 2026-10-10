"use client";

import { useState } from "react";
import { ActionButton, TransactionLifecycle } from "@/components/transaction-lifecycle";
import {
  explorerTxUrl,
  formatWholeUnits,
  validateInvestmentInput,
  type ChainDataState,
} from "@/lib/client/view-models";
import { useWallet } from "@/lib/client/wallet-context";
import { useInvestorFlow } from "@/lib/client/use-investor-flow";

/**
 * Interaction-ready investment preview panel for property detail.
 *
 * Provides whole-token validation, calculated AVNUSA allocations, clear demo
 * currency disclosures, live chain reads from Escrow and IdentityRegistry,
 * and receipt-confirmed approve/invest execution.
 */

export interface InvestmentPanelProps {
  /** Unit price of the property token in whole mIDR (0 decimals). */
  tokenPrice: bigint;
  /** Property token symbol, default "AVNUSA". */
  tokenSymbol?: string | undefined;
  /** Offering target in whole mIDR. */
  offeringTarget?: bigint | undefined;
  /** Remaining offering cap, or null/undefined if unknown. */
  remainingCap?: bigint | null | undefined;
  /** On-chain derived offering ID. */
  offeringId?: bigint | null | undefined;
  /** On-chain offering status: OPEN, FUNDED, FAILED. */
  offeringStatus?: "OPEN" | "FUNDED" | "FAILED" | null | undefined;
  /** Escrow chain data state, allowing presentation of loading/unavailable/error states. */
  chainState?: ChainDataState<unknown> | undefined;
  className?: string | undefined;
  /** Optional custom wallet for testing */
  customWallet?: ReturnType<typeof useWallet> | undefined;
  /** Optional custom investor flow for testing */
  customInvestorFlow?: ReturnType<typeof useInvestorFlow> | undefined;
}

const PRESET_AMOUNTS = [
  { label: "1M mIDR (100 tokens)", value: "1000000" },
  { label: "5M mIDR (500 tokens)", value: "5000000" },
  { label: "10M mIDR (1,000 tokens)", value: "10000000" },
] as const;

export function InvestmentPanel({
  tokenPrice,
  tokenSymbol = "AVNUSA",
  offeringTarget,
  remainingCap,
  offeringId,
  offeringStatus,
  chainState,
  className = "",
  customWallet,
  customInvestorFlow,
}: InvestmentPanelProps) {
  const [amount, setAmount] = useState<string>("1000000");

  const defaultWallet = useWallet();
  const wallet = customWallet ?? defaultWallet;

  const defaultFlow = useInvestorFlow({ offeringId });
  const flow = customInvestorFlow ?? defaultFlow;

  const effectiveRemainingCap =
    remainingCap ?? (flow.offering ? flow.offering.remainingCap : null);

  const effectiveOfferingStatus =
    offeringStatus ?? (flow.offering ? flow.offering.status : null);

  const validation = validateInvestmentInput({
    rawAmount: amount,
    tokenPrice,
    remainingCap: effectiveRemainingCap,
  });

  // Calculate prerequisite lock
  let missingPrerequisite: string | undefined;
  let actionLabel = `Invest in ${tokenSymbol}`;
  let isActionDisabled = true;

  if (!validation.isValid) {
    missingPrerequisite = validation.errorMessage ?? "a valid investment amount";
    isActionDisabled = true;
  } else if (!wallet.isConnected) {
    missingPrerequisite =
      "a connected investor wallet on Arbitrum Sepolia (live chain adapter pending FE-002)";
    isActionDisabled = true;
  } else if (wallet.isWrongNetwork) {
    missingPrerequisite =
      "connected to wrong network; switch to Arbitrum Sepolia (chain 421614)";
    actionLabel = "Switch to Arbitrum Sepolia";
    isActionDisabled = true;
  } else if (effectiveOfferingStatus && effectiveOfferingStatus !== "OPEN") {
    missingPrerequisite = `Offering is ${effectiveOfferingStatus.toLowerCase()}; only open offerings accept investments`;
    isActionDisabled = true;
  } else if (flow.investor) {
    if (!flow.investor.isApproved) {
      missingPrerequisite = "Investor wallet is not approved in IdentityRegistry";
      isActionDisabled = true;
    } else if (
      validation.amountBigInt !== null &&
      flow.investor.mIdrBalance < validation.amountBigInt
    ) {
      missingPrerequisite = `Insufficient mIDR balance (you have ${formatWholeUnits(
        flow.investor.mIdrBalance,
      )} mIDR, need ${formatWholeUnits(validation.amountBigInt)} mIDR)`;
      isActionDisabled = true;
    } else if (
      validation.amountBigInt !== null &&
      effectiveRemainingCap !== null &&
      effectiveRemainingCap !== undefined &&
      validation.amountBigInt > effectiveRemainingCap
    ) {
      missingPrerequisite = `Investment amount exceeds remaining offering cap (${formatWholeUnits(
        effectiveRemainingCap,
      )} mIDR)`;
      isActionDisabled = true;
    } else {
      isActionDisabled = false;
      missingPrerequisite = undefined;
      // Determine Approve vs Invest action
      if (
        validation.amountBigInt !== null &&
        flow.investor.allowance < validation.amountBigInt
      ) {
        actionLabel = "Approve mIDR for Escrow";
      } else {
        actionLabel = `Invest in ${tokenSymbol}`;
      }
    }
  }

  const isBusy =
    flow.txState.phase === "awaiting-signature" ||
    flow.txState.phase === "submitted" ||
    flow.txState.phase === "confirming";

  const handleAction = async () => {
    if (isActionDisabled || isBusy || validation.amountBigInt === null) {
      return;
    }

    if (actionLabel.startsWith("Approve")) {
      await flow.approve(validation.amountBigInt);
    } else if (actionLabel.startsWith("Invest")) {
      await flow.invest(validation.amountBigInt);
    }
  };

  return (
    <div
      className={`rounded-card border border-line bg-surface p-4 sm:p-5 shadow-panel min-w-0 ${className}`}
      aria-label="Investment preview"
    >
      <div className="flex flex-col gap-1 border-b border-line pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-ink-strong">
            Investment preview · {tokenSymbol}
          </h3>
          <span className="rounded-full border border-neutral-soft bg-surface-sunken px-2.5 py-0.5 text-2xs font-semibold text-ink-muted">
            Whole-unit investment
          </span>
        </div>
        <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
          mIDR — Demo Currency — No Real Monetary Value
        </p>
        <p className="text-xs text-ink-subtle">
          Property tokens represent economic participation rights in rental distributions
          and net exit proceeds — not direct legal title to the land.
        </p>
      </div>

      {/* Connected Investor Position Context */}
      {wallet.isConnected && wallet.address ? (
        <div className="mt-4 rounded-lg border border-line bg-surface-sunken p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className="text-ink-muted">
              Connected: <code className="ap-hash">{wallet.address}</code>
            </span>
            {flow.investor ? (
              <span
                className={`font-semibold ${
                  flow.investor.isApproved ? "text-brand" : "text-critical"
                }`}
              >
                {flow.investor.isApproved
                  ? "✓ Approved Investor"
                  : "✗ Not Approved in IdentityRegistry"}
              </span>
            ) : (
              <span className="text-ink-subtle">Checking identity registry…</span>
            )}
          </div>
          {flow.investor ? (
            <div className="mt-2 grid grid-cols-2 gap-2 border-t border-line/50 pt-2 sm:grid-cols-3">
              <div>
                <span className="text-ink-subtle">Available mIDR:</span>
                <p className="ap-tabular font-semibold text-ink-strong">
                  {formatWholeUnits(flow.investor.mIdrBalance)} mIDR
                </p>
              </div>
              <div>
                <span className="text-ink-subtle">Escrow Allowance:</span>
                <p className="ap-tabular font-semibold text-ink-strong">
                  {formatWholeUnits(flow.investor.allowance)} mIDR
                </p>
              </div>
              <div>
                <span className="text-ink-subtle">Current Allocation:</span>
                <p className="ap-tabular font-semibold text-ink-strong">
                  {formatWholeUnits(flow.investor.allocation)} {tokenSymbol}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Chain Status Context */}
      {chainState && chainState.status !== "ready" ? (
        <div className="mt-4 rounded-lg border border-line bg-surface-sunken p-3 text-xs">
          {chainState.status === "loading" ? (
            <p className="text-ink-muted">Loading offering accounting from escrow…</p>
          ) : chainState.status === "error" ? (
            <p className="text-critical">
              <span className="font-semibold">Escrow read error:</span> {chainState.reason}
            </p>
          ) : chainState.status === "unavailable" ? (
            <p className="text-ink-muted">
              <span className="font-semibold">Chain adapter status:</span>{" "}
              {chainState.reason}
            </p>
          ) : (
            <p className="text-ink-muted">
              <span className="font-semibold">Chain adapter status:</span>{" "}
              Live investment writes require a connected wallet and chain adapter (FE-002).
            </p>
          )}
        </div>
      ) : null}

      <form className="mt-4 flex flex-col gap-4 min-w-0" onSubmit={(e) => e.preventDefault()}>
        {/* Amount Input */}
        <div className="flex flex-col gap-1.5 min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-1">
            <label
              htmlFor="investment-amount"
              className="text-sm font-medium text-ink-muted"
            >
              Amount (mIDR)
            </label>
            <span className="text-xs text-ink-subtle">
              Unit price: {formatWholeUnits(tokenPrice)} mIDR / token
            </span>
          </div>

          <div className="relative">
            <input
              id="investment-amount"
              name="investment-amount"
              type="text"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 1000000"
              aria-invalid={!validation.isValid}
              aria-describedby={
                validation.errorMessage ? "investment-error investment-hint" : "investment-hint"
              }
              className="ap-tabular w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
            />
          </div>

          {/* Quick preset chips */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-2xs text-ink-subtle">Presets:</span>
            {PRESET_AMOUNTS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => setAmount(preset.value)}
                aria-pressed={amount === preset.value}
                className={`rounded border px-2 py-0.5 text-2xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  amount === preset.value
                    ? "border-brand bg-brand-soft text-brand"
                    : "border-line bg-surface-sunken text-ink-muted hover:border-line-strong hover:text-ink"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <p id="investment-hint" className="text-xs text-ink-subtle">
            Both mIDR and {tokenSymbol} use 0 decimals. Amounts must be whole multiples
            of {formatWholeUnits(tokenPrice)} mIDR.
          </p>

          {validation.errorMessage ? (
            <p id="investment-error" role="alert" className="text-xs font-medium text-critical">
              <span className="font-semibold">Invalid:</span> {validation.errorMessage}
            </p>
          ) : null}
        </div>

        {/* Calculated Allocation Preview */}
        <div
          className={`rounded-lg border p-4 min-w-0 ${
            validation.isValid
              ? "border-brand/30 bg-brand-soft/30 text-ink-strong"
              : "border-line bg-surface-sunken text-ink-subtle"
          }`}
          aria-live="polite"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-1">
            <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
              Estimated Allocation
            </span>
            <span className="text-xs text-ink-subtle">
              Exact on-chain units (0 decimals)
            </span>
          </div>

          <div className="mt-2 flex items-baseline gap-2">
            <span className="ap-tabular text-2xl font-bold tracking-tight text-ink-strong">
              {validation.isValid && validation.allocationTokens !== null
                ? formatWholeUnits(validation.allocationTokens)
                : "—"}
            </span>
            <span className="text-base font-semibold text-ink-muted">{tokenSymbol}</span>
          </div>

          {validation.isValid && validation.amountBigInt !== null && validation.allocationTokens !== null ? (
            <p className="mt-2 text-xs text-ink-muted ap-tabular break-words">
              Calculation: {formatWholeUnits(validation.amountBigInt)} mIDR ÷{" "}
              {formatWholeUnits(tokenPrice)} mIDR per token ={" "}
              {formatWholeUnits(validation.allocationTokens)} {tokenSymbol}
            </p>
          ) : (
            <p className="mt-2 text-xs text-ink-subtle">
              Enter a valid whole-multiple amount to calculate token allocation.
            </p>
          )}

          {offeringTarget ? (
            <p className="mt-1 text-2xs text-ink-subtle">
              Offering target: {formatWholeUnits(offeringTarget)} mIDR
            </p>
          ) : null}
        </div>

        {/* Transaction lifecycle status if transaction occurred or in flight */}
        {flow.txState.phase !== "idle" ? (
          <div className="pt-1">
            <TransactionLifecycle
              state={flow.txState}
              actionLabel={actionLabel}
              successDescription={
                flow.txState.phase === "confirmed"
                  ? actionLabel.startsWith("Approve")
                    ? "mIDR approval confirmed. You can now invest in the offering."
                    : `Investment of ${amount} mIDR confirmed on-chain in OfferingEscrow.`
                  : undefined
              }
            />
            {flow.txState.phase === "confirmed" && flow.txState.txHash ? (
              <div className="mt-2 rounded border border-brand/40 bg-brand-soft/30 p-2.5 text-xs text-brand">
                <span className="font-semibold">Receipt Confirmed:</span>{" "}
                <a
                  href={explorerTxUrl(flow.txState.txHash) ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-dotted font-mono"
                >
                  View on Arbiscan
                </a>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Action Button */}
        <div className="flex flex-col gap-2 pt-2 min-w-0">
          <ActionButton
            label={actionLabel}
            tone="primary"
            disabled={isActionDisabled}
            busy={isBusy}
            missingPrerequisite={missingPrerequisite}
            onClick={handleAction}
            className="w-full"
          />
          <p className="text-2xs text-ink-subtle">
            All primary purchases deposit mIDR into OfferingEscrow until the offering reaches
            its target. No wallet signing is triggered because the live chain adapter is
            pending merge (FE-002).
          </p>
        </div>
      </form>
    </div>
  );
}
