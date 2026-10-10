import Link from "next/link";
import { DemoDisclosure } from "@/components/demo-disclosure";
import { ConnectWalletPrompt } from "@/components/chain-state";
import { PropertyDetailsForm } from "@/components/property-details-form";
import { formatWholeUnits } from "@/lib/client/view-models";

/**
 * Owner listing wizard — step 1: property details.
 *
 * The PRD fixes a four-step wizard: property details, documents, verification,
 * offering. Registration is a wallet write, so the FE-001 shell collects the
 * details and states that submitting requires a connected owner wallet.
 */

const STEPS = ["Property Details", "Documents", "Verification", "Offering"] as const;

export default function NewPropertyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="ap-eyebrow">Owner · List a property</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong sm:text-3xl">
          Property details
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">
          Registering an asset writes it to the registry from your wallet. Nothing
          is submitted on your behalf.
        </p>
      </header>

      {/* Step indicator */}
      <ol className="mt-6 flex flex-wrap gap-2" aria-label="Wizard progress">
        {STEPS.map((step, index) => {
          const isCurrent = index === 0;
          const isComplete = index < 0;
          return (
            <li
              key={step}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                isCurrent
                  ? "border-brand bg-brand-soft text-brand"
                  : isComplete
                    ? "border-verified/30 bg-verified-soft text-verified"
                    : "border-line bg-surface text-ink-subtle"
              }`}
            >
              <span className="ap-tabular mr-1.5">{index + 1}</span>
              {step}
            </li>
          );
        })}
      </ol>

      <DemoDisclosure className="mt-6" />

      <section aria-labelledby="details-heading" className="mt-8">
        <h2 id="details-heading" className="text-lg font-semibold text-ink-strong">
          Step 1 · Property details
        </h2>

        <PropertyDetailsForm />
      </section>

      <ConnectWalletPrompt className="mt-8" />

      <div className="mt-8 flex items-center justify-between border-t border-line pt-6">
        <Link href="/owner" className="text-sm font-medium text-brand">
          ← Back to your assets
        </Link>
        <p className="text-sm text-ink-subtle">
          Next: <span className="font-medium text-ink-muted">Documents</span>
        </p>
      </div>

      <p className="mt-6 text-xs text-ink-subtle">
        Reference target: {formatWholeUnits(3_000_000_000n)} mIDR ·{" "}
        {formatWholeUnits(10_000n)} mIDR per token.
      </p>
    </div>
  );
}
