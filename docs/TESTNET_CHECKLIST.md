# ARCHPROP Arbitrum Sepolia Readiness Checklist

Target network: Arbitrum Sepolia (`421614`). This checklist prepares DEP-001;
it does not authorize a deployment.

## Current status

- Contracts and local economic invariants: ready.
- Typed ABIs and local Anvil golden path: ready.
- Shared-chain deployment script: not implemented.
- Arbitrum Sepolia addresses and transaction ledger: not populated.
- Live Supabase/RLS/storage verification: not performed.
- Browser golden path against shared-chain contracts: not performed.

## Human-provided prerequisites

- [ ] Explicit written authorization to deploy DEP-001.
- [ ] A dedicated funded Arbitrum Sepolia deployer wallet.
- [ ] Public Arbitrum Sepolia RPC URL.
- [ ] Distinct demo addresses for admin, owner, legal verifier, valuation
      verifier, revenue verifier, structurer, and at least two investors.
- [ ] Test ETH for every address that submits a transaction.
- [ ] A Supabase project with URL, anon key, and server-only service-role key.
- [ ] A hosting target and permission to configure its environment variables.

Private keys and service-role credentials must be passed through secure local or
hosting environment configuration. They must never enter files, arguments,
logs, screenshots, commits, issues, pull requests, or chat.

## Deployment tooling gate

Before broadcasting, implement and review a fail-closed testnet deployment
command that:

- requires an explicit `ARCHPROP_DEPLOY_CONFIRM=ARBITRUM_SEPOLIA_421614` value;
- verifies the RPC-reported chain ID is exactly `421614`;
- loads compiled artifacts from the repository, with no fallback bytecode;
- validates nonzero role addresses and prevents owner/verifier role collapse;
- checks deployer balance before any write;
- simulates each supported call before broadcasting;
- waits for successful receipts and records exact transaction hashes;
- never logs a private key or secret environment value;
- refuses local unlocked-account assumptions on a shared network;
- writes only a non-secret deployment result for orchestrator review;
- can validate an existing deployment without performing writes.

## Deployment order

1. `ArchpropRegistry`
2. `IdentityRegistry`
3. `MockIDR`
4. `OfferingEscrow`
5. `RevenueDistributor`
6. `PropertyToken` for Villa Nusa
7. `ArchpropRegistry.setEscrow(OfferingEscrow)`
8. Grant legal, valuation, revenue, and structurer roles
9. Confirm immutable token wiring and all configured addresses

Every address, block number, and transaction hash must be copied into
`docs/DEPLOYMENTS.md` only after its receipt succeeds.

## Runtime configuration

Populate the deployed values using the exact names in `.env.example`:

```text
NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL
NEXT_PUBLIC_ARCHPROP_REGISTRY_ADDRESS
NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS
NEXT_PUBLIC_OFFERING_ESCROW_ADDRESS
NEXT_PUBLIC_REVENUE_DISTRIBUTOR_ADDRESS
NEXT_PUBLIC_MOCK_IDR_ADDRESS
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

No frontend fallback address is permitted.

## Live acceptance sequence

- [ ] Apply the Supabase migration and verify RLS/storage behavior live.
- [ ] Create the Villa Nusa draft and upload all synthetic PDFs.
- [ ] Create and bind the on-chain asset.
- [ ] Complete distinct legal and valuation attestations.
- [ ] Prove finalization fails before both attestations and succeeds afterward.
- [ ] Register the agreement and reach `ISSUANCE_READY`.
- [ ] Link AVNUSA and create the exact 3,000,000,000 mIDR offering.
- [ ] Approve two investors and fund the target without hardcoded balances.
- [ ] Claim 150,000 AVNUSA per investor and release funds atomically.
- [ ] Publish a funded, attested 100,000,000 mIDR revenue epoch.
- [ ] Claim exact pro-rata revenue and close the epoch.
- [ ] Run the state validator and capture all deployment/action transaction
      references.
- [ ] Run production browser smoke tests with the final hosted configuration.

The project is not final merely because deployment succeeds. Completion
requires the entire receipt-backed Villa Nusa flow and the final report listed
in the PRD.
