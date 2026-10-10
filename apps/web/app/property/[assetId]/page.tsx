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
  chainError,
  chainReady,
  chainUnavailable,
  explorerAddressUrl,
  formatBps,
  formatWholeUnits,
  type ChainDataState,
} from "@/lib/client/view-models";
import {
  deriveOfferingForAsset,
  fetchAttestationRecords,
  getArchpropPublicClient,
  getClientChainConfig,
  inspectClientChainConfig,
  type AttestationRecords,
  type DerivedOffering,
} from "@/lib/client/chain-client";

/**
 * Property detail.
 *
 * The six sections appear in the order the PRD fixes: overview, verification,
 * economic rights, offering, on-chain proof, revenue.
 *
 * Rendered on every request: lifecycle, attestation, and offering state are
 * chain-authoritative, so a build-time static snapshot would age into a false
 * claim about the offering.
 */
export const dynamic = "force-dynamic";

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

  const config = getClientChainConfig();
  let verificationState: ChainDataState<AttestationRecords>;
  let offeringState: ChainDataState<{
    raisedAmount: bigint;
    targetAmount: bigint;
    isFinalized: boolean;
    isReleased: boolean;
    isFailed: boolean;
  }>;
  let derivedOffering: DerivedOffering | null = null;
  const revenueState = chainUnavailable<{ claimableAmount: bigint | null }>(
    "Revenue distributions are read from the revenue distributor once a wallet is connected.",
  );

  if (config) {
    try {
      const client = getArchpropPublicClient(config);
      const [attestations, offering] = await Promise.all([
        fetchAttestationRecords(client, config.addresses.registry, canonicalAssetId),
        deriveOfferingForAsset(client, config.addresses, canonicalAssetId),
      ]);

      derivedOffering = offering;

      if (attestations.ownership || attestations.valuation) {
        verificationState = chainReady(attestations);
      } else {
        verificationState = chainUnavailable(
          "No confirmed attestations found on-chain for this asset.",
        );
      }

      if (offering) {
        offeringState = chainReady({
          raisedAmount: offering.raised,
          targetAmount: offering.target,
          isFinalized: offering.status === "FUNDED",
          isReleased: offering.fundsReleased,
          isFailed: offering.status === "FAILED",
        });
      } else {
        offeringState = chainUnavailable(
          "No on-chain offering found in OfferingEscrow for this asset.",
        );
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      verificationState = chainError(`Failed to read attestations: ${reason}`);
      offeringState = chainError(`Failed to read offering accounting: ${reason}`);
    }
  } else {
    const report = inspectClientChainConfig();
    const reason =
      report.errors.length > 0
        ? `Chain configuration incomplete: ${report.errors.join("; ")}`
        : "Chain configuration unavailable in this environment.";
    verificationState = chainUnavailable(reason);
    offeringState = chainUnavailable(reason);
  }

  return (
    <div className="ap-page property-page mx-auto w-full max-w-6xl px-4 sm:px-5 py-8 sm:py-10">
      {/* 1. Property overview */}
      <section aria-labelledby="overview-heading" className="property-overview flex flex-col gap-4">
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
      <section aria-labelledby="verification-heading" className="property-detail-section mt-12" data-section="02">
        <h2 id="verification-heading" className="text-lg font-semibold text-ink-strong">
          Verification
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Ownership and valuation are attested on-chain by a verifier wallet. Each
          record below is a registry read, not a document review.
        </p>

        <div className="mt-4">
          <ChainValue state={verificationState} label="attestation records">
            {(records) => (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-card border border-line bg-surface p-4">
                  <p className="ap-eyebrow">Ownership Attestation</p>
                  {records.ownership ? (
                    <div className="mt-2 flex flex-col gap-1 text-xs">
                      <p className="text-brand font-semibold">✓ Confirmed On-Chain</p>
                      <p className="text-ink-subtle">
                        Verifier: <code className="ap-hash">{records.ownership.verifier}</code>
                      </p>
                      <p className="text-ink-subtle">
                        Evidence: <code className="ap-hash">{records.ownership.evidenceHash}</code>
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-ink-muted">No valid ownership attestation submitted.</p>
                  )}
                </div>
                <div className="rounded-card border border-line bg-surface p-4">
                  <p className="ap-eyebrow">Valuation Attestation</p>
                  {records.valuation ? (
                    <div className="mt-2 flex flex-col gap-1 text-xs">
                      <p className="text-brand font-semibold">✓ Confirmed On-Chain</p>
                      <p className="text-ink-subtle">
                        Verifier: <code className="ap-hash">{records.valuation.verifier}</code>
                      </p>
                      <p className="text-ink-subtle">
                        Valuation: {formatWholeUnits(records.valuation.value)} mIDR
                      </p>
                      <p className="text-ink-subtle">
                        Evidence: <code className="ap-hash">{records.valuation.evidenceHash}</code>
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-ink-muted">No valid valuation attestation submitted.</p>
                  )}
                </div>
              </div>
            )}
          </ChainValue>
        </div>
      </section>

      {/* 3. Economic rights */}
      <section aria-labelledby="economic-heading" className="property-detail-section mt-12" data-section="03">
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
      <section aria-labelledby="offering-heading" className="property-detail-section mt-12" data-section="04">
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
              assetId={canonicalAssetId}
              tokenPrice={listing.fundamentals.tokenPrice}
              tokenSymbol={listing.fundamentals.tokenSymbol}
              offeringTarget={listing.fundamentals.offeringTarget}
              remainingCap={derivedOffering?.remainingCap}
              offeringId={derivedOffering?.offeringId}
              offeringStatus={derivedOffering?.status}
              chainState={offeringState}
            />
          </div>
        ) : null}
      </section>

      {/* 5. On-chain proof */}
      <section aria-labelledby="proof-heading" className="property-detail-section mt-12" data-section="05">
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
            {config ? (
              <dd className="text-ink-muted flex flex-wrap items-center gap-2">
                <code className="ap-hash">{config.addresses.registry}</code>
                <a
                  href={explorerAddressUrl(config.addresses.registry) ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-brand underline decoration-dotted"
                >
                  View on Arbiscan
                </a>
              </dd>
            ) : (
              <dd className="text-ink-muted">
                Registry address unavailable — no validated contract address is
                configured in this environment, so no Arbiscan link is offered.
              </dd>
            )}
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
      <section aria-labelledby="revenue-heading" className="property-detail-section mt-12" data-section="06">
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
