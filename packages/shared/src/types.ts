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

export const VILLA_NUSA = {
  id: "0x2efb72e15d2f5cc06f3046b5c72037ec06e8763059bf5528237ff1f792632d6d" as AssetId,
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
