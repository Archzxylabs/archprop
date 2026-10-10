import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, keccak256, stringToHex, type PublicClient, type WalletClient } from "viem";
import { FaucetFlow, faucetIsLocked, faucetReadKey, formatFaucetAmount, initialFaucetState, parseFaucetAmount, readFaucetSnapshot } from "./faucet-client";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x3333333333333333333333333333333333333333" as const;
const HASH = `0x${"a".repeat(64)}` as const;
const REPLACEMENT_HASH = `0x${"b".repeat(64)}` as const;
const receipt = (status = "success") => ({
  status, transactionHash: HASH,
  logs: [{ address: TOKEN, data: encodeAbiParameters([{ type: "uint256" }], [1_000_000n]),
    topics: [keccak256(stringToHex("DemoMint(address,uint256)")), `0x${ADDRESS.slice(2).padStart(64, "0")}`] }],
});
function clients() {
  const publicMock = {
    getChainId: vi.fn().mockResolvedValue(421614),
    getBytecode: vi.fn().mockResolvedValue("0x1234"),
    readContract: vi.fn().mockImplementation(({ functionName }) => Promise.resolve(
      functionName === "decimals" ? 0 : functionName === "symbol" ? "mIDR" : 7_000_000n)),
    simulateContract: vi.fn().mockResolvedValue({}),
    waitForTransactionReceipt: vi.fn().mockResolvedValue(receipt()),
    getTransactionReceipt: vi.fn().mockResolvedValue(receipt()),
  };
  const walletMock = {
    getAddresses: vi.fn().mockResolvedValue([ADDRESS]),
    getChainId: vi.fn().mockResolvedValue(421614),
    writeContract: vi.fn().mockResolvedValue(HASH),
  };
  return { publicMock, walletMock, publicClient: publicMock as unknown as PublicClient,
    walletClient: walletMock as unknown as WalletClient };
}

describe("whole mIDR amounts", () => {
  it.each(["1000000", "1.000.000", " 1.000.000 "])("parses %s exactly", (input) => {
    expect(parseFaucetAmount(input)).toBe(1_000_000n);
  });
  it("accepts both bounds and formats Indonesian grouping", () => {
    expect(parseFaucetAmount("1")).toBe(1n);
    expect(parseFaucetAmount("10.000.000.000")).toBe(10_000_000_000n);
    expect(formatFaucetAmount(1_000_000n)).toBe("1.000.000");
  });
  it.each(["", "0", "10.000.000.001", "1.5", "1,5", "1,000,000", "10.00", "1.0000", "01.000", "0001", "-1", "+1", "1e6", "1 000", "Rp1.000.000", "900719925474099300000"])("rejects ambiguous/out-of-range %s", (input) => {
    expect(() => parseFaucetAmount(input)).toThrow();
  });
});

describe("faucet contract reads", () => {
  it("reads the configured zero-decimal mIDR balance", async () => {
    const { publicClient, publicMock } = clients();
    expect(await readFaucetSnapshot(publicClient, TOKEN, ADDRESS)).toEqual({ balance: 7_000_000n });
    expect(publicMock.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: TOKEN, functionName: "balanceOf", args: [ADDRESS] }));
  });
  it.each(["chain", "bytecode", "decimals", "symbol"])("fails closed on invalid %s", async (kind) => {
    const { publicClient, publicMock } = clients();
    if (kind === "chain") publicMock.getChainId.mockResolvedValue(1);
    if (kind === "bytecode") publicMock.getBytecode.mockResolvedValue("0x");
    if (kind === "decimals") publicMock.readContract.mockResolvedValue(18);
    if (kind === "symbol") publicMock.readContract.mockImplementation(({ functionName }) => Promise.resolve(functionName === "decimals" ? 0 : "USDC"));
    await expect(readFaucetSnapshot(publicClient, TOKEN, ADDRESS)).rejects.toThrow();
  });
});

describe("wallet-driven faucet", () => {
  const request = (c: ReturnType<typeof clients>, overrides = {}) => ({ ...c, token: TOKEN, account: ADDRESS, amount: 1_000_000n, isCurrent: () => true, ...overrides });
  it("simulates and sends whole units to caller, then confirms actual DemoMint", async () => {
    const c = clients();
    const flow = new FaucetFlow();
    await flow.claim(request(c));
    expect(c.walletMock.writeContract).toHaveBeenCalledWith(expect.objectContaining({ address: TOKEN, functionName: "faucet", args: [1_000_000n], account: ADDRESS, chain: expect.objectContaining({ id: 421614 }) }));
    expect(flow.state).toMatchObject({ phase: "confirmed", hash: HASH, amount: 1_000_000n, account: ADDRESS });
  });
  it("blocks simultaneous submissions before any async work", async () => {
    const c = clients();
    let release!: () => void;
    c.publicMock.simulateContract.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const flow = new FaucetFlow();
    const first = flow.claim(request(c));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await flow.claim(request(c));
    release();
    await first;
    expect(c.walletMock.writeContract).toHaveBeenCalledTimes(1);
  });
  it.each(["account", "chain", "context"])("blocks a %s change during simulation", async (kind) => {
    const c = clients();
    let current = true;
    c.publicMock.simulateContract.mockImplementation(async () => {
      if (kind === "account") c.walletMock.getAddresses.mockResolvedValue([OTHER]);
      if (kind === "chain") c.walletMock.getChainId.mockResolvedValue(1);
      if (kind === "context") current = false;
    });
    const flow = new FaucetFlow();
    await flow.claim(request(c, { isCurrent: () => current }));
    expect(c.walletMock.writeContract).not.toHaveBeenCalled();
    expect(flow.state.phase).toBe("failed");
  });
  it.each([0n, 10_000_000_001n])("rejects invalid direct amount %s before writes", async (amount) => {
    const c = clients();
    const flow = new FaucetFlow();
    await flow.claim(request(c, { amount }));
    expect(c.walletMock.writeContract).not.toHaveBeenCalled();
  });
  it("does not broadcast after a failed simulation", async () => {
    const c = clients();
    c.publicMock.simulateContract.mockRejectedValue(new Error("RPC https://secret.invalid?key=never-display"));
    const flow = new FaucetFlow();
    await flow.claim(request(c));
    expect(c.walletMock.writeContract).not.toHaveBeenCalled();
    expect(flow.state.message).not.toContain("secret");
    expect(flow.state.message).not.toContain("https:");
  });
  it("shows a safe Indonesian rejection and permits retry when no hash exists", async () => {
    const c = clients();
    c.walletMock.writeContract.mockRejectedValue({ cause: { code: 4001 }, message: "private RPC parameters" });
    const flow = new FaucetFlow();
    await flow.claim(request(c));
    expect(flow.state).toMatchObject({ phase: "failed", hash: null, message: "Permintaan dibatalkan di wallet." });
    c.walletMock.writeContract.mockResolvedValue(HASH);
    await flow.claim(request(c));
    expect(flow.state.phase).toBe("confirmed");
  });
  it("keeps an unknown receipt locked across wallet/input changes and only rechecks reads", async () => {
    const c = clients();
    c.publicMock.waitForTransactionReceipt.mockRejectedValue(new Error("RPC timeout"));
    const flow = new FaucetFlow();
    await flow.claim(request(c));
    expect(flow.state).toMatchObject({ phase: "receipt-unknown", hash: HASH, account: ADDRESS, amount: 1_000_000n });
    await flow.claim(request(c, { account: OTHER, amount: 2_000_000n }));
    expect(c.walletMock.writeContract).toHaveBeenCalledTimes(1);
    c.publicMock.getTransactionReceipt.mockRejectedValueOnce(new Error("not found"));
    await flow.recheck(c.publicClient);
    expect(flow.state.phase).toBe("receipt-unknown");
    await flow.recheck(c.publicClient);
    expect(flow.state.phase).toBe("confirmed");
    expect(c.walletMock.writeContract).toHaveBeenCalledTimes(1);
  });
  it("marks a reverted actual receipt failed", async () => {
    const c = clients();
    c.publicMock.waitForTransactionReceipt.mockResolvedValue(receipt("reverted"));
    const flow = new FaucetFlow();
    await flow.claim(request(c));
    expect(flow.state).toMatchObject({ phase: "failed", hash: HASH });
  });
  it.each(["repriced", "cancelled", "replaced"])("tracks a %s nonce replacement to its actual outcome", async (reason) => {
    const c = clients();
    const replacementReceipt = { ...receipt(), transactionHash: REPLACEMENT_HASH,
      logs: reason === "repriced" ? receipt().logs : [] };
    c.publicMock.waitForTransactionReceipt.mockImplementation(async ({ onReplaced }) => {
      onReplaced({ reason, replacedTransaction: { hash: HASH, from: ADDRESS, nonce: 4 },
        transaction: { hash: REPLACEMENT_HASH, from: ADDRESS, nonce: 4 }, transactionReceipt: replacementReceipt });
      return replacementReceipt;
    });
    const flow = new FaucetFlow();
    await flow.claim(request(c));
    expect(flow.state).toMatchObject({ phase: reason === "repriced" ? "confirmed" : "failed", hash: REPLACEMENT_HASH });
    expect(faucetIsLocked(flow.state)).toBe(false);
    expect(c.walletMock.writeContract).toHaveBeenCalledTimes(1);
  });
  it("rechecks the replacement hash when receipt reading fails after repricing", async () => {
    const c = clients();
    const replacementReceipt = { ...receipt(), transactionHash: REPLACEMENT_HASH };
    c.publicMock.waitForTransactionReceipt.mockImplementation(async ({ onReplaced }) => {
      onReplaced({ reason: "repriced", replacedTransaction: { hash: HASH, from: ADDRESS, nonce: 4 },
        transaction: { hash: REPLACEMENT_HASH, from: ADDRESS, nonce: 4 }, transactionReceipt: replacementReceipt });
      throw new Error("RPC timed out after replacement");
    });
    const flow = new FaucetFlow();
    await flow.claim(request(c));
    expect(flow.state).toMatchObject({ phase: "receipt-unknown", hash: REPLACEMENT_HASH });
    c.publicMock.getTransactionReceipt.mockResolvedValue(replacementReceipt);
    await flow.recheck(c.publicClient);
    expect(c.publicMock.getTransactionReceipt).toHaveBeenCalledWith({ hash: REPLACEMENT_HASH });
    expect(flow.state.phase).toBe("confirmed");
    expect(c.walletMock.writeContract).toHaveBeenCalledTimes(1);
  });
  it.each(["original hash", "sender", "nonce", "receipt hash"])("ignores unsafe replacement data with mismatched %s", async (kind) => {
    const c = clients();
    const data = { replacedTransaction: { hash: HASH, from: ADDRESS, nonce: 4 },
      transaction: { hash: REPLACEMENT_HASH, from: ADDRESS, nonce: 4 },
      transactionReceipt: { ...receipt(), transactionHash: REPLACEMENT_HASH } };
    if (kind === "original hash") data.replacedTransaction.hash = REPLACEMENT_HASH;
    if (kind === "sender") data.transaction.from = OTHER as typeof ADDRESS;
    if (kind === "nonce") data.transaction.nonce = 5;
    if (kind === "receipt hash") data.transactionReceipt.transactionHash = HASH;
    c.publicMock.waitForTransactionReceipt.mockImplementation(async ({ onReplaced }) => {
      onReplaced({ ...data, reason: "repriced" });
      return data.transactionReceipt;
    });
    const flow = new FaucetFlow();
    await flow.claim(request(c));
    expect(flow.state).toMatchObject({ phase: "receipt-unknown", hash: HASH });
  });
  it("invalidates a returning panel's balance when a tracked pending transaction confirms", async () => {
    const context = "token:wallet:421614";
    const pending = { ...initialFaucetState, phase: "confirming" as const, hash: HASH };
    const cachedReadKey = faucetReadKey(context, 0, pending);
    const confirmed = { ...pending, phase: "confirmed" as const };
    expect(faucetReadKey(context, 0, confirmed)).not.toBe(cachedReadKey);
    expect(faucetReadKey("token:another-wallet:421614", 0, confirmed)).not.toBe(faucetReadKey(context, 0, confirmed));
  });
  it.each(["no mint", "wrong token", "wrong recipient", "wrong amount", "other hash"])("never declares minted success with %s", async (kind) => {
    const c = clients();
    const result = receipt();
    if (kind === "no mint") result.logs = [];
    if (kind === "wrong token") result.logs[0]!.address = OTHER as typeof TOKEN;
    if (kind === "wrong recipient") result.logs[0]!.topics[1] = `0x${OTHER.slice(2).padStart(64, "0")}`;
    if (kind === "wrong amount") result.logs[0]!.data = encodeAbiParameters([{ type: "uint256" }], [2n]);
    if (kind === "other hash") result.transactionHash = `0x${"b".repeat(64)}`;
    c.publicMock.waitForTransactionReceipt.mockResolvedValue(result);
    const flow = new FaucetFlow();
    await flow.claim(request(c));
    expect(flow.state.phase).not.toBe("confirmed");
  });
});
