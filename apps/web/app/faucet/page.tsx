import type { Metadata } from "next";
import { FaucetPanel } from "@/components/faucet-panel";

export const metadata: Metadata = { title: "Faucet mIDR", description: "Minta mIDR tanpa nilai uang nyata untuk mencoba demo Archprop di Arbitrum Sepolia." };

export default function FaucetPage() {
  return (
    <div className="ap-page faucet-page mx-auto w-full max-w-5xl px-5 py-10" lang="id">
      <header>
        <p className="ap-eyebrow">Faucet / Mata uang demo</p>
        <h1>mIDR untuk mencoba.</h1>
        <p>Dapatkan saldo demo di Arbitrum Sepolia, langsung melalui wallet kamu.</p>
      </header>
      <aside className="faucet-disclosure mt-6" aria-label="Keterangan mata uang demo">
        <strong>Hackathon Demo — Synthetic / Simulated Data</strong>
        <p>mIDR adalah mata uang demo tanpa nilai uang nyata. Token ini bukan rupiah asli dan tidak dapat ditukar atau dicairkan menjadi rupiah.</p>
      </aside>
      <FaucetPanel />
    </div>
  );
}
