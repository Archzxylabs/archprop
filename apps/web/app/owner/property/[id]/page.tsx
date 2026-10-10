import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoDisclosure, LegalTitleDisclaimer } from "@/components/demo-disclosure";
import { ActionButton } from "@/components/transaction-lifecycle";
import { ChainStateNotice, ConnectWalletPrompt } from "@/components/chain-state";
import { StatusBadge } from "@/components/status-badge";
import { findListingByAssetId } from "@/lib/client/listings";
import {
  EXPECTED_CHAIN_ID,
  chainUnavailable,
  formatBps,
  formatWholeUnits,
} from "@/lib/client/view-models";

/**
 * Owner property detail.
 *
 * Shows the four wizard steps for a single registered asset and the actions
 * each unlocks. Verification progress, documents, and offering state are all
 * registry or storage reads; with no adapter the page states which reads have
 * not happened rather than showing empty sections.
 */

const STEPS = ["Property Details", "Documents", "Verification", "Offering"] as const;

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function OwnerPropertyPage({ params }: PageProps) {
  const { id } = await params;
  const listing = id.startsWith("0x") ? findListingByAssetId(id) : null;

  if (!listing) {
    notFound();
  }

  const documentsState = chainUnavailable<never[]>(
    "Uploaded documents are read from storage once a wallet is connected.",
  );
  const verificationState = chainUnavailable<never[]>(
    "Verification progress is read from the attestation registry once a wallet is connected.",
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="ap-eyebrow">Owner · {listing.externalId}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong sm:text-3xl">
          {listing.name}
        </h1>
        <p className="text-sm text-ink-muted">
          {listing.location} · {listing.issuerName}
        </p>
        <div className="pt-1">
          <StatusBadge status={listing.presentationStatus} />
        </div>
      </header>

      {/* Wizard progress */}
      <ol className="mt-6 flex flex-wrap gap-2" aria-label="Listing progress">
        {STEPS.map((step) => (
          <li
            key={step}
            className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink-muted"
          >
            {step}
          </li>
        ))}
      </ol>

      <DemoDisclosure className="mt-6" />

      {/* Step 1 — details */}
      <section aria-labelledby="step1-heading" className="mt-8">
        <h2 id="step1-heading" className="text-lg font-semibold text-ink-strong">
          1 · Property details
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
              <dt className="text-ink-subtle">Asset ID</dt>
              <dd className="ap-hash text-ink-muted">{listing.assetId}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-subtle">Network</dt>
              <dd className="text-ink-muted">Arbitrum Sepolia · {EXPECTED_CHAIN_ID}</dd>
            </div>
          </dl>
        ) : null}
      </section>

      {/* Step 2 — documents */}
      <section aria-labelledby="step2-heading" className="mt-10">
        <h2 id="step2-heading" className="text-lg font-semibold text-ink-strong">
          2 · Documents
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
          The land right certificate, appraisal, building permit, and economic
          rights agreement are uploaded to storage and hashed on-chain.
        </p>
        <div className="mt-3">
          <ChainStateNotice state={documentsState} label="uploaded documents" />
        </div>
      </section>

      {/* Step 3 — verification */}
      <section aria-labelledby="step3-heading" className="mt-10">
        <h2 id="step3-heading" className="text-lg font-semibold text-ink-strong">
          3 · Verification
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Verification progress is read from the attestation registry. It changes
          only once a verifier wallet&rsquo;s attestation is confirmed on-chain —
          the wizard does not advance optimistically.
        </p>
        <div className="mt-3">
          <ChainStateNotice state={verificationState} label="verification progress" />
        </div>
      </section>

      {/* Step 4 — offering */}
      <section aria-labelledby="step4-heading" className="mt-10">
        <h2 id="step4-heading" className="text-lg font-semibold text-ink-strong">
          4 · Offering
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Opening an offering escrows the tokens for sale. This write requires
          verified ownership and a connected owner wallet.
        </p>

        {listing.fundamentals ? (
          <dl className="mt-3 flex flex-col gap-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-subtle">Offering target</dt>
              <dd className="ap-tabular font-semibold text-ink-strong">
                {formatWholeUnits(listing.fundamentals.offeringTarget)} mIDR
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
        ) : null}

        <div className="mt-4 flex flex-wrap gap-3">
          <ActionButton
            label="Open offering"
            tone="primary"
            disabled
            missingPrerequisite="a connected owner wallet and verified ownership"
          />
        </div>
      </section>

      <LegalTitleDisclaimer className="mt-10 max-w-2xl" />
      <ConnectWalletPrompt className="mt-6" />

      <div className="mt-8 border-t border-line pt-6">
        <Link href="/owner" className="text-sm font-medium text-brand">
          ← Back to your assets
        </Link>
      </div>
    </div>
  );
}
