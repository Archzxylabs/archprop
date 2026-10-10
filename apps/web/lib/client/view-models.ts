import type {
  Address,
  AssetId,
  ChainTransaction,
  CreatePropertyRequest,
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

/**
 * Normalizes numeric input by stripping whitespace, commas, thin-spaces, and underscores.
 */
export function normalizeDecimalString(value: string): string {
  return value.replace(/[\s,\u202F_]/g, "");
}

/**
 * Validates whether a string is a canonical unsigned base-10 integer string.
 *
 * Per ADR-008 and frozen interfaces: unsigned base-10 strings with no signs,
 * no decimals, no scientific notation, and no leading zeros (except "0" itself).
 */
export function isCanonicalUnsignedDecimal(value: string): boolean {
  return /^(?:0|[1-9]\d*)$/.test(value);
}

/**
 * Parses a canonical unsigned base-10 string into a `bigint`, or returns `null`
 * if the string is non-canonical.
 */
export function parseCanonicalUnsignedDecimal(value: string): bigint | null {
  if (!isCanonicalUnsignedDecimal(value)) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/**
 * Validates that both supply and unit price are strictly positive integers (> 0).
 */
export function isPositiveSupplyAndPrice(
  supply: bigint | number | string,
  price: bigint | number | string,
): boolean {
  const s =
    typeof supply === "string"
      ? parseCanonicalUnsignedDecimal(normalizeDecimalString(supply))
      : typeof supply === "number"
        ? supply > 0 && Number.isInteger(supply)
          ? BigInt(supply)
          : null
        : supply;

  const p =
    typeof price === "string"
      ? parseCanonicalUnsignedDecimal(normalizeDecimalString(price))
      : typeof price === "number"
        ? price > 0 && Number.isInteger(price)
          ? BigInt(price)
          : null
        : price;

  return s !== null && p !== null && s > 0n && p > 0n;
}

/**
 * Validates the core offering invariant: `target == supply * price`.
 *
 * Both mIDR and token units have 0 decimals, so this check is exact.
 */
export function validateTargetSupplyPriceInvariant(
  target: bigint | number | string,
  supply: bigint | number | string,
  price: bigint | number | string,
): boolean {
  const t =
    typeof target === "string"
      ? parseCanonicalUnsignedDecimal(normalizeDecimalString(target))
      : typeof target === "number"
        ? target >= 0 && Number.isInteger(target)
          ? BigInt(target)
          : null
        : target;

  const s =
    typeof supply === "string"
      ? parseCanonicalUnsignedDecimal(normalizeDecimalString(supply))
      : typeof supply === "number"
        ? supply >= 0 && Number.isInteger(supply)
          ? BigInt(supply)
          : null
        : supply;

  const p =
    typeof price === "string"
      ? parseCanonicalUnsignedDecimal(normalizeDecimalString(price))
      : typeof price === "number"
        ? price >= 0 && Number.isInteger(price)
          ? BigInt(price)
          : null
        : price;

  if (t === null || s === null || p === null) {
    return false;
  }
  if (s <= 0n || p <= 0n || t <= 0n) {
    return false;
  }
  return s * p === t;
}

/**
 * Validates whether an investment amount in mIDR is cleanly divisible by token price.
 *
 * Because property tokens use 0 decimals, investors can only purchase whole tokens:
 * `paymentAmount % tokenPrice == 0`.
 */
export function isInvestmentAmountDivisible(
  paymentAmount: bigint | number | string,
  tokenPrice: bigint | number | string,
): boolean {
  const amount =
    typeof paymentAmount === "string"
      ? parseCanonicalUnsignedDecimal(normalizeDecimalString(paymentAmount))
      : typeof paymentAmount === "number"
        ? paymentAmount > 0 && Number.isInteger(paymentAmount)
          ? BigInt(paymentAmount)
          : null
        : paymentAmount;

  const price =
    typeof tokenPrice === "string"
      ? parseCanonicalUnsignedDecimal(normalizeDecimalString(tokenPrice))
      : typeof tokenPrice === "number"
        ? tokenPrice > 0 && Number.isInteger(tokenPrice)
          ? BigInt(tokenPrice)
          : null
        : tokenPrice;

  if (amount === null || price === null || amount <= 0n || price <= 0n) {
    return false;
  }
  return amount % price === 0n;
}

/**
 * Calculates the whole-token allocation for an investment in mIDR.
 * Returns `null` if the amount is not divisible, non-positive, or invalid.
 */
export function calculateTokenAllocation(
  paymentAmount: bigint | number | string,
  tokenPrice: bigint | number | string,
): bigint | null {
  if (!isInvestmentAmountDivisible(paymentAmount, tokenPrice)) {
    return null;
  }
  const amount =
    typeof paymentAmount === "string"
      ? parseCanonicalUnsignedDecimal(normalizeDecimalString(paymentAmount))!
      : typeof paymentAmount === "number"
        ? BigInt(paymentAmount)
        : paymentAmount;

  const price =
    typeof tokenPrice === "string"
      ? parseCanonicalUnsignedDecimal(normalizeDecimalString(tokenPrice))!
      : typeof tokenPrice === "number"
        ? BigInt(tokenPrice)
        : tokenPrice;

  return amount / price;
}

export type InvestmentErrorCode =
  | "EMPTY"
  | "MALFORMED"
  | "NEGATIVE"
  | "ZERO"
  | "FRACTIONAL"
  | "NOT_DIVISIBLE"
  | "OVER_CAP";

export interface InvestmentValidationResult {
  isValid: boolean;
  rawAmount: string;
  normalizedAmount: string;
  amountBigInt: bigint | null;
  allocationTokens: bigint | null;
  errorMessage: string | null;
  errorCode: InvestmentErrorCode | null;
}

/**
 * Validates investment input according to frozen protocol rules and whole-unit model.
 */
export function validateInvestmentInput(params: {
  rawAmount: string;
  tokenPrice: bigint;
  remainingCap?: bigint | null | undefined;
}): InvestmentValidationResult {
  const { rawAmount, tokenPrice, remainingCap } = params;
  const trimmed = rawAmount.trim();

  if (trimmed === "") {
    return {
      isValid: false,
      rawAmount,
      normalizedAmount: "",
      amountBigInt: null,
      allocationTokens: null,
      errorMessage: "Enter an investment amount in mIDR.",
      errorCode: "EMPTY",
    };
  }

  if (trimmed.includes(".")) {
    return {
      isValid: false,
      rawAmount,
      normalizedAmount: trimmed,
      amountBigInt: null,
      allocationTokens: null,
      errorMessage:
        "Amounts must be whole numbers (0 decimals). Fractional demo currency is not supported.",
      errorCode: "FRACTIONAL",
    };
  }

  if (trimmed.startsWith("-")) {
    return {
      isValid: false,
      rawAmount,
      normalizedAmount: trimmed,
      amountBigInt: null,
      allocationTokens: null,
      errorMessage: "Investment amount must be greater than zero.",
      errorCode: "NEGATIVE",
    };
  }

  const normalized = normalizeDecimalString(trimmed);
  if (!isCanonicalUnsignedDecimal(normalized)) {
    return {
      isValid: false,
      rawAmount,
      normalizedAmount: normalized,
      amountBigInt: null,
      allocationTokens: null,
      errorMessage:
        "Please enter a valid whole-number amount without letters or special characters.",
      errorCode: "MALFORMED",
    };
  }

  const amountBigInt = BigInt(normalized);
  if (amountBigInt === 0n) {
    return {
      isValid: false,
      rawAmount,
      normalizedAmount: normalized,
      amountBigInt: 0n,
      allocationTokens: null,
      errorMessage: "Investment amount must be greater than zero.",
      errorCode: "ZERO",
    };
  }

  if (tokenPrice <= 0n) {
    return {
      isValid: false,
      rawAmount,
      normalizedAmount: normalized,
      amountBigInt,
      allocationTokens: null,
      errorMessage: "Token price must be a positive amount.",
      errorCode: "MALFORMED",
    };
  }

  if (amountBigInt % tokenPrice !== 0n) {
    return {
      isValid: false,
      rawAmount,
      normalizedAmount: normalized,
      amountBigInt,
      allocationTokens: null,
      errorMessage: `Amount must be a whole multiple of token price (${formatWholeUnits(tokenPrice)} mIDR) to purchase whole tokens.`,
      errorCode: "NOT_DIVISIBLE",
    };
  }

  if (remainingCap !== undefined && remainingCap !== null && amountBigInt > remainingCap) {
    return {
      isValid: false,
      rawAmount,
      normalizedAmount: normalized,
      amountBigInt,
      allocationTokens: null,
      errorMessage: `Amount exceeds remaining offering cap (${formatWholeUnits(remainingCap)} mIDR).`,
      errorCode: "OVER_CAP",
    };
  }

  const allocationTokens = amountBigInt / tokenPrice;
  return {
    isValid: true,
    rawAmount,
    normalizedAmount: normalized,
    amountBigInt,
    allocationTokens,
    errorMessage: null,
    errorCode: null,
  };
}

/**
 * Exact canonical Villa Nusa defaults matching the frozen PRD, SYSTEM, and shared types.
 *
 * 10B indicative value, 3B offering target, 300k token supply, 10k token price, 3000 bps.
 * Target == supply * price invariant: 300,000 * 10,000 == 3,000,000,000.
 */
export const CANONICAL_VILLA_NUSA_PRESET: CreatePropertyRequest = {
  externalId: "ARCHPROP-001",
  name: "Villa Nusa",
  location: "Bali",
  propertyType: "Villa",
  issuerName: "PT Nusa Properties",
  indicativeValue: "10000000000",
  offeringTarget: "3000000000",
  tokenSupply: "300000",
  tokenPrice: "10000",
  economicRightsBps: 3000,
  description:
    "Luxury beachfront villa in Canggu, Bali offering 30% economic participation rights in distributable rental income and net exit proceeds.",
};

export interface PropertyFormValidationErrors {
  externalId?: string;
  name?: string;
  location?: string;
  propertyType?: string;
  issuerName?: string;
  indicativeValue?: string;
  offeringTarget?: string;
  tokenSupply?: string;
  tokenPrice?: string;
  economicRightsBps?: string;
  description?: string;
  invariant?: string;
}

export interface PropertyFormValidationResult {
  isValid: boolean;
  errors: PropertyFormValidationErrors;
}

/**
 * Pure client-side validation for CreatePropertyRequest fields.
 */
export function validateCreatePropertyRequest(
  data: Partial<CreatePropertyRequest> | Record<string, unknown>,
): PropertyFormValidationResult {
  const errors: PropertyFormValidationErrors = {};

  if (!data.externalId || typeof data.externalId !== "string" || !data.externalId.trim()) {
    errors.externalId = "Asset ID / external identifier is required.";
  }

  if (!data.name || typeof data.name !== "string" || !data.name.trim()) {
    errors.name = "Property name is required.";
  }

  if (!data.location || typeof data.location !== "string" || !data.location.trim()) {
    errors.location = "Location is required.";
  }

  if (!data.propertyType || typeof data.propertyType !== "string" || !data.propertyType.trim()) {
    errors.propertyType = "Property type is required.";
  }

  if (!data.issuerName || typeof data.issuerName !== "string" || !data.issuerName.trim()) {
    errors.issuerName = "Issuer name is required.";
  }

  if (!data.description || typeof data.description !== "string" || !data.description.trim()) {
    errors.description = "Property description is required.";
  }

  // Indicative value
  const indicativeRaw = typeof data.indicativeValue === "string" ? data.indicativeValue.trim() : "";
  const indicativeNorm = normalizeDecimalString(indicativeRaw);
  if (!indicativeNorm || !isCanonicalUnsignedDecimal(indicativeNorm) || BigInt(indicativeNorm) === 0n) {
    errors.indicativeValue = "Indicative value must be a positive canonical unsigned integer string.";
  }

  // Offering target
  const targetRaw = typeof data.offeringTarget === "string" ? data.offeringTarget.trim() : "";
  const targetNorm = normalizeDecimalString(targetRaw);
  if (!targetNorm || !isCanonicalUnsignedDecimal(targetNorm) || BigInt(targetNorm) === 0n) {
    errors.offeringTarget = "Offering target must be a positive canonical unsigned integer string.";
  }

  // Token supply
  const supplyRaw = typeof data.tokenSupply === "string" ? data.tokenSupply.trim() : "";
  const supplyNorm = normalizeDecimalString(supplyRaw);
  if (!supplyNorm || !isCanonicalUnsignedDecimal(supplyNorm) || BigInt(supplyNorm) === 0n) {
    errors.tokenSupply = "Token supply must be a positive canonical unsigned integer string.";
  }

  // Token price
  const priceRaw = typeof data.tokenPrice === "string" ? data.tokenPrice.trim() : "";
  const priceNorm = normalizeDecimalString(priceRaw);
  if (!priceNorm || !isCanonicalUnsignedDecimal(priceNorm) || BigInt(priceNorm) === 0n) {
    errors.tokenPrice = "Token price must be a positive canonical unsigned integer string.";
  }

  // Invariant check: target == supply * price
  if (
    targetNorm &&
    isCanonicalUnsignedDecimal(targetNorm) &&
    supplyNorm &&
    isCanonicalUnsignedDecimal(supplyNorm) &&
    priceNorm &&
    isCanonicalUnsignedDecimal(priceNorm)
  ) {
    const t = BigInt(targetNorm);
    const s = BigInt(supplyNorm);
    const p = BigInt(priceNorm);
    if (s * p !== t) {
      errors.invariant = `Offering target (${formatWholeUnits(t)} mIDR) must equal token supply × token price (${formatWholeUnits(s)} × ${formatWholeUnits(p)} = ${formatWholeUnits(s * p)} mIDR).`;
    }
  }

  // Economic rights BPS
  const bps =
    typeof data.economicRightsBps === "number"
      ? data.economicRightsBps
      : typeof data.economicRightsBps === "string"
        ? Number(data.economicRightsBps)
        : NaN;

  if (Number.isNaN(bps) || !Number.isInteger(bps) || bps <= 0 || bps > 10_000) {
    errors.economicRightsBps = "Economic rights must be an integer between 1 and 10,000 basis points (1–100%).";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

