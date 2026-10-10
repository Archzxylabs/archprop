"use client";

import { useCallback, useEffect, useState } from "react";
import { erc20Abi, type Address, type PublicClient, type WalletClient } from "viem";
import { offeringEscrowAbi } from "@archprop/chain";
import type { TxHash } from "@archprop/shared";
import {
  getClientChainConfig,
  getArchpropPublicClient,
  fetchInvestorState,
  deriveOfferingForAsset,
  type DerivedOffering,
  type InvestorChainState,
} from "./chain-client";
import { useWallet } from "./wallet-context";
import {
  EXPECTED_CHAIN_ID,
  initialTxState,
  type TxLifecycleState,
} from "./view-models";

/**
 * Standard ERC-20 approve using real wallet client and receipt wait.
 * Rejects wrong chain and reverts atomically if receipt fails.
 */
export async function executeApproveTransaction(params: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  mockIdrAddress: Address;
  escrowAddress: Address;
  investorAddress: Address;
  chainId: number;
  amount: bigint;
}): Promise<TxHash> {
  const {
    publicClient,
    walletClient,
    mockIdrAddress,
    escrowAddress,
    investorAddress,
    chainId,
    amount,
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
  } catch (simErr) {
    console.warn("Approval simulation note:", simErr);
  }

  const hash = await walletClient.writeContract({
    address: mockIdrAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [escrowAddress, amount],
    account: investorAddress,
    chain: publicClient.chain,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error("Approval transaction reverted on-chain.");
  }

  return hash as TxHash;
}

/**
 * OfferingEscrow invest execution using real wallet client and receipt wait.
 * Rejects wrong chain and reverts atomically if receipt fails.
 */
export async function executeInvestTransaction(params: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  escrowAddress: Address;
  investorAddress: Address;
  chainId: number;
  offeringId: bigint;
  amount: bigint;
}): Promise<TxHash> {
  const {
    publicClient,
    walletClient,
    escrowAddress,
    investorAddress,
    chainId,
    offeringId,
    amount,
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
  } catch (simErr) {
    console.warn("Investment simulation note:", simErr);
  }

  const hash = await walletClient.writeContract({
    address: escrowAddress,
    abi: offeringEscrowAbi,
    functionName: "invest",
    args: [offeringId, amount],
    account: investorAddress,
    chain: publicClient.chain,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error("Investment transaction reverted on-chain.");
  }

  return hash as TxHash;
}

export interface UseInvestorFlowOptions {
  offeringId?: bigint | null | undefined;
  assetId?: `0x${string}` | undefined;
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
  txState: TxLifecycleState;
  actionStep: "approve" | "invest";
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
    offeringId: initialOfferingId,
    customAddress,
    customChainId,
    customWalletClient,
    customPublicClient,
  } = options;

  const address = customAddress ?? wallet.address;
  const chainId = customChainId ?? wallet.chainId;
  const walletClient = customWalletClient ?? wallet.getWalletClient();

  const [offering, setOffering] = useState<DerivedOffering | null>(null);
  const [investor, setInvestor] = useState<InvestorChainState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [txState, setTxState] = useState<TxLifecycleState>(initialTxState);
  const [error, setError] = useState<string | null>(null);

  const config = getClientChainConfig();

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

  const refresh = useCallback(async () => {
    const client = getClient();
    if (!client || !config) {
      return;
    }

    setIsRefreshing(true);
    try {
      let derivedOfferingId: bigint | null | undefined = initialOfferingId;
      if (assetId) {
        const derived = await deriveOfferingForAsset(
          client,
          {
            offeringEscrow: config.addresses.offeringEscrow,
            registry: config.addresses.registry,
            mockIdr: config.addresses.mockIdr,
          },
          assetId,
        );
        setOffering(derived);
        if (derivedOfferingId === undefined || derivedOfferingId === null) {
          derivedOfferingId = derived?.offeringId;
        }
      }

      const targetOfferingId = initialOfferingId ?? derivedOfferingId;
      if (address && targetOfferingId !== undefined && targetOfferingId !== null) {
        const inv = await fetchInvestorState(
          client,
          {
            identityRegistry: config.addresses.identityRegistry,
            mockIdr: config.addresses.mockIdr,
            offeringEscrow: config.addresses.offeringEscrow,
          },
          address,
          targetOfferingId,
        );
        setInvestor(inv);
      } else {
        setInvestor(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRefreshing(false);
    }
  }, [getClient, config, assetId, initialOfferingId, address]);

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
    setTxState(initialTxState);
  }, []);

  const approve = useCallback(
    async (amount: bigint): Promise<TxHash | null> => {
      const client = getClient();
      if (!client || !config) {
        setTxState({ phase: "failed", txHash: null, error: "Chain configuration is missing." });
        return null;
      }
      if (!address || !walletClient) {
        setTxState({ phase: "failed", txHash: null, error: "Wallet not connected." });
        return null;
      }
      if (chainId !== EXPECTED_CHAIN_ID) {
        setTxState({
          phase: "failed",
          txHash: null,
          error: `Wrong network: connected to chain ${chainId}, expected Arbitrum Sepolia (${EXPECTED_CHAIN_ID}).`,
        });
        return null;
      }

      setTxState({ phase: "awaiting-signature", txHash: null, error: null });

      let txHash: TxHash | null = null;
      try {
        const hash = await executeApproveTransaction({
          publicClient: client,
          walletClient,
          mockIdrAddress: config.addresses.mockIdr,
          escrowAddress: config.addresses.offeringEscrow,
          investorAddress: address,
          chainId,
          amount,
        });

        txHash = hash;
        setTxState({ phase: "confirmed", txHash, error: null });
        await refresh();
        return txHash;
      } catch (err) {
        const reason =
          err instanceof Error
            ? err.message
            : "Approval transaction was rejected or failed.";
        setTxState({ phase: "failed", txHash, error: reason });
        return null;
      }
    },
    [getClient, config, address, walletClient, chainId, refresh],
  );

  const invest = useCallback(
    async (amount: bigint): Promise<TxHash | null> => {
      const client = getClient();
      if (!client || !config) {
        setTxState({ phase: "failed", txHash: null, error: "Chain configuration is missing." });
        return null;
      }
      if (!address || !walletClient) {
        setTxState({ phase: "failed", txHash: null, error: "Wallet not connected." });
        return null;
      }
      if (chainId !== EXPECTED_CHAIN_ID) {
        setTxState({
          phase: "failed",
          txHash: null,
          error: `Wrong network: connected to chain ${chainId}, expected Arbitrum Sepolia (${EXPECTED_CHAIN_ID}).`,
        });
        return null;
      }

      const targetOfferingId = initialOfferingId ?? offering?.offeringId;
      if (targetOfferingId === undefined || targetOfferingId === null) {
        setTxState({ phase: "failed", txHash: null, error: "Offering ID is unknown or not derived." });
        return null;
      }

      setTxState({ phase: "awaiting-signature", txHash: null, error: null });

      let txHash: TxHash | null = null;
      try {
        const hash = await executeInvestTransaction({
          publicClient: client,
          walletClient,
          escrowAddress: config.addresses.offeringEscrow,
          investorAddress: address,
          chainId,
          offeringId: targetOfferingId,
          amount,
        });

        txHash = hash;
        setTxState({ phase: "confirmed", txHash, error: null });
        await refresh();
        return txHash;
      } catch (err) {
        const reason =
          err instanceof Error
            ? err.message
            : "Investment transaction was rejected or failed.";
        setTxState({ phase: "failed", txHash, error: reason });
        return null;
      }
    },
    [getClient, config, address, walletClient, chainId, initialOfferingId, offering, refresh],
  );

  const actionStep: "approve" | "invest" =
    investor && investor.allowance < 1000000n ? "approve" : "invest";

  return {
    offering,
    investor,
    isLoading,
    isRefreshing,
    txState,
    actionStep,
    error,
    refresh,
    approve,
    invest,
    resetTx,
  };
}
