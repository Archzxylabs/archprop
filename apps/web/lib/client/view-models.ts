import type {
  Address,
  AssetId,
  ChainTransaction,
  DocumentType,
  Hex,
  LifecycleStatus,
  PresentationStatus,
  TxHash,
} from "@archprop/shared";

/**
 * Frontend-owned view models.
 *
 * These describe the data components need from a chain adapter. They carry no
 * values of their own: every economic and lifecycle field arrives as a request
 * state so a component can never render a fabricated balance, funding
 * percentage, attestation, or claimable amount.
 *
 * FE-002 connects this boundary to the reviewed chain package by supplying the
 * `ChainDataRequest` results below. Until then, callers pass an explicit
 * unavailable/loading state and the UI says so.
 */

/** Network the app expects. Mirrors `CHAIN_ID` from `@archprop/shared`. */
export const EXPECTED_CHAIN_ID = 421614 as const;

/** Explorer used for transaction links. Arbitrum Sepolia only. */
export const ARBITRUM_SEPOLIA_EXPLORER = "https://sepolia.arbiscan.io" as const;

/**
 * A chain read that may not have completed yet.
 *
 * `unavailable` is distinct from `error`: it means the read never happened
 * (no wallet, no adapter, missing contract address, unsupported network) and
 * the UI must say so rather than fall back to a static value.
 */
export type ChainDataState<T> =
  | { status: "idle"; value?: undefined }
  | { status: "loading"; value?: undefined }
  | { status: "ready"; value: T }
  | { status: "unavailable"; value?: undefined; reason: string }
  | { status: "error"; value?: undefined; reason: string };

export function chainIdle<T>(): ChainDataState<T> {
  return { status: "idle" };
}

export function chainLoading<T>(): ChainDataState<T> {
  return { status: "loading" };
}

export function chainReady<T>(value: T): ChainDataState<T> {
  return { status: "ready", value };
}

export function chainUnavailable<T>(reason: string): ChainDataState<T> {
  return { status: "unavailable", reason };
}

export function chainError<T>(reason: string): ChainDataState<T> {
  return { status: "error", reason };
}

export function isChainReady<T>(
  state: ChainDataState<T>,
): state is { status: "ready"; value: T } {
  return state.status === "ready";
}

export function isChainPending(state: { status: string }): boolean {
  return state.status === "idle" || state.status === "loading";
}

/**
 * Lifecycle state for one asset, straight from the registry.
 *
 * `ArchpropRegistry` is authoritative. `statusCache` is presentation-only and
 * is never shown in preference to this.
 */
export interface AssetChainState {
  status: LifecycleStatus;
  owner: Address;
  metadataHash: Hex;
  agreementHash: Hex;
  linkedToken: Address | null;
  /** Whether the registry reports the required attestations as present. */
  hasOwnershipAttestation: boolean;
  hasValuationAttestation: boolean;
  hasRevenueAttestation: boolean;
  hasToken: boolean;
}

/** One attestation as it exists on-chain. */
export interface AttestationChainRecord {
  attestationType: "OWNERSHIP" | "VALUATION" | "REVENUE";
  verifier: Address;
  evidenceHash: Hex;
  value: bigint;
  timestamp: bigint;
  valid: boolean;
  transaction: ChainTransaction;
}

/** Offering accounting owned by `OfferingEscrow`. */
export interface OfferingChainState {
  /** Total mIDR raised so far, in whole units (0 decimals). */
  raisedAmount: bigint;
  /** Offering target in whole mIDR. */
  targetAmount: bigint;
  /** Whether the escrow has finalized at target. */
  isFinalized: boolean;
  /** Whether escrow released funds to the owner. */
  isReleased: boolean;
  /** Whether the escrow failed after its deadline. */
  isFailed: boolean;
  /** Unix seconds; `null` when no deadline is configured. */
  deadline: bigint | null;
}

/** Investor position owned by the token contract and escrow. */
export interface InvestorPositionChainState {
  wallet: Address;
  /** AVNUSA balance, whole units (0 decimals). */
  tokenBalance: bigint;
  /** Total mIDR this investor has committed, whole units. */
  investedAmount: bigint;
  /** Whether `IdentityRegistry` approves this investor. */
  isApproved: boolean;
  /** Simulated revenue claimable for this investor, whole mIDR. */
  claimableAmount: bigint | null;
}

/** A write the UI has asked a wallet to perform. */
export interface WalletAction {
  /** Stable label for the action, e.g. "Verify ownership attestation". */
  label: string;
  /**
   * Executes the write and resolves with the receipt hash once the wallet has
   * broadcast it. FE-002 supplies this from the reviewed chain package.
   */
  execute: () => Promise<TxHash>;
}

export type TxPhase =
  | "idle"
  | "awaiting-signature"
  | "submitted"
  | "confirming"
  | "confirmed"
  | "failed";

export interface TxLifecycleState {
  phase: TxPhase;
  txHash: TxHash | null;
  /** Human-readable failure reason when `phase === "failed"`. */
  error: string | null;
}

export const initialTxState: TxLifecycleState = {
  phase: "idle",
  txHash: null,
  error: null,
};

/**
 * Funding progress for an asset, as read from the offering escrow.
 *
 * `percentBps` is derived from the two amounts by the read layer; nothing in
 * the UI computes it independently, so a card can never show a percentage the
 * escrow does not support.
 */
export interface FundingView {
  raisedAmount: bigint;
  targetAmount: bigint;
  percentBps: number;
}

/**
 * Marketplace card.
 *
 * `funding` comes from chain state. Cards whose funding has not been read
 * render an explicit unavailable message instead of a percentage.
 */
export interface PropertyCardView {
  assetId: AssetId | null;
  externalId: string;
  name: string;
  location: string;
  issuerName: string;
  imageUrl: string | null;
  /** Presentation status only; never used to claim an economic outcome. */
  presentationStatus: PresentationStatus;
  /** Static published fundamentals, or `null` when not yet read. */
  fundamentals: {
    indicativeValue: bigint;
    offeringTarget: bigint;
    tokenSupply: bigint;
    tokenPrice: bigint;
    tokenSymbol: string;
    economicRightsBps: number;
  } | null;
  /** Escrow funding read. Never a static or derived percentage. */
  funding: ChainDataState<FundingView>;
}

/** A document as listed for a property. Synthetic in the demo. */
export interface DocumentView {
  id: string;
  documentType: DocumentType;
  sha256: Hex;
  storagePath: string;
  isDemo: true;
  createdAt: string;
}

/**
 * Builds an explorer link for a transaction hash.
 *
 * Returns `null` for anything that is not a hash-shaped string so a caller can
 * never render a broken or misleading link.
 */
export function explorerTxUrl(txHash: TxHash | string | null | undefined): string | null {
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return null;
  }
  return `${ARBITRUM_SEPOLIA_EXPLORER}/tx/${txHash}`;
}

/** Builds an explorer link for an address, or `null` when not address-shaped. */
export function explorerAddressUrl(
  address: Address | string | null | undefined,
): string | null {
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return null;
  }
  return `${ARBITRUM_SEPOLIA_EXPLORER}/address/${address}`;
}

/**
 * Formats a whole-unit amount with thin-space grouping.
 *
 * Both mIDR and AVNUSA use 0 decimals, so these are exact integer units and no
 * fractional digits are ever invented.
 */
export function formatWholeUnits(value: bigint | number): string {
  const n = typeof value === "bigint" ? value : BigInt(Math.trunc(value));
  const negative = n < 0n;
  const digits = (negative ? -n : n).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return negative ? `-${grouped}` : grouped;
}

/** Compact display form for large figures, e.g. `10.0B`. */
export function formatCompact(value: bigint | number): string {
  const n = typeof value === "bigint" ? value : BigInt(Math.trunc(value));
  const abs = n < 0n ? -n : n;
  const sign = n < 0n ? "-" : "";
  const units: Array<[bigint, string]> = [
    [1_000_000_000n, "B"],
    [1_000_000n, "M"],
    [1_000n, "K"],
  ];
  for (const [divisor, suffix] of units) {
    if (abs >= divisor) {
      const scaled = (abs * 10n) / divisor;
      const whole = scaled / 10n;
      const frac = scaled % 10n;
      return `${sign}${whole}.${frac}${suffix}`;
    }
  }
  return `${sign}${abs}`;
}

/** Renders a share of an integer total in basis points, or `null` if the total is zero. */
export function ratioToBps(part: bigint, total: bigint): number | null {
  if (total <= 0n) {
    return null;
  }
  const bps = (part * 10_000n) / total;
  return Number(bps > 10_000n ? 10_000n : bps);
}

/** Formats basis points as a percentage string, e.g. `3000` → `30%`. */
export function formatBps(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const frac = Math.abs(bps % 100);
  if (frac === 0) {
    return `${whole}%`;
  }
  return `${whole}.${frac.toString().padStart(2, "0")}%`;
}

/** Shortens a hash or address for display while keeping both ends legible. */
export function truncateHash(value: string | null | undefined, lead = 10, tail = 8): string {
  if (!value) {
    return "—";
  }
  if (value.length <= lead + tail + 1) {
    return value;
  }
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}
