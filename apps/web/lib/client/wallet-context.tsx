"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  createWalletClient,
  custom,
  getAddress,
  isAddress,
  type Address,
  type WalletClient,
} from "viem";
import { arbitrumSepolia } from "@archprop/chain";
import { EXPECTED_CHAIN_ID } from "./view-models";

export interface WalletContextValue {
  address: Address | null;
  chainId: number | null;
  isConnected: boolean;
  isConnecting: boolean;
  isWrongNetwork: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchChain: () => Promise<void>;
  getWalletClient: () => WalletClient | null;
}

const WalletContext = createContext<WalletContextValue | null>(null);

declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: boolean;
      request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConnected = address !== null && isAddress(address);
  const isWrongNetwork = isConnected && chainId !== EXPECTED_CHAIN_ID;

  useEffect(() => {
    let isMounted = true;

    if (typeof window === "undefined" || !window.ethereum) {
      return;
    }

    const ethereum = window.ethereum;

    const syncWallet = async () => {
      try {
        const accounts = (await ethereum.request({
          method: "eth_accounts",
        })) as string[];

        if (!isMounted) return;
        const firstAccount = accounts?.[0];
        if (firstAccount && isAddress(firstAccount)) {
          setAddress(getAddress(firstAccount));
        } else {
          setAddress(null);
        }

        const chainIdHex = (await ethereum.request({
          method: "eth_chainId",
        })) as string;

        if (!isMounted) return;
        if (chainIdHex) {
          setChainId(parseInt(chainIdHex, 16));
        }
      } catch (err) {
        // Non-blocking sync error
        console.warn("Failed to sync wallet state:", err);
      }
    };

    void syncWallet();

    if (!ethereum.on) {
      return;
    }

    const handleAccountsChanged = (accountsUnknown: unknown) => {
      const accounts = accountsUnknown as string[];
      const firstAccount = accounts?.[0];
      if (firstAccount && isAddress(firstAccount)) {
        setAddress(getAddress(firstAccount));
        setError(null);
      } else {
        setAddress(null);
      }
    };

    const handleChainChanged = (chainIdHexUnknown: unknown) => {
      const chainIdHex = chainIdHexUnknown as string;
      if (chainIdHex) {
        setChainId(parseInt(chainIdHex, 16));
      }
    };

    ethereum.on("accountsChanged", handleAccountsChanged);
    ethereum.on("chainChanged", handleChainChanged);

    return () => {
      isMounted = false;
      if (ethereum.removeListener) {
        ethereum.removeListener("accountsChanged", handleAccountsChanged);
        ethereum.removeListener("chainChanged", handleChainChanged);
      }
    };
  }, []);

  const connect = useCallback(async () => {
    setError(null);

    if (typeof window === "undefined" || !window.ethereum) {
      setError("No injected wallet detected. Please install MetaMask or another Web3 wallet.");
      return;
    }

    setIsConnecting(true);
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];

      const firstAccount = accounts?.[0];
      if (!firstAccount || !isAddress(firstAccount)) {
        throw new Error("No accounts received from wallet.");
      }

      const rawChainId = (await window.ethereum.request({
        method: "eth_chainId",
      })) as string;

      setAddress(getAddress(firstAccount));
      setChainId(parseInt(rawChainId, 16));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to connect wallet.";
      setError(message);
      setAddress(null);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setChainId(null);
    setError(null);
  }, []);

  const switchChain = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) {
      return;
    }

    setError(null);
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${EXPECTED_CHAIN_ID.toString(16)}` }],
      });
      setChainId(EXPECTED_CHAIN_ID);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to switch chain.";
      setError(message);
    }
  }, []);

  const getWalletClient = useCallback((): WalletClient | null => {
    if (!address || typeof window === "undefined" || !window.ethereum) {
      return null;
    }

    return createWalletClient({
      account: address,
      chain: arbitrumSepolia,
      transport: custom(window.ethereum),
    });
  }, [address]);

  return (
    <WalletContext.Provider
      value={{
        address,
        chainId,
        isConnected,
        isConnecting,
        isWrongNetwork,
        error,
        connect,
        disconnect,
        switchChain,
        getWalletClient,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) {
    // Return a safe fallback for SSR or when not wrapped in provider
    return {
      address: null,
      chainId: null,
      isConnected: false,
      isConnecting: false,
      isWrongNetwork: false,
      error: null,
      connect: async () => {},
      disconnect: () => {},
      switchChain: async () => {},
      getWalletClient: () => null,
    };
  }
  return context;
}
