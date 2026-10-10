/**
 * Fail-closed runtime configuration for the API server.
 *
 * Every value is read once, at module load, from `process.env`. The variable
 * names are exactly those in the orchestrator-owned `.env.example`, which the
 * docs state defines the only runtime variable names — so no new name is
 * invented here.
 *
 * A missing or malformed required variable is an error that surfaces at
 * request time as a 503 rather than a silent fallback: docs/INTERFACES.md
 * forbids inventing fallback addresses, and a half-configured chain client
 * would let a route appear to work while writing wrong data.
 */

import { getAddress } from "viem";

export type AddressString = `0x${string}`;

export interface ChainConfig {
  readonly chainId: 421614;
  readonly rpcUrl: string;
  readonly registryAddress: AddressString;
  readonly revenueDistributorAddress: AddressString;
}

export interface SupabaseConfig {
  readonly url: string;
  readonly anonKey: string;
  readonly serviceRoleKey: string;
}

export interface ServerConfig {
  readonly supabase: SupabaseConfig;
  readonly chain: ChainConfig;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Normalizes to a checksummed address and rejects anything that is not a
 * nonzero 20-byte hex value.
 */
function normalizeAddress(raw: string | undefined, name: string): AddressString {
  const value = raw?.trim();
  if (!value) {
    throw new ConfigError(`${name} is not configured`);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new ConfigError(`${name} is not a 20-byte hex address`);
  }
  // getAddress validates the checksum for mixed-case input and normalizes
  // otherwise; it throws on a checksum mismatch.
  let checksummed: string;
  try {
    checksummed = getAddress(value);
  } catch {
    throw new ConfigError(`${name} has an invalid checksum`);
  }
  if (/^0x0+$/.test(checksummed)) {
    throw new ConfigError(`${name} must not be the zero address`);
  }
  return checksummed as AddressString;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ConfigError(`${name} is not configured`);
  }
  return value;
}

/**
 * Reads configuration. Returns a discriminated result rather than throwing so
 * callers can decide how to report the failure.
 */
export function loadConfig(): { ok: true; config: ServerConfig } | { ok: false; error: ConfigError } {
  try {
    const rpcUrl = requireEnv("NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL");
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rpcUrl);
    } catch {
      throw new ConfigError("NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL is not a valid URL");
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new ConfigError("NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL must be an http(s) URL");
    }

    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    return {
      ok: true,
      config: {
        supabase: {
          url: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
          anonKey: requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
          serviceRoleKey,
        },
        chain: {
          chainId: 421614,
          rpcUrl,
          registryAddress: normalizeAddress(
            process.env.NEXT_PUBLIC_ARCHPROP_REGISTRY_ADDRESS,
            "NEXT_PUBLIC_ARCHPROP_REGISTRY_ADDRESS",
          ),
          revenueDistributorAddress: normalizeAddress(
            process.env.NEXT_PUBLIC_REVENUE_DISTRIBUTOR_ADDRESS,
            "NEXT_PUBLIC_REVENUE_DISTRIBUTOR_ADDRESS",
          ),
        },
      },
    };
  } catch (error) {
    if (error instanceof ConfigError) {
      return { ok: false, error };
    }
    return { ok: false, error: new ConfigError(`Invalid configuration: ${describe(error)}`) };
  }
}

/** Extracts a message from an unknown thrown value without assuming it is an Error. */
export function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "unexpected error";
}
