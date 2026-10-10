import { notFound } from "next/navigation";
import { DemoDisclosure } from "@/components/demo-disclosure";
import { ActionButton } from "@/components/transaction-lifecycle";
import { ConnectWalletPrompt } from "@/components/chain-state";
import { StatusBadge } from "@/components/status-badge";
import { findListing, findListingByAssetId } from "@/lib/client/listings";
import { formatWholeUnits } from "@/lib/client/view-models";

/**
 * Verifier review screen for a single asset.
 *
 * The PRD requires the verifier screen to show the asset, verification type,
 * document, evidence hash, owner wallet, and a demo label, plus reject and
 * verify-on-chain actions.
 *
 * Owner wallet and evidence hash are registry reads. The FE-001 shell has no
 * adapter, so both render their unavailable reason instead of an empty value
 * that would read as "no evidence exists".
 */

interface PageProps {
  params: Promise<{ assetId: string }>;
}

export default async function VerifierDetailPage({ params }: PageProps) {
  const { assetId } = await params;

  const listing = assetId.startsWith("0x")
    ? findListingByAssetId(assetId)
    : findListing(assetId);

  if (!listing) {
    notFound();
  }

  return (
    <div className="ap-page mx-auto w-full max-w-4xl px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="ap-eyebrow">Verifier · {listing.externalId}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong sm:text-3xl">
          {listing.name}
        </h1>
        <p className="text-sm text-ink-muted">
          {listing.location} · {listing.issuerName}
        </p>
      </header>

      <DemoDisclosure className="mt-6" />

      <div className="mt-8 rounded-card border border-line bg-surface p-5 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="ap-eyebrow">Asset</p>
            <p className="text-base font-semibold text-ink-strong">{listing.name}</p>
          </div>
          <StatusBadge status={listing.presentationStatus} />
        </div>

        <dl className="mt-4 flex flex-col gap-3 border-t border-line pt-4 text-sm">
          <div className="flex flex-col gap-0.5">
            <dt className="text-ink-subtle">Asset ID</dt>
            <dd className="ap-hash text-ink-muted">{listing.assetId ?? "Not registered on-chain"}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-ink-subtle">Verification type</dt>
            <dd className="font-medium text-ink-strong">Ownership</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-ink-subtle">Document</dt>
            <dd className="font-medium text-ink-strong">Land right certificate</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-ink-subtle">Evidence hash</dt>
            <dd className="leading-relaxed text-ink-muted">
              <span className="font-semibold text-ink-muted">Unavailable:</span> the
              evidence hash is read from the attestation record once a wallet is
              connected.
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-ink-subtle">Owner wallet</dt>
            <dd className="leading-relaxed text-ink-muted">
              <span className="font-semibold text-ink-muted">Unavailable:</span> the
              owner wallet is read from the registry once a wallet is connected.
            </dd>
          </div>
        </dl>
      </div>

      <section aria-labelledby="attestation-heading" className="mt-8">
        <h2 id="attestation-heading" className="text-lg font-semibold text-ink-strong">
          Attestation
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Both actions submit a wallet transaction. They are disabled until a
          verifier wallet is connected to Arbitrum Sepolia.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          <ActionButton
            label="Verify on-chain"
            tone="primary"
            disabled
            missingPrerequisite="a connected verifier wallet on Arbitrum Sepolia"
          />
          <ActionButton
            label="Reject"
            tone="danger"
            disabled
            missingPrerequisite="a connected verifier wallet on Arbitrum Sepolia"
          />
        </div>

        <ConnectWalletPrompt className="mt-6" />
      </section>

      <section aria-labelledby="published-heading" className="mt-8">
        <h2 id="published-heading" className="text-lg font-semibold text-ink-strong">
          Published economics
        </h2>
        {listing.fundamentals ? (
          <dl className="mt-3 flex flex-col gap-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-subtle">Indicative value</dt>
              <dd className="ap-tabular font-semibold text-ink-strong">
                {formatWholeUnits(listing.fundamentals.indicativeValue)} mIDR
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-subtle">Offering target</dt>
              <dd className="ap-tabular font-semibold text-ink-strong">
                {formatWholeUnits(listing.fundamentals.offeringTarget)} mIDR
              </dd>
            </div>
          </dl>
        ) : null}
      </section>
    </div>
  );
}
