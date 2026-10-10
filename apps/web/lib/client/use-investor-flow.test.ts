import { describe, expect, it, vi } from "vitest";
import type { Address, PublicClient, WalletClient } from "viem";
import type { DerivedOffering, InvestorChainState } from "./chain-client";
import {
  BroadcastFailedError,
  ReceiptUnavailableError,
  SimulationFailedError,
  StaleReadGuard,
  TransactionRevertedError,
  canResetInvestorTx,
  commitInvestorTxState,
  deriveInvestorAction,
  evaluateInvestorWriteGuard,
  evaluateWriteBoundary,
  executeApproveTransaction,
  executeInvestTransaction,
  initialInvestorTxState,
  loadInvestorSnapshot,
  mapWriteErrorToTxState,
  reduceDuplicateWriteAttempt,
  reduceResetTxState,
  type InvestorSnapshot,
  type InvestorTxState,
} from "./use-investor-flow";

const INVESTOR_A = "0x6666666666666666666666666666666666666666" as const;
const INVESTOR_B = "0xaaaa000000000000000000000000000000000001" as const;
const CANONICAL_ASSET_ID =
  "0x1756428cf9ce005285ddcf87c75240c798535bed95c6aeca6a5a7d3eb7b364ae" as const;
const ADDRESSES = {
  registry: "0x1111111111111111111111111111111111111111" as const,
  identityRegistry: "0x2222222222222222222222222222222222222222" as const,
  mockIdr: "0x3333333333333333333333333333333333333333" as const,
  offeringEscrow: "0x4444444444444444444444444444444444444444" as const,
};

function openOffering(overrides: Partial<DerivedOffering> = {}): DerivedOffering {
  return {
    offeringId: 1n,
    assetId: CANONICAL_ASSET_ID,
    propertyToken: "0x7777777777777777777777777777777777777777" as const,
    paymentToken: ADDRESSES.mockIdr,
    target: 3_000_000_000n,
    tokenPrice: 10_000n,
    deadline: 4_000_000_000n,
    raised: 0n,
    issuerTreasury: "0x8888888888888888888888888888888888888888" as const,
    status: "OPEN",
    statusCode: 0,
    fundsReleased: false,
    remainingCap: 3_000_000_000n,
    ...overrides,
  };
}

function investorState(
  address: Address,
  overrides: Partial<InvestorChainState> = {},
): InvestorChainState {
  return {
    address,
    isApproved: true,
    mIdrBalance: 50_000_000n,
    allowance: 0n,
    allocation: 0n,
    payment: 0n,
    ...overrides,
  };
}

describe("executeApproveTransaction", () => {
  const investorAddress = "0x6666666666666666666666666666666666666666" as const;
  const mockIdrAddress = "0x3333333333333333333333333333333333333333" as const;
  const escrowAddress = "0x4444444444444444444444444444444444444444" as const;
  const dummyTxHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as const;

  it("rejects transactions when connected to any chain other than Arbitrum Sepolia (421614)", async () => {
    const mockPublicClient = {} as PublicClient;
    const mockWalletClient = {} as WalletClient;

    await expect(
      executeApproveTransaction({
        publicClient: mockPublicClient,
        walletClient: mockWalletClient,
        mockIdrAddress,
        escrowAddress,
        investorAddress,
        chainId: 1, // Ethereum mainnet
        amount: 1_000_000n,
      }),
    ).rejects.toThrow(/Wrong network: connected to chain 1, expected Arbitrum Sepolia \(421614\)/);
  });

  it("simulates, writes approve, and resolves with txHash upon successful receipt", async () => {
    const simulateMock = vi.fn(async () => ({}));
    const waitForReceiptMock = vi.fn(async () => ({ status: "success" }));
    const writeContractMock = vi.fn(async () => dummyTxHash);

    const mockPublicClient = {
      chain: { id: 421614 },
      simulateContract: simulateMock,
      waitForTransactionReceipt: waitForReceiptMock,
    } as unknown as PublicClient;

    const mockWalletClient = {
      writeContract: writeContractMock,
    } as unknown as WalletClient;

    const txHash = await executeApproveTransaction({
      publicClient: mockPublicClient,
      walletClient: mockWalletClient,
      mockIdrAddress,
      escrowAddress,
      investorAddress,
      chainId: 421614,
      amount: 1_000_000n,
    });

    expect(txHash).toBe(dummyTxHash);
    expect(simulateMock).toHaveBeenCalledTimes(1);
    expect(writeContractMock).toHaveBeenCalledWith({
      address: mockIdrAddress,
      abi: expect.any(Array),
      functionName: "approve",
      args: [escrowAddress, 1_000_000n],
      account: investorAddress,
      chain: { id: 421614 },
    });
    expect(waitForReceiptMock).toHaveBeenCalledWith({ hash: dummyTxHash });
  });

  it("throws and fails closed when approve transaction reverts on-chain", async () => {
    const mockPublicClient = {
      chain: { id: 421614 },
      simulateContract: vi.fn(async () => ({})),
      waitForTransactionReceipt: vi.fn(async () => ({ status: "reverted" })),
    } as unknown as PublicClient;

    const mockWalletClient = {
      writeContract: vi.fn(async () => dummyTxHash),
    } as unknown as WalletClient;

    await expect(
      executeApproveTransaction({
        publicClient: mockPublicClient,
        walletClient: mockWalletClient,
        mockIdrAddress,
        escrowAddress,
        investorAddress,
        chainId: 421614,
        amount: 1_000_000n,
      }),
    ).rejects.toThrow("Approval transaction reverted on-chain.");
  });
});

describe("executeInvestTransaction", () => {
  const investorAddress = "0x6666666666666666666666666666666666666666" as const;
  const escrowAddress = "0x4444444444444444444444444444444444444444" as const;
  const dummyTxHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as const;

  it("rejects investment when connected to wrong chain", async () => {
    const mockPublicClient = {} as PublicClient;
    const mockWalletClient = {} as WalletClient;

    await expect(
      executeInvestTransaction({
        publicClient: mockPublicClient,
        walletClient: mockWalletClient,
        escrowAddress,
        investorAddress,
        chainId: 11155111, // Ethereum Sepolia
        offeringId: 42n,
        amount: 1_000_000n,
      }),
    ).rejects.toThrow(/Wrong network/);
  });

  it("simulates, writes invest, and resolves with txHash upon confirmed receipt", async () => {
    const simulateMock = vi.fn(async () => ({}));
    const waitForReceiptMock = vi.fn(async () => ({ status: "success" }));
    const writeContractMock = vi.fn(async () => dummyTxHash);

    const mockPublicClient = {
      chain: { id: 421614 },
      simulateContract: simulateMock,
      waitForTransactionReceipt: waitForReceiptMock,
    } as unknown as PublicClient;

    const mockWalletClient = {
      writeContract: writeContractMock,
    } as unknown as WalletClient;

    const txHash = await executeInvestTransaction({
      publicClient: mockPublicClient,
      walletClient: mockWalletClient,
      escrowAddress,
      investorAddress,
      chainId: 421614,
      offeringId: 42n,
      amount: 1_000_000n,
    });

    expect(txHash).toBe(dummyTxHash);
    expect(simulateMock).toHaveBeenCalledTimes(1);
    expect(writeContractMock).toHaveBeenCalledWith({
      address: escrowAddress,
      abi: expect.any(Array),
      functionName: "invest",
      args: [42n, 1_000_000n],
      account: investorAddress,
      chain: { id: 421614 },
    });
    expect(waitForReceiptMock).toHaveBeenCalledWith({ hash: dummyTxHash });
  });

  it("throws and fails closed when investment transaction reverts on-chain", async () => {
    const mockPublicClient = {
      chain: { id: 421614 },
      simulateContract: vi.fn(async () => ({})),
      waitForTransactionReceipt: vi.fn(async () => ({ status: "reverted" })),
    } as unknown as PublicClient;

    const mockWalletClient = {
      writeContract: vi.fn(async () => dummyTxHash),
    } as unknown as WalletClient;

    await expect(
      executeInvestTransaction({
        publicClient: mockPublicClient,
        walletClient: mockWalletClient,
        escrowAddress,
        investorAddress,
        chainId: 421614,
        offeringId: 42n,
        amount: 1_000_000n,
      }),
    ).rejects.toThrow("Investment transaction reverted on-chain.");
  });
});

describe("transaction phase discipline", () => {
  const investorAddress = INVESTOR_A;
  const mockIdrAddress = ADDRESSES.mockIdr;
  const escrowAddress = ADDRESSES.offeringEscrow;
  const dummyTxHash =
    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as const;

  /** Lets every pending microtask (simulate → broadcast) run. */
  const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("stops the write when the contract simulation fails", async () => {
    const writeContractMock = vi.fn(async () => dummyTxHash);
    const mockPublicClient = {
      chain: { id: 421614 },
      simulateContract: vi.fn(async () => {
        throw new Error("execution reverted: allowance");
      }),
      waitForTransactionReceipt: vi.fn(),
    } as unknown as PublicClient;
    const mockWalletClient = { writeContract: writeContractMock } as unknown as WalletClient;

    const attempt = executeApproveTransaction({
      publicClient: mockPublicClient,
      walletClient: mockWalletClient,
      mockIdrAddress,
      escrowAddress,
      investorAddress,
      chainId: 421614,
      amount: 1_000_000n,
    });

    await expect(attempt).rejects.toThrow(SimulationFailedError);
    await expect(
      executeApproveTransaction({
        publicClient: mockPublicClient,
        walletClient: mockWalletClient,
        mockIdrAddress,
        escrowAddress,
        investorAddress,
        chainId: 421614,
        amount: 1_000_000n,
      }),
    ).rejects.toThrow(/wallet write was not sent, so nothing was broadcast/);

    // A failed simulation must never reach the wallet.
    expect(writeContractMock).not.toHaveBeenCalled();
    expect(mockPublicClient.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it("stops an invest write when its simulation fails", async () => {
    const writeContractMock = vi.fn(async () => dummyTxHash);
    const mockPublicClient = {
      chain: { id: 421614 },
      simulateContract: vi.fn(async () => {
        throw new Error("execution reverted: cap reached");
      }),
    } as unknown as PublicClient;
    const mockWalletClient = { writeContract: writeContractMock } as unknown as WalletClient;

    await expect(
      executeInvestTransaction({
        publicClient: mockPublicClient,
        walletClient: mockWalletClient,
        escrowAddress,
        investorAddress,
        chainId: 421614,
        offeringId: 1n,
        amount: 1_000_000n,
      }),
    ).rejects.toThrow(SimulationFailedError);

    expect(writeContractMock).not.toHaveBeenCalled();
  });

  it("reports failure without a hash when the wallet rejects before broadcast", async () => {
    const mockPublicClient = {
      chain: { id: 421614 },
      simulateContract: vi.fn(async () => ({})),
      waitForTransactionReceipt: vi.fn(),
    } as unknown as PublicClient;
    const mockWalletClient = {
      writeContract: vi.fn(async () => {
        throw new Error("User rejected the request.");
      }),
    } as unknown as WalletClient;

    const attempt = executeApproveTransaction({
      publicClient: mockPublicClient,
      walletClient: mockWalletClient,
      mockIdrAddress,
      escrowAddress,
      investorAddress,
      chainId: 421614,
      amount: 1_000_000n,
    });

    await expect(attempt).rejects.toThrow(BroadcastFailedError);
    const error = (await attempt.catch((caught: unknown) => caught)) as BroadcastFailedError;
    expect(error.txHash).toBeNull();
    expect(mockPublicClient.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it("captures the hash immediately after broadcast, before the receipt is read", async () => {
    const phases: Array<{ phase: string; txHash: string }> = [];
    let resolveReceipt: ((value: { status: string }) => void) | undefined;
    const receipt = new Promise<{ status: string }>((resolve) => {
      resolveReceipt = resolve;
    });

    const mockPublicClient = {
      chain: { id: 421614 },
      simulateContract: vi.fn(async () => ({})),
      waitForTransactionReceipt: vi.fn(() => receipt),
    } as unknown as PublicClient;
    const mockWalletClient = {
      writeContract: vi.fn(async () => dummyTxHash),
    } as unknown as WalletClient;

    const pending = executeApproveTransaction({
      publicClient: mockPublicClient,
      walletClient: mockWalletClient,
      mockIdrAddress,
      escrowAddress,
      investorAddress,
      chainId: 421614,
      amount: 1_000_000n,
      onPhase: (update) => phases.push(update),
    });

    // The receipt has not resolved, yet the hash is already reported.
    await flushMicrotasks();
    expect(phases).toEqual([
      { phase: "submitted", txHash: dummyTxHash },
      { phase: "confirming", txHash: dummyTxHash },
    ]);

    resolveReceipt?.({ status: "success" });
    await expect(pending).resolves.toBe(dummyTxHash);
  });

  it("keeps the hash and reports an unknown outcome when receipt lookup fails", async () => {
    const mockPublicClient = {
      chain: { id: 421614 },
      simulateContract: vi.fn(async () => ({})),
      waitForTransactionReceipt: vi.fn(async () => {
        throw new Error("timed out waiting for receipt");
      }),
    } as unknown as PublicClient;
    const mockWalletClient = {
      writeContract: vi.fn(async () => dummyTxHash),
    } as unknown as WalletClient;

    const attempt = executeInvestTransaction({
      publicClient: mockPublicClient,
      walletClient: mockWalletClient,
      escrowAddress,
      investorAddress,
      chainId: 421614,
      offeringId: 1n,
      amount: 1_000_000n,
    });

    await expect(attempt).rejects.toThrow(ReceiptUnavailableError);
    const error = (await attempt.catch((caught: unknown) => caught)) as ReceiptUnavailableError;
    expect(error.txHash).toBe(dummyTxHash);
    expect(error.message).toContain(dummyTxHash);
    expect(error.message).toMatch(/outcome is unknown/i);
  });

  it("keeps the hash when a receipt reports a reverted transaction", async () => {
    const mockPublicClient = {
      chain: { id: 421614 },
      simulateContract: vi.fn(async () => ({})),
      waitForTransactionReceipt: vi.fn(async () => ({ status: "reverted" })),
    } as unknown as PublicClient;
    const mockWalletClient = {
      writeContract: vi.fn(async () => dummyTxHash),
    } as unknown as WalletClient;

    const attempt = executeApproveTransaction({
      publicClient: mockPublicClient,
      walletClient: mockWalletClient,
      mockIdrAddress,
      escrowAddress,
      investorAddress,
      chainId: 421614,
      amount: 1_000_000n,
    });

    const error = (await attempt.catch((caught: unknown) => caught)) as TransactionRevertedError;
    expect(error).toBeInstanceOf(TransactionRevertedError);
    expect(error.txHash).toBe(dummyTxHash);
  });
});

describe("mapWriteErrorToTxState", () => {
  const hash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as const;
  const amount = 1_000_000n;

  it("never reports a pre-broadcast failure as confirmed and carries no hash", () => {
    const state = mapWriteErrorToTxState(
      new SimulationFailedError("simulation reverted", "approve", null),
      "approve",
      amount,
    );
    expect(state.phase).toBe("failed");
    expect(state.action).toBe("approve");
    expect(state.amount).toBe(amount);
    expect(state.txHash).toBeNull();
  });

  it("retains the hash for a receipt that could not be read and does not call it failed", () => {
    const state = mapWriteErrorToTxState(
      new ReceiptUnavailableError("receipt unavailable", "invest", hash),
      "invest",
      amount,
    );
    expect(state.phase).toBe("receipt-unknown");
    expect(state.txHash).toBe(hash);
    expect(state.action).toBe("invest");
    expect(state.error).not.toMatch(/unchanged/i);
  });

  it("labels a mined-and-reverted transaction as reverted, keeping its hash", () => {
    const state = mapWriteErrorToTxState(
      new TransactionRevertedError("reverted", "invest", hash),
      "invest",
      amount,
    );
    expect(state.phase).toBe("reverted");
    expect(state.txHash).toBe(hash);
  });

  it("falls back to a hashless failure for an unexpected error", () => {
    const state = mapWriteErrorToTxState(new Error("boom"), "approve", amount);
    expect(state.phase).toBe("failed");
    expect(state.txHash).toBeNull();
    expect(state.error).toBe("boom");
  });
});

describe("StaleReadGuard and loadInvestorSnapshot", () => {
  const assetId = CANONICAL_ASSET_ID;

  function mockClient(investorAddress: Address, delayMs = 0): PublicClient {
    return {
      getLogs: vi.fn(async () => [
        {
          args: {
            offeringId: 1n,
            assetId,
            token: "0x7777777777777777777777777777777777777777",
            target: 3_000_000_000n,
            tokenPrice: 10_000n,
            deadline: 4_000_000_000n,
          },
        },
      ]),
      readContract: vi.fn(async (params: { functionName: string }) => {
        switch (params.functionName) {
          case "getOffering":
            return {
              assetId,
              propertyToken: "0x7777777777777777777777777777777777777777",
              paymentToken: ADDRESSES.mockIdr,
              target: 3_000_000_000n,
              tokenPrice: 10_000n,
              deadline: 4_000_000_000n,
              raised: 0n,
              issuerTreasury: "0x8888888888888888888888888888888888888888",
              status: 0,
              fundsReleased: false,
            };
          case "assetToken":
            return "0x7777777777777777777777777777777777777777";
          case "isApproved": {
            if (delayMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
            return investorAddress === INVESTOR_A;
          }
          case "balanceOf":
            return 50_000_000n;
          case "allowance":
            return 0n;
          case "allocationOf":
            return 0n;
          case "paymentOf":
            return 0n;
          default:
            throw new Error(`Unexpected contract call: ${params.functionName}`);
        }
      }),
    } as unknown as PublicClient;
  }

  it("drops an in-flight read when the wallet changes mid-flight", async () => {
    const guard = new StaleReadGuard();
    const applied: InvestorSnapshot[] = [];
    const errors: string[] = [];

    const slowForWalletA = loadInvestorSnapshot({
      client: mockClient(INVESTOR_A, 30),
      addresses: ADDRESSES,
      assetId,
      walletAddress: INVESTOR_A,
      guard,
      onSnapshot: (snapshot) => applied.push(snapshot),
      onError: (reason) => errors.push(reason),
    });

    // The investor switches before wallet A's investor read lands.
    const fastForWalletB = loadInvestorSnapshot({
      client: mockClient(INVESTOR_B, 0),
      addresses: ADDRESSES,
      assetId,
      walletAddress: INVESTOR_B,
      guard,
      onSnapshot: (snapshot) => applied.push(snapshot),
      onError: (reason) => errors.push(reason),
    });

    await Promise.all([slowForWalletA, fastForWalletB]);

    expect(applied).toHaveLength(1);
    expect(applied[0]?.walletAddress).toBe(INVESTOR_B);
    expect(applied[0]?.investor?.address).toBe(INVESTOR_B);
    expect(errors).toEqual([]);
  });

  it("keeps only the newest refresh when two refreshes overlap", async () => {
    const guard = new StaleReadGuard();
    const applied: InvestorSnapshot[] = [];

    const first = loadInvestorSnapshot({
      client: mockClient(INVESTOR_A, 30),
      addresses: ADDRESSES,
      assetId,
      walletAddress: INVESTOR_A,
      guard,
      onSnapshot: (snapshot) => applied.push(snapshot),
      onError: () => {},
    });
    const second = loadInvestorSnapshot({
      client: mockClient(INVESTOR_A, 0),
      addresses: ADDRESSES,
      assetId,
      walletAddress: INVESTOR_A,
      guard,
      onSnapshot: (snapshot) => applied.push(snapshot),
      onError: () => {},
    });

    await Promise.all([first, second]);

    expect(applied).toHaveLength(1);
  });

  it("reports an error for the current read and stays silent for a superseded one", async () => {
    const guard = new StaleReadGuard();
    const errors: string[] = [];

    const failing = loadInvestorSnapshot({
      client: {
        getLogs: vi.fn(async () => {
          throw new Error("rpc unavailable");
        }),
      } as unknown as PublicClient,
      addresses: ADDRESSES,
      assetId,
      walletAddress: INVESTOR_A,
      guard,
      onSnapshot: () => {},
      onError: (reason) => errors.push(reason),
    });
    const superseding = loadInvestorSnapshot({
      client: mockClient(INVESTOR_A, 0),
      addresses: ADDRESSES,
      assetId,
      walletAddress: INVESTOR_A,
      guard,
      onSnapshot: () => {},
      onError: (reason) => errors.push(reason),
    });

    await Promise.all([failing, superseding]);

    expect(errors).toEqual([]);
  });

  it("does not fall back to a page-provided offering ID the chain does not confirm", async () => {
    const guard = new StaleReadGuard();
    const applied: InvestorSnapshot[] = [];

    await loadInvestorSnapshot({
      client: {
        getLogs: vi.fn(async () => []),
      } as unknown as PublicClient,
      addresses: ADDRESSES,
      assetId,
      offeringId: 7n,
      walletAddress: INVESTOR_A,
      guard,
      onSnapshot: (snapshot) => applied.push(snapshot),
      onError: () => {},
    });

    expect(applied).toHaveLength(1);
    expect(applied[0]?.offering).toBeNull();
    expect(applied[0]?.investor).toBeNull();
  });

  it("reads an offering by its on-chain ID when no asset ID is given", async () => {
    const guard = new StaleReadGuard();
    const applied: InvestorSnapshot[] = [];
    const errors: string[] = [];

    await loadInvestorSnapshot({
      client: mockClient(INVESTOR_A, 0),
      addresses: ADDRESSES,
      offeringId: 1n,
      walletAddress: INVESTOR_A,
      guard,
      onSnapshot: (snapshot) => applied.push(snapshot),
      onError: (reason) => errors.push(reason),
    });

    expect(errors).toEqual([]);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.offering?.offeringId).toBe(1n);
    expect(applied[0]?.investor?.address).toBe(INVESTOR_A);
  });
});

describe("evaluateWriteBoundary (write-boundary rechecks)", () => {
  const base = {
    walletAddress: INVESTOR_A as Address | null,
    chainId: 421614 as number | null,
    amount: 1_000_000n as bigint | null,
    investor: investorState(INVESTOR_A, { allowance: 0n }) as
      | InvestorChainState
      | null,
    offering: openOffering() as DerivedOffering | null,
    txPhase: "idle" as const,
  };

  it("allows an approval when the allowance does not cover the entered amount", () => {
    const decision = evaluateWriteBoundary({ ...base, amount: 1_000_000n });
    expect(decision).toEqual({ canWrite: true, action: "approve", reason: null });
  });

  it("uses the entered amount, not a fixed threshold, to decide approval need", () => {
    // Allowance is above the old hardcoded 1 000 000 threshold but below the
    // amount actually entered, so approval is still required.
    const decision = evaluateWriteBoundary({
      ...base,
      amount: 5_000_000n,
      investor: investorState(INVESTOR_A, { allowance: 2_000_000n }),
    });
    expect(decision.action).toBe("approve");
    expect(decision.canWrite).toBe(true);
  });

  it("switches to invest once the allowance covers the entered amount", () => {
    const decision = evaluateWriteBoundary({
      ...base,
      amount: 1_000_000n,
      investor: investorState(INVESTOR_A, { allowance: 1_000_000n }),
    });
    expect(decision).toEqual({ canWrite: true, action: "invest", reason: null });
  });

  it("requires approval for an amount just above a large allowance", () => {
    const decision = evaluateWriteBoundary({
      ...base,
      amount: 3_000_000n,
      investor: investorState(INVESTOR_A, { allowance: 2_999_999n }),
    });
    expect(decision.action).toBe("approve");
  });

  it("blocks while a transaction outcome is still pending", () => {
    for (const txPhase of [
      "awaiting-signature",
      "submitted",
      "confirming",
      "receipt-unknown",
    ] as const) {
      const decision = evaluateWriteBoundary({ ...base, txPhase });
      expect(decision.canWrite).toBe(false);
      expect(decision.reason).toBeTruthy();
    }
  });

  it("blocks on a wallet, a chain ID, and an offering that is not OPEN", () => {
    expect(evaluateWriteBoundary({ ...base, walletAddress: null }).canWrite).toBe(false);
    expect(evaluateWriteBoundary({ ...base, chainId: 1 }).reason).toContain(
      "wrong network",
    );
    expect(evaluateWriteBoundary({ ...base, chainId: null }).canWrite).toBe(false);
    expect(evaluateWriteBoundary({ ...base, offering: null }).reason).toContain(
      "confirmed on-chain offering",
    );

    for (const status of ["FUNDED", "FAILED"] as const) {
      const decision = evaluateWriteBoundary({
        ...base,
        offering: openOffering({ status }),
      });
      expect(decision.canWrite).toBe(false);
      expect(decision.reason).toContain(status);
    }
  });

  it("blocks when the offering deadline has already passed", () => {
    const decision = evaluateWriteBoundary({
      ...base,
      offering: openOffering({ deadline: 1_700_000_000n }),
      nowSeconds: 2_000_000_000n,
    });
    expect(decision.canWrite).toBe(false);
    expect(decision.reason).toContain("deadline");
  });

  it("fails closed when the live token price disagrees with the displayed constant", () => {
    const decision = evaluateWriteBoundary({
      ...base,
      displayedTokenPrice: 20_000n,
    });
    expect(decision.canWrite).toBe(false);
    expect(decision.reason).toContain("live offering token price");
  });

  it("fails closed when the live target disagrees with the displayed constant", () => {
    const decision = evaluateWriteBoundary({
      ...base,
      displayedOfferingTarget: 1_000_000_000n,
    });
    expect(decision.canWrite).toBe(false);
    expect(decision.reason).toContain("live offering target");
  });

  it("blocks an amount that is not a whole multiple of the live token price", () => {
    const decision = evaluateWriteBoundary({ ...base, amount: 10_001n });
    expect(decision.canWrite).toBe(false);
    expect(decision.reason).toContain("whole multiple of the live token price");
  });

  it("blocks a non-positive amount", () => {
    expect(evaluateWriteBoundary({ ...base, amount: null }).canWrite).toBe(false);
    expect(evaluateWriteBoundary({ ...base, amount: 0n }).canWrite).toBe(false);
    expect(evaluateWriteBoundary({ ...base, amount: -1n }).canWrite).toBe(false);
  });

  it("blocks an amount above the remaining cap", () => {
    const decision = evaluateWriteBoundary({
      ...base,
      amount: 1_000_000n,
      offering: openOffering({ remainingCap: 999_999n }),
    });
    expect(decision.canWrite).toBe(false);
    expect(decision.reason).toContain("remaining offering cap");
  });

  it("blocks investor data that was read for a different wallet", () => {
    const decision = evaluateWriteBoundary({
      ...base,
      investor: investorState(INVESTOR_B),
    });
    expect(decision.canWrite).toBe(false);
    expect(decision.reason).toContain("identity, balance, and allowance read for the connected wallet");
  });

  it("blocks an unapproved investor and an insufficient balance", () => {
    const unapproved = evaluateWriteBoundary({
      ...base,
      investor: investorState(INVESTOR_A, { isApproved: false }),
    });
    expect(unapproved.canWrite).toBe(false);
    expect(unapproved.reason).toContain("demo investor approval in IdentityRegistry");

    const broke = evaluateWriteBoundary({
      ...base,
      amount: 1_000_000n,
      investor: investorState(INVESTOR_A, {
        mIdrBalance: 500_000n,
        allowance: 1_000_000n,
      }),
    });
    expect(broke.canWrite).toBe(false);
    expect(broke.reason).toContain("mIDR balance of at least");
  });

  it("blocks unknown offering data rather than assuming OPEN", () => {
    const decision = evaluateWriteBoundary({ ...base, offering: null });
    expect(decision.canWrite).toBe(false);
    expect(decision.action).toBeNull();
  });
});

describe("deriveInvestorAction (amount-dependent allowance)", () => {
  it("returns null while either input is unknown", () => {
    expect(deriveInvestorAction(null, 1_000_000n)).toBeNull();
    expect(deriveInvestorAction(investorState(INVESTOR_A), null)).toBeNull();
    expect(deriveInvestorAction(investorState(INVESTOR_A), 0n)).toBeNull();
  });

  it("asks for approval only while the allowance is below the entered amount", () => {
    const investor = investorState(INVESTOR_A, { allowance: 1_500_000n });
    expect(deriveInvestorAction(investor, 1_000_000n)).toBe("invest");
    expect(deriveInvestorAction(investor, 2_000_000n)).toBe("approve");
    expect(deriveInvestorAction(investor, 1_500_000n)).toBe("invest");
  });

  it("never applies the old fixed 1 000 000 mIDR threshold", () => {
    const investor = investorState(INVESTOR_A, { allowance: 0n });
    // A 100 mIDR amount still needs approval, and a 10M amount with a 1M
    // allowance also needs approval: the threshold is the amount, not a constant.
    expect(deriveInvestorAction(investor, 100n)).toBe("approve");
    expect(deriveInvestorAction(investorState(INVESTOR_A, { allowance: 1_000_000n }), 10_000_000n)).toBe(
      "approve",
    );
  });
});

describe("duplicate write rejection and reset safety (FE-002D-CORRECTION-2)", () => {
  const dummyTxHash = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as const;

  it("blocks duplicate click while a write is in flight and preserves state", () => {
    const inFlightState: InvestorTxState = {
      phase: "awaiting-signature",
      action: "invest",
      amount: 10_000_000n,
      txHash: null,
      error: null,
    };

    const guard = evaluateInvestorWriteGuard({
      isWriteInFlight: true,
      txPhase: inFlightState.phase,
    });

    expect(guard.canProceed).toBe(false);
    expect(guard.reason).toContain("still awaiting a chain outcome");

    // Rejected duplicate attempt preserves the original state completely
    const nextState = reduceDuplicateWriteAttempt(inFlightState);
    expect(nextState).toBe(inFlightState);
    expect(nextState.phase).toBe("awaiting-signature");
    expect(nextState.action).toBe("invest");
    expect(nextState.amount).toBe(10_000_000n);
    expect(nextState.txHash).toBeNull();
  });

  it("blocks duplicate call after broadcast with receipt still pending and preserves tx hash/action/amount", () => {
    const submittedState: InvestorTxState = {
      phase: "submitted",
      action: "invest",
      amount: 5_000_000n,
      txHash: dummyTxHash,
      error: null,
    };

    const guardSubmitted = evaluateInvestorWriteGuard({
      isWriteInFlight: false,
      txPhase: submittedState.phase,
    });
    expect(guardSubmitted.canProceed).toBe(false);

    const confirmingState: InvestorTxState = {
      phase: "confirming",
      action: "invest",
      amount: 5_000_000n,
      txHash: dummyTxHash,
      error: null,
    };

    const guardConfirming = evaluateInvestorWriteGuard({
      isWriteInFlight: false,
      txPhase: confirmingState.phase,
    });
    expect(guardConfirming.canProceed).toBe(false);

    // State, hash, action, amount remain completely intact
    const preserved = reduceDuplicateWriteAttempt(confirmingState);
    expect(preserved.txHash).toBe(dummyTxHash);
    expect(preserved.action).toBe("invest");
    expect(preserved.amount).toBe(5_000_000n);
    expect(preserved.phase).toBe("confirming");
    expect(preserved.error).toBeNull();
  });

  it("blocks duplicate call after receipt lookup becomes unknown, preserves state/hash, and keeps a third attempt blocked", () => {
    const unknownState: InvestorTxState = {
      phase: "receipt-unknown",
      action: "approve",
      amount: 3_000_000n,
      txHash: dummyTxHash,
      error: "Receipt lookup timed out after broadcast.",
    };

    // Duplicate call after receipt lookup becomes unknown
    const duplicateGuard = evaluateInvestorWriteGuard({
      isWriteInFlight: false,
      txPhase: unknownState.phase,
    });
    expect(duplicateGuard.canProceed).toBe(false);

    // State is preserved, not overwritten with "failed" or txHash: null
    const preservedState = reduceDuplicateWriteAttempt(unknownState);
    expect(preservedState.txHash).toBe(dummyTxHash);
    expect(preservedState.action).toBe("approve");
    expect(preservedState.amount).toBe(3_000_000n);
    expect(preservedState.phase).toBe("receipt-unknown");
    expect(preservedState.error).toBe("Receipt lookup timed out after broadcast.");

    // A third attempt is STILL blocked after the rejected duplicate
    const thirdAttemptGuard = evaluateInvestorWriteGuard({
      isWriteInFlight: false,
      txPhase: preservedState.phase,
    });
    expect(thirdAttemptGuard.canProceed).toBe(false);
  });

  it("updates the guard ref synchronously before React can render a receipt-unknown state", () => {
    const stateRef = { current: initialInvestorTxState };
    const unknownState: InvestorTxState = {
      phase: "receipt-unknown",
      action: "invest",
      amount: 1_000_000n,
      txHash: dummyTxHash,
      error: "Receipt lookup timed out after broadcast.",
    };

    const renderedNext = commitInvestorTxState(stateRef, unknownState);

    expect(renderedNext).toBe(unknownState);
    expect(stateRef.current).toBe(unknownState);
    expect(
      evaluateInvestorWriteGuard({
        isWriteInFlight: false,
        txPhase: stateRef.current.phase,
      }).canProceed,
    ).toBe(false);
    expect(stateRef.current.txHash).toBe(dummyTxHash);
  });

  it("resetTx cannot erase an unresolved broadcast or pending write, but resets resolved outcomes truthfully", () => {
    const unresolvedBroadcast: InvestorTxState = {
      phase: "receipt-unknown",
      action: "invest",
      amount: 1_000_000n,
      txHash: dummyTxHash,
      error: "Receipt unavailable",
    };

    expect(canResetInvestorTx(unresolvedBroadcast.phase)).toBe(false);
    const afterResetAttempt = reduceResetTxState(unresolvedBroadcast);
    expect(afterResetAttempt).toBe(unresolvedBroadcast);
    expect(afterResetAttempt.txHash).toBe(dummyTxHash);
    expect(afterResetAttempt.phase).toBe("receipt-unknown");

    // Also blocks pending broadcast
    const submittedState: InvestorTxState = {
      phase: "submitted",
      action: "invest",
      amount: 1_000_000n,
      txHash: dummyTxHash,
      error: null,
    };
    expect(canResetInvestorTx(submittedState.phase)).toBe(false);
    expect(reduceResetTxState(submittedState)).toBe(submittedState);

    // In contrast, resolved receipt (confirmed) can be reset
    const confirmedState: InvestorTxState = {
      phase: "confirmed",
      action: "invest",
      amount: 1_000_000n,
      txHash: dummyTxHash,
      error: null,
    };
    expect(canResetInvestorTx(confirmedState.phase)).toBe(true);
    expect(reduceResetTxState(confirmedState)).toEqual({
      phase: "idle",
      action: null,
      amount: null,
      txHash: null,
      error: null,
    });

    // Resolved receipt (reverted) can also be reset
    const revertedState: InvestorTxState = {
      phase: "reverted",
      action: "invest",
      amount: 1_000_000n,
      txHash: dummyTxHash,
      error: "Transaction reverted on chain.",
    };
    expect(canResetInvestorTx(revertedState.phase)).toBe(true);
    expect(reduceResetTxState(revertedState)).toEqual({
      phase: "idle",
      action: null,
      amount: null,
      txHash: null,
      error: null,
    });
  });
});
