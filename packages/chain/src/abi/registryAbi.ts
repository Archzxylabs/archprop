/**
 * Frozen ArchpropRegistry ABI.
 *
 * Source of truth: docs/INTERFACES.md, "Solidity ABI contract".
 * Every entry and event below is transcribed verbatim from that document.
 * Do not add, rename, reorder, or remove entries; interface changes require an
 * interface-change request in docs/DECISIONS.md and orchestrator approval.
 */

export const archpropRegistryAbi = [
  // ---- writes ----
  {
    type: "function",
    name: "createAsset",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "metadataHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "beginVerification",
    stateMutability: "nonpayable",
    inputs: [{ name: "assetId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "submitAttestation",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "kind", type: "uint8" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "value", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "rejectAsset",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "kind", type: "uint8" },
      { name: "evidenceHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "finalizeVerification",
    stateMutability: "nonpayable",
    inputs: [{ name: "assetId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "registerAgreement",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "agreementHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "markIssuanceReady",
    stateMutability: "nonpayable",
    inputs: [{ name: "assetId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "linkToken",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "token", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setEscrow",
    stateMutability: "nonpayable",
    inputs: [{ name: "escrow", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "transitionFromEscrow",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "status", type: "uint8" },
    ],
    outputs: [],
  },
  // ---- views ----
  {
    type: "function",
    name: "isRevenueAttestationValid",
    stateMutability: "view",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "assetStatus",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "bytes32" }],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "assetToken",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "assetOwner",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getAsset",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "bytes32" }],
    outputs: [
      {
        name: "asset",
        type: "tuple",
        components: [
          { name: "owner", type: "address" },
          { name: "metadataHash", type: "bytes32" },
          { name: "agreementHash", type: "bytes32" },
          { name: "status", type: "uint8" },
          { name: "token", type: "address" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getLatestAttestation",
    stateMutability: "view",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "kind", type: "uint8" },
    ],
    outputs: [
      {
        name: "attestation",
        type: "tuple",
        components: [
          { name: "verifier", type: "address" },
          { name: "attestationType", type: "uint8" },
          { name: "evidenceHash", type: "bytes32" },
          { name: "value", type: "uint256" },
          { name: "timestamp", type: "uint64" },
          { name: "valid", type: "bool" },
        ],
      },
    ],
  },
  // ---- events ----
  {
    type: "event",
    name: "AssetCreated",
    inputs: [
      { name: "assetId", type: "bytes32", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "metadataHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AttestationSubmitted",
    inputs: [
      { name: "assetId", type: "bytes32", indexed: true },
      { name: "kind", type: "uint8", indexed: true },
      { name: "verifier", type: "address", indexed: true },
      { name: "evidenceHash", type: "bytes32", indexed: false },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AssetRejected",
    inputs: [
      { name: "assetId", type: "bytes32", indexed: true },
      { name: "kind", type: "uint8", indexed: true },
      { name: "verifier", type: "address", indexed: true },
      { name: "evidenceHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AssetVerified",
    inputs: [{ name: "assetId", type: "bytes32", indexed: true }],
  },
  {
    type: "event",
    name: "AgreementRegistered",
    inputs: [
      { name: "assetId", type: "bytes32", indexed: true },
      { name: "agreementHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TokenLinked",
    inputs: [
      { name: "assetId", type: "bytes32", indexed: true },
      { name: "token", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "AssetStatusChanged",
    inputs: [
      { name: "assetId", type: "bytes32", indexed: true },
      { name: "from", type: "uint8", indexed: false },
      { name: "to", type: "uint8", indexed: false },
    ],
  },
] as const;
