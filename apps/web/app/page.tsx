import type { AssetId } from "@archprop/shared";
import Link from "next/link";
import { LegalTitleDisclaimer } from "@/components/demo-disclosure";
import { buildMarketplaceCards, findListing } from "@/lib/client/listings";
import {
  chainUnavailable,
  formatCompact,
  formatWholeUnits,
  type ChainDataState,
  type FundingView,
} from "@/lib/client/view-models";

/**
 * Landing page.
 *
 * This screen is presentation-only. It carries no wallet, no chain reads, and
 * no fabricated economics: every on-chain number it would want to show is a
 * `ChainDataState` that no adapter has resolved yet, so the UI says so instead
 * of substituting a static figure.
 */

/**
 * No adapter is connected on the landing page, so funding is unavailable for
 * every asset. This is the truthful state, not a placeholder: FE-002 supplies
 * the real read and this line disappears.
 */
function readFundingUnavailable(assetId: AssetId): ChainDataState<FundingView> {
  void assetId;
  return chainUnavailable<FundingView>(
    "Funding is read from the offering escrow once a wallet is connected.",
  );
}

/** The published one-line summary for a listing, from its seed. */
function listingSummary(externalId: string): string {
  return findListing(externalId)?.summary ?? "";
}

export default function HomePage() {
  const cards = buildMarketplaceCards((assetId) => readFundingUnavailable(assetId));

  return (
    <div className="mx-auto w-full max-w-6xl px-5">
      {/* Hero */}
      <section className="py-14 sm:py-20" aria-labelledby="hero-heading">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <div className="flex flex-col gap-5">
            <p className="ap-eyebrow">Real-World Asset Marketplace</p>
            <h1
              id="hero-heading"
              className="text-3xl font-semibold tracking-tight text-ink-strong sm:text-4xl"
            >
              Property-backed assets, verified on-chain
            </h1>
            <p className="max-w-2xl text-base leading-relaxed text-ink-muted">
              Archprop connects property owners with investors. Owners register an
              asset and publish the documents behind it. Verifiers attest ownership
              and valuation. Investors then participate in defined economic rights,
              recorded on Arbitrum Sepolia.
            </p>
            <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">
              No wallet is required to browse. Connecting one only enables reading
              and writing on-chain state — it never changes how a number is
              displayed.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                href="/marketplace"
                className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-ink-inverse transition-colors hover:bg-brand-deep"
              >
                Browse the marketplace
              </Link>
              <Link
                href="/owner"
                className="rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-sunken"
              >
                List a property
              </Link>
            </div>
          </div>

          {/* Published fundamentals for the primary demo asset. */}
          <aside className="rounded-card border border-line bg-surface p-5 shadow-panel">
            <p className="ap-eyebrow">Primary demo asset</p>
            <p className="mt-2 text-lg font-semibold text-ink-strong">Villa Nusa</p>
            <p className="text-sm text-ink-muted">Bali · PT Nusa Properties</p>
            <dl className="mt-4 flex flex-col gap-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-subtle">Indicative value</dt>
                <dd className="ap-tabular font-semibold text-ink-strong">
                  {formatWholeUnits(10_000_000_000n)} mIDR
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-subtle">Offering target</dt>
                <dd className="ap-tabular font-semibold text-ink-strong">
                  {formatWholeUnits(3_000_000_000n)} mIDR
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-subtle">Token price</dt>
                <dd className="ap-tabular font-semibold text-ink-strong">
                  {formatWholeUnits(10_000n)} mIDR
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-subtle">Economic rights</dt>
                <dd className="ap-tabular font-semibold text-ink-strong">
                  {formatCompact(3_000n)} bps
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-ink-subtle">
              These are the figures the asset has published. Raised amount and
              funding progress come from the escrow and are not shown here.
            </p>
          </aside>
        </div>
      </section>

      {/* Marketplace preview */}
      <section className="pb-6" aria-labelledby="listings-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2
            id="listings-heading"
            className="text-xl font-semibold tracking-tight text-ink-strong"
          >
            Listings
          </h2>
          <Link href="/marketplace" className="text-sm font-medium text-brand">
            View all
          </Link>
        </div>

        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <li
              key={card.externalId}
              className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-panel"
            >
              <div className="aspect-4/3 overflow-hidden rounded-lg bg-surface-sunken">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={card.imageUrl ?? undefined}
                  alt={`${card.name}, ${card.location}`}
                  className="size-full object-cover"
                />
              </div>
              <div>
                <p className="text-sm font-semibold text-ink-strong">{card.name}</p>
                <p className="text-xs text-ink-muted">{card.location}</p>
              </div>
              <p className="text-xs leading-relaxed text-ink-muted">
                {listingSummary(card.externalId)}
              </p>
              <Link
                href={
                  card.assetId
                    ? `/property/${card.assetId}`
                    : "/marketplace"
                }
                className="mt-auto text-sm font-medium text-brand"
              >
                View property
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <LegalTitleDisclaimer className="my-8" />

      {/* Role entry points */}
      <section className="pb-14" aria-labelledby="roles-heading">
        <h2
          id="roles-heading"
          className="text-xl font-semibold tracking-tight text-ink-strong"
        >
          Three roles
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {(
            [
              {
                href: "/owner",
                title: "Owners",
                body: "Register a property, publish documents, and open an offering once verification is complete.",
              },
              {
                href: "/verifier",
                title: "Verifiers",
                body: "Review the evidence behind an asset and attest ownership or valuation on-chain.",
              },
              {
                href: "/portfolio",
                title: "Investors",
                body: "Hold tokens, track an offering, and claim simulated revenue distributions.",
              },
            ] as const
          ).map((role) => (
            <Link
              key={role.href}
              href={role.href}
              className="rounded-card border border-line bg-surface p-4 shadow-panel transition-colors hover:border-brand-line"
            >
              <p className="text-sm font-semibold text-ink-strong">{role.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">{role.body}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
