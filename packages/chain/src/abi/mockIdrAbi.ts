/**
 * Frozen MockIDR ABI.
 * Source of truth: docs/INTERFACES.md, "Solidity ABI contract".
 *
 * MockIDR is demo-only currency with zero decimals. It has no real monetary
 * value and must never be labelled otherwise in UI or scripts.
 */

export const mockIdrAbi = [
  // ---- writes ----
  {
    type: "function",
    name: "faucet",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  // ---- ERC20 reads ----
  // docs/INTERFACES.md permits implementations to add read helpers. MockIDR is
  // a zero-decimals ERC20, so the standard read surface is declared here.
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  // ---- events ----
  {
    type: "event",
    name: "DemoMint",
    inputs: [
      { name: "recipient", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;
