import type { AssetId, AttestationType, DocumentType } from "@archprop/shared";
import { DemoDisclosure, LegalTitleDisclaimer } from "@/components/demo-disclosure";
import { ActionButton } from "@/components/transaction-lifecycle";
import { ConnectWalletPrompt } from "@/components/chain-state";
import { StatusBadge } from "@/components/status-badge";
import { findListing } from "@/lib/client/listings";
import { formatWholeUnits } from "@/lib/client/view-models";

/**
 * Verifier review screen.
 *
 * This is the primary hackathon demo surface. It shows one asset with the
 * evidence a verifier needs — document, evidence hash, owner wallet — and
 * offers the verify and reject writes.
 *
 * Both writes require a connected wallet and a matching on-chain asset. With
 * neither present the buttons are disabled and each states what is missing,
 * rather than failing silently or implying a write succeeded.
 */

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  LAND_RIGHT: "Land right certificate",
  APPRAISAL: "Appraisal report",
  BUILDING_PERMIT: "Building permit",
  ECONOMIC_RIGHTS_AGREEMENT: "Economic rights agreement",
};

const ATTESTATION_LABELS: Record<AttestationType, string> = {
  OWNERSHIP: "Ownership",
  VALUATION: "Valuation",
  REVENUE: "Revenue",
};

interface VerifierTarget {
  assetId: AssetId;
  externalId: string;
  name: string;
  location: string;
  issuerName: string;
  documentType: DocumentType;
  attestationType: AttestationType;
}

/** The asset this screen reviews. Resolved from the published listings. */
function resolveTarget(): VerifierTarget | null {
  const listing = findListing("ARCHPROP-001");
  if (!listing?.assetId) {
    return null;
  }
  return {
    assetId: listing.assetId,
    externalId: listing.externalId,
    name: listing.name,
    location: listing.location,
    issuerName: listing.issuerName,
    documentType: "LAND_RIGHT",
    attestationType: "OWNERSHIP",
  };
}

export default function VerifierPage() {
  const target = resolveTarget();

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="ap-eyebrow">Verifier · Demo</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong sm:text-3xl">
          Review an asset
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">
          Review the evidence behind an asset, then attest ownership or valuation
          on-chain. Attestation progress is read from the registry — the display
          changes only once the chain reflects the write.
        </p>
      </header>

      <DemoDisclosure className="mt-6" />

      {!target ? (
        <p className="mt-8 rounded-card border border-line bg-surface-sunken px-4 py-3 text-sm text-ink-muted">
          No verifiable asset is published in this environment.
        </p>
      ) : (
        <>
          {/* Asset under review */}
          <section aria-labelledby="asset-heading" className="mt-8">
            <h2 id="asset-heading" className="text-lg font-semibold text-ink-strong">
              Asset
            </h2>

            <div className="mt-4 rounded-card border border-line bg-surface p-5 shadow-panel">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <p className="ap-eyebrow">{target.externalId}</p>
                  <p className="text-base font-semibold text-ink-strong">
                    {target.name}
                  </p>
                  <p className="text-sm text-ink-muted">
                    {target.location} · {target.issuerName}
                  </p>
                </div>
                <StatusBadge status="VERIFICATION_PENDING" />
              </div>

              <dl className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-sm">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-ink-subtle">Asset ID</dt>
                  <dd className="ap-hash text-ink-muted">{target.assetId}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-ink-subtle">Verification type</dt>
                  <dd className="font-medium text-ink-strong">
                    {ATTESTATION_LABELS[target.attestationType]}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-ink-subtle">Document</dt>
                  <dd className="font-medium text-ink-strong">
                    {DOCUMENT_LABELS[target.documentType]}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-ink-subtle">Owner wallet</dt>
                  <dd className="text-ink-muted">
                    <span className="font-semibold text-ink-muted">Unavailable:</span>{" "}
                    the owner wallet is read from the registry once a wallet is
                    connected.
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-ink-subtle">Evidence hash</dt>
                  <dd className="text-ink-muted">
                    <span className="font-semibold text-ink-muted">Unavailable:</span>{" "}
                    the evidence hash is read from the attestation record once a
                    wallet is connected.
                  </dd>
                </div>
              </dl>
            </div>
          </section>

          {/* Attestation actions */}
          <section aria-labelledby="actions-heading" className="mt-10">
            <h2 id="actions-heading" className="text-lg font-semibold text-ink-strong">
              Attestation
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
              Both writes submit a transaction from the connected verifier wallet.
              They are disabled until that wallet is present and connected to
              Arbitrum Sepolia.
            </p>

            <div className="mt-4 flex flex-col gap-3">
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

            <div className="mt-6">
              <ConnectWalletPrompt
                title="Connect a verifier wallet to attest"
                description="Attestation is a wallet write. This screen shows the evidence to review, but will not send a transaction until a wallet is connected."
              />
            </div>
          </section>

          {/* Published economics for context */}
          <section aria-labelledby="economics-heading" className="mt-10">
            <h2 id="economics-heading" className="text-lg font-semibold text-ink-strong">
              Published economics
            </h2>
            <dl className="mt-3 flex flex-col gap-2 text-sm">
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
            </dl>
            <LegalTitleDisclaimer className="mt-4 max-w-2xl" />
          </section>
        </>
      )}
    </div>
  );
}
