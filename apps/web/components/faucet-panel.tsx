"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { getArchpropPublicClient, getClientChainConfig } from "@/lib/client/chain-client";
import { FaucetFlow, faucetErrorMessage, faucetIsLocked, faucetReadKey, formatFaucetAmount, initialFaucetState, parseFaucetAmount, readFaucetSnapshot } from "@/lib/client/faucet-client";
import { useWallet } from "@/lib/client/wallet-context";

// Keep a broadcast hash across client-side route navigation as well as wallet/input changes.
// No writes run on the server; the server snapshot is always the idle state.
const flow = new FaucetFlow();
const phaseLabels = {
  idle: "Minta mIDR demo",
  preparing: "Memeriksa permintaan…",
  "awaiting-signature": "Konfirmasi di wallet…",
  confirming: "Menunggu konfirmasi…",
  "receipt-unknown": "Konfirmasi belum tersedia",
  confirmed: "Minta mIDR lagi",
  failed: "Coba lagi",
} as const;

export function FaucetPanel() {
  const wallet = useWallet();
  const config = getClientChainConfig();
  const tx = useSyncExternalStore(flow.subscribe, flow.getState, () => initialFaucetState);
  const [input, setInput] = useState("1.000.000");
  const [inputError, setInputError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [read, setRead] = useState<{ key: string; balance: bigint | null; error: string | null } | null>(null);
  const mounted = useRef(true);
  const walletRef = useRef(wallet);
  const account = wallet.chainId === 421614 ? wallet.address : null;
  const configKey = config ? `${config.rpcUrl}:${config.addresses.mockIdr}` : "missing";
  const configRef = useRef(configKey);
  const readKey = faucetReadKey(`${configKey}:${account}:${wallet.chainId}`, refresh, tx);
  const locked = faucetIsLocked(tx);
  const currentRead = read?.key === readKey ? read : null;
  const ready = !!config && !!currentRead && !currentRead.error;

  useLayoutEffect(() => {
    walletRef.current = wallet;
    configRef.current = configKey;
  }, [wallet, configKey]);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let current = true;
    if (!config) return;
    void readFaucetSnapshot(getArchpropPublicClient(config), config.addresses.mockIdr, account)
      .then(({ balance }) => { if (current) setRead({ key: readKey, balance, error: null }); })
      .catch(() => { if (current) setRead({ key: readKey, balance: null, error: "Faucet belum dapat diakses. Coba muat ulang saldo; konfigurasi jaringan atau kontrak mungkin belum sesuai." }); });
    return () => { current = false; };
  }, [config, account, readKey]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || !ready || !config || !wallet.address || wallet.chainId !== 421614) return;
    let amount: bigint;
    try { amount = parseFaucetAmount(input); }
    catch { setInputError("Gunakan bilangan bulat 1–10.000.000.000 mIDR, misalnya 1.000.000. Titik hanya untuk pemisah ribuan."); return; }
    const walletClient = wallet.getWalletClient();
    if (!walletClient) return;
    setInputError(null);
    const accountAtStart = wallet.address;
    const configAtStart = configKey;
    await flow.claim({ publicClient: getArchpropPublicClient(config), walletClient, token: config.addresses.mockIdr, account: accountAtStart, amount,
      isCurrent: () => mounted.current && configRef.current === configAtStart && walletRef.current.isConnected && walletRef.current.chainId === 421614 && walletRef.current.address?.toLowerCase() === accountAtStart.toLowerCase() });
  }

  async function recheck() {
    if (!config) return;
    await flow.recheck(getArchpropPublicClient(config));
  }

  return (
    <div className="faucet-grid mt-8">
      <section className="faucet-card" aria-labelledby="faucet-request-heading">
        <p className="ap-eyebrow">mIDR / Arbitrum Sepolia</p>
        <h2 id="faucet-request-heading">Isi saldo demo</h2>
        <p className="faucet-copy">mIDR masuk ke wallet yang mengirim permintaan. Tidak perlu persetujuan investor untuk menggunakan faucet.</p>
        {!wallet.isConnected ? (
          <button type="button" className="button button-accent mt-5" disabled={wallet.isConnecting} onClick={wallet.connect}>
            {wallet.isConnecting ? "Menghubungkan…" : "Hubungkan wallet"} <span aria-hidden="true">↗</span>
          </button>
        ) : wallet.chainId !== 421614 ? (
          <div className="faucet-notice mt-5">
            <p>Ganti jaringan wallet ke Arbitrum Sepolia untuk meminta mIDR.</p>
            <button type="button" className="button button-accent mt-3" onClick={wallet.switchChain}>Ganti jaringan</button>
          </div>
        ) : (
          <p className="faucet-recipient mt-5">Wallet penerima <code>{wallet.address}</code></p>
        )}
        {wallet.error ? <p role="alert" className="faucet-error mt-3">{faucetErrorMessage(wallet.error, "Wallet belum dapat dihubungkan atau jaringan belum berhasil diganti. Periksa wallet lalu coba lagi.")}</p> : null}
        <form onSubmit={submit} className="mt-6">
          <label htmlFor="faucet-amount" className="faucet-label">Jumlah mIDR demo</label>
          <div className="faucet-amount mt-2">
            <input id="faucet-amount" name="amount" type="text" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={24}
              value={input} disabled={locked} aria-invalid={!!inputError} aria-describedby={inputError ? "faucet-amount-help faucet-amount-error" : "faucet-amount-help"}
              onChange={(event) => { setInput(event.target.value); setInputError(null); }} />
            <span>mIDR</span>
          </div>
          <p id="faucet-amount-help" className="faucet-help mt-2">Satuan bulat; maksimal 10.000.000.000 mIDR per permintaan.</p>
          <div className="faucet-presets mt-4" aria-label="Pilihan jumlah mIDR">
            {[1_000_000n, 10_000_000n, 100_000_000n].map((amount) => (
              <button type="button" key={amount.toString()} disabled={locked} onClick={() => { setInput(formatFaucetAmount(amount)); setInputError(null); }}>{formatFaucetAmount(amount)}</button>
            ))}
          </div>
          {inputError ? <p id="faucet-amount-error" className="faucet-error mt-3" role="alert">{inputError}</p> : null}
          <button type="submit" className="button button-accent faucet-submit mt-5" disabled={locked || !ready || !wallet.isConnected || wallet.chainId !== 421614}>
            {phaseLabels[tx.phase]} <span aria-hidden="true">↗</span>
          </button>
        </form>
        {!config ? <p className="faucet-error mt-4" role="alert">Faucet belum dikonfigurasi. Alamat kontrak dan RPC Arbitrum Sepolia diperlukan.</p> : currentRead?.error ? <p className="faucet-error mt-4" role="alert">{currentRead.error}</p> : !currentRead ? <p className="faucet-help mt-4" role="status">Memeriksa kontrak mIDR…</p> : null}
        <p className="faucet-help mt-4">Permintaan membutuhkan sedikit ETH testnet untuk biaya jaringan. mIDR tidak memiliki nilai uang nyata.</p>
        <noscript><p className="faucet-notice mt-4">Aktifkan JavaScript untuk menghubungkan wallet dan meminta mIDR demo.</p></noscript>
      </section>

      <aside className="faucet-summary" aria-label="Saldo dan konfirmasi faucet">
        <p className="ap-eyebrow">Saldo wallet</p>
        <p className="faucet-balance">{!wallet.isConnected ? "Hubungkan wallet" : wallet.chainId !== 421614 ? "Ganti jaringan" : currentRead?.error ? "Belum tersedia" : currentRead?.balance !== null && currentRead?.balance !== undefined ? `${formatFaucetAmount(currentRead.balance)} mIDR` : "Memuat…"}</p>
        <button type="button" className="faucet-refresh" disabled={!config || (!currentRead && !read)} onClick={() => setRefresh((value) => value + 1)}>Muat ulang saldo ↻</button>
        {tx.phase !== "idle" ? (
          <div className="faucet-transaction mt-6" aria-live="polite" aria-atomic="true">
            <h2>{tx.phase === "confirmed" ? "Permintaan berhasil" : tx.phase === "failed" ? "Permintaan gagal" : phaseLabels[tx.phase]}</h2>
            {tx.message ? <p className={tx.phase === "failed" ? "faucet-error" : ""}>{tx.message}</p> : null}
            {tx.hash ? <>
              <p>{tx.amount !== null ? `${formatFaucetAmount(tx.amount)} mIDR` : ""} ke <code>{tx.account}</code></p>
              <a href={`https://sepolia.arbiscan.io/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer">Lihat transaksi di Arbiscan ↗</a>
              <code className="faucet-hash">{tx.hash}</code>
            </> : null}
            {tx.phase === "receipt-unknown" ? <>
              <p>Permintaan baru dikunci sampai transaksi ini memiliki hasil yang diketahui, termasuk jika wallet diganti.</p>
              <button type="button" className="button button-accent mt-3" disabled={!config || tx.rechecking} onClick={recheck}>{tx.rechecking ? "Memeriksa…" : "Cek konfirmasi lagi"}</button>
            </> : null}
          </div>
        ) : null}
        <div className="faucet-next mt-6">
          <h2>Siap mencoba investasi?</h2>
          <p>Gunakan mIDR untuk simulasi pendanaan properti. Investasi tetap memerlukan persetujuan investor demo dan offering yang terbuka.</p>
          <Link href="/marketplace">Jelajahi properti ↗</Link>
        </div>
      </aside>
    </div>
  );
}
