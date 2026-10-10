import Link from "next/link";
import type { AssetId } from "@archprop/shared";
import { DemoDisclosure } from "@/components/demo-disclosure";
import { ChainValue } from "@/components/chain-state";
import { StatusBadge } from "@/components/status-badge";
import { buildMarketplaceCards, findListing } from "@/lib/client/listings";
import {
  chainUnavailable,
  formatBps,
  formatWholeUnits,
  type ChainDataState,
  type FundingView,
} from "@/lib/client/view-models";

/**
 * Marketplace listing.
 *
 * Funding is an escrow read. No wallet is connected in the FE-001 shell, so
 * every card renders the escrow's unavailable reason rather than a percentage:
 * the PRD's "72% funded" seed is what the chain will return once a read
 * exists, not a figure this screen invents.
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

export default function MarketplacePage() {
  const cards = buildMarketplaceCards(readFundingUnavailable);

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="ap-eyebrow">Marketplace</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong sm:text-3xl">
          Property-backed offerings
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">
          Every listing publishes its name, location, and verification state.
          Raised amount, funding progress, and balances are read from the
          blockchain and are shown only once that read succeeds.
        </p>
      </header>

      <DemoDisclosure className="mt-6" />

      <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <li
            key={card.externalId}
              className="flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-panel"
            >
              {/* Image */}
              <div className="aspect-4/3 bg-surface-sunken">
                {card.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={card.imageUrl}
                    alt={`${card.name}, ${card.location}`}
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center p-4 text-center text-xs text-ink-subtle">
                    No image published
                  </div>
                )}
              </div>

              <div className="flex flex-1 flex-col gap-3 p-4">
                <div className="flex flex-col gap-1">
                  <h2 className="text-base font-semibold text-ink-strong">{card.name}</h2>
                  <p className="text-xs text-ink-muted">{card.location}</p>
                </div>

                <StatusBadge status={card.presentationStatus} />

                <p className="text-xs leading-relaxed text-ink-muted">
                  {listingSummary(card.externalId)}
                </p>

                {/* Published fundamentals */}
                {card.fundamentals ? (
                  <dl className="flex flex-col gap-1.5 border-t border-line pt-3 text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-ink-subtle">Property value</dt>
                      <dd className="ap-tabular font-semibold text-ink-strong">
                        {formatWholeUnits(card.fundamentals.indicativeValue)} mIDR
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-ink-subtle">Offering size</dt>
                      <dd className="ap-tabular font-semibold text-ink-strong">
                        {formatWholeUnits(card.fundamentals.offeringTarget)} mIDR
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-ink-subtle">Token price</dt>
                      <dd className="ap-tabular font-semibold text-ink-strong">
                        {formatWholeUnits(card.fundamentals.tokenPrice)} mIDR
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="border-t border-line pt-3 text-xs leading-relaxed text-ink-subtle">
                    This listing has not published fundamentals.
                  </p>
                )}

                {/* Funding: chain-authoritative, shown only when read */}
                <div className="mt-auto flex flex-col gap-1 border-t border-line pt-3">
                  <p className="ap-eyebrow">Funding</p>
                  <ChainValue state={card.funding} label="funding progress">
                    {(funding) => (
                      <span className="ap-tabular text-sm font-semibold text-ink-strong">
                        {formatBps(funding.percentBps)} ·{" "}
                        {formatWholeUnits(funding.raisedAmount)} of{" "}
                        {formatWholeUnits(funding.targetAmount)} mIDR
                      </span>
                    )}
                  </ChainValue>
                </div>

                {card.assetId ? (
                  <Link
                    href={`/property/${card.assetId}`}
                    className="rounded-lg bg-brand px-4 py-2.5 text-center text-sm font-semibold text-ink-inverse transition-colors hover:bg-brand-deep"
                  >
                    View property
                  </Link>
                ) : (
                  <p className="rounded-lg border border-line bg-surface-sunken px-4 py-2.5 text-center text-xs text-ink-subtle">
                    No on-chain asset yet
                  </p>
                )}
              </div>
            </li>
          ))}
      </ul>

      {/* Verbatim listing references */}
      <section className="mt-12" aria-labelledby="listing-ids-heading">
        <h2 id="listing-ids-heading" className="text-lg font-semibold text-ink-strong">
          Listings by identifier
        </h2>
        <ul className="mt-3 flex flex-col gap-1 text-sm text-ink-muted">
          {cards.map((card) => (
            <li key={card.externalId}>
              <code className="ap-hash">{card.externalId}</code> — {card.name}
              {card.assetId ? (
                <>
                  {" · "}
                  <code className="ap-hash">{card.assetId}</code>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
