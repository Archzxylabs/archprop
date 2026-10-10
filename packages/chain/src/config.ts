/**
 * Fail-closed runtime and address configuration.
 *
 * Every contract address must be supplied explicitly by the environment. This
 * module deliberately contains no fallback, zero, sample, placeholder, or
 * previously deployed address. If configuration is missing or malformed, the
 * loader throws instead of returning a value that could be used to target the
 * wrong contract or the wrong chain.
 */

import { getAddress, isAddress, type Address as ViemAddress } from "viem";
import type { Address as SharedAddress } from "@archprop/shared";
import { ARBITRUM_SEPOLIA_CHAIN_ID, arbitrumSepolia } from "./chain";

export type ContractAddress = SharedAddress;

/** The contracts ARCHPROP requires, in frozen deployment order. */
export const CONTRACT_KEYS = [
  "registry",
  "identityRegistry",
  "mockIdr",
  "offeringEscrow",
  "revenueDistributor",
] as const satisfies readonly string[];

export type ContractKey = (typeof CONTRACT_KEYS)[number];

export type ContractAddresses = Record<ContractKey, ContractAddress>;

/**
 * Environment variable name for each contract address.
 *
 * Runtime environment names match the unmodified `.env.example`.
 * The web app and scripts read `NEXT_PUBLIC_*` addresses.
 */
export const CONTRACT_ADDRESS_ENV: Record<ContractKey, string> = {
  registry: "NEXT_PUBLIC_ARCHPROP_REGISTRY_ADDRESS",
  identityRegistry: "NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS",
  mockIdr: "NEXT_PUBLIC_MOCK_IDR_ADDRESS",
  offeringEscrow: "NEXT_PUBLIC_OFFERING_ESCROW_ADDRESS",
  revenueDistributor: "NEXT_PUBLIC_REVENUE_DISTRIBUTOR_ADDRESS",
};

/** Environment variable name for the RPC URL, matching `.env.example`. */
export const RPC_URL_ENV = "NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL";

/**
 * Thrown when configuration is missing, malformed, or targets a wrong chain.
 *
 * `name` is a mutable (non-readonly) property so subclasses may narrow it to
 * their own class name without a type conflict.
 */
export class ChainConfigError extends Error {
  override name = "ChainConfigError";
}

/** All configuration problems found in one pass, so callers can report them together. */
export interface ChainConfigReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

function readEnv(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const raw = env[name];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Validates and normalizes an RPC URL. Requires an absolute http(s) URL so a
 * relative path or bare hostname cannot silently become a local default.
 */
export function parseRpcUrl(raw: string | undefined): string {
  if (raw === undefined) {
    throw new ChainConfigError(
      `Missing ${RPC_URL_ENV}. Set an absolute Arbitrum Sepolia http(s) RPC URL.`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ChainConfigError(
      `Invalid ${RPC_URL_ENV}: not a valid URL (${raw}).`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ChainConfigError(
      `Invalid ${RPC_URL_ENV}: scheme must be http or https (${raw}).`,
    );
  }
  if (parsed.hostname.length === 0) {
    throw new ChainConfigError(`Invalid ${RPC_URL_ENV}: missing hostname.`);
  }
  return parsed.toString();
}

/**
 * Validates and checksums a contract address. Rejects missing, empty, invalid,
 * and zero addresses. Never substitutes a default.
 */
export function parseContractAddress(
  key: ContractKey,
  raw: string | undefined,
): ContractAddress {
  if (raw === undefined) {
    throw new ChainConfigError(
      `Missing address for ${key}: set ${CONTRACT_ADDRESS_ENV[key]}. ` +
        `No default address exists; configuration must be explicit.`,
    );
  }
  if (!isAddress(raw, { strict: false })) {
    throw new ChainConfigError(
      `Invalid address for ${key}: "${raw}" is not an EVM address.`,
    );
  }
  const checksummed = getAddress(raw);
  if (/^0x0{40}$/.test(checksummed)) {
    throw new ChainConfigError(
      `Invalid address for ${key}: the zero address is not a deployment. ` +
        `Set ${CONTRACT_ADDRESS_ENV[key]} to the real contract address.`,
    );
  }
  return checksummed as ContractAddress;
}

export interface ChainConfig {
  /** Absolute http(s) RPC URL. */
  rpcUrl: string;
  /** Validated, checksummed contract addresses. */
  addresses: ContractAddresses;
  /** Always 421614; present so callers can assert it without re-deriving. */
  chainId: typeof ARBITRUM_SEPOLIA_CHAIN_ID;
}

/**
 * Loads and validates the full chain configuration from an environment map.
 * Throws `ChainConfigError` listing every problem found, so a misconfigured
 * deployment is reported rather than partially applied.
 */
export function loadChainConfig(env: NodeJS.ProcessEnv): ChainConfig {
  const errors: string[] = [];

  let rpcUrl: string | undefined;
  try {
    rpcUrl = parseRpcUrl(readEnv(RPC_URL_ENV, env));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const addresses = {} as ContractAddresses;
  for (const key of CONTRACT_KEYS) {
    try {
      addresses[key] = parseContractAddress(
        key,
        readEnv(CONTRACT_ADDRESS_ENV[key], env),
      );
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (errors.length > 0) {
    throw new ChainConfigError(
      `ARCHPROP chain configuration is incomplete:\n- ${errors.join("\n- ")}`,
    );
  }

  return {
    rpcUrl: rpcUrl as string,
    addresses,
    chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
  };
}

/**
 * Non-throwing configuration diagnostic used by `check-config`.
 * Reports every missing or invalid field without ever emitting a default.
 */
export function inspectChainConfig(
  env: NodeJS.ProcessEnv,
): ChainConfigReport & { config?: ChainConfig } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const rpcRaw = readEnv(RPC_URL_ENV, env);
  if (rpcRaw === undefined) {
    errors.push(`missing ${RPC_URL_ENV}`);
  }

  for (const key of CONTRACT_KEYS) {
    const raw = readEnv(CONTRACT_ADDRESS_ENV[key], env);
    if (raw === undefined) {
      errors.push(`missing ${CONTRACT_ADDRESS_ENV[key]} (${key})`);
      continue;
    }
    if (/^0x0{40}$/i.test(raw)) {
      errors.push(
        `${CONTRACT_ADDRESS_ENV[key]} (${key}) is the zero address, which is not a deployment`,
      );
    } else if (!isAddress(raw, { strict: false })) {
      errors.push(`${CONTRACT_ADDRESS_ENV[key]} (${key}) is not a valid address`);
    }
  }

  if (
    env.ARCHPROP_PRIVATE_KEY !== undefined ||
    env.PRIVATE_KEY !== undefined
  ) {
    warnings.push(
      "a private-key environment variable is present; chain reads never need one and scripts must not broadcast",
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  try {
    return {
      ok: true,
      errors,
      warnings,
      config: loadChainConfig(env),
    };
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
      warnings,
    };
  }
}

/** The chain definition this package is permitted to build clients for. */
export const archpropChain = arbitrumSepolia;

export type { ViemAddress };
