"use client";

import { useCallback, useRef, useState } from "react";
import type { TxHash } from "@archprop/shared";
import {
  initialTxState,
  type TxLifecycleState,
  type TxPhase,
  type WalletAction,
} from "./view-models";

export interface UseTransactionLifecycleResult {
  state: TxLifecycleState;
  /** Runs the supplied wallet action through the full lifecycle. */
  run: (action: WalletAction) => Promise<TxHash | null>;
  /** Returns the UI to `idle` without touching chain state. */
  reset: () => void;
}

/**
 * Drives a wallet write through the presentation lifecycle required by the
 * verifier and owner screens:
 *
 * `idle → awaiting-signature → submitted → confirming → confirmed | failed`
 *
 * This hook owns presentation only. It never decides that a write succeeded
 * before a real receipt hash exists, and it never fabricates one: `confirmed`
 * is reached solely because the caller's action resolved with a hash.
 */
export function useTransactionLifecycle(): UseTransactionLifecycleResult {
  const [state, setState] = useState<TxLifecycleState>(initialTxState);
  const inFlight = useRef(false);

  const setPhase = useCallback((phase: TxPhase, patch: Partial<TxLifecycleState> = {}) => {
    setState((previous) => ({ ...previous, phase, ...patch }));
  }, []);

  const reset = useCallback(() => {
    inFlight.current = false;
    setState(initialTxState);
  }, []);

  const run = useCallback(
    async (action: WalletAction): Promise<TxHash | null> => {
      if (inFlight.current) {
        return null;
      }
      inFlight.current = true;
      setState({ phase: "awaiting-signature", txHash: null, error: null });

      let txHash: TxHash | null = null;
      try {
        txHash = await action.execute();
        setPhase("submitted", { txHash });
        // A resolved hash means the wallet broadcast the transaction. Confirming
        // is the terminal presentation state until FE-002 supplies the receipt
        // watcher, so the UI never claims finality it cannot prove.
        setPhase("confirming", { txHash });
        return txHash;
      } catch (error) {
        const reason =
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : "Transaction was rejected or failed.";
        setState({ phase: "failed", txHash, error: reason });
        return null;
      } finally {
        inFlight.current = false;
      }
    },
    [setPhase],
  );

  return { state, run, reset };
}
