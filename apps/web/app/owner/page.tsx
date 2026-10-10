import Link from "next/link";
import { DemoDisclosure } from "@/components/demo-disclosure";
import { ConnectWalletPrompt } from "@/components/chain-state";
import { StatusBadge } from "@/components/status-badge";
import { LISTINGS } from "@/lib/client/listings";
import { chainUnavailable, formatWholeUnits } from "@/lib/client/view-models";

/**
 * Owner dashboard.
 *
 * Lists the assets the connected owner has registered, with lifecycle and
 * verification progress read from the registry. The FE-001 shell has no
 * adapter, so the listing states that plainly rather than showing a static
 * table that implies it was read.
 */

export default function OwnerPage() {
  const lifecycleState = chainUnavailable<never[]>(
    "Registered assets are read from the registry once a wallet is connected.",
  );

  return (
    <div className="ap-page mx-auto w-full max-w-5xl px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="ap-eyebrow">Owner</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong sm:text-3xl">
          Your assets
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">
          Register a property, publish its documents, and open an offering once
          verification completes. Lifecycle and verification progress are read
          from the registry.
        </p>
      </header>

      <div className="mt-6">
        <Link
          href="/owner/property/new"
          className="inline-flex rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-ink-inverse transition-colors hover:bg-brand-deep"
        >
          List a property
        </Link>
      </div>

      <DemoDisclosure className="mt-6" />

      <section aria-labelledby="assets-heading" className="mt-8">
        <h2 id="assets-heading" className="text-lg font-semibold text-ink-strong">
          Registered assets
        </h2>

        <div className="mt-4">
          <ConnectWalletPrompt
            title="Connect a wallet to see your registered assets"
            description="Registered assets are resolved from the connected owner address. Without a wallet, this list would be a guess about who you are."
          />
        </div>

        <p className="mt-4 text-sm leading-relaxed text-ink-muted">
          The demo environment publishes these listings for every visitor. Your
          registered assets appear here once a wallet is connected.
        </p>

        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {LISTINGS.map((listing) => (
            <li
              key={listing.externalId}
              className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4 shadow-panel"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-semibold text-ink-strong">{listing.name}</p>
                  <p className="text-xs text-ink-muted">
                    {listing.location} · {listing.externalId}
                  </p>
                </div>
                <StatusBadge status={listing.presentationStatus} />
              </div>

              {listing.fundamentals ? (
                <p className="ap-tabular text-xs text-ink-muted">
                  {formatWholeUnits(listing.fundamentals.offeringTarget)} mIDR target
                </p>
              ) : null}

              {listing.assetId ? (
                <Link
                  href={`/owner/property/${listing.assetId}`}
                  className="mt-auto text-sm font-medium text-brand"
                >
                  Manage property
                </Link>
              ) : null}
            </li>
          ))}
        </ul>

        {/* The registry read this page depends on. */}
        <p className="mt-4 text-xs text-ink-subtle">
          {lifecycleState.status === "unavailable" ? lifecycleState.reason : null}
        </p>
      </section>
    </div>
  );
}
