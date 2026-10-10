import Link from "next/link";
import { notFound } from "next/navigation";
import type { AssetId } from "@archprop/shared";
import {
  DemoDisclosure,
  LegalTitleDisclaimer,
} from "@/components/demo-disclosure";
import {
  ChainStateNotice,
  ChainValue,
  ConnectWalletPrompt,
  WrongNetworkNotice,
} from "@/components/chain-state";
import { StatusBadge } from "@/components/status-badge";
import { InvestmentPanel } from "@/components/investment-panel";
import { findListing, findListingByAssetId } from "@/lib/client/listings";
import {
  EXPECTED_CHAIN_ID,
  chainUnavailable,
  formatBps,
  formatWholeUnits,
} from "@/lib/client/view-models";

/**
 * Property detail.
 *
 * The six sections appear in the order the PRD fixes: overview, verification,
 * economic rights, offering, on-chain proof, revenue.
 *
 * Verification cards, offering accounting, on-chain proof, and revenue are all
 * chain reads. The FE-001 shell has no adapter, so each one renders its
 * unavailable reason. Nothing on this page substitutes a static value for a
 * read that has not happened.
 */

interface PageProps {
  params: Promise<{ assetId: string }>;
}

export default async function PropertyPage({ params }: PageProps) {
  const { assetId } = await params;

  const listing = assetId.startsWith("0x")
    ? findListingByAssetId(assetId)
    : findListing(assetId);

  if (!listing || !listing.assetId) {
    notFound();
  }

  const canonicalAssetId = listing.assetId as AssetId;

  /**
   * Verification records are attestation reads. No adapter means no records,
   * and the section says so rather than showing an empty state that looks like
   * a completed read.
   */
  const verificationState = chainUnavailable<never[]>(
    "Attestation records are read from the attestation registry once a wallet is connected.",
  );

  const offeringState = chainUnavailable<{
    raisedAmount: bigint;
    targetAmount: bigint;
    isFinalized: boolean;
    isReleased: boolean;
    isFailed: boolean;
  }>("Offering accounting is read from the escrow contract once a wallet is connected.");

  const revenueState = chainUnavailable<{ claimableAmount: bigint | null }>(
    "Revenue distributions are read from the revenue distributor once a wallet is connected.",
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10">
      {/* 1. Property overview */}
      <section aria-labelledby="overview-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="ap-eyebrow">{listing.externalId}</p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-strong sm:text-3xl">
            {listing.name}
          </h1>
          <p className="text-sm text-ink-muted">
            {listing.location} · {listing.issuerName}
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
          <div className="flex flex-col gap-4">
            <div className="aspect-16/9 overflow-hidden rounded-card border border-line bg-surface-sunken">
              {listing.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={listing.imageUrl}
                  alt={`${listing.name}, ${listing.location}`}
                  className="size-full object-cover"
                />
              ) : null}
            </div>
            <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">
              {listing.summary}
            </p>
            <StatusBadge status={listing.presentationStatus} />
          </div>

          {listing.fundamentals ? (
            <aside className="rounded-card border border-line bg-surface p-5 shadow-panel">
              <p className="ap-eyebrow">Published fundamentals</p>
              <dl className="mt-3 flex flex-col gap-2 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-subtle">Property value</dt>
                  <dd className="ap-tabular font-semibold text-ink-strong">
                    {formatWholeUnits(listing.fundamentals.indicativeValue)} mIDR
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-subtle">Offering size</dt>
                  <dd className="ap-tabular font-semibold text-ink-strong">
                    {formatWholeUnits(listing.fundamentals.offeringTarget)} mIDR
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-subtle">Token supply</dt>
                  <dd className="ap-tabular font-semibold text-ink-strong">
                    {formatWholeUnits(listing.fundamentals.tokenSupply)}{" "}
                    {listing.fundamentals.tokenSymbol}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-subtle">Token price</dt>
                  <dd className="ap-tabular font-semibold text-ink-strong">
                    {formatWholeUnits(listing.fundamentals.tokenPrice)} mIDR
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-subtle">Economic rights</dt>
                  <dd className="ap-tabular font-semibold text-ink-strong">
                    {formatBps(listing.fundamentals.economicRightsBps)}
                  </dd>
                </div>
              </dl>
            </aside>
          ) : null}
        </div>
      </section>

      {/* 2. Verification */}
      <section aria-labelledby="verification-heading" className="mt-12">
        <h2 id="verification-heading" className="text-lg font-semibold text-ink-strong">
          Verification
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Ownership and valuation are attested on-chain by a verifier wallet. Each
          record below is a registry read, not a document review.
        </p>

        <div className="mt-4">
          <ChainStateNotice state={verificationState} label="attestation records" />
        </div>
      </section>

      {/* 3. Economic rights */}
      <section aria-labelledby="economic-heading" className="mt-12">
        <h2 id="economic-heading" className="text-lg font-semibold text-ink-strong">
          Economic rights
        </h2>
        <LegalTitleDisclaimer className="mt-3 max-w-3xl" />
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-muted">
          Holding {listing.fundamentals?.tokenSymbol ?? "the asset token"}{" "}
          represents defined economic participation rights in a demo agreement —
          a share of revenue as the agreement sets out. It is not a share deed,
          not a mortgage, and not title to the land.
        </p>
        {listing.fundamentals ? (
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-muted">
            The published economic participation is{" "}
            <span className="ap-tabular font-semibold text-ink-strong">
              {formatBps(listing.fundamentals.economicRightsBps)}
            </span>
            , across{" "}
            <span className="ap-tabular font-semibold text-ink-strong">
              {formatWholeUnits(listing.fundamentals.tokenSupply)}{" "}
              {listing.fundamentals.tokenSymbol}
            </span>
            .
          </p>
        ) : null}
      </section>

      {/* 4. Offering */}
      <section aria-labelledby="offering-heading" className="mt-12">
        <h2 id="offering-heading" className="text-lg font-semibold text-ink-strong">
          Offering
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Raised amount, target, and escrow state are read from the offering
          escrow. They are not shown until that read succeeds.
        </p>

        <div className="mt-4 rounded-card border border-line bg-surface p-5 shadow-panel">
          <ChainValue state={offeringState} label="offering accounting">
            {(offering) => {
              const percentBps =
                offering.targetAmount > 0n
                  ? Number(
                      (offering.raisedAmount * 10_000n) / offering.targetAmount,
                    )
                  : 0;
              return (
                <dl className="flex flex-col gap-2 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-ink-subtle">Raised</dt>
                    <dd className="ap-tabular font-semibold text-ink-strong">
                      {formatWholeUnits(offering.raisedAmount)} mIDR
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-ink-subtle">Target</dt>
                    <dd className="ap-tabular font-semibold text-ink-strong">
                      {formatWholeUnits(offering.targetAmount)} mIDR
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-ink-subtle">Progress</dt>
                    <dd className="ap-tabular font-semibold text-ink-strong">
                      {formatBps(percentBps)}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-ink-subtle">Escrow state</dt>
                    <dd className="font-semibold text-ink-strong">
                      {offering.isFailed
                        ? "Failed"
                        : offering.isReleased
                          ? "Released"
                          : offering.isFinalized
                            ? "Finalized"
                            : "Open"}
                    </dd>
                  </div>
                </dl>
              );
            }}
          </ChainValue>
        </div>

        {listing.fundamentals ? (
          <div className="mt-6">
            <InvestmentPanel
              tokenPrice={listing.fundamentals.tokenPrice}
              tokenSymbol={listing.fundamentals.tokenSymbol}
              offeringTarget={listing.fundamentals.offeringTarget}
              chainState={offeringState}
            />
          </div>
        ) : null}
      </section>

      {/* 5. On-chain proof */}
      <section aria-labelledby="proof-heading" className="mt-12">
        <h2 id="proof-heading" className="text-lg font-semibold text-ink-strong">
          On-chain proof
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
          The asset identifier and registry address are the canonical on-chain
          references for this property.
        </p>

        <dl className="mt-4 flex flex-col gap-2 text-sm">
          <div className="flex flex-col gap-0.5">
            <dt className="text-ink-subtle">Asset ID</dt>
            <dd className="ap-hash text-ink-muted">{canonicalAssetId}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-ink-subtle">Registry</dt>
            <dd className="text-ink-muted">
              Registry address unavailable — no validated contract address is
              configured in this environment. Arbiscan links appear here once
              chain configuration is wired (FE-002).
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-ink-subtle">Network</dt>
            <dd className="text-ink-muted">
              Arbitrum Sepolia · {EXPECTED_CHAIN_ID}
            </dd>
          </div>
        </dl>

        <WrongNetworkNotice expectedChainId={EXPECTED_CHAIN_ID} className="mt-4" />
      </section>

      {/* 6. Revenue / distributions */}
      <section aria-labelledby="revenue-heading" className="mt-12">
        <h2 id="revenue-heading" className="text-lg font-semibold text-ink-strong">
          Revenue / distributions
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Claimable revenue is a per-investor read from the revenue distributor.
          In this demo environment distributions are simulated.
        </p>

        <div className="mt-4 flex flex-col gap-4">
          <ChainStateNotice state={revenueState} label="claimable revenue" />
          <ConnectWalletPrompt
            title="Connect a wallet to read revenue"
            description="Claimable amounts depend on the connected wallet's token balance, which is read from the chain."
          />
        </div>
      </section>

      <DemoDisclosure className="mt-12" />

      <div className="mt-8">
        <Link href="/marketplace" className="text-sm font-medium text-brand">
          ← Back to marketplace
        </Link>
      </div>
    </div>
  );
}
