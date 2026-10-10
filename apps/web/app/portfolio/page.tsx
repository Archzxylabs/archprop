import Link from "next/link";
import { DemoDisclosure } from "@/components/demo-disclosure";
import { ChainStateNotice, ConnectWalletPrompt } from "@/components/chain-state";
import { StatusBadge } from "@/components/status-badge";
import { findListingByAssetId } from "@/lib/client/listings";
import { chainUnavailable, formatWholeUnits } from "@/lib/client/view-models";

/**
 * Investor portfolio.
 *
 * Token balances, claimable revenue, and participation state are per-investor
 * chain reads. The FE-001 shell has no adapter, so the portfolio explains that
 * and does not fabricate a position.
 */

export default function PortfolioPage() {
  const demoAsset = findListingByAssetId(
    "0x1756428cf9ce005285ddcf87c75240c798535bed95c6aeca6a5a7d3eb7b364ae",
  );

  const balancesState = chainUnavailable<never[]>(
    "Token balances are read from the asset token contract once a wallet is connected.",
  );
  const claimableState = chainUnavailable<bigint | null>(
    "Claimable revenue is read from the revenue distributor once a wallet is connected.",
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="ap-eyebrow">Portfolio</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong sm:text-3xl">
          Your positions
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">
          Balances, participation, and claimable revenue are read from the chain
          for the connected wallet. Without one, this portfolio would be showing
          someone else&rsquo;s numbers.
        </p>
      </header>

      <DemoDisclosure className="mt-6" />

      <ConnectWalletPrompt
        className="mt-6"
        title="Connect a wallet to see your portfolio"
        description="Every figure below depends on the connected wallet's on-chain balance and claimable revenue."
      />

      {/* Balances */}
      <section aria-labelledby="balances-heading" className="mt-10">
        <h2 id="balances-heading" className="text-lg font-semibold text-ink-strong">
          Token balances
        </h2>
        <div className="mt-3">
          <ChainStateNotice state={balancesState} label="token balances" />
        </div>
      </section>

      {/* Claimable revenue */}
      <section aria-labelledby="claimable-heading" className="mt-10">
        <h2 id="claimable-heading" className="text-lg font-semibold text-ink-strong">
          Claimable revenue
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Revenue distributions in this demo environment are simulated, and the
          claimable amount is read from the distributor for your wallet.
        </p>
        <div className="mt-3">
          <ChainStateNotice state={claimableState} label="claimable revenue" />
        </div>
      </section>

      {/* What a position looks like once connected */}
      <section aria-labelledby="shape-heading" className="mt-10">
        <h2 id="shape-heading" className="text-lg font-semibold text-ink-strong">
          What this screen will show
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Once a wallet is connected, each position shows the asset, tokens held,
          and the economic participation those tokens represent. No figure here is
          a sample of what the chain will return.
        </p>

        {demoAsset ? (
          <div className="mt-4 rounded-card border border-line bg-surface p-4 shadow-panel">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink-strong">
                  {demoAsset.name}
                </p>
                <p className="text-xs text-ink-muted">
                  {demoAsset.location} · {demoAsset.externalId}
                </p>
              </div>
              <StatusBadge status={demoAsset.presentationStatus} />
            </div>
            {demoAsset.fundamentals ? (
              <p className="ap-tabular mt-3 text-xs text-ink-muted">
                Token price {formatWholeUnits(demoAsset.fundamentals.tokenPrice)} mIDR
                · {demoAsset.fundamentals.tokenSymbol}
              </p>
            ) : null}
            <Link
              href={`/property/${demoAsset.assetId}`}
              className="mt-3 inline-block text-sm font-medium text-brand"
            >
              View property
            </Link>
          </div>
        ) : null}
      </section>
    </div>
  );
}
