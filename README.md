# ARCHPROP

ARCHPROP is a verification-gated real-world asset (RWA) property investment
marketplace for Arbitrum Sepolia. A property cannot reach issuance until
independent demo verifiers attest its required real-world claims on-chain.

> Hackathon Demo — Synthetic / Simulated Data

The application uses synthetic property documents, simulated verification,
demo investor approval, and `mIDR` demo currency with no real monetary value.
AVNUSA represents defined economic-participation rights; it does not represent
direct legal title to land.

## Golden path

```text
Villa Nusa submission
→ ownership and valuation attestations
→ verification gate
→ economic-rights agreement
→ AVNUSA issuance
→ offering and escrow investment
→ token claim
→ funded revenue epoch
→ investor revenue claim
```

The target network is Arbitrum Sepolia (`421614`). Local Anvil is used only for
development and integration tests.

## Repository

```text
apps/web/           Next.js marketplace and API routes
packages/contracts/ Solidity contracts and Foundry tests
packages/chain/     Typed viem ABIs and chain readers
packages/shared/    Shared types and signed-message builders
scripts/            Local deployment, seeding, and state validation
supabase/           PostgreSQL migration and synthetic PDF fixtures
tests/e2e/          Local golden-path and shared-testnet guards
docs/               Frozen interfaces, decisions, ownership, and task board
```

Read `PRD.md`, `SYSTEM.md`, and `docs/INTERFACES.md` before changing protocol
behavior. The blockchain is authoritative for lifecycle and economic state;
PostgreSQL is presentation metadata and cache only.

## Prerequisites

- Node.js 22 or newer
- pnpm `12.9.1` (declared in `package.json`)
- Foundry (`forge`, `anvil`, and `cast`) for contract work and local E2E

## Setup

```bash
corepack enable
pnpm install
cp .env.example .env.local
pnpm --filter @archprop/web dev
```

Fill `.env.local` with your own public Arbitrum Sepolia RPC endpoint, deployed
contract addresses, and Supabase configuration. Never commit `.env.local`,
private keys, service-role credentials, or deployment secrets.

The web client fails closed when required public chain configuration is missing
or malformed. No fallback contract addresses are embedded in the application.

## Verification

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build

cd packages/contracts
forge fmt --check
forge build
forge test
```

The local Anvil golden path is opt-in and requires compiled Foundry artifacts:

```bash
anvil
ARCHPROP_RUN_LOCAL_E2E=1 pnpm --dir tests/e2e test
```

The default E2E suite does not broadcast to a shared chain. Arbitrum Sepolia
deployment must be explicitly authorized and its addresses and transaction
references recorded in `docs/DEPLOYMENTS.md`.

## Collaboration

Use short-lived branches from `main` and merge through pull requests. Keep
contract ABIs, lifecycle enums, API schemas, numeric constants, and runtime
variable names aligned with `docs/INTERFACES.md`. Do not commit generated build
output, local deployment JSON, credentials, or private keys.
