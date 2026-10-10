# ARCHPROP Smart Contracts

Core Solidity protocol contracts for the ARCHPROP Real World Asset (RWA) marketplace on Arbitrum Sepolia.

## Protocol Invariants & Rules

1. **No verification, no issuance:** Assets start at `SUBMITTED`. Independent verifiers submit on-chain attestations (`OWNERSHIP` by `LEGAL_VERIFIER_ROLE` with value 0, `VALUATION` by `VALUATION_VERIFIER_ROLE` with nonzero value). Verification can only be finalized once both attestations exist. Issuance readiness requires verification and a registered economic-rights agreement.
2. **Fixed supply, constructor mint only:** `PropertyToken` mints its entire fixed supply to `OfferingEscrow` in the constructor. There is no `mintToEscrow` or owner mint path. Both `PropertyToken` and `MockIDR` use **0 decimals** (exact integer units).
3. **Identity approval gate:** Only `DEFAULT_ADMIN_ROLE` can approve investors in `IdentityRegistry`. `PropertyToken` permits transfers to/from `OfferingEscrow`, freezes all transfers during active revenue epochs, and restricts all other transfers to approved investors.
4. **Escrow accounting & atomic activation:** `OfferingEscrow` enforces `target == totalSupply * tokenPrice`, bounded whole-token investments, and releases funds to the issuer treasury while atomically activating the asset (`FUNDED -> ACTIVE`).
5. **Attested revenue distribution:** `RevenueDistributor` requires a matching `REVENUE` attestation on an `ACTIVE` asset, single-use evidence hash, exact token funding, and wires to `PropertyToken` to freeze transfers during the epoch. Unclaimed dust is returned to the funder upon epoch closure after deadline.

## Contracts Overview

| Contract | Description |
| --- | --- |
| `ArchpropRegistry` | Canonical lifecycle authority and attestation registry |
| `IdentityRegistry` | Investor whitelist / approval gate |
| `MockIDR` | Valueless whole-unit demo currency with bounded faucet |
| `PropertyToken` | Fractional economic-rights ERC-20 token (zero decimals) |
| `OfferingEscrow` | Primary offering escrow with whole-token allocation and refund paths |
| `RevenueDistributor` | Pro-rata revenue distribution with transfer lock and single-use evidence |

## Pinned Dependencies

The protocol depends on pinned library releases:
- **OpenZeppelin Contracts:** `5.5.0` (tag `v5.5.0`)
- **forge-std:** `1.11.0` (tag `v1.11.0`)

Note: In accordance with repository policy, `lib/` is gitignored and excluded from version control.

## Local Bootstrap Instructions

To bootstrap the local dependencies from scratch within `packages/contracts`:

```bash
cd packages/contracts

# Method 1: Using forge install
forge install OpenZeppelin/openzeppelin-contracts@v5.5.0 --no-git --no-commit
forge install foundry-rs/forge-std@v1.11.0 --no-git --no-commit

# Method 2: Using git clone into lib/
mkdir -p lib
git clone --depth 1 --branch v5.5.0 https://github.com/OpenZeppelin/openzeppelin-contracts.git lib/openzeppelin-contracts
git clone --depth 1 --branch v1.11.0 https://github.com/foundry-rs/forge-std.git lib/forge-std
```

Remappings are resolved automatically or via standard Foundry configuration:
```text
@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
forge-std/=lib/forge-std/src/
openzeppelin-contracts/=lib/openzeppelin-contracts/
```

## Verification & Testing

Run the standard suite from `packages/contracts`:

```bash
# Verify formatting
forge fmt --check

# Compile contracts
forge build

# Execute test suite with verbosity
forge test -vvv
```
