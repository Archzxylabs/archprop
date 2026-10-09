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

## Interface change process

An agent must provide the proposed before/after signature, affected consumers,
migration/test plan, and reason. The orchestrator records the approved change in
this file before any consumer implementation changes.
