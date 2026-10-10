/**
 * Frozen OfferingEscrow ABI.
 * Source of truth: docs/INTERFACES.md, "Solidity ABI contract".
 */

export const offeringEscrowAbi = [
  // ---- writes ----
  {
    type: "function",
    name: "createOffering",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "propertyToken", type: "address" },
      { name: "paymentToken", type: "address" },
      { name: "target", type: "uint256" },
      { name: "tokenPrice", type: "uint256" },
      { name: "deadline", type: "uint64" },
      { name: "issuerTreasury", type: "address" },
    ],
    outputs: [{ name: "offeringId", type: "uint256" }],
  },
  {
    type: "function",
    name: "invest",
    stateMutability: "nonpayable",
    inputs: [
      { name: "offeringId", type: "uint256" },
      { name: "paymentAmount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "finalizeSuccessfulOffering",
    stateMutability: "nonpayable",
    inputs: [{ name: "offeringId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "failOffering",
    stateMutability: "nonpayable",
    inputs: [{ name: "offeringId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claimTokens",
    stateMutability: "nonpayable",
    inputs: [{ name: "offeringId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claimRefund",
    stateMutability: "nonpayable",
    inputs: [{ name: "offeringId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "releaseFunds",
    stateMutability: "nonpayable",
    inputs: [{ name: "offeringId", type: "uint256" }],
    outputs: [],
  },
  // ---- views ----
  {
    type: "function",
    name: "getOffering",
    stateMutability: "view",
    inputs: [{ name: "offeringId", type: "uint256" }],
    outputs: [
      {
        name: "offering",
        type: "tuple",
        components: [
          { name: "assetId", type: "bytes32" },
          { name: "propertyToken", type: "address" },
          { name: "paymentToken", type: "address" },
          { name: "target", type: "uint256" },
          { name: "tokenPrice", type: "uint256" },
          { name: "deadline", type: "uint64" },
          { name: "raised", type: "uint256" },
          { name: "issuerTreasury", type: "address" },
          { name: "status", type: "uint8" },
          { name: "fundsReleased", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "allocationOf",
    stateMutability: "view",
    inputs: [
      { name: "offeringId", type: "uint256" },
      { name: "investor", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "paymentOf",
    stateMutability: "view",
    inputs: [
      { name: "offeringId", type: "uint256" },
      { name: "investor", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "tokensClaimed",
    stateMutability: "view",
    inputs: [
      { name: "offeringId", type: "uint256" },
      { name: "investor", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "refundClaimed",
    stateMutability: "view",
    inputs: [
      { name: "offeringId", type: "uint256" },
      { name: "investor", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  // ---- events ----
  {
    type: "event",
    name: "OfferingCreated",
    inputs: [
      { name: "offeringId", type: "uint256", indexed: true },
      { name: "assetId", type: "bytes32", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "target", type: "uint256", indexed: false },
      { name: "tokenPrice", type: "uint256", indexed: false },
      { name: "deadline", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "InvestmentMade",
    inputs: [
      { name: "offeringId", type: "uint256", indexed: true },
      { name: "investor", type: "address", indexed: true },
      { name: "paymentAmount", type: "uint256", indexed: false },
      { name: "allocation", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OfferingFunded",
    inputs: [
      { name: "offeringId", type: "uint256", indexed: true },
      { name: "raised", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OfferingFailed",
    inputs: [
      { name: "offeringId", type: "uint256", indexed: true },
      { name: "raised", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TokensClaimed",
    inputs: [
      { name: "offeringId", type: "uint256", indexed: true },
      { name: "investor", type: "address", indexed: true },
      { name: "allocation", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RefundClaimed",
    inputs: [
      { name: "offeringId", type: "uint256", indexed: true },
      { name: "investor", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FundsReleased",
    inputs: [
      { name: "offeringId", type: "uint256", indexed: true },
      { name: "treasury", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;
