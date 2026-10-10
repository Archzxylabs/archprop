import type { ReactNode } from "react";
import {
  isChainPending,
  type ChainDataState,
} from "@/lib/client/view-models";

/**
 * Truthful rendering of chain reads.
 *
 * Every on-chain value is displayed through one of these, so a component can
 * never accidentally fall back to a hardcoded balance, funding percentage,
 * attestation, or claimable amount.
 */

export interface ChainValueProps<T> {
  state: ChainDataState<T>;
  /** Renders the resolved value. */
  children: (value: T) => ReactNode;
  /** Optional skeleton shown while the read is in flight. */
  skeleton?: ReactNode;
  /** Label used in the unavailable/error message, e.g. "funding progress". */
  label: string;
  className?: string;
}

export function ChainValue<T>({
  state,
  children,
  skeleton,
  label,
  className = "",
}: ChainValueProps<T>) {
  if (isChainPending(state)) {
    return (
      <span className={`inline-flex items-center gap-2 text-ink-subtle ${className}`}>
        {skeleton ?? <LoadingDots />}
        <span className="text-sm">Loading {label}…</span>
      </span>
    );
  }

  if (state.status === "ready") {
    return <>{children(state.value)}</>;
  }

  if (state.status === "unavailable") {
    return (
      <span
        className={`inline-flex flex-col gap-0.5 text-ink-subtle ${className}`}
        data-chain-state="unavailable"
      >
        <span className="text-sm font-medium">On-chain {label} unavailable</span>
        <span className="text-xs">{state.reason}</span>
      </span>
    );
  }

  if (state.status === "error") {
    return (
      <span
        className={`inline-flex flex-col gap-0.5 text-critical ${className}`}
        data-chain-state="error"
      >
        <span className="text-sm font-medium">Could not read {label}</span>
        <span className="text-xs">{state.reason}</span>
      </span>
    );
  }

  return null;
}

export function LoadingDots({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1" role="status" aria-live="polite">
      <span className="sr-only">{label ?? "Loading"}</span>
      <span className="size-1 animate-pulse rounded-full bg-current" aria-hidden="true" />
      <span
        className="size-1 animate-pulse rounded-full bg-current [animation-delay:150ms]"
        aria-hidden="true"
      />
      <span
        className="size-1 animate-pulse rounded-full bg-current [animation-delay:300ms]"
        aria-hidden="true"
      />
    </span>
  );
}

export interface ChainStateNoticeProps {
  state: ChainDataState<unknown>;
  label: string;
  className?: string;
}

/** Block-level notice for a whole panel whose chain read is not available. */
export function ChainStateNotice({ state, label, className = "" }: ChainStateNoticeProps) {
  return (
    <div className={`rounded-card border border-line bg-surface-sunken px-4 py-3 ${className}`}>
      <ChainValue state={state} label={label}>
        {() => null}
      </ChainValue>
    </div>
  );
}

export interface WrongNetworkNoticeProps {
  expectedChainId: number;
  actualChainId?: number | null;
  className?: string;
}

/**
 * Shown when a wallet is connected to the wrong network.
 *
 * The app fails closed: it never presents mainnet or another chain's state as
 * ARCHPROP state.
 */
export function WrongNetworkNotice({
  expectedChainId,
  actualChainId,
  className = "",
}: WrongNetworkNoticeProps) {
  return (
    <aside
      aria-label="Wrong network"
      className={`rounded-card border border-critical/30 bg-critical-soft px-4 py-3 ${className}`}
    >
      <p className="text-sm font-semibold text-ink-strong">Wrong network</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
        ARCHPROP runs on Arbitrum Sepolia (chain {expectedChainId}).
        {typeof actualChainId === "number"
          ? ` Your wallet is connected to chain ${actualChainId}.`
          : " Your wallet is connected to another network."}{" "}
        On-chain values are hidden until the wallet is switched, so no state is
        shown that belongs to another chain.
      </p>
    </aside>
  );
}

export interface ConnectWalletPromptProps {
  className?: string;
  title?: string;
  description?: string;
}

/** Prompt shown when no wallet is connected and a chain read is required. */
export function ConnectWalletPrompt({
  className = "",
  title = "Connect a wallet to read on-chain state",
  description = "Lifecycle, funding, balances, attestations, and claims are read from the blockchain. Nothing is substituted when a wallet is not connected.",
}: ConnectWalletPromptProps) {
  return (
    <aside
      aria-label="Wallet not connected"
      className={`rounded-card border border-line bg-surface-sunken px-4 py-3 ${className}`}
    >
      <p className="text-sm font-semibold text-ink-strong">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{description}</p>
    </aside>
  );
}

export interface DisabledActionHintProps {
  /** The missing prerequisite, e.g. "a connected wallet". */
  missing: string;
  className?: string;
}

/**
 * A disabled action must explain what is missing. Every disabled button in the
 * app pairs with one of these.
 */
export function DisabledActionHint({ missing, className = "" }: DisabledActionHintProps) {
  return (
    <p className={`text-xs leading-relaxed text-ink-subtle ${className}`}>
      <span className="font-semibold text-ink-muted">Unavailable:</span> this action
      needs {missing}.
    </p>
  );
}
