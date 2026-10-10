import { arbitrumSepolia, mockIdrAbi } from "@archprop/chain";
import { decodeEventLog, type Address, type Hex, type PublicClient, type TransactionReceipt, type WalletClient } from "viem";

/** Frozen whole-unit per-call bound, docs/INTERFACES.md. */
export const MAX_FAUCET_AMOUNT = 10_000_000_000n;
const AMOUNT_ERROR = "Masukkan bilangan bulat 1–10.000.000.000 mIDR, misalnya 1.000.000.";

export function parseFaucetAmount(input: string): bigint {
  const value = input.trim();
  // Accept canonical integers or Indonesian thousands groups. Never use floats.
  if (!/^(?:[1-9]\d*|[1-9]\d{0,2}(?:\.\d{3})+)$/.test(value)) throw new Error(AMOUNT_ERROR);
  const digits = value.replaceAll(".", "");
  if (digits.length > 11) throw new Error(AMOUNT_ERROR);
  const amount = BigInt(digits);
  if (amount > MAX_FAUCET_AMOUNT) throw new Error(AMOUNT_ERROR);
  return amount;
}

export function formatFaucetAmount(amount: bigint): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(amount);
}

/** Product messages only: never expose a provider URL, request body or raw error. */
export function faucetErrorMessage(error: unknown, fallback: string): string {
  let cause = error;
  for (let depth = 0; depth < 6 && cause && typeof cause === "object"; depth += 1) {
    const entry = cause as { code?: unknown; name?: unknown; cause?: unknown };
    if (entry.code === 4001 || entry.name === "UserRejectedRequestError") return "Permintaan dibatalkan di wallet.";
    cause = entry.cause;
  }
  return fallback;
}

/** Verify the configured RPC/token before showing balances or requesting a write. */
export async function readFaucetSnapshot(client: PublicClient, token: Address, account: Address | null) {
  if (await client.getChainId() !== arbitrumSepolia.id) throw new Error("RPC faucet bukan Arbitrum Sepolia.");
  const [bytecode, decimals, symbol] = await Promise.all([
    client.getBytecode({ address: token }),
    client.readContract({ address: token, abi: mockIdrAbi, functionName: "decimals" }),
    client.readContract({ address: token, abi: mockIdrAbi, functionName: "symbol" }),
  ]);
  if (!bytecode || bytecode === "0x" || decimals !== 0 || symbol !== "mIDR") {
    throw new Error("Kontrak faucet belum sesuai dengan token demo mIDR.");
  }
  const balance = account ? await client.readContract({ address: token, abi: mockIdrAbi, functionName: "balanceOf", args: [account] }) : null;
  return { balance };
}

export type FaucetPhase = "idle" | "preparing" | "awaiting-signature" | "confirming" | "receipt-unknown" | "confirmed" | "failed";
export interface FaucetTxState {
  phase: FaucetPhase;
  hash: Hex | null;
  account: Address | null;
  token: Address | null;
  amount: bigint | null;
  message: string | null;
  rechecking: boolean;
}
export const initialFaucetState: FaucetTxState = { phase: "idle", hash: null, account: null, token: null, amount: null, message: null, rechecking: false };

export function faucetIsLocked(state: FaucetTxState): boolean {
  return ["preparing", "awaiting-signature", "confirming", "receipt-unknown"].includes(state.phase);
}

/** A currently mounted panel invalidates its balance when the tracked mint confirms. */
export function faucetReadKey(context: string, refresh: number, state: FaucetTxState): string {
  return `${context}:${refresh}:${state.phase === "confirmed" ? state.hash : ""}`;
}

interface FaucetRequest {
  publicClient: PublicClient;
  walletClient: WalletClient;
  token: Address;
  account: Address;
  amount: bigint;
  /** Synchronously invalidated by a changed UI wallet/config, including during simulation. */
  isCurrent: () => boolean;
}

/** One controller survives input/account/network changes; an unknown hash cannot be reset. */
export class FaucetFlow {
  state: FaucetTxState = initialFaucetState;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly onChange: (state: FaucetTxState) => void = () => {}) {}
  getState = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(change: Partial<FaucetTxState>) {
    this.state = { ...this.state, ...change };
    this.onChange(this.state);
    for (const listener of this.listeners) listener();
  }

  async claim(request: FaucetRequest): Promise<void> {
    if (faucetIsLocked(this.state)) return;
    const { publicClient, walletClient, token, account, amount, isCurrent } = request;
    this.update({ ...initialFaucetState, phase: "preparing", token, account, amount });
    let failure = "Faucet belum dapat diakses. Periksa koneksi dan konfigurasi jaringan.";
    try {
      if (amount <= 0n || amount > MAX_FAUCET_AMOUNT) throw new Error(AMOUNT_ERROR);
      const checkWallet = async () => {
        const [accounts, chainId] = await Promise.all([walletClient.getAddresses(), walletClient.getChainId()]);
        if (!isCurrent() || accounts[0]?.toLowerCase() !== account.toLowerCase() || chainId !== arbitrumSepolia.id) {
          throw new Error("Wallet berubah.");
        }
      };
      failure = "Wallet atau jaringan berubah. Periksa wallet dan coba lagi.";
      await checkWallet();
      failure = "Faucet belum dapat diakses. Periksa koneksi dan konfigurasi jaringan.";
      await readFaucetSnapshot(publicClient, token, account);
      failure = "Permintaan faucet belum dapat diproses. Periksa saldo ETH testnet untuk biaya jaringan dan coba lagi.";
      await publicClient.simulateContract({ address: token, abi: mockIdrAbi, functionName: "faucet", args: [amount], account });
      failure = "Wallet atau jaringan berubah. Periksa wallet dan coba lagi.";
      // Read live provider state immediately before broadcast, not cached React state.
      await checkWallet();
      if (!isCurrent()) throw new Error("Wallet berubah.");
      this.update({ phase: "awaiting-signature" });
      failure = "Transaksi belum terkirim. Periksa wallet dan saldo ETH testnet, lalu coba lagi.";
      const hash = await walletClient.writeContract({ address: token, abi: mockIdrAbi, functionName: "faucet", args: [amount], account, chain: arbitrumSepolia });
      this.update({ phase: "confirming", hash });
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000,
          onReplaced: ({ replacedTransaction, transaction, transactionReceipt }) => {
            if (replacedTransaction.hash.toLowerCase() !== this.state.hash?.toLowerCase()
              || transaction.from.toLowerCase() !== this.state.account?.toLowerCase()
              || transaction.nonce !== replacedTransaction.nonce
              || transactionReceipt.transactionHash.toLowerCase() !== transaction.hash.toLowerCase()) {
              throw new Error("Replacement berbeda.");
            }
            // viem follows speed-up/cancel replacements. Keep the active hash even if
            // its receipt read later fails; success still requires the exact DemoMint.
            this.update({ hash: transaction.hash });
          },
        });
        this.acceptReceipt(receipt);
      } catch {
        this.update({ phase: "receipt-unknown", message: "Transaksi sudah dikirim, tetapi hasilnya belum diketahui. Cek konfirmasi sebelum meminta lagi." });
      }
    } catch (error) {
      this.update({ phase: "failed", message: faucetErrorMessage(error, amount <= 0n || amount > MAX_FAUCET_AMOUNT ? AMOUNT_ERROR : failure) });
    }
  }

  private acceptReceipt(receipt: TransactionReceipt) {
    if (receipt.transactionHash.toLowerCase() !== this.state.hash?.toLowerCase()) throw new Error("Receipt berbeda.");
    if (receipt.status === "reverted") {
      this.update({ phase: "failed", message: "Transaksi gagal di jaringan. mIDR tidak diterima; kamu dapat mencoba lagi." });
      return;
    }
    if (receipt.status !== "success") throw new Error("Receipt belum final.");
    const minted = receipt.logs.some((log) => {
      if (log.address.toLowerCase() !== this.state.token?.toLowerCase()) return false;
      try {
        const event = decodeEventLog({ abi: mockIdrAbi, eventName: "DemoMint", data: log.data, topics: log.topics });
        return event.args.recipient.toLowerCase() === this.state.account?.toLowerCase() && event.args.amount === this.state.amount;
      } catch { return false; }
    });
    this.update(minted
      ? { phase: "confirmed", message: "mIDR demo berhasil diterima." }
      : { phase: "failed", message: "Transaksi terkonfirmasi, tetapi penerimaan mIDR tidak dapat diverifikasi." });
  }

  /** Always read-only, scoped to the original token/account/hash even after wallet changes. */
  async recheck(client: PublicClient): Promise<void> {
    if (this.state.phase !== "receipt-unknown" || !this.state.hash || this.state.rechecking) return;
    this.update({ rechecking: true });
    try {
      if (await client.getChainId() !== arbitrumSepolia.id) throw new Error("RPC berbeda.");
      const receipt = await client.getTransactionReceipt({ hash: this.state.hash! });
      this.acceptReceipt(receipt);
    } catch {
      this.update({ phase: "receipt-unknown", message: "Konfirmasi masih belum tersedia. Hash transaksi tetap tersimpan; cek lagi beberapa saat nanti." });
    } finally { this.update({ rechecking: false }); }
  }
}
