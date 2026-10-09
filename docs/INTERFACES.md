# ARCHPROP Frozen Interfaces

**Status:** Locked for the hackathon MVP.  Changes require an interface-change
request in `docs/DECISIONS.md`, updates to consumers, and orchestrator approval.

## Constants and terminology

- Network: Arbitrum Sepolia (`421614`). Local Anvil is test-only.
- Asset ID is `bytes32`: `keccak256("ARCHPROP-001")` for Villa Nusa.
- mIDR and property tokens use **0 decimals**. All listed amounts are therefore
  exact on-chain integer units.
- `mIDR` means **Demo Currency — No Real Monetary Value**.
- `AVNUSA` means economic-rights units, never legal title to land.

Villa Nusa is fixed at 10,000,000,000 mIDR indicative value, 30% economic
rights, 3,000,000,000 mIDR target, 300,000 AVNUSA supply, and 10,000 mIDR per
token. `target == supply * price` is an invariant.

## Lifecycle

`DRAFT` exists only in PostgreSQL/UI before a wallet submits an asset. Contract
creation emits `SUBMITTED`, avoiding an owner/admin-only on-chain draft bypass.

| Solidity value | State | Permitted transition |
| --- | --- | --- |
| 0 | `SUBMITTED` | create asset |
| 1 | `UNDER_VERIFICATION` | owner starts review |
| 2 | `VERIFIED` | both valid required attestations + finalize |
| 3 | `ISSUANCE_READY` | verified + nonzero agreement hash |
| 4 | `OFFERING` | escrow creates offering for linked token |
| 5 | `FUNDED` | escrow finalizes target funding |
| 6 | `ACTIVE` | offering funds are released |
| 7 | `REJECTED` | verifier/admin reject from review |
| 8 | `FAILED` | escrow fails after its deadline |

No caller may skip an intermediate state. `ArchpropRegistry` is lifecycle
authoritative. It grants only the configured `OfferingEscrow` permission to
advance `OFFERING`, `FUNDED`, and `FAILED`; it advances to `ACTIVE` only after
the escrow's successful release. The UI maps only these names; it must never
invent a chain status.

## Shared TypeScript definitions

`packages/shared/src/types.ts` is the source for these names. Each package must
import it rather than redeclare it.

```ts
export const CHAIN_ID = 421614 as const;
export type Hex = `0x${string}`;
export type Address = `0x${string}`;
export type AssetId = Hex;
export type TxHash = Hex;
export type LifecycleStatus =
  | "SUBMITTED" | "UNDER_VERIFICATION" | "VERIFIED" | "ISSUANCE_READY"
  | "OFFERING" | "FUNDED" | "ACTIVE" | "REJECTED" | "FAILED";
export type AttestationType = "OWNERSHIP" | "VALUATION" | "REVENUE";
export type DocumentType =
  | "LAND_RIGHT" | "APPRAISAL" | "BUILDING_PERMIT" | "ECONOMIC_RIGHTS_AGREEMENT";
export interface PropertyMetadata {
  assetId: AssetId; name: string; location: string; issuerName: string;
  indicativeValue: bigint; offeringTarget: bigint; tokenSupply: bigint;
  tokenPrice: bigint; economicRightsBps: number; description: string;
}
export interface DocumentRecord {
  id: string; propertyId: string; documentType: DocumentType; sha256: Hex;
  storagePath: string; isDemo: true; createdAt: string;
}
export interface ChainTransaction { txHash: TxHash; eventName: string; blockNumber?: bigint }
```

`status_cache` is presentation-only; contract reads take precedence for every
economic/lifecycle display.

## Solidity ABI contract

Solidity implementations may add read helpers but must not change these
signatures, enum ordering, event parameter order, or access rules.

```solidity
enum AssetStatus { SUBMITTED, UNDER_VERIFICATION, VERIFIED, ISSUANCE_READY,
                   OFFERING, FUNDED, ACTIVE, REJECTED, FAILED }
enum AttestationType { OWNERSHIP, VALUATION, REVENUE }
struct Attestation {
  address verifier; AttestationType attestationType; bytes32 evidenceHash;
  uint256 value; uint64 timestamp; bool valid;
}

interface IArchpropRegistry {
  function createAsset(bytes32 assetId, bytes32 metadataHash) external;
  function beginVerification(bytes32 assetId) external;
  function submitAttestation(bytes32 assetId, AttestationType kind,
    bytes32 evidenceHash, uint256 value) external;
  function finalizeVerification(bytes32 assetId) external;
  function registerAgreement(bytes32 assetId, bytes32 agreementHash) external;
  function markIssuanceReady(bytes32 assetId) external;
  function linkToken(bytes32 assetId, address token) external;
  function setEscrow(address escrow) external;
  function transitionFromEscrow(bytes32 assetId, AssetStatus status) external;
  function isRevenueAttestationValid(bytes32 assetId, bytes32 evidenceHash,
    uint256 amount) external view returns (bool);
  function assetStatus(bytes32 assetId) external view returns (AssetStatus);
  function assetToken(bytes32 assetId) external view returns (address);
  function assetOwner(bytes32 assetId) external view returns (address);
}

interface IIdentityRegistry {
  function isApproved(address investor) external view returns (bool);
  function setInvestorApproval(address investor, bool approved) external;
}

interface IPropertyToken {
  function assetId() external view returns (bytes32);
  function setRevenueTransferLock(bool locked) external;
}

interface IOfferingEscrow {
  function createOffering(bytes32 assetId, address propertyToken, address paymentToken,
    uint256 target, uint256 tokenPrice, uint64 deadline, address issuerTreasury)
    external returns (uint256 offeringId);
  function invest(uint256 offeringId, uint256 paymentAmount) external;
  function finalizeSuccessfulOffering(uint256 offeringId) external;
  function failOffering(uint256 offeringId) external;
  function claimTokens(uint256 offeringId) external;
  function claimRefund(uint256 offeringId) external;
  function releaseFunds(uint256 offeringId) external;
}

interface IRevenueDistributor {
  function publishRevenue(bytes32 assetId, address propertyToken, address paymentToken,
    uint256 amount, bytes32 evidenceHash, uint64 claimDeadline)
    external returns (uint256 epochId);
  function claimRevenue(uint256 epochId) external;
  function closeRevenueEpoch(uint256 epochId) external;
}
```

Required roles are OpenZeppelin `bytes32` constants:
`DEFAULT_ADMIN_ROLE`, `LEGAL_VERIFIER_ROLE`, `VALUATION_VERIFIER_ROLE`,
`STRUCTURER_ROLE`, and `REVENUE_VERIFIER_ROLE`.

Access rules: legal role can submit only `OWNERSHIP`; valuation role only
`VALUATION`; revenue role only `REVENUE`; the asset owner can begin review;
`STRUCTURER_ROLE` registers the agreement, marks issuance ready, links token,
and creates the offering. A property owner cannot self-attest.

## Events

Implement and index `assetId`/`offeringId`/`epochId` when present:

```solidity
event AssetCreated(bytes32 indexed assetId, address indexed owner, bytes32 metadataHash);
event AttestationSubmitted(bytes32 indexed assetId, AttestationType indexed kind,
  address indexed verifier, bytes32 evidenceHash, uint256 value);
event AssetVerified(bytes32 indexed assetId);
event AgreementRegistered(bytes32 indexed assetId, bytes32 agreementHash);
event TokenLinked(bytes32 indexed assetId, address indexed token);
event AssetStatusChanged(bytes32 indexed assetId, AssetStatus from, AssetStatus to);
event InvestorApprovalChanged(address indexed investor, bool approved);
event OfferingCreated(uint256 indexed offeringId, bytes32 indexed assetId, address indexed token,
  uint256 target, uint256 tokenPrice, uint64 deadline);
event InvestmentMade(uint256 indexed offeringId, address indexed investor,
  uint256 paymentAmount, uint256 allocation);
event OfferingFunded(uint256 indexed offeringId, uint256 raised);
event OfferingFailed(uint256 indexed offeringId, uint256 raised);
event TokensClaimed(uint256 indexed offeringId, address indexed investor, uint256 allocation);
event RefundClaimed(uint256 indexed offeringId, address indexed investor, uint256 amount);
event FundsReleased(uint256 indexed offeringId, address indexed treasury, uint256 amount);
event RevenuePublished(uint256 indexed epochId, bytes32 indexed assetId, uint256 amount,
  bytes32 evidenceHash, uint64 claimDeadline);
event RevenueClaimed(uint256 indexed epochId, address indexed investor, uint256 amount);
```

## Frozen protocol rules

1. `finalizeVerification` requires valid ownership and valuation attestations.
2. `markIssuanceReady` requires `VERIFIED` plus a nonzero agreement hash.
3. A token can link only in `ISSUANCE_READY`; its fixed supply is minted once to
   the configured escrow. It has no public/owner mint function.
4. Escrow accepts only approved investors, whole-token investment amounts,
   `paymentAmount % tokenPrice == 0`, and `raised + paymentAmount <= target`.
   Payments remain escrowed until successful finalization and release.
5. A failed offering permits refunds only; a funded offering permits token claims
   only. All claim/release paths are one-time and non-reentrant.
6. Revenue publication requires a matching valid `REVENUE` attestation and
   pre-funded mIDR. Publishing locks transfers of the property token. A claim is
   `balanceOf(claimant) * epoch.amount / epoch.totalSupply` while locked, so the
   aggregate entitlement cannot exceed the funded amount (rounding dust remains
   in the distributor). Transfers unlock only when the epoch closes after its
   deadline; claims are unavailable after closure.

## HTTP schema

Routes are relative to `apps/web` and return JSON. Validation errors are
`{ "error": { "code": string, "message": string, "fields"?: object } }`.

| Route | Request | Success |
| --- | --- | --- |
| `POST /api/properties` | `PropertyMetadata` without `assetId`; signed-in owner context | `201 { property }` |
| `GET /api/properties` | optional `status`, `q` | `200 { properties }` |
| `GET /api/properties/:id` | property UUID or chain asset ID | `200 { property, documents, chainCache }` |
| `POST /api/properties/:id/documents` | `multipart/form-data`: `file`, `documentType` | `201 { document: DocumentRecord }` |
| `POST /api/demo/revenue` | `{ assetId, period, amount, evidenceHash, txHash }` | `201 { revenueEpoch }` |

The document route accepts PDFs only, limits uploads to 10 MiB, calculates its
own SHA-256, writes private storage, and never accepts a client-provided hash.
The revenue route records a confirmed transaction reference only; it never
performs a wallet write or makes a distribution authoritative off-chain.
