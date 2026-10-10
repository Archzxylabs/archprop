import { describe, expect, it, vi } from "vitest";
import type { PublicClient, WalletClient } from "viem";
import {
  executeApproveTransaction,
  executeInvestTransaction,
} from "./use-investor-flow";

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
