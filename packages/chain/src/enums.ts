/**
 * Lifecycle and enum decoding.
 *
 * Numeric enum order is frozen by docs/INTERFACES.md and must be preserved
 * exactly. Any value outside the declared range is an error rather than a
 * silently mapped or defaulted state: a chain that reports an unknown enum
 * value is treated as an integration failure, never as a known lifecycle
 * state.
 */

import type {
  AttestationType,
  LifecycleStatus,
} from "@archprop/shared";

/** Solidity `AssetStatus` enum, in frozen numeric order. */
export const ASSET_STATUS_ENUM = [
  "SUBMITTED",
  "UNDER_VERIFICATION",
  "VERIFIED",
  "ISSUANCE_READY",
  "OFFERING",
  "FUNDED",
  "ACTIVE",
  "REJECTED",
  "FAILED",
] as const satisfies readonly LifecycleStatus[];

/** Solidity `AttestationType` enum, in frozen numeric order. */
export const ATTESTATION_TYPE_ENUM = [
  "OWNERSHIP",
  "VALUATION",
  "REVENUE",
] as const satisfies readonly AttestationType[];

/** Solidity `OfferingStatus` enum, in frozen numeric order. */
export type OfferingStatus = "OPEN" | "FUNDED" | "FAILED";

export const OFFERING_STATUS_ENUM = [
  "OPEN",
  "FUNDED",
  "FAILED",
] as const satisfies readonly OfferingStatus[];

export type EnumName = "AssetStatus" | "AttestationType" | "OfferingStatus";

/** Thrown when a chain value cannot be decoded to a frozen enum member. */
export class UnknownEnumValueError extends Error {
  override readonly name = "UnknownEnumValueError";

  constructor(
    readonly enumName: EnumName,
    readonly received: number | bigint,
  ) {
    super(
      `Unknown ${enumName} value ${received.toString()} on chain; expected one of ` +
        `${JSON.stringify(knownEnumValues(enumName))}. Refusing to guess a state.`,
    );
  }
}

function knownEnumValues(enumName: EnumName): readonly string[] {
  switch (enumName) {
    case "AssetStatus":
      return ASSET_STATUS_ENUM;
    case "AttestationType":
      return ATTESTATION_TYPE_ENUM;
    case "OfferingStatus":
      return OFFERING_STATUS_ENUM;
  }
}

/**
 * Normalizes a chain value to a number, rejecting non-integers.
 * bigint is the on-chain representation; number is accepted for convenience at
 * display boundaries.
 */
function toEnumIndex(value: number | bigint, enumName: EnumName): number {
  const asBigInt = typeof value === "bigint" ? value : BigInt(value);
  if (asBigInt < 0n || asBigInt > 255n) {
    throw new UnknownEnumValueError(enumName, value);
  }
  const asNumber = Number(asBigInt);
  if (BigInt(asNumber) !== asBigInt) {
    throw new UnknownEnumValueError(enumName, value);
  }
  return asNumber;
}

/** Decodes an on-chain `AssetStatus` to its frozen lifecycle name. */
export function decodeAssetStatus(value: number | bigint): LifecycleStatus {
  const index = toEnumIndex(value, "AssetStatus");
  const status = ASSET_STATUS_ENUM[index];
  if (status === undefined) {
    throw new UnknownEnumValueError("AssetStatus", value);
  }
  return status;
}

/** Decodes an on-chain `AttestationType` to its frozen name. */
export function decodeAttestationType(
  value: number | bigint,
): AttestationType {
  const index = toEnumIndex(value, "AttestationType");
  const kind = ATTESTATION_TYPE_ENUM[index];
  if (kind === undefined) {
    throw new UnknownEnumValueError("AttestationType", value);
  }
  return kind;
}

/** Decodes an on-chain `OfferingStatus` to its frozen name. */
export function decodeOfferingStatus(value: number | bigint): OfferingStatus {
  const index = toEnumIndex(value, "OfferingStatus");
  const status = OFFERING_STATUS_ENUM[index];
  if (status === undefined) {
    throw new UnknownEnumValueError("OfferingStatus", value);
  }
  return status;
}

/** Encodes a lifecycle name to its frozen `AssetStatus` numeric value. */
export function encodeAssetStatus(status: LifecycleStatus): number {
  const index = ASSET_STATUS_ENUM.indexOf(status);
  if (index === -1) {
    throw new UnknownEnumValueError("AssetStatus", -1);
  }
  return index;
}

/** Encodes an attestation name to its frozen `AttestationType` numeric value. */
export function encodeAttestationType(kind: AttestationType): number {
  const index = ATTESTATION_TYPE_ENUM.indexOf(kind);
  if (index === -1) {
    throw new UnknownEnumValueError("AttestationType", -1);
  }
  return index;
}

/** Encodes an offering name to its frozen `OfferingStatus` numeric value. */
export function encodeOfferingStatus(status: OfferingStatus): number {
  const index = OFFERING_STATUS_ENUM.indexOf(status);
  if (index === -1) {
    throw new UnknownEnumValueError("OfferingStatus", -1);
  }
  return index;
}

/**
 * Lifecycle order used to reason about transitions. Mirrors the frozen table in
 * docs/INTERFACES.md; `REJECTED` and `FAILED` are terminal and therefore have
 * no permitted successors.
 */
export const LIFECYCLE_ORDER: readonly LifecycleStatus[] = ASSET_STATUS_ENUM;

/** Terminal lifecycle states; no further transition is permitted. */
export const TERMINAL_LIFECYCLE_STATES: readonly LifecycleStatus[] = [
  "REJECTED",
  "FAILED",
];

/** True when `status` admits no further lifecycle transition. */
export function isTerminalLifecycleStatus(
  status: LifecycleStatus,
): boolean {
  return TERMINAL_LIFECYCLE_STATES.includes(status);
}

/**
 * The canonical golden-path lifecycle sequence, from asset creation through
 * fund release. Used by diagnostics and E2E scaffolding to assert that no
 * intermediate state is skipped.
 */
export const GOLDEN_PATH_LIFECYCLE: readonly LifecycleStatus[] = [
  "SUBMITTED",
  "UNDER_VERIFICATION",
  "VERIFIED",
  "ISSUANCE_READY",
  "OFFERING",
  "FUNDED",
  "ACTIVE",
];
