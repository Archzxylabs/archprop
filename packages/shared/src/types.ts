export const CHAIN_ID = 421_614 as const;

export type Hex = `0x${string}`;
export type Address = `0x${string}`;
export type AssetId = Hex;
export type TxHash = Hex;

export type LifecycleStatus =
  | "SUBMITTED"
  | "UNDER_VERIFICATION"
  | "VERIFIED"
  | "ISSUANCE_READY"
  | "OFFERING"
  | "FUNDED"
  | "ACTIVE"
  | "REJECTED"
  | "FAILED";

export type AttestationType = "OWNERSHIP" | "VALUATION" | "REVENUE";
export type DocumentType =
  | "LAND_RIGHT"
  | "APPRAISAL"
  | "BUILDING_PERMIT"
  | "ECONOMIC_RIGHTS_AGREEMENT";

export type PresentationStatus =
  | LifecycleStatus
  | "DRAFT"
  | "COMING_SOON"
  | "VERIFICATION_PENDING";

export interface PropertyMetadata {
  assetId: AssetId;
  name: string;
  location: string;
  issuerName: string;
  indicativeValue: bigint;
  offeringTarget: bigint;
  tokenSupply: bigint;
  tokenPrice: bigint;
  economicRightsBps: number;
  description: string;
}

export interface DocumentRecord {
  id: string;
  propertyId: string;
  documentType: DocumentType;
  sha256: Hex;
  storagePath: string;
  isDemo: true;
  createdAt: string;
}

export interface ChainTransaction {
  txHash: TxHash;
  eventName: string;
  blockNumber?: bigint;
}

export interface CreatePropertyRequest {
  externalId: string;
  name: string;
  location: string;
  propertyType: string;
  issuerName: string;
  indicativeValue: string;
  offeringTarget: string;
  tokenSupply: string;
  tokenPrice: string;
  economicRightsBps: number;
  description: string;
}

/** Owner-authorized reference to an already-confirmed createAsset transaction. */
export interface BindPropertyChainRequest {
  txHash: TxHash;
  chainAssetId: AssetId;
  issuedAtMs: string;
  signature: Hex;
}

/** Wallet-signed, short-lived access request for one private demo evidence PDF. */
export interface VerifierEvidenceAccessRequest {
  role: "LEGAL" | "VALUATION";
  issuedAtMs: string;
  signature: Hex;
}

/** Exact EIP-191 personal_sign message for the property/chain binding route. */
export function buildPropertyBindingMessage(input: {
  propertyId: string;
  userId: string;
  chainAssetId: AssetId;
  txHash: TxHash;
  issuedAtMs: string;
}): string {
  return [
    "ARCHPROP property-chain binding v1",
    `chainId:${CHAIN_ID}`,
    `propertyId:${input.propertyId.toLowerCase()}`,
    `userId:${input.userId.toLowerCase()}`,
    `chainAssetId:${input.chainAssetId.toLowerCase()}`,
    `txHash:${input.txHash.toLowerCase()}`,
    `issuedAtMs:${input.issuedAtMs}`,
  ].join("\n");
}

/** Exact EIP-191 personal_sign message for verifier evidence access. */
export function buildVerifierEvidenceAccessMessage(input: {
  propertyId: string;
  documentId: string;
  assetId: AssetId;
  role: VerifierEvidenceAccessRequest["role"];
  userId: string;
  issuedAtMs: string;
}): string {
  return [
    "ARCHPROP verifier-evidence access v1",
    `chainId:${CHAIN_ID}`,
    `propertyId:${input.propertyId.toLowerCase()}`,
    `documentId:${input.documentId.toLowerCase()}`,
    `assetId:${input.assetId.toLowerCase()}`,
    `role:${input.role}`,
    `userId:${input.userId.toLowerCase()}`,
    `issuedAtMs:${input.issuedAtMs}`,
  ].join("\n");
}

export const VILLA_NUSA = {
  id: "0x1756428cf9ce005285ddcf87c75240c798535bed95c6aeca6a5a7d3eb7b364ae" as AssetId,
  externalId: "ARCHPROP-001",
  name: "Villa Nusa",
  location: "Bali",
  issuerName: "PT Nusa Properties",
  indicativeValue: 10_000_000_000n,
  economicRightsBps: 3_000,
  offeringTarget: 3_000_000_000n,
  tokenSupply: 300_000n,
  tokenPrice: 10_000n,
  tokenSymbol: "AVNUSA"
} as const satisfies Omit<PropertyMetadata, "assetId" | "description"> & {
  id: AssetId;
  externalId: string;
  tokenSymbol: string;
};
