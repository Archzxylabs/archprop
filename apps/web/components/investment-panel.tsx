"use client";

import { useState } from "react";
import { ActionButton } from "@/components/transaction-lifecycle";
import {
  formatWholeUnits,
  validateInvestmentInput,
  type ChainDataState,
} from "@/lib/client/view-models";

/**
 * Interaction-ready investment preview panel for property detail.
 *
 * Provides whole-token validation, calculated AVNUSA allocations, clear demo
 * currency disclosures, and chain availability states.
 *
 * In accordance with protocol invariants, live wallet writes remain disabled
 * until a real wallet adapter and receipt lifecycle exist (FE-002). No simulated
 * transactions, fake balances, or optimistic confirmations are displayed.
 */

export interface InvestmentPanelProps {
  /** Unit price of the property token in whole mIDR (0 decimals). */
  tokenPrice: bigint;
  /** Property token symbol, default "AVNUSA". */
  tokenSymbol?: string;
  /** Offering target in whole mIDR. */
  offeringTarget?: bigint;
  /** Remaining offering cap, or null/undefined if unknown. */
  remainingCap?: bigint | null;
  /** Escrow chain data state, allowing presentation of loading/unavailable/error states. */
  chainState?: ChainDataState<unknown>;
  className?: string;
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
  chainState,
  className = "",
}: InvestmentPanelProps) {
  const [amount, setAmount] = useState<string>("1000000");

  const validation = validateInvestmentInput({
    rawAmount: amount,
    tokenPrice,
    remainingCap,
  });

  const missingPrerequisite = !validation.isValid
    ? (validation.errorMessage ?? "a valid investment amount")
    : "a connected investor wallet on Arbitrum Sepolia (live chain adapter pending FE-002)";

  return (
    <div
      className={`rounded-card border border-line bg-surface p-5 shadow-panel ${className}`}
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

      <form className="mt-4 flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
        {/* Amount Input */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
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
                validation.errorMessage ? "investment-error" : "investment-hint"
              }
              className="ap-tabular w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle"
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
                className={`rounded border px-2 py-0.5 text-2xs font-medium transition-colors ${
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
          className={`rounded-lg border p-4 ${
            validation.isValid
              ? "border-brand/30 bg-brand-soft/30 text-ink-strong"
              : "border-line bg-surface-sunken text-ink-subtle"
          }`}
          aria-live="polite"
        >
          <div className="flex items-baseline justify-between gap-2">
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
            <p className="mt-2 text-xs text-ink-muted ap-tabular">
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

        {/* Action Button */}
        <div className="flex flex-col gap-2 pt-2">
          <ActionButton
            label={`Invest in ${tokenSymbol}`}
            tone="primary"
            disabled
            missingPrerequisite={missingPrerequisite}
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
