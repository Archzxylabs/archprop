/**
 * Frozen IdentityRegistry ABI.
 * Source of truth: docs/INTERFACES.md, "Solidity ABI contract".
 */

export const identityRegistryAbi = [
  {
    type: "function",
    name: "isApproved",
    stateMutability: "view",
    inputs: [{ name: "investor", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "setInvestorApproval",
    stateMutability: "nonpayable",
    inputs: [
      { name: "investor", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "InvestorApprovalChanged",
    inputs: [
      { name: "investor", type: "address", indexed: true },
      { name: "approved", type: "bool", indexed: false },
    ],
  },
] as const;
