# SYSTEM.md — ARCHPROP HACKATHON MVP

## Mission

Build a reliable end-to-end hackathon demonstration of a property RWA marketplace on Arbitrum Sepolia.

The project must demonstrate:

```text
real-world property
→ demo independent verification
→ on-chain attestations
→ issuance gate
→ economic-right token
→ marketplace
→ investment
→ escrow
→ revenue distribution
```

The system must prioritize one complete golden path over broad feature count.

---

## System Principle

The defining rule is:

> **No verification, no issuance.**

More generally:

> **A real-world claim must be attested before it unlocks an on-chain economic action.**

Do not weaken this rule in frontend logic, backend shortcuts, seed scripts, or admin bypasses.

---

## Canonical Demo Asset

Use one complete working asset:

```text
Asset: Villa Nusa
Asset ID: ARCHPROP-001
Location: Bali
Property value: Rp10,000,000,000
Economic rights offered: 30%
Offering target: Rp3,000,000,000
Property token: AVNUSA
Supply: 300,000
Initial unit price: Rp10,000
```

Two additional marketplace cards may be seeded only for visual completeness:

- Ubud Retreat — Coming Soon
- Lombok Residence — Verification Pending

Do not build separate full protocol flows for them until Villa Nusa works end-to-end.

---

## Demo-Only Nature

Verification is simulated.

Revenue is simulated.

Investor identity approval is simulated.

Payment uses Mock IDR.

All relevant UI must say so.

Do not claim real integration with:
- ATR/BPN;
- KJPP;
- banking rails;
- KYC vendors;
- regulators;
- real rupiah settlement.

Use:

> **Hackathon Demo — Synthetic / Simulated Data**

where appropriate.

---

## Technology Lock

### Network
Arbitrum Sepolia

### Chain ID
421614

### Frontend
- Next.js
- TypeScript
- Tailwind CSS
- wagmi
- viem

### Contracts
- Solidity
- Foundry
- OpenZeppelin Contracts

### Backend
- Next.js API/server routes

### Database
- Supabase PostgreSQL

### File storage
- Supabase Storage
- private bucket for documents
- public bucket for property images

### Package manager
- pnpm

Do not introduce additional infrastructure unless strictly required by a blocker.

---

## Repository Shape

Preferred:

```text
archprop/
├── apps/
│   └── web/
├── packages/
│   ├── contracts/
│   ├── chain/
│   └── shared/
├── supabase/
│   └── migrations/
├── scripts/
│   └── seed-demo.ts
├── docs/
│   ├── PRD.md
│   ├── SYSTEM.md
│   └── AGENT.md
├── .env.example
└── README.md
```

If the existing repository differs, preserve working structure where possible instead of performing a destructive rewrite.

---

## Source-of-Truth Rules

### Blockchain is authoritative for:
- asset lifecycle status;
- verifier attestations;
- verifier identity/role;
- agreement registration;
- token address;
- token supply;
- token balances;
- offering state;
- amount raised;
- investor allocation;
- successful/failed offering;
- revenue publication;
- revenue claims.

### PostgreSQL is authoritative for:
- property presentation metadata;
- descriptions;
- images;
- location data;
- user profile metadata;
- document metadata;
- private file references;
- marketplace search/cache.

### Storage is authoritative for:
- synthetic demo PDFs;
- property images;
- demo agreement PDF.

If DB and chain conflict on economic state:

> **chain wins.**

---

## Canonical Lifecycle

Use exactly:

```text
DRAFT
SUBMITTED
UNDER_VERIFICATION
VERIFIED
ISSUANCE_READY
OFFERING
FUNDED
ACTIVE
REJECTED
FAILED
```

Avoid inventing synonyms like:
- APPROVED;
- LIVE;
- TOKENIZED;
- READY;
- COMPLETE;

unless they are UI labels mapped explicitly to canonical states.

---

## Contract Set

Build:

```text
ArchpropRegistry.sol
IdentityRegistry.sol
PropertyToken.sol
OfferingEscrow.sol
RevenueDistributor.sol
MockIDR.sol
```

Avoid fragmenting the MVP into unnecessary contracts.

---

## `ArchpropRegistry.sol`

Must own:

- asset creation;
- asset lifecycle state;
- verifier role enforcement;
- ownership attestation;
- valuation attestation;
- verification finalization;
- economic-rights agreement hash;
- linked token address.

Required attestation types:

```text
OWNERSHIP
VALUATION
```

Required verifier roles:

```text
LEGAL_VERIFIER_ROLE
VALUATION_VERIFIER_ROLE
```

Required rule:

```text
OWNERSHIP == verified
AND
VALUATION == verified
```

before status can become `VERIFIED`.

Economic-rights agreement hash must exist before `ISSUANCE_READY`.

Token issuance/linking must be impossible before `ISSUANCE_READY`.

---

## `IdentityRegistry.sol`

MVP responsibility:

```text
address → approved investor boolean
```

Use only for demo investor identity gating.

UI must label it as simulated investor verification.

---

## `PropertyToken.sol`

Restricted ERC-20.

Properties:
- one token contract per property;
- fixed supply for MVP;
- decimals = 0;
- asset ID linkage;
- restricted transfers based on identity registry.

Villa Nusa:

```text
Name: Archprop Villa Nusa
Symbol: AVNUSA
Supply: 300000
Decimals: 0
```

No free minting by owner.

---

## `OfferingEscrow.sol`

Must support:

- fixed token price;
- target amount;
- deadline;
- approved investor requirement;
- payment in MockIDR;
- allocation tracking;
- escrow;
- successful finalization;
- failed offering;
- token claim;
- refund claim.

Must prevent:
- overfunding;
- early fund release;
- double token claim;
- refund after success;
- fund release after failure.

---

## `RevenueDistributor.sol`

Hackathon scope:
- simple distribution epochs;
- no need for production-scale holder fan-out;
- must prevent double claims;
- must correspond to a simulated revenue attestation.

Revenue UI must clearly show:

> **Simulated property revenue**

Do not spend hackathon time building a Merkle system unless the full golden path is already stable.

---

## `MockIDR.sol`

Demo token only.

Use obvious labeling:

> **mIDR — Demo Currency — No Real Monetary Value**

Provide demo faucet behavior.

Do not name it IDR without the demo qualifier.

---

## UI System

### Visual goal
Premium real-estate + financial platform.

### Avoid
- DEX UI;
- meme-token UI;
- unnecessary trading charts;
- crypto-first wording;
- excessive gradients/neon.

### Emphasize
- property imagery;
- verification;
- trust;
- economic rights;
- funding progress;
- on-chain proof.

---

## Required Pages

```text
/
/marketplace
/property/[assetId]

/owner
/owner/property/new
/owner/property/[id]

/verifier
/verifier/[assetId]

/portfolio

/admin
```

---

## Marketplace Rules

Only assets in an appropriate offering state may be investable.

Marketplace presentation may come from DB.

Funding and offering state must come from chain.

Villa Nusa is the only required functional asset.

---

## Property Detail Information Order

Always:

1. Property
2. Verification
3. Economic Rights
4. Offering
5. On-chain Proof
6. Revenue

Economic Rights section must contain:

> **This token does not represent direct legal title to the land.**

---

## Demo Verifier UX

This is a priority screen.

Show:

```text
Asset
Verification Type
Document Name
Evidence Hash
Owner Wallet
Demo Disclaimer
Verify Onchain
Reject
```

After successful transaction:

```text
Attestation Published
Verifier Wallet
Transaction Hash
Arbiscan Link
```

---

## Document Handling

Synthetic files only.

Private storage:
- `LAND_RIGHT_DEMO.pdf`
- `APPRAISAL_DEMO.pdf`
- `BUILDING_PERMIT_DEMO.pdf`
- `ECONOMIC_RIGHTS_AGREEMENT_DEMO.pdf`

Every document must be watermarked:

> **DEMO / SYNTHETIC DOCUMENT**

Calculate SHA-256 hash on upload.

Do not store full private documents on-chain.

---

## Security Rules

Never:
- place private keys in frontend code;
- commit private keys;
- store owner/investor private keys in DB;
- trust frontend state for authorization;
- let admin bypass issuance eligibility silently;
- expose private object-storage URLs permanently;
- let self-reported owner claims become verified without attestation.

Use contract roles and modifiers.

Use SafeERC20 for ERC-20 movement.

Use reentrancy protection where external token transfers/claims make it appropriate.

---

## Required Events

Contracts should emit explicit events:

```text
AssetCreated
AttestationSubmitted
AssetVerified
AgreementRegistered
TokenLinked
AssetStatusChanged
InvestorApprovalChanged
OfferingCreated
InvestmentMade
OfferingFunded
OfferingFailed
TokensClaimed
RefundClaimed
FundsReleased
RevenuePublished
RevenueClaimed
```

Event names may vary slightly if needed, but every major demo state change must be observable.

---

## Testing Standard

Foundry tests must cover at minimum:

- role authorization;
- missing-attestation issuance failure;
- successful verification;
- missing agreement issuance failure;
- unapproved investor failure;
- successful investment;
- overfund prevention;
- escrow finalization;
- refund path;
- double token claim failure;
- double refund failure;
- restricted transfer behavior;
- revenue publication authorization;
- double revenue claim failure.

Prefer fewer contracts with excellent tests over broad untested functionality.

---

## Backend Rules

Keep backend thin.

Use it for:
- property CRUD;
- metadata;
- file upload coordination;
- signed document URLs;
- search;
- demo revenue orchestration.

Do not route normal owner/verifier/investor blockchain signing through a server private key.

---

## Definition of Quality

The project is considered good when a judge can understand the system from the demo without needing verbal excuses.

The judge should visibly see:

```text
before attestation → issuance unavailable
after attestation → issuance available

before funding → investor allocation pending
after funding → token claimable

before revenue attestation → no distribution
after revenue attestation → claim available
```

This before/after causality is more important than raw feature count.

---

## Priority Order

### P0
1. Contracts compile.
2. Contract tests pass.
3. Villa Nusa owner submission works.
4. Demo legal attestation works.
5. Demo valuation attestation works.
6. Verification gate works.
7. Agreement registration works.
8. Property token issuance works.
9. Offering works.
10. Investor purchase works.
11. Successful funding works.
12. Token claim works.
13. Revenue publication works.
14. Revenue claim works.
15. Marketplace/property UI works.
16. Arbiscan links work.

### P1
- polished UI;
- owner wizard polish;
- two extra seed property cards;
- transaction history;
- better loading states.

### P2
- any additional feature.

Never begin P2 while P0 is incomplete.
