"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  erc20Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { offeringEscrowAbi } from "@archprop/chain";
import type { AssetId, TxHash } from "@archprop/shared";
import {
  getClientChainConfig,
  getArchpropPublicClient,
  fetchInvestorState,
  fetchOfferingById,
  deriveOfferingForAsset,
  type ChainAddressSet,
  type ChainConfig,
  type DerivedOffering,
  type InvestorChainState,
} from "./chain-client";
import { useWallet } from "./wallet-context";
import { EXPECTED_CHAIN_ID, formatWholeUnits } from "./view-models";

/**
 * Live investor path for Villa Nusa.
 *
 * Every write here is preceded by a fresh on-chain recheck, its transaction
 * hash is captured the moment the wallet broadcasts it, and "confirmed" is only
 * ever reached from a successful receipt. Approval and investment are recorded
 * as distinct writes, so an approval receipt can never be presented as an
 * investment success after the allowance refresh changes the button label.
 */

/** Which of the two investor writes a state describes. */
export type InvestorWriteAction = "approve" | "invest";

/**
 * Phases an investor write moves through.
 *
 * `reverted` means the transaction was mined and its receipt reported failure.
 * `receipt-unknown` means the wallet broadcast the transaction but its receipt
 * could not be read: the outcome is not known and must not be reported as
 * either success or failure.
 */
export type InvestorTxPhase =
  | "idle"
  | "awaiting-signature"
  | "submitted"
  | "confirming"
  | "confirmed"
  | "reverted"
  | "receipt-unknown"
  | "failed";

export interface InvestorTxState {
  phase: InvestorTxPhase;
  /** The write this state describes. Never inferred from a button label. */
  action: InvestorWriteAction | null;
  /** Whole mIDR units this write was asked to move (0 decimals). */
  amount: bigint | null;
  /** Hash captured at broadcast; retained for every post-broadcast phase. */
  txHash: TxHash | null;
  error: string | null;
}

export const initialInvestorTxState: InvestorTxState = {
  phase: "idle",
  action: null,
  amount: null,
  txHash: null,
  error: null,
};

/**
 * True while a transaction outcome is still pending.
 *
 * Duplicate actions stay disabled for every one of these, including
 * `receipt-unknown`, because the chain may still confirm the write.
 */
export function isInvestorTxPending(phase: InvestorTxPhase): boolean {
  return (
    phase === "awaiting-signature" ||
    phase === "submitted" ||
    phase === "confirming" ||
    phase === "receipt-unknown"
  );
}

/**
 * Whether a transaction state may be reset to idle.
 *
 * An unresolved broadcast or in-flight write (awaiting-signature, submitted,
 * confirming, receipt-unknown) must NOT be cleared, as that would discard
 * the transaction hash and unlock an unsafe retry while the first outcome is
 * still unresolved on chain. Only resolved states (confirmed, reverted,
 * pre-broadcast failed, or idle) can be reset.
 */
export function canResetInvestorTx(phase: InvestorTxPhase): boolean {
  return !isInvestorTxPending(phase);
}

/**
 * Pure state reducer for resetTx.
 *
 * Leaves unresolved states (pending or receipt-unknown) completely intact,
 * preserving their action, amount, phase, hash, and error.
 * Only resets to initialInvestorTxState when the receipt is actually known
 * (confirmed or reverted) or when a pre-broadcast failure occurred.
 */
export function reduceResetTxState(currentState: InvestorTxState): InvestorTxState {
  if (!canResetInvestorTx(currentState.phase)) {
    return currentState;
  }
  return initialInvestorTxState;
}

/**
 * Evaluates whether an investor write attempt can proceed.
 *
 * Returns canProceed: false when another write is in flight or when the current
 * transaction has an unresolved chain outcome (awaiting-signature, submitted,
 * confirming, or receipt-unknown).
 */
export function evaluateInvestorWriteGuard(input: {
  isWriteInFlight: boolean;
  txPhase: InvestorTxPhase;
}): { canProceed: boolean; reason: string | null } {
  if (input.isWriteInFlight || isInvestorTxPending(input.txPhase)) {
    return {
      canProceed: false,
      reason: "Another transaction for this wallet is still awaiting a chain outcome.",
    };
  }
  return { canProceed: true, reason: null };
}

/**
 * Pure state transition for a rejected duplicate write attempt.
 *
 * A rejected duplicate attempt must leave the original action, amount, phase,
 * hash, and error completely unchanged.
 */
export function reduceDuplicateWriteAttempt(currentState: InvestorTxState): InvestorTxState {
  return currentState;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Base class for a failed investor write.
 *
 * `txHash` is non-null only when the wallet actually broadcast a transaction,
 * so a caller can never display a hash that does not exist.
 */
export class InvestorWriteError extends Error {
  constructor(
    message: string,
    readonly action: InvestorWriteAction,
    readonly txHash: TxHash | null,
  ) {
    super(message);
  }
}

/** The write was stopped before broadcast because simulation reverted. */
export class SimulationFailedError extends InvestorWriteError {
  override readonly name = "SimulationFailedError";
}

/** The wallet refused or failed to broadcast. No transaction exists. */
export class BroadcastFailedError extends InvestorWriteError {
  override readonly name = "BroadcastFailedError";
}

/** Broadcast succeeded but no receipt could be read. The outcome is unknown. */
export class ReceiptUnavailableError extends InvestorWriteError {
  override readonly name = "ReceiptUnavailableError";
}

/** The transaction was mined and its receipt reported failure. */
export class TransactionRevertedError extends InvestorWriteError {
  override readonly name = "TransactionRevertedError";
}

export type TxPhaseListener = (update: {
  phase: Extract<InvestorTxPhase, "submitted" | "confirming">;
  txHash: TxHash;
}) => void;

export interface ExecuteApproveTransactionParams {
  publicClient: PublicClient;
  walletClient: WalletClient;
  mockIdrAddress: Address;
  escrowAddress: Address;
  investorAddress: Address;
  chainId: number;
  amount: bigint;
  /** Reports `submitted` and `confirming` as soon as they are known. */
  onPhase?: TxPhaseListener | undefined;
}

/**
 * Standard ERC-20 approve using the real wallet client.
 *
 * A failed simulation stops the write instead of warning and continuing. The
 * hash is reported as soon as the wallet returns it, before the receipt wait.
 */
export async function executeApproveTransaction(
  params: ExecuteApproveTransactionParams,
): Promise<TxHash> {
  const {
    publicClient,
    walletClient,
    mockIdrAddress,
    escrowAddress,
    investorAddress,
    chainId,
    amount,
    onPhase,
  } = params;

  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `Wrong network: connected to chain ${chainId}, expected Arbitrum Sepolia (${EXPECTED_CHAIN_ID}).`,
    );
  }

  try {
    await publicClient.simulateContract({
      address: mockIdrAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [escrowAddress, amount],
      account: investorAddress,
    });
  } catch (error) {
    throw new SimulationFailedError(
      `The mIDR approval could not be simulated against the chain: ${errorText(
        error,
      )} The wallet write was not sent, so nothing was broadcast.`,
      "approve",
      null,
    );
  }

  let hash: Hex;
  try {
    hash = await walletClient.writeContract({
      address: mockIdrAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [escrowAddress, amount],
      account: investorAddress,
      chain: publicClient.chain,
    });
  } catch (error) {
    throw new BroadcastFailedError(
      `The wallet did not broadcast the approval: ${errorText(error)}`,
      "approve",
      null,
    );
  }

  const txHash = hash as TxHash;
  onPhase?.({ phase: "submitted", txHash });
  onPhase?.({ phase: "confirming", txHash });

  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash });
  } catch (error) {
    throw new ReceiptUnavailableError(
      `The approval was broadcast as ${txHash}, but its receipt could not be read (${errorText(
        error,
      )}). The outcome is unknown — check the transaction on Arbiscan before retrying.`,
      "approve",
      txHash,
    );
  }

  if (receipt.status !== "success") {
    throw new TransactionRevertedError(
      "Approval transaction reverted on-chain.",
      "approve",
      txHash,
    );
  }

  return txHash;
}

export interface ExecuteInvestTransactionParams {
  publicClient: PublicClient;
  walletClient: WalletClient;
  escrowAddress: Address;
  investorAddress: Address;
  chainId: number;
  offeringId: bigint;
  amount: bigint;
  /** Reports `submitted` and `confirming` as soon as they are known. */
  onPhase?: TxPhaseListener | undefined;
}

/**
 * OfferingEscrow invest using the real wallet client.
 *
 * Same phase discipline as the approval: simulation failure stops the write,
 * the hash is captured at broadcast, and only a successful receipt confirms.
 */
export async function executeInvestTransaction(
  params: ExecuteInvestTransactionParams,
): Promise<TxHash> {
  const {
    publicClient,
    walletClient,
    escrowAddress,
    investorAddress,
    chainId,
    offeringId,
    amount,
    onPhase,
  } = params;

  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `Wrong network: connected to chain ${chainId}, expected Arbitrum Sepolia (${EXPECTED_CHAIN_ID}).`,
    );
  }

  try {
    await publicClient.simulateContract({
      address: escrowAddress,
      abi: offeringEscrowAbi,
      functionName: "invest",
      args: [offeringId, amount],
      account: investorAddress,
    });
  } catch (error) {
    throw new SimulationFailedError(
      `The investment could not be simulated against the chain: ${errorText(
        error,
      )} The wallet write was not sent, so nothing was broadcast.`,
      "invest",
      null,
    );
  }

  let hash: Hex;
  try {
    hash = await walletClient.writeContract({
      address: escrowAddress,
      abi: offeringEscrowAbi,
      functionName: "invest",
      args: [offeringId, amount],
      account: investorAddress,
      chain: publicClient.chain,
    });
  } catch (error) {
    throw new BroadcastFailedError(
      `The wallet did not broadcast the investment: ${errorText(error)}`,
      "invest",
      null,
    );
  }

  const txHash = hash as TxHash;
  onPhase?.({ phase: "submitted", txHash });
  onPhase?.({ phase: "confirming", txHash });

  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash });
  } catch (error) {
    throw new ReceiptUnavailableError(
      `The investment was broadcast as ${txHash}, but its receipt could not be read (${errorText(
        error,
      )}). The outcome is unknown — check the transaction on Arbiscan before retrying.`,
      "invest",
      txHash,
    );
  }

  if (receipt.status !== "success") {
    throw new TransactionRevertedError(
      "Investment transaction reverted on-chain.",
      "invest",
      txHash,
    );
  }

  return txHash;
}

/** Converts a thrown write error into the state the UI must display. */
export function mapWriteErrorToTxState(
  error: unknown,
  action: InvestorWriteAction,
  amount: bigint,
): InvestorTxState {
  if (error instanceof ReceiptUnavailableError) {
    return {
      phase: "receipt-unknown",
      action,
      amount,
      txHash: error.txHash,
      error: error.message,
    };
  }
  if (error instanceof TransactionRevertedError) {
    return {
      phase: "reverted",
      action,
      amount,
      txHash: error.txHash,
      error: error.message,
    };
  }
  if (error instanceof SimulationFailedError || error instanceof BroadcastFailedError) {
    return { phase: "failed", action, amount, txHash: error.txHash, error: error.message };
  }
  return {
    phase: "failed",
    action,
    amount,
    txHash: null,
    error: errorText(error),
  };
}

/**
 * Sequence guard for asynchronous chain reads.
 *
 * Every read opens a ticket; only the newest ticket may write state. Opening a
 * later ticket — which happens on every refresh, on every write-boundary
 * recheck, and therefore the moment the connected wallet changes and its read
 * starts — drops every outstanding ticket, so a slow response for a previous
 * wallet or offering can never overwrite current state.
 */
export class StaleReadGuard {
  private sequence = 0;

  /** Opens a ticket for a new read and invalidates any previous one. */
  open(): { isCurrent: () => boolean } {
    const token = ++this.sequence;
    return { isCurrent: () => token === this.sequence };
  }
}

export interface InvestorSnapshot {
  walletAddress: Address | null;
  offering: DerivedOffering | null;
  investor: InvestorChainState | null;
}

export interface LoadInvestorSnapshotParams {
  client: PublicClient;
  addresses: ChainAddressSet;
  assetId?: AssetId | undefined;
  offeringId?: bigint | null | undefined;
  walletAddress?: Address | null | undefined;
  guard: StaleReadGuard;
  /** Invoked at most once, only while the ticket is still current. */
  onSnapshot: (snapshot: InvestorSnapshot) => void;
  /** Invoked at most once, only while the ticket is still current. */
  onError: (reason: string) => void;
}

/**
 * Reads the offering and, when a wallet is connected, that wallet's investor
 * state. Results are only delivered while the ticket is current, so a wallet
 * switch or a newer refresh discards an in-flight response.
 */
export async function loadInvestorSnapshot(
  params: LoadInvestorSnapshotParams,
): Promise<{ isCurrent: () => boolean }> {
  const { client, addresses, assetId, offeringId, walletAddress, guard, onSnapshot, onError } =
    params;

  const ticket = guard.open();

  try {
    let derived: DerivedOffering | null = null;
    let targetOfferingId: bigint | null = null;

    if (assetId) {
      derived = await deriveOfferingForAsset(client, addresses, assetId);
      // An offering the chain does not confirm never falls back to a page
      // prop: with no offering there is nothing to price, cap, or invest in.
      targetOfferingId = derived?.offeringId ?? null;
    } else if (offeringId !== null && offeringId !== undefined) {
      derived = await fetchOfferingById(client, addresses, offeringId);
      targetOfferingId = derived.offeringId;
    }

    if (!ticket.isCurrent()) {
      return ticket;
    }

    let investor: InvestorChainState | null = null;
    if (walletAddress && targetOfferingId !== null) {
      investor = await fetchInvestorState(client, addresses, walletAddress, targetOfferingId);
    }

    if (!ticket.isCurrent()) {
      return ticket;
    }

    onSnapshot({ walletAddress: walletAddress ?? null, offering: derived, investor });
  } catch (error) {
    if (ticket.isCurrent()) {
      onError(errorText(error));
    }
  }

  return ticket;
}

export interface WriteBoundaryInput {
  walletAddress: Address | null | undefined;
  chainId: number | null | undefined;
  /** Whole mIDR amount currently entered. */
  amount: bigint | null | undefined;
  /** Freshly read investor state for `walletAddress`, or null while unknown. */
  investor: InvestorChainState | null | undefined;
  /** Freshly read offering, or null while unknown. */
  offering: DerivedOffering | null | undefined;
  /** Constants the page displays for this asset; null skips the cross-check. */
  displayedTokenPrice?: bigint | null | undefined;
  displayedOfferingTarget?: bigint | null | undefined;
  txPhase: InvestorTxPhase;
  /** Unix seconds used for the deadline check; defaults to wall clock. */
  nowSeconds?: bigint | undefined;
}

export interface WriteBoundaryDecision {
  /** Whether the write may be sent to the wallet right now. */
  canWrite: boolean;
  /**
   * The write the current allowance requires, when it can be determined.
   * Derived from the entered amount, never from a fixed threshold.
   */
  action: InvestorWriteAction | null;
  /** Missing prerequisite, phrased as a noun phrase, or null when allowed. */
  reason: string | null;
}

/**
 * Rechecks every economic and identity prerequisite at the write boundary.
 *
 * Checks, in order: a pending transaction, a connected wallet, chain ID
 * 421614, a confirmed offering that is still `OPEN` and inside its deadline,
 * agreement between the live offering economics and the displayed constants,
 * a positive whole-multiple amount within the remaining cap, current-wallet
 * identity approval, a sufficient balance, and finally the allowance that
 * decides approval versus investment.
 */
export function evaluateWriteBoundary(input: WriteBoundaryInput): WriteBoundaryDecision {
  const {
    walletAddress,
    chainId,
    amount,
    investor,
    offering,
    displayedTokenPrice,
    displayedOfferingTarget,
    txPhase,
  } = input;

  if (isInvestorTxPending(txPhase)) {
    return {
      canWrite: false,
      action: null,
      reason: "a transaction outcome that the chain has not resolved yet",
    };
  }

  if (!walletAddress) {
    return {
      canWrite: false,
      action: null,
      reason: "a connected investor wallet on Arbitrum Sepolia",
    };
  }

  if (chainId === null || chainId === undefined) {
    return { canWrite: false, action: null, reason: "a wallet that reports its connected chain" };
  }

  if (chainId !== EXPECTED_CHAIN_ID) {
    return {
      canWrite: false,
      action: null,
      reason: `connected to wrong network; switch to Arbitrum Sepolia (chain ${EXPECTED_CHAIN_ID})`,
    };
  }

  if (!offering) {
    return {
      canWrite: false,
      action: null,
      reason: "a confirmed on-chain offering read from OfferingEscrow",
    };
  }

  if (offering.status !== "OPEN") {
    return {
      canWrite: false,
      action: null,
      reason: `the offering to be ${offering.status}; only an OPEN offering accepts investments`,
    };
  }

  const nowSeconds = input.nowSeconds ?? BigInt(Math.floor(Date.now() / 1000));
  if (offering.deadline > 0n && nowSeconds >= offering.deadline) {
    return {
      canWrite: false,
      action: null,
      reason: "an offering whose deadline has not already passed",
    };
  }

  if (displayedTokenPrice !== null && displayedTokenPrice !== undefined) {
    if (offering.tokenPrice !== displayedTokenPrice) {
      return {
        canWrite: false,
        action: null,
        reason: `the live offering token price to match the displayed ${formatWholeUnits(
          displayedTokenPrice,
        )} mIDR; the chain reports ${formatWholeUnits(offering.tokenPrice)} mIDR`,
      };
    }
  }

  if (displayedOfferingTarget !== null && displayedOfferingTarget !== undefined) {
    if (offering.target !== displayedOfferingTarget) {
      return {
        canWrite: false,
        action: null,
        reason: `the live offering target to match the displayed ${formatWholeUnits(
          displayedOfferingTarget,
        )} mIDR; the chain reports ${formatWholeUnits(offering.target)} mIDR`,
      };
    }
  }

  if (amount === null || amount === undefined || amount <= 0n) {
    return {
      canWrite: false,
      action: null,
      reason: "a positive whole-multiple investment amount in mIDR",
    };
  }

  if (offering.tokenPrice <= 0n || amount % offering.tokenPrice !== 0n) {
    return {
      canWrite: false,
      action: null,
      reason: `a whole multiple of the live token price (${formatWholeUnits(
        offering.tokenPrice,
      )} mIDR) so only whole tokens are purchased`,
    };
  }

  if (amount > offering.remainingCap) {
    return {
      canWrite: false,
      action: null,
      reason: `an amount within the remaining offering cap (${formatWholeUnits(
        offering.remainingCap,
      )} mIDR)`,
    };
  }

  if (!investor || investor.address.toLowerCase() !== walletAddress.toLowerCase()) {
    return {
      canWrite: false,
      action: null,
      reason: "the identity, balance, and allowance read for the connected wallet",
    };
  }

  if (!investor.isApproved) {
    return {
      canWrite: false,
      action: null,
      reason: "demo investor approval in IdentityRegistry",
    };
  }

  if (investor.mIdrBalance < amount) {
    return {
      canWrite: false,
      action: null,
      reason: `an mIDR balance of at least ${formatWholeUnits(
        amount,
      )} mIDR; this wallet holds ${formatWholeUnits(investor.mIdrBalance)} mIDR`,
    };
  }

  if (investor.allowance < amount) {
    return { canWrite: true, action: "approve", reason: null };
  }

  return { canWrite: true, action: "invest", reason: null };
}

/**
 * The write the currently entered amount requires.
 *
 * Uses the amount the investor actually typed, so the allowance test is never
 * a fixed threshold. Returns null while the inputs are unknown.
 */
export function deriveInvestorAction(
  investor: InvestorChainState | null | undefined,
  amount: bigint | null | undefined,
): InvestorWriteAction | null {
  if (!investor || amount === null || amount === undefined || amount <= 0n) {
    return null;
  }
  return investor.allowance < amount ? "approve" : "invest";
}

export interface UseInvestorFlowOptions {
  offeringId?: bigint | null | undefined;
  assetId?: AssetId | undefined;
  /**
   * Constants the page displays. When supplied, a live offering that disagrees
   * disables the write instead of silently using one or the other.
   */
  expectedTokenPrice?: bigint | null | undefined;
  expectedOfferingTarget?: bigint | null | undefined;
  // Dependency injection for tests
  customPublicClient?: PublicClient | undefined;
  customWalletClient?: WalletClient | undefined;
  customAddress?: Address | undefined;
  customChainId?: number | undefined;
}

export interface UseInvestorFlowResult {
  offering: DerivedOffering | null;
  investor: InvestorChainState | null;
  isLoading: boolean;
  isRefreshing: boolean;
  txState: InvestorTxState;
  error: string | null;
  refresh: () => Promise<void>;
  approve: (amount: bigint) => Promise<TxHash | null>;
  invest: (amount: bigint) => Promise<TxHash | null>;
  resetTx: () => void;
}

export function useInvestorFlow(options: UseInvestorFlowOptions = {}): UseInvestorFlowResult {
  const wallet = useWallet();

  const {
    assetId,
    offeringId,
    expectedTokenPrice,
    expectedOfferingTarget,
    customAddress,
    customChainId,
    customWalletClient,
    customPublicClient,
  } = options;

  const address = customAddress ?? wallet.address;
  const chainId = customChainId ?? wallet.chainId;
  const walletClient = customWalletClient ?? wallet.getWalletClient();

  const [offering, setOffering] = useState<DerivedOffering | null>(null);
  /**
   * Investor state is stored together with the wallet it was read for.
   *
   * The value is derived, not cleared in an effect, so a wallet switch renders
   * `null` on the very next frame instead of the previous wallet's balance,
   * allowance, or identity approval — with no window in which stale data can be
   * displayed or acted on.
   */
  const [investorRead, setInvestorRead] = useState<{
    walletAddress: Address | null;
    data: InvestorChainState | null;
  }>({ walletAddress: null, data: null });
  const investor =
    investorRead.walletAddress !== null && investorRead.walletAddress === address
      ? investorRead.data
      : null;
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [txState, setTxState] = useState<InvestorTxState>(initialInvestorTxState);
  const [error, setError] = useState<string | null>(null);

  const guardRef = useRef<StaleReadGuard>(new StaleReadGuard());
  const pendingWriteRef = useRef(false);
  const txStateRef = useRef<InvestorTxState>(initialInvestorTxState);

  // The ref mirrors the rendered phase so a write started later in the same
  // tick can see it without re-reading React state.
  useEffect(() => {
    txStateRef.current = txState;
  }, [txState]);

  // The config/client are memoized in chain-client, so these references are
  // stable across renders and cannot re-trigger the refresh effect by
  // themselves.
  const config: ChainConfig | null = getClientChainConfig();

  const getClient = useCallback((): PublicClient | null => {
    if (customPublicClient) {
      return customPublicClient;
    }
    if (!config) {
      return null;
    }
    try {
      return getArchpropPublicClient(config);
    } catch {
      return null;
    }
  }, [customPublicClient, config]);

  /**
   * A wallet change does not need an effect to drop stale data: `investor` is
   * derived above, and `refresh` below depends on `address`, so the in-flight
   * ticket for the previous wallet is invalidated as soon as the next read
   * opens. Opening a ticket bumps the shared sequence, which is what makes a
   * slow response for an old wallet or offering unable to overwrite current
   * state.
   */
  const refresh = useCallback(async () => {
    const client = getClient();
    if (!client || !config) {
      return;
    }

    setIsRefreshing(true);
    const ticket = await loadInvestorSnapshot({
      client,
      addresses: config.addresses,
      assetId,
      offeringId,
      walletAddress: address,
      guard: guardRef.current,
      onSnapshot: (snapshot) => {
        setOffering(snapshot.offering);
        setInvestorRead({ walletAddress: snapshot.walletAddress, data: snapshot.investor });
      },
      onError: (reason) => setError(reason),
    });

    if (ticket.isCurrent()) {
      setIsRefreshing(false);
    }
  }, [getClient, config, assetId, offeringId, address]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      await refresh();
      if (!cancelled) {
        setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const resetTx = useCallback(() => {
    setTxState((current) => reduceResetTxState(current));
  }, []);

  /**
   * Re-reads the offering and the connected wallet's investor state so the
   * write boundary is evaluated against current chain data, not the values
   * last rendered.
   */
  const readWritePreconditions = useCallback(
    async (
      client: PublicClient,
      addresses: ChainAddressSet,
    ): Promise<{ offering: DerivedOffering | null; investor: InvestorChainState | null }> => {
      const ticket = guardRef.current.open();
      let derived: DerivedOffering | null = null;
      let targetOfferingId: bigint | null = null;

      if (assetId) {
        derived = await deriveOfferingForAsset(client, addresses, assetId);
        targetOfferingId = derived?.offeringId ?? null;
      } else if (offeringId !== null && offeringId !== undefined) {
        derived = await fetchOfferingById(client, addresses, offeringId);
        targetOfferingId = derived.offeringId;
      }

      if (!ticket.isCurrent()) {
        throw new Error(
          "The connected wallet changed while the on-chain recheck was in flight; nothing was sent.",
        );
      }

      let freshInvestor: InvestorChainState | null = null;
      if (address && targetOfferingId !== null) {
        freshInvestor = await fetchInvestorState(client, addresses, address, targetOfferingId);
      }

      if (!ticket.isCurrent()) {
        throw new Error(
          "The connected wallet changed while the on-chain recheck was in flight; nothing was sent.",
        );
      }

      return { offering: derived, investor: freshInvestor };
    },
    [assetId, offeringId, address],
  );

  const performWrite = useCallback(
    async (action: InvestorWriteAction, amount: bigint): Promise<TxHash | null> => {
      const client = getClient();
      if (!client || !config) {
        setTxState({
          phase: "failed",
          action,
          amount,
          txHash: null,
          error: "Chain configuration is missing.",
        });
        return null;
      }
      if (!address || !walletClient) {
        setTxState({
          phase: "failed",
          action,
          amount,
          txHash: null,
          error: "Wallet not connected.",
        });
        return null;
      }
      if (chainId !== EXPECTED_CHAIN_ID) {
        setTxState({
          phase: "failed",
          action,
          amount,
          txHash: null,
          error: `Wrong network: connected to chain ${chainId}, expected Arbitrum Sepolia (${EXPECTED_CHAIN_ID}).`,
        });
        return null;
      }
      setTxState({ phase: "awaiting-signature", action, amount, txHash: null, error: null });

      let fresh: { offering: DerivedOffering | null; investor: InvestorChainState | null };
      try {
        fresh = await readWritePreconditions(client, config.addresses);
      } catch (err) {
        setTxState({
          phase: "failed",
          action,
          amount,
          txHash: null,
          error: `The on-chain prerequisites could not be rechecked, so nothing was sent: ${errorText(
            err,
          )}`,
        });
        return null;
      }

      const decision = evaluateWriteBoundary({
        walletAddress: address,
        chainId,
        amount,
        investor: fresh.investor,
        offering: fresh.offering,
        displayedTokenPrice: expectedTokenPrice,
        displayedOfferingTarget: expectedOfferingTarget,
        txPhase: "idle",
      });

      if (!decision.canWrite) {
        setTxState({
          phase: "failed",
          action,
          amount,
          txHash: null,
          error: `The write was not sent: the chain state does not satisfy ${decision.reason}.`,
        });
        return null;
      }

      if (decision.action !== action) {
        setTxState({
          phase: "failed",
          action,
          amount,
          txHash: null,
          error:
            action === "approve"
              ? "The allowance already covers this amount, so no approval is needed. Invest instead."
              : "The allowance does not cover this amount yet, so an mIDR approval is required first.",
        });
        return null;
      }

      const onPhase: TxPhaseListener = (update) => {
        setTxState((previous) => ({ ...previous, phase: update.phase, txHash: update.txHash }));
      };

      try {
        const hash =
          action === "approve"
            ? await executeApproveTransaction({
                publicClient: client,
                walletClient,
                mockIdrAddress: config.addresses.mockIdr,
                escrowAddress: config.addresses.offeringEscrow,
                investorAddress: address,
                chainId,
                amount,
                onPhase,
              })
            : await executeInvestTransaction({
                publicClient: client,
                walletClient,
                escrowAddress: config.addresses.offeringEscrow,
                investorAddress: address,
                chainId,
                offeringId: (fresh.offering?.offeringId ?? offeringId) as bigint,
                amount,
                onPhase,
              });

        setTxState({ phase: "confirmed", action, amount, txHash: hash, error: null });
        void refresh();
        return hash;
      } catch (err) {
        setTxState(mapWriteErrorToTxState(err, action, amount));
        // A broadcast whose receipt could not be read keeps its hash and stays
        // pending; everything else can be safely re-read.
        if (!(err instanceof ReceiptUnavailableError)) {
          void refresh();
        }
        return null;
      }
    },
    [
      getClient,
      config,
      address,
      walletClient,
      chainId,
      readWritePreconditions,
      expectedTokenPrice,
      expectedOfferingTarget,
      offeringId,
      refresh,
    ],
  );

  /**
   * Single entry point for both writes.
   *
   * `pendingWriteRef` closes the window between two clicks that land before
   * React re-renders, and the phase check covers a broadcast that was left with
   * an unresolved receipt. Either one makes a duplicate action a no-op instead
   * of a second on-chain write.
   *
   * Crucially, a rejected duplicate attempt leaves the original action, amount,
   * phase, hash, and error completely unchanged, and never invokes performWrite.
   */
  const runWrite = useCallback(
    async (action: InvestorWriteAction, amount: bigint): Promise<TxHash | null> => {
      const guard = evaluateInvestorWriteGuard({
        isWriteInFlight: pendingWriteRef.current,
        txPhase: txStateRef.current.phase,
      });

      if (!guard.canProceed) {
        // A rejected duplicate attempt leaves original state completely intact.
        // It must never call setTxState or simulateContract/writeContract.
        return null;
      }

      pendingWriteRef.current = true;
      try {
        return await performWrite(action, amount);
      } finally {
        pendingWriteRef.current = false;
      }
    },
    [performWrite],
  );

  const approve = useCallback(
    (amount: bigint): Promise<TxHash | null> => runWrite("approve", amount),
    [runWrite],
  );

  const invest = useCallback(
    (amount: bigint): Promise<TxHash | null> => runWrite("invest", amount),
    [runWrite],
  );

  return {
    offering,
    investor,
    isLoading,
    isRefreshing,
    txState,
    error,
    refresh,
    approve,
    invest,
    resetTx,
  };
}
