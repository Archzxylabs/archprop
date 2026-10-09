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

## Interface change process

An agent must provide the proposed before/after signature, affected consumers,
migration/test plan, and reason. The orchestrator records the approved change in
this file before any consumer implementation changes.
