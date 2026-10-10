/**
 * Frozen RevenueDistributor ABI.
 * Source of truth: docs/INTERFACES.md, "Solidity ABI contract".
 */

export const revenueDistributorAbi = [
  // ---- writes ----
  {
    type: "function",
    name: "publishRevenue",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "propertyToken", type: "address" },
      { name: "paymentToken", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "claimDeadline", type: "uint64" },
    ],
    outputs: [{ name: "epochId", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimRevenue",
    stateMutability: "nonpayable",
    inputs: [{ name: "epochId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "closeRevenueEpoch",
    stateMutability: "nonpayable",
    inputs: [{ name: "epochId", type: "uint256" }],
    outputs: [],
  },
  // ---- views ----
  {
    type: "function",
    name: "getRevenueEpoch",
    stateMutability: "view",
    inputs: [{ name: "epochId", type: "uint256" }],
    outputs: [
      {
        name: "epoch",
        type: "tuple",
        components: [
          { name: "assetId", type: "bytes32" },
          { name: "propertyToken", type: "address" },
          { name: "paymentToken", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "totalSupply", type: "uint256" },
          { name: "claimDeadline", type: "uint64" },
          { name: "funder", type: "address" },
          { name: "claimedAmount", type: "uint256" },
          { name: "closed", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "claimableRevenue",
    stateMutability: "view",
    inputs: [
      { name: "epochId", type: "uint256" },
      { name: "investor", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "revenueClaimed",
    stateMutability: "view",
    inputs: [
      { name: "epochId", type: "uint256" },
      { name: "investor", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  // ---- events ----
  {
    type: "event",
    name: "RevenuePublished",
    inputs: [
      { name: "epochId", type: "uint256", indexed: true },
      { name: "assetId", type: "bytes32", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "evidenceHash", type: "bytes32", indexed: false },
      { name: "claimDeadline", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RevenueClaimed",
    inputs: [
      { name: "epochId", type: "uint256", indexed: true },
      { name: "investor", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;
