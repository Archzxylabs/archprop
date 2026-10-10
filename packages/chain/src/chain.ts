/**
 * Arbitrum Sepolia chain configuration.
 *
 * The network is fixed to Arbitrum Sepolia (421614). Local Anvil is test-only
 * and is represented separately so tests never accidentally target the shared
 * testnet.
 */

import { arbitrumSepolia } from "viem/chains";

export { arbitrumSepolia };

/** The single supported chain ID for ARCHPROP. */
export const ARBITRUM_SEPOLIA_CHAIN_ID = 421_614 as const;

/** Chain ID used by local Anvil for integration tests only. */
export const ANVIL_CHAIN_ID = 31_337 as const;

export const SUPPORTED_CHAIN_IDS = [
  ARBITRUM_SEPOLIA_CHAIN_ID,
] as const satisfies readonly number[];

/** True when `chainId` is a chain ARCHPROP is permitted to talk to. */
export function isSupportedChainId(
  chainId: number,
): chainId is (typeof SUPPORTED_CHAIN_IDS)[number] {
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
}

/** True when `chainId` is the local test-only Anvil chain. */
export function isAnvilChainId(chainId: number): boolean {
  return chainId === ANVIL_CHAIN_ID;
}

export const CHAIN_NAME = "Arbitrum Sepolia" as const;

export const NATIVE_CURRENCY = {
  name: "Sepolia Ether",
  symbol: "ETH",
  decimals: 18,
} as const;
