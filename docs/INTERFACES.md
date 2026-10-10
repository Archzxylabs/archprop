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
export type PresentationStatus =
  | LifecycleStatus | "DRAFT" | "COMING_SOON" | "VERIFICATION_PENDING";
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
export interface CreatePropertyRequest {
  externalId: string; name: string; location: string; propertyType: string;
  issuerName: string; indicativeValue: string; offeringTarget: string;
  tokenSupply: string; tokenPrice: string; economicRightsBps: number;
  description: string;
}
export interface BindPropertyChainRequest {
  txHash: TxHash; chainAssetId: AssetId; issuedAtMs: string; signature: Hex;
}
export function buildPropertyBindingMessage(input: {
  propertyId: string; userId: string; chainAssetId: AssetId;
  txHash: TxHash; issuedAtMs: string;
}): string;
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
enum OfferingStatus { OPEN, FUNDED, FAILED }
struct Attestation {
  address verifier; AttestationType attestationType; bytes32 evidenceHash;
  uint256 value; uint64 timestamp; bool valid;
}
struct AssetView {
  address owner; bytes32 metadataHash; bytes32 agreementHash;
  AssetStatus status; address token;
}
struct OfferingView {
  bytes32 assetId; address propertyToken; address paymentToken;
  uint256 target; uint256 tokenPrice; uint64 deadline; uint256 raised;
  address issuerTreasury; OfferingStatus status; bool fundsReleased;
}
struct RevenueEpochView {
  bytes32 assetId; address propertyToken; address paymentToken;
  uint256 amount; uint256 totalSupply; uint64 claimDeadline;
  address funder; uint256 claimedAmount; bool closed;
}

interface IArchpropRegistry {
  function createAsset(bytes32 assetId, bytes32 metadataHash) external;
  function beginVerification(bytes32 assetId) external;
  function submitAttestation(bytes32 assetId, AttestationType kind,
    bytes32 evidenceHash, uint256 value) external;
  function rejectAsset(bytes32 assetId, AttestationType kind,
    bytes32 evidenceHash) external;
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
  function getAsset(bytes32 assetId) external view returns (AssetView memory);
  function getLatestAttestation(bytes32 assetId, AttestationType kind)
    external view returns (Attestation memory);
}

interface IIdentityRegistry {
  function isApproved(address investor) external view returns (bool);
  function setInvestorApproval(address investor, bool approved) external;
}

interface IPropertyToken {
  function assetId() external view returns (bytes32);
  function identityRegistry() external view returns (address);
  function offeringEscrow() external view returns (address);
  function revenueDistributor() external view returns (address);
  function setRevenueTransferLock(bool locked) external;
}

interface IMockIDR {
  function faucet(uint256 amount) external;
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
  function getOffering(uint256 offeringId) external view returns (OfferingView memory);
  function allocationOf(uint256 offeringId, address investor) external view returns (uint256);
  function paymentOf(uint256 offeringId, address investor) external view returns (uint256);
  function tokensClaimed(uint256 offeringId, address investor) external view returns (bool);
  function refundClaimed(uint256 offeringId, address investor) external view returns (bool);
}

interface IRevenueDistributor {
  function publishRevenue(bytes32 assetId, address propertyToken, address paymentToken,
    uint256 amount, bytes32 evidenceHash, uint64 claimDeadline)
    external returns (uint256 epochId);
  function claimRevenue(uint256 epochId) external;
  function closeRevenueEpoch(uint256 epochId) external;
  function getRevenueEpoch(uint256 epochId) external view returns (RevenueEpochView memory);
  function claimableRevenue(uint256 epochId, address investor) external view returns (uint256);
  function revenueClaimed(uint256 epochId, address investor) external view returns (bool);
}
```

Constructor/configuration lock:

```solidity
ArchpropRegistry(address admin)
IdentityRegistry(address admin)
MockIDR(address admin)
PropertyToken(
  string name_, string symbol_, bytes32 assetId_, uint256 supply_,
  address identityRegistry_, address offeringEscrow_, address revenueDistributor_
)
OfferingEscrow(address admin, address registry, address identityRegistry)
RevenueDistributor(address admin, address registry)
```

`ArchpropRegistry.setEscrow` is admin-only and one-time. `PropertyToken` stores
the three dependency addresses immutably, mints its fixed supply exactly once
to `offeringEscrow_`, returns `0` from `decimals()`, and permits
`setRevenueTransferLock` only from `revenueDistributor_`. Transfers involving
the configured escrow are allowed for issuance/claims; all other non-mint,
non-burn endpoints must be approved by `IdentityRegistry`.

Required roles are OpenZeppelin `bytes32` constants:
`DEFAULT_ADMIN_ROLE`, `LEGAL_VERIFIER_ROLE`, `VALUATION_VERIFIER_ROLE`,
`STRUCTURER_ROLE`, and `REVENUE_VERIFIER_ROLE`.

Access rules: legal role can submit only `OWNERSHIP`; valuation role only
`VALUATION`; revenue role only `REVENUE`; the asset owner can begin review;
`STRUCTURER_ROLE` registers the agreement, marks issuance ready, links token,
and creates the offering. A property owner cannot self-attest. Role separation
is enforced even if the owner also holds an attestation role. A role-matched
legal or valuation verifier may call `rejectAsset` only while the asset is
`UNDER_VERIFICATION`; rejection is terminal for the MVP. Revenue attestations
are accepted only while the asset is `ACTIVE`. Revenue publication is
`RevenueDistributor.DEFAULT_ADMIN_ROLE`-only.

## Events

Implement and index `assetId`/`offeringId`/`epochId` when present:

```solidity
event AssetCreated(bytes32 indexed assetId, address indexed owner, bytes32 metadataHash);
event AttestationSubmitted(bytes32 indexed assetId, AttestationType indexed kind,
  address indexed verifier, bytes32 evidenceHash, uint256 value);
event AssetRejected(bytes32 indexed assetId, AttestationType indexed kind,
  address indexed verifier, bytes32 evidenceHash);
event AssetVerified(bytes32 indexed assetId);
event AgreementRegistered(bytes32 indexed assetId, bytes32 agreementHash);
event TokenLinked(bytes32 indexed assetId, address indexed token);
event AssetStatusChanged(bytes32 indexed assetId, AssetStatus from, AssetStatus to);
event InvestorApprovalChanged(address indexed investor, bool approved);
event DemoMint(address indexed recipient, uint256 amount);
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
   Evidence hashes must be nonzero; ownership value is zero and valuation or
   revenue values are nonzero. Attestations are append-only.
2. `markIssuanceReady` requires `VERIFIED` plus a nonzero agreement hash.
3. A token can link only in `ISSUANCE_READY`; its fixed supply is minted once to
   the configured escrow. Registry linking validates token `assetId`; it has no
   public/owner mint function.
   MockIDR is separately fixed to zero decimals and exposes a demo-only faucet
   for `0 < amount <= 10_000_000_000` per call; the UI always labels it as
   valueless demo currency.
4. Escrow accepts only approved investors, whole-token investment amounts,
   `paymentAmount % tokenPrice == 0`, and `raised + paymentAmount <= target`.
   Investment credit requires the escrow's actual payment-token balance to
   increase by exactly `paymentAmount`; fee-on-transfer or deflationary tokens
   cannot create an undercollateralized allocation.
   Offering creation requires the registry-linked token, `ISSUANCE_READY`, a
   future deadline, nonzero treasury, and `target == totalSupply * tokenPrice`.
   Payments remain escrowed until successful finalization and release.
5. A failed offering permits refunds only; a funded offering permits token claims
   only. All claim/release paths are one-time and non-reentrant.
6. Revenue publication requires a matching valid `REVENUE` attestation and
   an exact mIDR `safeTransferFrom` deposit in the same transaction. The
   attestation evidence hash is single-use, only one epoch per property token
   may be open, the asset must be `ACTIVE`, and the offering escrow must hold no
   remaining property tokens. Publishing locks transfers. A claim is
   `balanceOf(claimant) * epoch.amount / epoch.totalSupply` while locked, so the
   aggregate entitlement cannot exceed the funded amount (rounding dust remains
   in the distributor). Transfers unlock only when an admin closes the epoch
   after its deadline; claims are unavailable after closure and remaining dust
   returns to the epoch funder.

## HTTP schema

Routes are relative to `apps/web` and return JSON. Validation errors are
`{ "error": { "code": string, "message": string, "fields"?: object } }`.

| Route | Request | Success |
| --- | --- | --- |
| `POST /api/properties` | `CreatePropertyRequest`; signed-in owner context | `201 { property }` |
| `POST /api/properties/:id/bind-chain` | `BindPropertyChainRequest`; signed-in owner context | `200 { property }` |
| `GET /api/properties` | optional `status`, `q` | `200 { properties }` |
| `GET /api/properties/:id` | property UUID or chain asset ID | `200 { property, documents, chainCache }` |
| `POST /api/properties/:id/documents` | `multipart/form-data`: `file`, `documentType` | `201 { document: DocumentRecord }` |
| `POST /api/demo/revenue` | `{ assetId, period, amount, evidenceHash, txHash }` | `201 { revenueEpoch }` |

The document route accepts PDFs only, limits uploads to 10 MiB, calculates its
own SHA-256, writes private storage, and never accepts a client-provided hash.
The binding route records an already-confirmed `createAsset` transaction; it
never broadcasts one. The URL `:id` is the draft property's UUID. The server
requires its authenticated owner, `DRAFT`/unbound cache state, RPC chain ID
`421614`, a successful receipt with `AssetCreated` emitted by the configured
registry, and `chainAssetId == keccak256(UTF-8 externalId)`. The event's owner
must equal the EIP-191 signer and the current registry asset owner; its nonzero
metadata hash must match the current registry asset. Binding is permitted while
the on-chain asset remains `SUBMITTED`. `issuedAtMs` is a canonical unsigned
base-10 Unix-millisecond string no older than 10 minutes and no more than 60
seconds in the future. The signature covers the exact no-trailing-newline text
returned by `buildPropertyBindingMessage({ propertyId: id, userId: JWT user id,
chainAssetId, txHash, issuedAtMs })`:

```text
ARCHPROP property-chain binding v1
chainId:421614
propertyId:<lowercase UUID>
userId:<lowercase UUID>
chainAssetId:<lowercase 0x-prefixed bytes32>
txHash:<lowercase 0x-prefixed bytes32>
issuedAtMs:<canonical decimal string>
```

After all checks, the server performs one conditional service-role update of
`chain_asset_id` and `status_cache = 'SUBMITTED'`; zero affected rows or a
uniqueness race returns `409`. The database remains presentation/cache only.
No caller-supplied owner, metadata hash, status, or wallet address is trusted.
Numeric JSON fields are canonical base-10 strings and are validated as unsigned
integers before conversion to database numeric values. The revenue route checks
a successful chain receipt and matching `RevenuePublished` event before
recording a transaction reference; it never performs a wallet write or makes a
distribution authoritative off-chain.

## Runtime/deployment configuration

`docs/DEPLOYMENTS.md` is the human-readable address ledger and `.env.example`
defines the only runtime variable names. Frontend and scripts must fail closed
when a required address is absent or is not a checksummed/nonzero address. No
agent may invent fallback addresses. Generated ABI artifacts are reconciled
against this frozen ABI after SC-001; differences require orchestrator review.
