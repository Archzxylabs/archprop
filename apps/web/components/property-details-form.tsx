"use client";

import { ActionButton } from "@/components/transaction-lifecycle";
import { LegalTitleDisclaimer } from "@/components/demo-disclosure";

/**
 * Step 1 of the owner listing wizard.
 *
 * Registration is a wallet write, so this form collects the details and states
 * that submitting requires a connected owner wallet. The handler prevents the
 * default navigation until that write exists.
 */

const IDENTITY_FIELDS = [
  { id: "name", label: "Property name", placeholder: "e.g. Villa Nusa" },
  { id: "location", label: "Location", placeholder: "e.g. Bali" },
  { id: "issuer", label: "Issuer name", placeholder: "e.g. PT Nusa Properties" },
] as const;

const NUMERIC_FIELDS = [
  { id: "value", label: "Indicative value (mIDR)", placeholder: "10000000000" },
  { id: "target", label: "Offering target (mIDR)", placeholder: "3000000000" },
  { id: "bps", label: "Economic rights (bps)", placeholder: "3000" },
] as const;

export function PropertyDetailsForm() {
  return (
    <form
      className="mt-4 flex flex-col gap-4"
      aria-label="Property details"
      onSubmit={(event) => event.preventDefault()}
    >
      {IDENTITY_FIELDS.map((field) => (
        <div key={field.id} className="flex flex-col gap-1.5">
          <label htmlFor={field.id} className="text-sm font-medium text-ink-muted">
            {field.label}
          </label>
          <input
            id={field.id}
            name={field.id}
            type="text"
            placeholder={field.placeholder}
            className="rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle"
          />
        </div>
      ))}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="description" className="text-sm font-medium text-ink-muted">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          placeholder="What the property is and what the offering represents"
          className="rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {NUMERIC_FIELDS.map((field) => (
          <div key={field.id} className="flex flex-col gap-1.5">
            <label htmlFor={field.id} className="text-sm font-medium text-ink-muted">
              {field.label}
            </label>
            <input
              id={field.id}
              name={field.id}
              type="text"
              inputMode="numeric"
              placeholder={field.placeholder}
              className="ap-tabular rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle"
            />
          </div>
        ))}
      </div>

      <LegalTitleDisclaimer className="max-w-2xl" />

      <div className="flex flex-col gap-2">
        <ActionButton
          label="Register property"
          tone="primary"
          disabled
          missingPrerequisite="a connected owner wallet on Arbitrum Sepolia"
        />
        <p className="text-xs text-ink-subtle">
          Registering creates the asset record on-chain. It does not mint the
          PropertyToken — token issuance happens later, once the asset is
          verified and issuance prerequisites are met. Steps 2–4 unlock as those
          chain states are reached.
        </p>
      </div>
    </form>
  );
}
