# ARCHPROP — Product Requirements Document

**Version:** Hackathon MVP  
**Network:** Arbitrum Sepolia  
**Chain ID:** 421614  
**Product:** RWA Property Marketplace  
**Scope:** End-to-end technical demo only  
**Primary demo asset:** Villa Nusa

---

## 1. Product Summary

Archprop is a property RWA marketplace where:

1. A property owner submits a real-world property.
2. Demo independent verifiers attest key facts about the property on-chain.
3. The property cannot be issued as an RWA until all required attestations exist.
4. A defined economic-rights agreement is linked to the asset.
5. A restricted property token is issued.
6. The offering becomes visible in the marketplace.
7. Demo investors can fund the offering using Mock IDR on Arbitrum Sepolia.
8. After funding, token holders can receive simulated property revenue.

### Core thesis

> **No verification, no issuance.**

Archprop is not merely a property-token marketplace. Its core differentiator is an **attestation-gated RWA lifecycle**: real-world claims must be independently attested on-chain before economic actions can occur.

---

## 2. What the Token Represents

The property token MUST NOT be described as direct legal ownership of the land certificate.

For the hackathon demo:

- Underlying real-world asset: **Villa Nusa**
- Demo property value: **Rp10,000,000,000**
- Economic rights offered: **30%**
- Offering target: **Rp3,000,000,000**
- Property token supply: **300,000 AVNUSA**
- Initial price: **Rp10,000 per AVNUSA**
- Token-holder rights in the demo agreement:
  - participation in distributable rental income;
  - participation in net exit proceeds.

The relationship is:

```text
REAL PROPERTY
     ↓
DEMO ECONOMIC RIGHTS AGREEMENT
     ↓
DEFINED ECONOMIC RIGHTS
     ↓
PROPERTY TOKEN
```

The token represents the defined economic-rights units, not the land title itself.

---

## 3. Hackathon Disclosure

All real-world verification and revenue data in this MVP are simulated.

Every demo document and verification UI MUST visibly state:

> **Hackathon Demo — Synthetic / Simulated Data**

Archprop MUST NOT imply:
- connection to ATR/BPN;
- connection to a real KJPP;
- real investor KYC;
- real IDR settlement;
- real public securities offering;
- production regulatory approval.

The architecture should show how those actors/data sources could later replace the demo roles without redesigning the core protocol.

---

## 4. Users and Roles

### 4.1 Property Owner

Can:
- create a property draft;
- upload synthetic demo documents;
- submit a property;
- monitor verification status;
- register the demo economic-rights agreement after verification;
- create an offering after issuance eligibility is reached.

Cannot:
- self-verify the asset;
- issue a property token before required attestations exist;
- change on-chain verification results.

### 4.2 Demo Legal Verifier

Role: `LEGAL_VERIFIER_ROLE`

Can attest:
- `OWNERSHIP`

The verifier signs an on-chain attestation linked to:
- `assetId`;
- evidence hash;
- verification result;
- timestamp.

### 4.3 Demo Valuation Verifier

Role: `VALUATION_VERIFIER_ROLE`

Can attest:
- `VALUATION`

The attestation includes:
- demo property valuation;
- evidence hash;
- verifier wallet;
- timestamp.

### 4.4 Demo Revenue Verifier / Admin

Can publish a simulated revenue attestation after the property is active.

Revenue is clearly labeled simulated.

### 4.5 Demo Investor

Can:
- receive Mock IDR;
- be whitelisted through the demo identity flow;
- invest in open offerings;
- claim property tokens after a successful offering;
- claim revenue distributions.

---

## 5. Required Demo Documents

Use synthetic PDF files only.

### `LAND_RIGHT_DEMO.pdf`
Purpose:
- demo evidence for the claimed legal holder of the property.

### `APPRAISAL_DEMO.pdf`
Purpose:
- demo evidence supporting the stated property valuation.

### `BUILDING_PERMIT_DEMO.pdf`
Purpose:
- supporting real-world asset evidence for the property.

### `ECONOMIC_RIGHTS_AGREEMENT_DEMO.pdf`
Purpose:
- defines what token holders are economically entitled to.

Minimum content:
- underlying asset;
- issuer / property owner;
- offered economic-rights percentage;
- offering size;
- token supply;
- rental-income participation;
- net exit participation;
- duration / termination concept;
- demo disclaimer.

All PDFs MUST have a prominent:

> **DEMO / SYNTHETIC DOCUMENT**

watermark.

---

## 6. Product State Machine

Use this canonical lifecycle everywhere:

```text
DRAFT
  ↓
SUBMITTED
  ↓
UNDER_VERIFICATION
  ↓
VERIFIED
  ↓
ISSUANCE_READY
  ↓
OFFERING
  ↓
FUNDED
  ↓
ACTIVE
```

Failure branches:

```text
UNDER_VERIFICATION → REJECTED
OFFERING → FAILED
```

No frontend-only status should conflict with the blockchain.

For on-chain lifecycle states, the blockchain is authoritative.

---

## 7. Golden Demo Flow

### Step 1 — Owner submits Villa Nusa

Owner completes:

- Property Name
- Location
- Property Type
- Issuer / Owner Name
- Indicative Property Value
- Offering Amount
- Description
- Images

Result:
- DB property created.
- Owner submits asset on-chain.
- `ARCHPROP-001` created.
- On-chain status becomes `SUBMITTED`.

### Step 2 — Owner uploads synthetic evidence

Upload:
- `LAND_RIGHT_DEMO.pdf`
- `APPRAISAL_DEMO.pdf`
- `BUILDING_PERMIT_DEMO.pdf`

Files go to private storage.

Backend computes SHA-256 hashes.

Hashes are associated with `ARCHPROP-001`.

### Step 3 — Legal verifier attests ownership

Verifier opens the verification portal.

Displays:
- asset;
- document name;
- evidence hash;
- submitting wallet;
- demo disclaimer.

Action:

> **VERIFY OWNERSHIP ONCHAIN**

Verifier wallet submits an attestation transaction.

Result:
- `OWNERSHIP = VERIFIED`

### Step 4 — Valuation verifier attests valuation

Action:

> **VERIFY VALUATION ONCHAIN**

Attestation includes:
- value = `Rp10,000,000,000`
- evidence hash;
- verifier wallet.

Result:
- `VALUATION = VERIFIED`

### Step 5 — Verification gate

Required attestations for MVP:

- `OWNERSHIP`
- `VALUATION`

Before both exist:

`finalizeVerification(assetId)` MUST revert.

After both exist:

- asset status → `VERIFIED`.

This MUST be enforced by Solidity, not only by the frontend.

### Step 6 — Register economic rights

Owner/structurer uploads:

`ECONOMIC_RIGHTS_AGREEMENT_DEMO.pdf`

Hash is registered on-chain.

Required economic configuration:

```text
Property value:      Rp10B
Economic rights:     30%
Offering target:     Rp3B
Token supply:        300,000
Rights:              rental distribution + net exit participation
```

Result:

- agreement hash stored;
- status → `ISSUANCE_READY`.

### Step 7 — Issue property token

Create:

```text
Name:   Archprop Villa Nusa
Symbol: AVNUSA
Supply: 300,000
```

Token creation MUST fail if asset is not `ISSUANCE_READY`.

### Step 8 — Create offering

Offering configuration:

```text
Asset:          ARCHPROP-001
Token:          AVNUSA
Target:         3,000,000,000 mIDR
Token price:    10,000 mIDR
Supply:         300,000
Status:         OPEN
```

Property appears in marketplace.

### Step 9 — Demo investor flow

Admin marks demo investor wallet as approved.

UI label:

> **Demo Investor Verified**

Investor gets demo funds from Mock IDR faucet.

Investor selects an amount and invests.

Example:

```text
Investment: 1,000,000 mIDR
Token price: 10,000 mIDR
Allocation: 100 AVNUSA
```

Funds stay in escrow.

### Step 10 — Offering reaches target

Demo seed wallets can complete the remaining funding.

Result:
- offering → `FUNDED`;
- funds can be released according to demo rules;
- investors can claim allocated AVNUSA.

### Step 11 — Revenue attestation

Demo Revenue Verifier publishes:

```text
Period: October 2026
Distributable revenue: 30,000,000 mIDR
```

The UI MUST say:

> **Simulated property revenue for hackathon demonstration**

### Step 12 — Revenue claim

Investor portfolio shows:

- AVNUSA balance;
- investment amount;
- claimable demo revenue.

Investor clicks:

> **CLAIM REVENUE**

Contract transfers mIDR.

---

## 8. UX Requirements

### 8.1 Design Direction

Archprop should visually feel like:

> premium property platform + institutional fintech

Avoid:
- DEX-like layout;
- meme-token aesthetics;
- excessive crypto jargon;
- neon-heavy design;
- price speculation UI.

Emphasize:
- property;
- verification;
- economic rights;
- funding;
- proof.

### 8.2 Homepage

Primary CTA:
- **Explore Properties**

Secondary CTA:
- **List a Property**

Hero copy must explain the product without requiring Web3 knowledge.

### 8.3 Marketplace

Route:

`/marketplace`

Seed three cards for visual completeness:

1. Villa Nusa — working demo — `72% Funded` before demo finalization.
2. Ubud Retreat — `Coming Soon`.
3. Lombok Residence — `Verification Pending`.

Only Villa Nusa requires full functionality.

Card fields:
- image;
- property name;
- location;
- verification badge;
- property value;
- offering size;
- token price;
- funding progress.

### 8.4 Property Detail

Route:

`/property/[assetId]`

Sections in this exact order:

1. Property overview
2. Verification
3. Economic rights
4. Offering
5. On-chain proof
6. Revenue / distributions

Verification cards show:
- type;
- status;
- verifier wallet;
- evidence hash;
- transaction link.

Economic-rights section MUST explicitly say:

> **This token does not represent direct legal title to the land.**

### 8.5 Owner Flow

Routes:

```text
/owner
/owner/property/new
/owner/property/[id]
```

Use a simple four-step wizard:

```text
1. Property Details
2. Documents
3. Verification
4. Offering
```

Verification progress should visibly change after verifier transactions.

### 8.6 Verifier Flow

Routes:

```text
/verifier
/verifier/[assetId]
```

Display:
- asset;
- verification type;
- document;
- evidence hash;
- owner wallet;
- demo label;
- reject button;
- verify-onchain button.

This is a key hackathon demo screen.

### 8.7 Investor Portfolio

Route:

`/portfolio`

Display:
- held property tokens;
- invested amount;
- offering status;
- demo revenue claimable;
- claim button;
- Arbiscan links.

---

## 9. Frontend Architecture

Recommended:

- Next.js
- TypeScript
- Tailwind CSS
- wagmi
- viem

Wallet writes should occur client-side when initiated by owner/verifier/investor.

Do not store user private keys in the backend.

---

## 10. Backend Architecture

Use:

- Next.js server/API routes
- Supabase PostgreSQL
- Supabase Storage
- viem for chain reads where needed

Do not introduce:
- microservices;
- Kafka;
- Redis;
- GraphQL;
- complex indexers.

### Minimal API surface

```text
POST /api/properties
GET  /api/properties
GET  /api/properties/:id
POST /api/properties/:id/documents
POST /api/demo/revenue
```

Wallet-driven on-chain writes should not be routed through server-held private keys.

---

## 11. Database Responsibilities

Database stores:

- property metadata;
- property description;
- location;
- images;
- owner profile;
- document metadata;
- private storage path;
- document hash;
- demo flags;
- UI cache;
- transaction references;
- search/indexing data.

Database MUST NOT be authoritative for:

- verified status;
- token ownership;
- amount raised;
- verifier identity;
- token issuance;
- revenue claims.

Those come from the blockchain.

### Minimal tables

#### `users`

```text
id
email
wallet_address
role
created_at
```

#### `properties`

```text
id
chain_asset_id
owner_user_id
name
slug
property_type
country
province
city
address_private
description
issuer_name
indicative_value
status_cache
token_address
created_at
```

#### `property_documents`

```text
id
property_id
document_type
storage_path
document_hash
is_demo
uploaded_by
created_at
```

#### `property_images`

```text
id
property_id
storage_path
sort_order
```

#### `chain_transactions`

```text
id
property_id
tx_hash
event_name
block_number
created_at
```

#### `revenue_epochs`

```text
id
property_id
period
distributable_revenue
evidence_hash
chain_tx_hash
created_at
```

---

## 12. Storage Responsibilities

### Private bucket

```text
property-documents/
```

Stores:
- synthetic land-right PDF;
- synthetic appraisal PDF;
- demo building permit;
- demo economic-rights agreement.

### Public bucket

```text
property-images/
```

Stores:
- marketplace images.

Do not expose private document paths publicly.

Use signed URLs where necessary for the verifier demo.

---

## 13. Blockchain Architecture

MVP contracts:

```text
ArchpropRegistry.sol
IdentityRegistry.sol
PropertyToken.sol
OfferingEscrow.sol
RevenueDistributor.sol
MockIDR.sol
```

Use OpenZeppelin primitives where appropriate.

### `ArchpropRegistry.sol`

Responsibilities:
- create assets;
- store lifecycle status;
- register demo verifier roles;
- record ownership attestation;
- record valuation attestation;
- enforce verification gate;
- register economic-rights agreement hash;
- link property-token address.

Suggested roles:

```text
DEFAULT_ADMIN_ROLE
LEGAL_VERIFIER_ROLE
VALUATION_VERIFIER_ROLE
STRUCTURER_ROLE
REVENUE_VERIFIER_ROLE
```

Suggested events:

```text
AssetCreated
AttestationSubmitted
AssetVerified
AgreementRegistered
TokenLinked
AssetStatusChanged
```

### `IdentityRegistry.sol`

Responsibilities:
- demo investor whitelist.

State:

```text
wallet => bool approved
```

Admin function:

```text
setInvestorApproval(address investor, bool approved)
```

### `PropertyToken.sol`

Restricted ERC-20.

Requirements:
- one contract per property;
- immutable/linkable `assetId`;
- fixed supply for MVP;
- transfers only allowed between approved identities where applicable.

Token:

```text
Name: Archprop Villa Nusa
Symbol: AVNUSA
Decimals: 0
Supply: 300,000
```

### `OfferingEscrow.sol`

Responsibilities:
- primary offering;
- target;
- price;
- deadline;
- mIDR escrow;
- investor allocation;
- finalization;
- token claims;
- refunds.

Core checks:
- investor approved;
- offering open;
- cap not exceeded;
- no early fund release;
- no double token claim;
- no refund after successful finalization.

Suggested events:

```text
OfferingCreated
InvestmentMade
OfferingFunded
OfferingFailed
TokensClaimed
RefundClaimed
FundsReleased
```

### `RevenueDistributor.sol`

Responsibilities:
- accept demo distribution funding;
- publish distribution epoch;
- track investor claims;
- prevent double claims.

For hackathon scale, keep distribution logic simple.

Do not build a production-scale Merkle system unless the core golden path is already complete.

Revenue publication MUST correspond to an attested demo revenue event.

Suggested events:

```text
RevenuePublished
RevenueClaimed
```

### `MockIDR.sol`

Demo ERC-20 only.

Requirements:
- obvious demo naming;
- faucet function or controlled mint;
- no implication of real rupiah.

UI label:

> **mIDR — Demo Currency — No Real Monetary Value**

---

## 14. Critical Smart Contract Invariants

Tests MUST prove:

1. Non-owner cannot create owner-only state transitions.
2. Random wallet cannot submit legal attestation.
3. Random wallet cannot submit valuation attestation.
4. Legal verifier cannot impersonate valuation verifier if roles differ.
5. Asset cannot become verified without all required attestations.
6. Token cannot be linked/issued before issuance eligibility.
7. Unapproved investor cannot invest.
8. Offering cannot exceed target/cap.
9. Funds cannot be released before offering success.
10. Successful offering cannot be refunded.
11. Failed offering cannot release issuer funds.
12. Investor cannot claim property token twice.
13. Investor cannot claim refund twice.
14. Investor cannot claim revenue twice for one epoch.
15. Invalid property-token transfer to an unapproved address must fail where restriction applies.
16. Evidence hashes are immutable per attestation record.
17. Economic-rights agreement hash is required before issuance readiness.

---

## 15. Chain Events and UI Sync

Emit explicit events for all important state changes.

Frontend should:
- wait for transaction receipt;
- update chain state;
- display transaction hash;
- provide Arbiscan link.

For hackathon scale:
- direct `viem` reads are acceptable;
- lightweight polling is acceptable;
- DB can cache public marketplace state.

Do not make DB the source of truth for chain economic state.

---

## 16. Demo Seed Data

### Villa Nusa
- full working flow.

### Ubud Retreat
- marketplace seed only;
- status: `COMING_SOON`.

### Lombok Residence
- marketplace seed only;
- status: `VERIFICATION_PENDING`.

Do not implement full contracts for the two seed properties unless all Villa Nusa functionality is complete.

---

## 17. Demo Script

### 0:00–0:30 — Problem
Explain:
- property tokenization requires trust in real-world facts;
- Archprop makes real-world verification enforceable on-chain.

### 0:30–1:00 — Owner
Submit Villa Nusa.

Show:
- Asset ID created.

### 1:00–1:40 — Verifiers
Legal verifier signs ownership.

Valuation verifier signs valuation.

Show:
- transactions;
- before/after status.

### 1:40–2:00 — Verification Gate
Show that issuance is unavailable before attestations.

After attestations:
- status becomes `VERIFIED`.

### 2:00–2:20 — Economic Rights
Register agreement hash.

Asset becomes:
- `ISSUANCE_READY`.

### 2:20–3:00 — Marketplace
Create offering.

Investor buys AVNUSA using mIDR.

Funding progress changes.

### 3:00–3:30 — Funding
Complete offering with seeded demo wallet.

Investor claims AVNUSA.

### 3:30–4:00 — Revenue
Publish simulated revenue attestation.

Investor claims mIDR revenue.

Closing line:

> **Archprop does not just tokenize property. It makes real-world verification enforceable on-chain before value can move.**

---

## 18. Definition of Done

Project is not complete until all items pass:

- [ ] Property can be created.
- [ ] Asset ID exists on Arbitrum Sepolia.
- [ ] Synthetic demo documents can be uploaded.
- [ ] SHA-256 hashes are created.
- [ ] Demo legal verifier can attest ownership.
- [ ] Demo valuation verifier can attest valuation.
- [ ] Unauthorized attestation reverts.
- [ ] Verification finalization before requirements reverts.
- [ ] Asset becomes `VERIFIED` after required attestations.
- [ ] Economic-rights agreement hash is registered.
- [ ] Asset becomes `ISSUANCE_READY`.
- [ ] Property token can be created only after issuance readiness.
- [ ] Offering can be created.
- [ ] Villa Nusa appears in marketplace.
- [ ] Demo investor can be approved.
- [ ] Demo investor can obtain mIDR.
- [ ] Approved investor can invest.
- [ ] Unapproved investor cannot invest.
- [ ] Offering escrow holds funds.
- [ ] Offering can become `FUNDED`.
- [ ] Investor can claim AVNUSA.
- [ ] Demo revenue can be attested.
- [ ] Revenue distribution can be published.
- [ ] Investor can claim mIDR revenue.
- [ ] Double claims fail.
- [ ] Major on-chain actions show transaction hashes.
- [ ] All demo verification/revenue data is clearly labeled simulated.
- [ ] `forge test` passes.
- [ ] frontend typecheck passes.
- [ ] production build passes.

---

## 19. North Star Metric

For a real product, the preferred metric is:

> **Funded RWA Value**

Definition:

Total value of RWA offerings that successfully reach funding and move into active status.

For the hackathon, this metric is conceptual only.

---

## 20. Product Principle

Every team member and coding agent must preserve this:

> **A real-world claim must be attested before it can unlock an on-chain economic action.**

Examples:

```text
Ownership claim
→ ownership attestation
→ issuance unlocked

Valuation claim
→ valuation attestation
→ issuance unlocked

Revenue claim
→ revenue attestation
→ distribution unlocked
```

This is the protocol pattern that defines Archprop.
