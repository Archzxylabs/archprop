# ARCHPROP Frontend Handoff

This document is the working boundary for the public UI/UX branch. The frozen
product and protocol contracts remain in `PRD.md`, `SYSTEM.md`, and
`docs/INTERFACES.md`.

## Current frontend baseline

The accepted baseline already provides:

- responsive marketplace and property presentation;
- an EIP-1193 wallet connection for Arbitrum Sepolia (`421614`);
- fail-closed public chain configuration;
- live Villa Nusa offering and investor reads;
- receipt-confirmed mIDR approval and investment writes;
- duplicate-write and unresolved-receipt protection;
- transaction hashes and Arbiscan links only after a real broadcast;
- mandatory synthetic-data, mIDR, and land-title disclosures.

Do not replace these flows with mock balances, timers, fabricated hashes, or
optimistic success states.

## P0 frontend gaps

These are functional gaps, not visual polish:

1. Owner authentication and draft creation through `POST /api/properties`.
2. Owner `createAsset` wallet write followed by the signed
   `POST /api/properties/:id/bind-chain` request.
3. Private synthetic PDF upload and owner document progress.
4. Verifier evidence discovery/access using the frozen signed-message helpers,
   followed by real `submitAttestation` or `rejectAsset` wallet writes.
5. Guided agreement registration, issuance readiness, token linking, and
   offering creation for the authorized demo operator/structurer.
6. Investor token claim, live portfolio balance, revenue epoch discovery, and
   receipt-confirmed revenue claim.
7. Demo operator controls for investor approval and revenue publication without
   owner self-verification or server-held user keys.

Do not display any item above as available until its live prerequisite and
receipt path exist.

## UI/UX scope for the public branch

Safe presentation work includes:

- typography, spacing, color, imagery, and layout;
- responsive navigation and page composition;
- accessible focus, labels, empty states, and loading/error presentation;
- marketplace cards and the six-section Villa Nusa detail hierarchy;
- transaction progress presentation that consumes the existing truthful state;
- owner, verifier, portfolio, and admin visual structure.

Keep these files and contracts unchanged unless the orchestrator approves an
interface request:

- `packages/contracts/**`;
- `packages/chain/**` ABIs and enum ordering;
- `packages/shared/**` types and signed-message formats;
- `apps/web/app/api/**` and `apps/web/lib/server/**`;
- `supabase/**`;
- root dependency/configuration files;
- `docs/INTERFACES.md` and `docs/DECISIONS.md`.

## Product invariants to preserve

- Villa Nusa asset key: `ARCHPROP-001` / its frozen `bytes32` hash.
- Indicative value: `10,000,000,000` mIDR.
- Offering target: `3,000,000,000` mIDR.
- Supply: `300,000` AVNUSA with zero decimals.
- Token price: `10,000` mIDR.
- Economic rights: `30%`.
- Chain: Arbitrum Sepolia `421614` only; Anvil is test-only.
- Token ownership means economic participation, not legal land title.
- Every verification and revenue claim is visibly synthetic/simulated.

## Branch workflow

```bash
git switch main
git pull --ff-only
git switch -c frontend-ui-ux
pnpm install
pnpm --filter @archprop/web test
pnpm --filter @archprop/web typecheck
pnpm --filter @archprop/web lint
pnpm --filter @archprop/web build
```

Commit generated output, `.env*`, credentials, local deployment JSON, and local
lockfiles only if the orchestrator explicitly approves them. Submit the UI work
through a pull request; do not push directly to `main`.

## Review gate

The handoff is acceptable when:

- no route or required six-section order disappears;
- no disabled action falsely claims completion;
- keyboard focus remains visible and ordered;
- no horizontal overflow appears at 320, 375, 768, 1024, or 1440 pixels;
- configured/unconfigured, loading, empty, wrong-network, rejected, reverted,
  and receipt-unknown states are visibly distinct;
- the full frontend test, typecheck, lint, and production build commands pass.
