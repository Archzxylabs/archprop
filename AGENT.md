# AGENT.md — IMPLEMENTATION CONTRACT FOR CODING AGENTS

You are implementing **Archprop**, a hackathon MVP property RWA marketplace on **Arbitrum Sepolia**.

Read `PRD.md` and `SYSTEM.md` before changing code.

Your job is to deliver the complete golden path, not to redesign the product.

---

## 1. Product in One Sentence

> **Archprop is a property RWA marketplace where a property can only be issued after demo independent verifiers attest its real-world claims on-chain; approved demo investors can then fund the offering and claim simulated property revenue.**

---

## 2. Non-Negotiable Rule

> **NO VERIFICATION → NO ISSUANCE**

This must be enforced in Solidity.

Do not implement it only as a hidden/disabled frontend button.

Similarly:

> **NO REVENUE ATTESTATION → NO REVENUE DISTRIBUTION**

---

## 3. Do Not Reinterpret the Token

The token is NOT:
- a land certificate;
- direct legal land ownership;
- an NFT representing physical possession.

For the demo it represents:

> units of the defined economic participation rights in the demo Economic Rights Agreement.

For Villa Nusa:

- 30% economic participation is offered;
- 300,000 AVNUSA represent that offered participation;
- demo rights include rental distributions and net exit participation.

The property remains the underlying real-world asset.

---

## 4. Demo Data Must Stay Demo Data

Use synthetic documents and simulated verifier accounts.

Every relevant screen must state:

> **Hackathon Demo — Synthetic / Simulated Data**

Never add claims of:
- BPN integration;
- KJPP integration;
- real bank integration;
- real KYC;
- real rupiah;
- regulatory approval.

---

## 5. Canonical Golden Path

Do not break this flow:

```text
Owner creates Villa Nusa
→ Asset created on Arbitrum Sepolia
→ Owner uploads synthetic documents
→ Legal demo verifier attests OWNERSHIP
→ Valuation demo verifier attests VALUATION
→ Registry finalizes VERIFIED
→ Economic-rights agreement hash registered
→ Asset becomes ISSUANCE_READY
→ AVNUSA issued
→ Offering created
→ Villa Nusa appears in marketplace
→ Approved demo investor invests using mIDR
→ Offering reaches target
→ Investor claims AVNUSA
→ Demo revenue verifier publishes revenue
→ Investor claims mIDR revenue
```

---

## 6. Canonical Asset

Use these defaults in demo seed/setup:

```text
Asset: Villa Nusa
Asset ID: ARCHPROP-001
Location: Bali
Issuer: PT Nusa Properties
Property value: 10,000,000,000 IDR equivalent
Economic rights offered: 30%
Offering target: 3,000,000,000 mIDR
Token: AVNUSA
Token supply: 300,000
Token price: 10,000 mIDR
Decimals: 0
```

Do not silently change these numbers across frontend, DB seed, and contracts.

If integer units require adapting MockIDR decimals, centralize conversion helpers and keep displayed values consistent.

---

## 7. Network Lock

Deploy/use:

> **Arbitrum Sepolia**

Chain ID:

```text
421614
```

Do not default to Ethereum Sepolia, Base Sepolia, Polygon Amoy, local-only Anvil, or another network for the final demo configuration.

Local Anvil is allowed for tests and local development.

---

## 8. Required Contract Set

Implement:

```text
ArchpropRegistry.sol
IdentityRegistry.sol
PropertyToken.sol
OfferingEscrow.sol
RevenueDistributor.sol
MockIDR.sol
```

Do not create additional protocol contracts unless a clear technical requirement exists.

Prefer composition only when it makes the code safer or materially simpler.

---

## 9. `ArchpropRegistry.sol` Requirements

Must support:

### Asset
Store at minimum:
- owner;
- metadata hash/reference;
- agreement hash;
- lifecycle status;
- linked property token.

### Status enum
Use canonical lifecycle-compatible states.

At minimum on-chain:

```text
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

### Attestations
Required types:

```text
OWNERSHIP
VALUATION
REVENUE
```

Revenue may be stored in Registry or validated through a tightly linked mechanism.

### Roles

```text
LEGAL_VERIFIER_ROLE
VALUATION_VERIFIER_ROLE
STRUCTURER_ROLE
REVENUE_VERIFIER_ROLE
DEFAULT_ADMIN_ROLE
```

### Verification Gate
`VERIFIED` is only reachable when:
- valid ownership attestation exists;
- valid valuation attestation exists.

### Agreement Gate
`ISSUANCE_READY` is only reachable when:
- asset is VERIFIED;
- non-zero/non-empty agreement hash is registered.

### Token Gate
Token linking/issuance is only possible when:
- asset is ISSUANCE_READY.

No admin emergency path should silently bypass these checks for the normal demo.

---

## 10. Attestation Model

Each attestation must include enough information to prove:

```text
which asset?
which type?
which verifier?
which evidence hash?
what result/value?
when?
```

Suggested structure:

```solidity
struct Attestation {
    address verifier;
    AttestationType attestationType;
    bytes32 evidenceHash;
    uint256 value;
    uint64 timestamp;
    bool valid;
}
```

Exact schema may vary if tests and product semantics remain correct.

Ownership value can be unused/zero.

Valuation value stores the demo numeric valuation.

Revenue value stores the demo distributable amount or references a revenue epoch.

Attestations should be append-only or safely invalidatable with explicit events.

Do not allow silent mutation.

---

## 11. `IdentityRegistry.sol` Requirements

Demo-only investor approval.

Required:

```solidity
function isApproved(address investor) external view returns (bool);
```

Admin/authorized demo function to update approval.

Emit an event.

Do not store KYC documents on-chain.

---

## 12. `PropertyToken.sol` Requirements

Use ERC-20 semantics.

For Villa Nusa:

```text
name = "Archprop Villa Nusa"
symbol = "AVNUSA"
decimals = 0
fixed supply = 300000
```

Requirements:
- linked `assetId`;
- fixed supply;
- no unrestricted public mint;
- transfer restrictions using IdentityRegistry where applicable;
- offering contract must be able to deliver allocated tokens after funding.

Do not give arbitrary mint authority to property owner.

---

## 13. `MockIDR.sol` Requirements

Mock payment token only.

Clearly named and presented as demo currency.

Recommend:
- symbol `mIDR`;
- faucet or controlled demo mint;
- safe integer units.

Do not imply redeemability for real IDR.

---

## 14. `OfferingEscrow.sol` Requirements

Support:

```text
create/configure offering
invest
finalize success
mark failure after deadline
claim tokens
claim refund
release funds
```

Required data:
- asset ID;
- property token;
- payment token;
- target;
- price;
- deadline;
- raised amount;
- issuer treasury;
- status;
- investor allocation;
- claim status.

### Investment rule
Investor must be approved in IdentityRegistry.

### Escrow rule
Payment remains locked before offering success.

### Success rule
When target is reached / finalization criteria are met:
- offering becomes FUNDED;
- issuer fund release becomes available;
- investors can claim token allocations.

### Failure rule
If deadline passes below target:
- offering becomes FAILED;
- investors can claim refunds;
- issuer cannot release funds.

### Double-action protection
Prevent:
- duplicate token claim;
- duplicate refund;
- success+refund contradictions.

Use SafeERC20 and reentrancy protections where appropriate.

---

## 15. `RevenueDistributor.sol` Requirements

Hackathon-scale implementation only.

Must support:
- a revenue epoch/period;
- a distributable amount;
- funding of the distribution;
- investor entitlement;
- claim;
- double-claim prevention.

A distribution must require a corresponding demo revenue attestation by the appropriate role.

Keep the implementation simple enough to explain in a hackathon demo.

Do not overengineer holder indexing.

---

## 16. Required Contract Events

Emit explicit events for core actions.

At minimum:

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

Names can differ slightly, but every important demo action needs an observable event.

---

## 17. Required Tests

Before calling contracts complete:

### Registry
- owner creates asset;
- unauthorized legal attestation reverts;
- unauthorized valuation attestation reverts;
- legal role cannot submit valuation if role-separated;
- valuation role cannot submit ownership if role-separated;
- finalize verification with missing ownership reverts;
- finalize verification with missing valuation reverts;
- finalize verification after both succeeds;
- agreement registration before verification reverts;
- issuance readiness without agreement reverts;
- issuance readiness after agreement succeeds;
- token linking before issuance-ready reverts.

### Identity
- admin can approve investor;
- unauthorized approval change reverts.

### Token
- fixed supply correct;
- unapproved transfer recipient fails where required;
- approved transfer succeeds.

### Offering
- unapproved investor cannot invest;
- approved investor can invest;
- over-cap investment fails or is safely bounded according to chosen design;
- funds remain escrowed before success;
- early release fails;
- success finalization works;
- token claim works;
- second token claim fails;
- failed offering refund works;
- second refund fails;
- funded offering refund fails.

### Revenue
- unauthorized revenue publish fails;
- revenue without correct attestation fails;
- valid distribution publish works;
- claim works;
- second claim fails.

Run:

```text
forge test
```

until fully green.

---

## 18. Frontend Requirements

Build the user experience around four roles:

- Owner
- Verifier
- Investor
- Admin/Demo operator

Do not show protocol complexity unless useful.

Use human language first.

Examples:

Good:
> **Ownership Verified**

Less useful:
> `OWNERSHIP_ATTESTATION_TYPE_0x01`

Good:
> **Invest Rp1,000,000 — Receive 100 AVNUSA**

Less useful:
> `approve()` followed by `buy()` without explanation.

---

## 19. Required Routes

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

## 20. Homepage

Two main CTAs:

```text
Explore Properties
List a Property
```

Make it immediately clear that this is a two-sided property RWA marketplace.

---

## 21. Marketplace

Seed exactly enough content to feel real.

Cards:

```text
Villa Nusa
Verified
72% Funded

Ubud Retreat
Coming Soon

Lombok Residence
Verification Pending
```

Only Villa Nusa needs full protocol functionality.

Do not spend time building additional fully functional properties before P0 completion.

---

## 22. Property Detail

Required sections in order:

```text
Property
Verification
Economic Rights
Offering
On-chain Proof
Revenue
```

Verification must show:
- verifier;
- type;
- transaction hash;
- evidence hash;
- status.

Economic-rights section must explicitly state:

> **This token does not represent direct legal title to the land.**

---

## 23. Owner UX

Use a four-step flow:

```text
1. Property Details
2. Documents
3. Verification
4. Offering
```

The owner should see verification status change after on-chain verifier signatures.

Do not let the owner self-verify.

---

## 24. Verifier UX

This is a demo-priority screen.

Show:
- property;
- document/evidence;
- SHA-256 hash;
- verification type;
- owner wallet;
- simulated-data disclaimer.

Primary CTA:

> **VERIFY ONCHAIN**

After confirmation:
- show success;
- show transaction hash;
- link to Arbiscan.

---

## 25. Investor UX

Marketplace property page must show:

```text
Property Value
Offering Size
Token Price
Funding Progress
Verification
Economic Rights
```

Investment panel:

```text
Amount
You Receive
Invest
```

Use mIDR behind the scenes and friendly Rp-equivalent presentation in demo UI.

Always label mIDR as demo currency.

---

## 26. Portfolio UX

Show:
- AVNUSA balance;
- invested amount;
- offering status;
- claimable simulated revenue;
- claim action;
- transaction history / links.

---

## 27. Database Rules

Use Supabase Postgres.

Suggested tables:

```text
users
properties
property_documents
property_images
chain_transactions
revenue_epochs
```

DB status is a cache/presentation aid.

Do not use it to bypass chain state.

---

## 28. Storage Rules

Use Supabase Storage.

Private:
```text
property-documents/
```

Public:
```text
property-images/
```

Synthetic docs must be watermarked.

Never expose private document bucket broadly.

---

## 29. Document Hashing

Compute SHA-256 for each uploaded synthetic document.

The verifier attestation must reference the hash of the exact reviewed file.

If the file changes, the hash must change.

Do not silently reuse an old attestation for a changed document.

---

## 30. Chain Read/Write Rules

Prefer wallet-driven writes for:
- asset submit;
- verifier attest;
- invest;
- token claim;
- revenue claim.

Backend may orchestrate demo/admin operations where justified, but do not store normal users' private keys.

For reads:
- use viem;
- read important economic state directly from chain;
- cache only for UI/search performance.

---

## 31. Transaction UX

Every write flow must handle:

```text
idle
awaiting wallet signature
submitted
confirming
confirmed
failed
```

After confirmation, show:
- human-readable result;
- transaction hash;
- Arbiscan link.

Do not update UI optimistically as VERIFIED/FUNDED before receipt confirmation.

---

## 32. Demo Labels

Use consistent labels:

```text
Hackathon Demo
Synthetic Document
Simulated Verification
Demo Investor Verification
Simulated Property Revenue
mIDR — Demo Currency
```

Do not hide these labels.

Credibility is more important than pretending external integrations exist.

---

## 33. UI Quality Bar

Aim for:
- clean spacing;
- strong property photography;
- neutral institutional typography;
- obvious state badges;
- clear progress indicators;
- responsive mobile layout;
- no broken empty states;
- no giant Web3 jargon.

Prioritize state clarity over visual gimmicks.

---

## 34. Build Priority

Execute in this order:

### Phase 1 — Contracts
- registry;
- identity;
- mock IDR;
- property token;
- offering;
- revenue;
- tests.

### Phase 2 — Chain deployment
- deploy to Arbitrum Sepolia;
- record addresses;
- seed verifier/admin roles;
- verify basic reads/writes.

### Phase 3 — DB/storage
- migrations;
- document upload;
- hashing;
- Villa Nusa metadata.

### Phase 4 — Owner/verifier
- owner submission;
- verifier queue;
- on-chain attestation;
- verification status sync.

### Phase 5 — Offering/marketplace
- agreement registration;
- token issuance;
- offering creation;
- marketplace;
- invest.

### Phase 6 — Funding/revenue
- finalize;
- token claim;
- revenue publish;
- revenue claim.

### Phase 7 — Polish
- seed additional cards;
- loading/error states;
- explorer links;
- responsive design;
- demo script rehearsal.

Do not polish before golden-path correctness.

---

## 35. Verification Commands

Before reporting completion, run all available project checks.

Expected checks include:

```text
forge test
pnpm typecheck
pnpm lint
pnpm build
```

If project scripts differ, inspect `package.json` and use the repository's real verification commands.

Do not claim PASS without actual execution.

---

## 36. Definition of Done

Do not say "done" until the entire golden path can be demonstrated from a clean browser session:

1. Owner submits Villa Nusa.
2. Asset transaction confirms.
3. Synthetic evidence exists.
4. Legal verifier signs.
5. Valuation verifier signs.
6. Asset becomes VERIFIED.
7. Agreement hash is registered.
8. Asset becomes ISSUANCE_READY.
9. AVNUSA is issued.
10. Offering becomes OPEN.
11. Villa appears in marketplace.
12. Demo investor is approved.
13. Demo investor obtains mIDR.
14. Investor purchases allocation.
15. Offering reaches target.
16. Investor claims AVNUSA.
17. Simulated revenue is attested.
18. Investor claims revenue.
19. All critical actions have transaction hashes.
20. Tests/build/typecheck/lint pass.

---

## 37. Do Not Drift

Do not transform this project into:
- a lending protocol;
- an NFT marketplace;
- a DEX;
- a DAO;
- a property management ERP;
- a generic tokenization platform;
- a multichain protocol.

The hackathon product is:

> **verified property → economic rights → on-chain issuance → marketplace → funding → revenue**

If a feature does not improve this path, defer it.
