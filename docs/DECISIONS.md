# ARCHPROP Architecture Decisions

## ADR-001 — Contract lifecycle starts at `SUBMITTED`

**Decision:** `DRAFT` is a DB/UI-only pre-submission state. `createAsset` creates
the on-chain record at `SUBMITTED`.

**Why:** It reconciles the PRD's owner draft flow with the locked on-chain enum
and prevents a privileged on-chain draft-to-issued bypass.

## ADR-002 — Whole-unit mIDR and AVNUSA

**Decision:** Both demo currencies use zero decimals. Values are displayed as
Rp-equivalent but stored as exact integer demo units.

**Why:** 3,000,000,000 mIDR / 300,000 AVNUSA is exactly 10,000 mIDR and removes
conversion ambiguity from contracts, UI, and seed scripts.

## ADR-003 — Escrow owns primary inventory

**Decision:** A property token has fixed supply and mints once to the configured
`OfferingEscrow`; only that escrow delivers allocations after success.

**Why:** There is no property-owner mint authority and no circular allowance or
unrestricted issuance path.

## ADR-004 — Revenue uses a transfer lock

**Decision:** Publishing a funded, attested revenue epoch locks AVNUSA transfers
until the epoch is closed after its claim deadline. Entitlement uses the locked
balance divided by total supply.

**Why:** This small-MVP method provides deterministic, non-duplicable economic
rights without an unimplemented holder snapshot/Merkle system. The UI must show
the claim deadline and temporary transfer lock.

## ADR-005 — Authority separation

**Decision:** Registry controls lifecycle and attestations; identity controls
demo investor approval; escrow controls offering accounting; distributor controls
funded revenue epochs. DB is never authoritative for economic state.

## ADR-006 — No testnet deployment in implementation phase

**Decision:** Agent 4 may write deployment/seed scripts and local diagnostics
only. An Arbitrum Sepolia deployment requires explicit orchestrator authorization
after complete local integration checks and funded non-secret deployer access.

## ADR-007 — Explicit verifier rejection

**Decision:** A role-matched legal or valuation verifier can transition an asset
from `UNDER_VERIFICATION` to terminal `REJECTED` with a nonzero evidence hash.

**Why:** The PRD requires a verifier Reject action and a `REJECTED` branch; a
lifecycle state without an authorized transition would force frontend fiction.

## ADR-008 — JSON numeric values are decimal strings

**Decision:** API request/response values that can exceed JavaScript safe integer
range use canonical unsigned base-10 strings. Contract adapters convert them to
`bigint` only at the chain boundary.

**Why:** JSON cannot serialize `bigint`, and JavaScript numbers could silently
lose economic precision.

## ADR-009 — Revenue epochs are exclusive and attestation-single-use

**Decision:** Only one epoch per property token may be open, a revenue evidence
hash can fund only one epoch, and all primary-offering tokens must be claimed
before publication.

**Why:** The transfer-lock snapshot model is safe only with one lock owner and a
fully distributed supply; these constraints prevent replay and missed investor
entitlement.

## ADR-010 — Offering `OPEN` is not a lifecycle synonym

**Decision:** `OfferingStatus.OPEN` is the escrow's local funding state. The
registry's canonical asset lifecycle state for the same period is `OFFERING`.
UI may display “Open for investment” but maps chain lifecycle only to
`OFFERING`.

**Why:** The PRD uses `OPEN` in the offering configuration while the canonical
asset state machine requires `OFFERING`.

## ADR-011 — Agreement registration and readiness are two gated writes

**Decision:** `registerAgreement` stores the nonzero agreement hash while the
asset remains `VERIFIED`; `markIssuanceReady` is the explicit subsequent
transition and rechecks the agreement gate. The UI treats them as one guided
step with two confirmed transactions.

**Why:** This preserves the PRD outcome while making the required “issuance
readiness without agreement reverts” invariant directly testable and visible.

## ADR-012 — Signed, receipt-verified property binding

**Decision:** Add `POST /api/properties/:id/bind-chain` and the shared
`BindPropertyChainRequest`/`buildPropertyBindingMessage` contract specified in
`docs/INTERFACES.md`. A Supabase-authenticated draft owner must sign an EIP-191
message binding their user ID and property UUID to the exact Arbitrum Sepolia
`createAsset` transaction and expected external-ID-derived asset ID. The server
verifies the receipt, registry emitter, event/current owner, chain ID, fresh
signature, and conditional one-time DB update. It never performs a wallet write.

**Why:** The frozen draft flow creates a DB UUID before on-chain `SUBMITTED`,
but the original five-route API had no authenticated bridge between them.
Receipt-only binding would let a signed-in user attach someone else's asset to
their draft. The wallet signature proves control of the event owner while the
JWT proves control of the off-chain draft. The database remains a cache, not a
source of verification or economic authority.

**Affected consumers:** Backend route/receipt tests and frontend owner
registration flow consume the shared message builder. No Solidity ABI or
existing HTTP response is changed. The new route is a deliberate additive
exception to the earlier five-route baseline.

**Migration/test plan:** Existing `properties.chain_asset_id` uniqueness and
`status_cache` columns suffice; no new migration is required. Test wrong chain,
reverted/wrong-emitter receipt, mismatched asset/owner/signature, stale message,
foreign JWT owner, repeat/racing bind, and successful conditional update.
Metadata content hashing remains a separately documented limitation: this
binding authenticates the creator and nonzero on-chain metadata hash, but does
not claim that the DB's descriptive fields were cryptographically committed.

## ADR-013 — Escrow credits only exact payment deposits

**Decision:** `OfferingEscrow.invest` must verify its payment-token balance
increased by exactly `paymentAmount` before retaining the investment and token
allocation. Deflationary/fee-on-transfer payment tokens revert atomically.
This hardens the existing escrow invariant without changing the frozen function
signatures, constructors, lifecycle transitions, or events. A new custom error
for mismatched receipt is permitted.

**Why:** The previous implementation credited `paymentAmount` after
`safeTransferFrom` without checking actual receipt. A fee-charging token could
make `raised == target` while the escrow held less than `target`, breaking both
issuer release and refund conservation. `RevenueDistributor` already checks
exact deposits; primary offering accounting must do the same.

**Test plan:** Keep the MockIDR golden path unchanged; add a focused fee-token
regression proving the investment reverts, `raised`/allocation/payment remain
zero, and the escrow holds no undercollateralized deposit. Run the full Foundry
suite and local E2E after integration.

## ADR-014 — Signed, role-checked verifier evidence access

**Decision:** Add the `POST /api/properties/:id/documents/:documentId/access`
contract in `docs/INTERFACES.md`. A Supabase-authenticated caller must sign a
fresh EIP-191 message binding their user ID, one document, the bound asset,
and the requested verifier role. The server checks the recovered wallet's live
registry role, rejects the asset owner, requires `UNDER_VERIFICATION`, and
issues only a 60-second private-storage signed URL for a role-appropriate
synthetic PDF. It never trusts a DB role, caller-supplied storage path, or
cached lifecycle state as authorization.

**Why:** The verifier screen must inspect the exact private evidence bytes
whose SHA-256 hash is attested on-chain. Owner-only storage RLS and a public
document URL cannot establish independent, least-privilege verifier access.
The wallet signature and live on-chain role preserve the verification gate
without giving the server a signing key.

**Affected consumers:** Backend route/security tests and verifier UI use the
shared `VerifierEvidenceAccessRequest` and
`buildVerifierEvidenceAccessMessage`. No Solidity ABI or existing route changes.
This is an additive API route; no new database table or broad storage policy is
required.

**Test plan:** Reject missing/invalid JWT, malformed/stale signature, wrong
chain, unbound or wrong-state asset, owner self-access, wrong/missing on-chain
role, document/property mismatch, forbidden document type, and storage errors.
Verify a valid role receives one short-lived URL with `Cache-Control: no-store`
and no storage path in the response. Live Supabase RLS/storage behavior remains
an explicit integration gate when an instance is configured.

---

## Interface change process

An agent must provide the proposed before/after signature, affected consumers,
migration/test plan, and reason. The orchestrator records the approved change in
this file before any consumer implementation changes.
