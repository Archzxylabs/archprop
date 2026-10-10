"use client";

import type { ReactNode } from "react";
import type { Address, TxHash } from "@archprop/shared";
import { explorerTxUrl, formatWholeUnits } from "@/lib/client/view-models";
import { DisabledActionHint } from "./chain-state";

/**
 * Reusable transaction lifecycle UI.
 *
 * Presents `idle → awaiting-signature → submitted → confirming → confirmed |
 * reverted | receipt-unknown | failed` for a wallet write. It is purely
 * presentational: the parent owns the state, so an owner, verifier, or
 * investor screen can reuse it unchanged.
 *
 * The component never asserts a phase its state does not carry, and never
 * renders a transaction link without a real hash. When the state records which
 * write it describes, that recorded action — not the button currently shown —
 * names the result, so an approval can never read as an investment after the
 * allowance refresh changes the label.
 */

const PHASE_ORDER = [
  "awaiting-signature",
  "submitted",
  "confirming",
  "confirmed",
] as const;

const PHASE_LABELS: Record<string, string> = {
  idle: "Not started",
  "awaiting-signature": "Awaiting signature",
  submitted: "Submitted",
  confirming: "Confirming",
  confirmed: "Confirmed",
  reverted: "Reverted",
  "receipt-unknown": "Receipt unavailable",
  failed: "Failed",
};

/**
 * The smallest shape this component needs.
 *
 * `TxLifecycleState` from the shared view models satisfies it, and the investor
 * flow's richer state supplies the recorded action and amount.
 */
export interface TransactionLifecycleStateView {
  phase: string;
  txHash: TxHash | null;
  error: string | null;
  /** Which write produced this state, when the caller records one. */
  action?: "approve" | "invest" | null | undefined;
  /** Whole mIDR units this write moved, when the caller records one. */
  amount?: bigint | null | undefined;
}

export interface TransactionLifecycleProps {
  state: TransactionLifecycleStateView;
  /** Short name of the write, e.g. "Ownership attestation". */
  actionLabel: string;
  /** Contract or account the write targets, shown when known. */
  target?: Address | null | undefined;
  /** What the write accomplishes once confirmed, in plain language. */
  successDescription?: string | undefined;
  className?: string | undefined;
}

/** Names a recorded investor write truthfully, independent of the current label. */
function recordedActionName(
  action: TransactionLifecycleStateView["action"],
  fallback: string,
): string {
  if (action === "approve") {
    return "mIDR approval";
  }
  if (action === "invest") {
    return "Investment";
  }
  return fallback;
}

export function TransactionLifecycle({
  state,
  actionLabel,
  target,
  successDescription,
  className = "",
}: TransactionLifecycleProps) {
  const { phase, txHash, error } = state;
  const explorerUrl = explorerTxUrl(txHash);
  const activeIndex = PHASE_ORDER.indexOf(phase as (typeof PHASE_ORDER)[number]);
  const actionName = recordedActionName(state.action, actionLabel);
  const amountLabel =
    state.amount !== null && state.amount !== undefined
      ? `${formatWholeUnits(state.amount)} mIDR`
      : null;

  return (
    <section
      aria-label={`${actionName} transaction status`}
      className={`rounded-card border border-line bg-surface-sunken px-4 py-3 ${className}`}
    >
      <p className="ap-eyebrow">Transaction status</p>

      <p className="mt-1 text-sm font-semibold text-ink-strong" role="status" aria-live="polite">
        {actionName}: {PHASE_LABELS[phase] ?? phase}
      </p>

      {phase === "failed" ? (
        <p className="mt-1 text-xs leading-relaxed text-critical">
          Nothing was sent to the chain. {error ?? "No reason was returned by the wallet."}{" "}
          No transaction hash exists for this attempt and no chain state was
          changed by it.
        </p>
      ) : null}

      {phase === "reverted" ? (
        <p className="mt-1 text-xs leading-relaxed text-critical">
          The transaction was mined but reverted. {error ?? "The chain reported failure."}{" "}
          The hash below is a real mined transaction; it recorded no approval
          credit and no investment.
        </p>
      ) : null}

      {phase === "receipt-unknown" ? (
        <p className="mt-1 text-xs leading-relaxed text-ink-strong">
          The wallet broadcast this transaction, but its receipt could not be
          read. {error ?? "The chain returned no receipt."} The outcome is not
          yet known: it may still confirm, so it is not reported as either
          success or failure. Check the hash below before retrying.
        </p>
      ) : null}

      {phase === "confirmed" && successDescription ? (
        <p className="mt-1 text-xs leading-relaxed text-verified">
          {successDescription} Lifecycle and economic state are read from the
          chain, so the display updates only when the chain reflects it.
        </p>
      ) : null}

      {phase === "confirming" ? (
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          The wallet broadcast this transaction. It is shown as confirming until
          a receipt is read from the chain; the UI does not treat a broadcast as
          a confirmed outcome.
        </p>
      ) : null}

      <ol className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2" aria-label="Progress">
        {PHASE_ORDER.map((step, index) => {
          const isComplete = phase === "confirmed" || (activeIndex > index && phase !== "failed");
          const isCurrent = phase === step;
          return (
            <li key={step} className="flex items-center gap-1">
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-semibold ${
                  isCurrent
                    ? "border-brand bg-brand-soft text-brand"
                    : isComplete
                      ? "border-verified/30 bg-verified-soft text-verified"
                      : "border-line text-ink-subtle"
                }`}
              >
                {isComplete && !isCurrent ? (
                  <span aria-hidden="true">✓</span>
                ) : null}
                {PHASE_LABELS[step]}
              </span>
              {index < PHASE_ORDER.length - 1 ? (
                <span className="text-ink-subtle" aria-hidden="true">
                  →
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <dl className="mt-3 grid gap-1 text-xs">
        {state.action ? (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-subtle">Write</dt>
            <dd className="text-ink-muted">
              {state.action === "approve" ? "MockIDR approve for OfferingEscrow" : "OfferingEscrow invest"}
              {amountLabel ? ` · ${amountLabel}` : null}
            </dd>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-ink-subtle">Transaction</dt>
          <dd className="ap-hash text-ink-muted">
            {txHash ? (
              explorerUrl ? (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-dotted underline-offset-2 hover:text-brand"
                >
                  {txHash}
                </a>
              ) : (
                txHash
              )
            ) : (
              "—"
            )}
          </dd>
        </div>
        {target ? (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-subtle">Target</dt>
            <dd className="ap-hash text-ink-muted">{target}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

export interface ActionButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** What the write does, in plain language. */
  label: string;
  tone?: "primary" | "secondary" | "danger" | undefined;
  /** True while a write is in flight. */
  busy?: boolean | undefined;
  /** The missing prerequisite, when the button is disabled. */
  missingPrerequisite?: string | undefined;
  children?: ReactNode;
}

const TONE_CLASSES: Record<"primary" | "secondary" | "danger", string> = {
  primary:
    "bg-brand text-ink-inverse border-brand hover:bg-brand-deep hover:border-brand-deep disabled:bg-neutral-soft disabled:text-ink-subtle disabled:border-line",
  secondary:
    "bg-surface text-ink border-line-strong hover:bg-surface-sunken disabled:text-ink-subtle disabled:border-line",
  danger:
    "bg-surface text-critical border-critical/40 hover:bg-critical-soft disabled:text-ink-subtle disabled:border-line",
};

/**
 * Button for a wallet write.
 *
 * Disabled buttons are paired with an explanatory hint so a disabled action
 * always states the missing prerequisite.
 */
export function ActionButton({
  label,
  tone = "primary",
  busy = false,
  missingPrerequisite,
  children,
  className = "",
  disabled,
  ...rest
}: ActionButtonProps) {
  const isDisabled = disabled || busy;
  return (
    <span className="inline-flex flex-col gap-1.5">
      <button
        type="button"
        disabled={isDisabled}
        aria-busy={busy || undefined}
        className={`inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${TONE_CLASSES[tone]} ${className}`}
        {...rest}
      >
        {busy ? <LoadingSpinner /> : null}
        {label}
      </button>
      {missingPrerequisite ? <DisabledActionHint missing={missingPrerequisite} /> : null}
      {children}
    </span>
  );
}

export function LoadingSpinner() {
  return (
    <span
      className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden="true"
    />
  );
}
