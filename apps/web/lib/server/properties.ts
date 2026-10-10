/**
 * Database row shapes and the API DTO mapping for properties.
 *
 * The row types describe exactly what the SELECT returns, so a column rename in
 * a migration is a compile error here rather than a silent undefined.
 *
 * DTOs deliberately omit `address_private` and `owner_user_id`: those columns
 * are withheld from `authenticated` by column-level grants, and the API must
 * not reintroduce a path that could expose them. `chainCache` is always a
 * separate object so a client can never mistake cached data for chain truth.
 */

import type { DocumentType, PresentationStatus } from "@archprop/shared";

export interface PropertyRow {
  id: string;
  chain_asset_id: string | null;
  external_id: string;
  name: string;
  slug: string;
  property_type: string;
  location: string;
  issuer_name: string;
  description: string;
  indicative_value: string;
  offering_target: string;
  token_supply: string;
  token_price: string;
  economic_rights_bps: number;
  status_cache: PresentationStatus;
  token_address: string | null;
  created_at: string;
}

export interface PropertyDocumentRow {
  id: string;
  property_id: string;
  document_type: DocumentType;
  document_hash: string;
  storage_path: string;
  is_demo: boolean;
  created_at: string;
}

export interface ChainTransactionRow {
  id: string;
  tx_hash: string;
  event_name: string;
  block_number: string | number | null;
}

export interface RevenueEpochRow {
  id: string;
  period: string;
  distributable_revenue: string;
  evidence_hash: string;
  chain_tx_hash: string;
  chain_epoch_id: string | null;
  chain_block_number: string | number | null;
  created_at: string;
}

/** Public representation of a property. Never contains private address. */
export interface PropertyDto {
  id: string;
  chainAssetId: string | null;
  externalId: string;
  name: string;
  slug: string;
  propertyType: string;
  location: string;
  issuerName: string;
  description: string;
  indicativeValue: string;
  offeringTarget: string;
  tokenSupply: string;
  tokenPrice: string;
  economicRightsBps: number;
  statusCache: PresentationStatus;
  tokenAddress: string | null;
  createdAt: string;
}

export interface DocumentDto {
  id: string;
  propertyId: string;
  documentType: DocumentType;
  sha256: string;
  storagePath: string;
  isDemo: true;
  createdAt: string;
}

export interface ChainTransactionDto {
  txHash: string;
  eventName: string;
  blockNumber: number | null;
}

export interface RevenueEpochDto {
  id: string;
  period: string;
  distributableRevenue: string;
  evidenceHash: string;
  txHash: string;
  blockNumber: number | null;
  createdAt: string;
}

/** Coerces a Postgres numeric/bigint (string) or number to number, or null. */
export function toNullableNumber(value: string | number | null): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function toPropertyDto(row: PropertyRow): PropertyDto {
  return {
    id: row.id,
    chainAssetId: row.chain_asset_id,
    externalId: row.external_id,
    name: row.name,
    slug: row.slug,
    propertyType: row.property_type,
    location: row.location,
    issuerName: row.issuer_name,
    description: row.description,
    indicativeValue: row.indicative_value,
    offeringTarget: row.offering_target,
    tokenSupply: row.token_supply,
    tokenPrice: row.token_price,
    economicRightsBps: row.economic_rights_bps,
    statusCache: row.status_cache,
    tokenAddress: row.token_address,
    createdAt: row.created_at,
  };
}

export function toDocumentDto(row: PropertyDocumentRow): DocumentDto {
  return {
    id: row.id,
    propertyId: row.property_id,
    documentType: row.document_type,
    sha256: row.document_hash,
    storagePath: row.storage_path,
    // The schema enforces is_demo = true; the DTO states it as a literal so the
    // contract with clients matches DocumentRecord in packages/shared.
    isDemo: true,
    createdAt: row.created_at,
  };
}

export function toChainTransactionDto(row: ChainTransactionRow): ChainTransactionDto {
  return {
    txHash: row.tx_hash,
    eventName: row.event_name,
    blockNumber: toNullableNumber(row.block_number),
  };
}

export function toRevenueEpochDto(row: RevenueEpochRow): RevenueEpochDto {
  return {
    id: row.id,
    period: row.period,
    distributableRevenue: row.distributable_revenue,
    evidenceHash: row.evidence_hash,
    txHash: row.chain_tx_hash,
    blockNumber: toNullableNumber(row.chain_block_number),
    createdAt: row.created_at,
  };
}
