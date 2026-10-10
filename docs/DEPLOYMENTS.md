# ARCHPROP Deployment Ledger

**Network:** Arbitrum Sepolia
**Chain ID:** `421614`
**Status:** **NOT DEPLOYED / NOT AUTHORIZED**

> [!IMPORTANT]
> Live deployment to Arbitrum Sepolia requires explicit human orchestrator
> authorization under task DEP-001. No deployment may be initiated without
> verified funded deployer keys and sequential merge of contract, backend, and
> frontend packages. Addresses below must NOT be invented, mocked, or defaulted.
> Local Anvil (31337) ephemeral deployments are never committed to this ledger.

---

## Deployment Metadata

| Field | Value |
| --- | --- |
| **Network** | Arbitrum Sepolia |
| **Chain ID** | `421614` |
| **Deployer Address** | `NOT DEPLOYED / NOT AUTHORIZED` |
| **Deployment Timestamp (UTC)** | `NOT DEPLOYED / NOT AUTHORIZED` |
| **Deployment Block Number** | `NOT DEPLOYED / NOT AUTHORIZED` |
| **Deployment Status** | `NOT DEPLOYED / NOT AUTHORIZED` |

---

## Contract Address Slots

| Contract | Address Slot | Status |
| --- | --- | --- |
| `ArchpropRegistry` | `NOT DEPLOYED / NOT AUTHORIZED` | Pending DEP-001 |
| `IdentityRegistry` | `NOT DEPLOYED / NOT AUTHORIZED` | Pending DEP-001 |
| `MockIDR` | `NOT DEPLOYED / NOT AUTHORIZED` | Pending DEP-001 |
| `OfferingEscrow` | `NOT DEPLOYED / NOT AUTHORIZED` | Pending DEP-001 |
| `RevenueDistributor` | `NOT DEPLOYED / NOT AUTHORIZED` | Pending DEP-001 |
| `PropertyToken` (`AVNUSA` — Villa Nusa) | `NOT DEPLOYED / NOT AUTHORIZED` | Pending DEP-001 |

---

## Deployment Transaction Slots

| Action | Transaction Hash Slot | Status |
| --- | --- | --- |
| `ArchpropRegistry` deployment | `NOT DEPLOYED / NOT AUTHORIZED` | Pending DEP-001 |
| `IdentityRegistry` deployment | `NOT DEPLOYED / NOT AUTHORIZED` | Pending DEP-001 |
| `MockIDR` deployment | `NOT DEPLOYED / NOT AUTHORIZED` | Pending DEP-001 |
| `OfferingEscrow` deployment | `NOT DEPLOYED / NOT AUTHORIZED` | Pending DEP-001 |
| `RevenueDistributor` deployment | `NOT DEPLOYED / NOT AUTHORIZED` | Pending DEP-001 |
| `PropertyToken` deployment | `NOT DEPLOYED / NOT AUTHORIZED` | Pending DEP-001 |
| `ArchpropRegistry.setEscrow` | `NOT DEPLOYED / NOT AUTHORIZED` | Pending DEP-001 |

---

## Verification Checklist (DEP-001)

- [ ] Human dispatcher explicit authorization recorded in `docs/DECISIONS.md`.
- [ ] Funded Arbitrum Sepolia deployer key provided through secure non-repo environment.
- [ ] All contracts deployed and verified on Arbiscan Sepolia.
- [ ] Initial role grants confirmed on-chain:
  - `ArchpropRegistry.setEscrow(OfferingEscrow)` confirmed.
  - `LEGAL_VERIFIER_ROLE` granted to demo legal verifier.
  - `VALUATION_VERIFIER_ROLE` granted to demo valuation verifier.
  - `REVENUE_VERIFIER_ROLE` granted to demo revenue verifier.
  - `STRUCTURER_ROLE` granted to demo structurer on Registry and Escrow.
- [ ] `.env.example` addresses populated in web/server environments without invention or drift.
