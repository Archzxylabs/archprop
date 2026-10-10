"use client";

import { useState } from "react";
import { ActionButton } from "@/components/transaction-lifecycle";
import { LegalTitleDisclaimer } from "@/components/demo-disclosure";
import {
  CANONICAL_VILLA_NUSA_PRESET,
  formatBps,
  formatWholeUnits,
  parseCanonicalUnsignedDecimal,
  validateCreatePropertyRequest,
  validateEconomicRightsBps,
} from "@/lib/client/view-models";

export type PropertyFormState = {
  externalId: string;
  name: string;
  location: string;
  propertyType: string;
  issuerName: string;
  indicativeValue: string;
  offeringTarget: string;
  tokenSupply: string;
  tokenPrice: string;
  economicRightsBps: string;
  description: string;
};

const INITIAL_FORM_STATE: PropertyFormState = {
  externalId: CANONICAL_VILLA_NUSA_PRESET.externalId,
  name: CANONICAL_VILLA_NUSA_PRESET.name,
  location: CANONICAL_VILLA_NUSA_PRESET.location,
  propertyType: CANONICAL_VILLA_NUSA_PRESET.propertyType,
  issuerName: CANONICAL_VILLA_NUSA_PRESET.issuerName,
  indicativeValue: CANONICAL_VILLA_NUSA_PRESET.indicativeValue,
  offeringTarget: CANONICAL_VILLA_NUSA_PRESET.offeringTarget,
  tokenSupply: CANONICAL_VILLA_NUSA_PRESET.tokenSupply,
  tokenPrice: CANONICAL_VILLA_NUSA_PRESET.tokenPrice,
  economicRightsBps: CANONICAL_VILLA_NUSA_PRESET.economicRightsBps.toString(),
  description: CANONICAL_VILLA_NUSA_PRESET.description,
};

/**
 * Step 1 of the owner listing wizard.
 *
 * Represents all frozen CreatePropertyRequest fields with canonical unsigned
 * base-10 numeric strings, positive supply/price rules, and the target == supply * price
 * invariant.
 *
 * Registration is a wallet write, so this form collects and validates the details
 * while keeping the submit action disabled until a real owner wallet and chain adapter exist.
 */

export interface PropertyDetailsFormProps {
  initialValues?: Partial<PropertyFormState>;
}

export function PropertyDetailsForm({ initialValues }: PropertyDetailsFormProps = {}) {
  const [formState, setFormState] = useState<PropertyFormState>(() => ({
    ...INITIAL_FORM_STATE,
    ...initialValues,
  }));

  const validation = validateCreatePropertyRequest(formState);
  const bpsResult = validateEconomicRightsBps(formState.economicRightsBps);

  const updateField = (
    field: keyof PropertyFormState,
    value: string,
  ) => {
    setFormState((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleResetToPreset = () => {
    setFormState(INITIAL_FORM_STATE);
  };

  // Exact raw numeric strings — no stripping or deleting separators
  const parsedSupply = parseCanonicalUnsignedDecimal(formState.tokenSupply);
  const parsedPrice = parseCanonicalUnsignedDecimal(formState.tokenPrice);
  const parsedTarget = parseCanonicalUnsignedDecimal(formState.offeringTarget);

  const hasValidSupply = parsedSupply !== null && parsedSupply > 0n;
  const hasValidPrice = parsedPrice !== null && parsedPrice > 0n;
  const hasValidTarget = parsedTarget !== null && parsedTarget > 0n;

  const calculatedTarget =
    hasValidSupply && hasValidPrice
      ? parsedSupply * parsedPrice
      : null;

  const matchesInvariant =
    calculatedTarget !== null &&
    hasValidTarget &&
    parsedTarget === calculatedTarget;

  const missingPrerequisite = !validation.isValid
    ? "valid property parameters matching required invariants"
    : "a connected owner wallet on Arbitrum Sepolia";

  return (
    <form
      className="mt-4 flex flex-col gap-6 min-w-0"
      aria-label="Property details"
      onSubmit={(event) => event.preventDefault()}
    >
      {/* Preset loader banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-sunken p-3 text-xs">
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold text-ink-strong">Demo Preset Available</span>
          <span className="text-ink-muted">
            Populate standard canonical Villa Nusa values (ARCHPROP-001, 10B value, 3B target, 300k supply, 10k price, 3000 bps).
          </span>
        </div>
        <button
          type="button"
          onClick={handleResetToPreset}
          className="rounded border border-line-strong bg-surface px-3 py-1.5 font-medium text-ink transition-colors hover:bg-surface-sunken hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Reset to Villa Nusa preset
        </button>
      </div>

      {/* Asset Identity */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 min-w-0">
          <label htmlFor="externalId" className="text-sm font-medium text-ink-muted">
            Asset ID / External ID
          </label>
          <input
            id="externalId"
            name="externalId"
            type="text"
            value={formState.externalId}
            onChange={(e) => updateField("externalId", e.target.value)}
            placeholder="e.g. ARCHPROP-001"
            aria-invalid={!!validation.errors.externalId}
            aria-describedby={validation.errors.externalId ? "externalId-error" : undefined}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
          />
          {validation.errors.externalId ? (
            <p id="externalId-error" role="alert" className="text-xs text-critical">
              {validation.errors.externalId}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5 min-w-0">
          <label htmlFor="name" className="text-sm font-medium text-ink-muted">
            Property name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            value={formState.name}
            onChange={(e) => updateField("name", e.target.value)}
            placeholder="e.g. Villa Nusa"
            aria-invalid={!!validation.errors.name}
            aria-describedby={validation.errors.name ? "name-error" : undefined}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
          />
          {validation.errors.name ? (
            <p id="name-error" role="alert" className="text-xs text-critical">
              {validation.errors.name}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5 min-w-0">
          <label htmlFor="location" className="text-sm font-medium text-ink-muted">
            Location
          </label>
          <input
            id="location"
            name="location"
            type="text"
            value={formState.location}
            onChange={(e) => updateField("location", e.target.value)}
            placeholder="e.g. Bali"
            aria-invalid={!!validation.errors.location}
            aria-describedby={validation.errors.location ? "location-error" : undefined}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
          />
          {validation.errors.location ? (
            <p id="location-error" role="alert" className="text-xs text-critical">
              {validation.errors.location}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5 min-w-0">
          <label htmlFor="propertyType" className="text-sm font-medium text-ink-muted">
            Property type
          </label>
          <input
            id="propertyType"
            name="propertyType"
            type="text"
            value={formState.propertyType}
            onChange={(e) => updateField("propertyType", e.target.value)}
            placeholder="e.g. Villa"
            aria-invalid={!!validation.errors.propertyType}
            aria-describedby={validation.errors.propertyType ? "propertyType-error" : undefined}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
          />
          {validation.errors.propertyType ? (
            <p id="propertyType-error" role="alert" className="text-xs text-critical">
              {validation.errors.propertyType}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2 min-w-0">
          <label htmlFor="issuerName" className="text-sm font-medium text-ink-muted">
            Issuer name
          </label>
          <input
            id="issuerName"
            name="issuerName"
            type="text"
            value={formState.issuerName}
            onChange={(e) => updateField("issuerName", e.target.value)}
            placeholder="e.g. PT Nusa Properties"
            aria-invalid={!!validation.errors.issuerName}
            aria-describedby={validation.errors.issuerName ? "issuerName-error" : undefined}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
          />
          {validation.errors.issuerName ? (
            <p id="issuerName-error" role="alert" className="text-xs text-critical">
              {validation.errors.issuerName}
            </p>
          ) : null}
        </div>
      </div>

      {/* Description */}
      <div className="flex flex-col gap-1.5 min-w-0">
        <label htmlFor="description" className="text-sm font-medium text-ink-muted">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          value={formState.description}
          onChange={(e) => updateField("description", e.target.value)}
          placeholder="What the property is and what the offering represents"
          aria-invalid={!!validation.errors.description}
          aria-describedby={validation.errors.description ? "description-error" : undefined}
          className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
        />
        {validation.errors.description ? (
          <p id="description-error" role="alert" className="text-xs text-critical">
            {validation.errors.description}
          </p>
        ) : null}
      </div>

      {/* Financial & Offering Architecture */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
          Financial & Offering Architecture (mIDR)
        </h3>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-1.5 min-w-0">
            <label htmlFor="indicativeValue" className="text-sm font-medium text-ink-muted">
              Indicative value (mIDR)
            </label>
            <input
              id="indicativeValue"
              name="indicativeValue"
              type="text"
              inputMode="numeric"
              value={formState.indicativeValue}
              onChange={(e) => updateField("indicativeValue", e.target.value)}
              placeholder="10000000000"
              aria-invalid={!!validation.errors.indicativeValue}
              aria-describedby={validation.errors.indicativeValue ? "indicativeValue-error" : undefined}
              className="ap-tabular w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
            />
            {validation.errors.indicativeValue ? (
              <p id="indicativeValue-error" role="alert" className="text-xs text-critical">
                {validation.errors.indicativeValue}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5 min-w-0">
            <label htmlFor="offeringTarget" className="text-sm font-medium text-ink-muted">
              Offering target (mIDR)
            </label>
            <input
              id="offeringTarget"
              name="offeringTarget"
              type="text"
              inputMode="numeric"
              value={formState.offeringTarget}
              onChange={(e) => updateField("offeringTarget", e.target.value)}
              placeholder="3000000000"
              aria-invalid={!!validation.errors.offeringTarget || !!validation.errors.invariant}
              aria-describedby={
                [
                  validation.errors.offeringTarget && "offeringTarget-error",
                  validation.errors.invariant && "offering-invariant-error",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              className="ap-tabular w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
            />
            {validation.errors.offeringTarget ? (
              <p id="offeringTarget-error" role="alert" className="text-xs text-critical">
                {validation.errors.offeringTarget}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5 min-w-0">
            <label htmlFor="economicRightsBps" className="text-sm font-medium text-ink-muted">
              Economic rights (bps)
            </label>
            <input
              id="economicRightsBps"
              name="economicRightsBps"
              type="text"
              inputMode="numeric"
              value={formState.economicRightsBps}
              onChange={(e) => updateField("economicRightsBps", e.target.value)}
              placeholder="3000"
              aria-invalid={!!validation.errors.economicRightsBps}
              aria-describedby={
                validation.errors.economicRightsBps
                  ? "economicRightsBps-error economicRightsBps-hint"
                  : "economicRightsBps-hint"
              }
              className="ap-tabular w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
            />
            <p id="economicRightsBps-hint" className="text-xs text-ink-subtle">
              {bpsResult.isValid && bpsResult.bps !== null
                ? `${formatBps(bpsResult.bps)} participation`
                : "Basis points (100 bps = 1%, range 1–10,000)"}
            </p>
            {validation.errors.economicRightsBps ? (
              <p id="economicRightsBps-error" role="alert" className="text-xs text-critical">
                {validation.errors.economicRightsBps}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5 min-w-0">
            <label htmlFor="tokenSupply" className="text-sm font-medium text-ink-muted">
              Token supply (AVNUSA)
            </label>
            <input
              id="tokenSupply"
              name="tokenSupply"
              type="text"
              inputMode="numeric"
              value={formState.tokenSupply}
              onChange={(e) => updateField("tokenSupply", e.target.value)}
              placeholder="300000"
              aria-invalid={!!validation.errors.tokenSupply || !!validation.errors.invariant}
              aria-describedby={
                [
                  validation.errors.tokenSupply && "tokenSupply-error",
                  validation.errors.invariant && "offering-invariant-error",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              className="ap-tabular w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
            />
            {validation.errors.tokenSupply ? (
              <p id="tokenSupply-error" role="alert" className="text-xs text-critical">
                {validation.errors.tokenSupply}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-2 min-w-0">
            <label htmlFor="tokenPrice" className="text-sm font-medium text-ink-muted">
              Token price (mIDR per unit)
            </label>
            <input
              id="tokenPrice"
              name="tokenPrice"
              type="text"
              inputMode="numeric"
              value={formState.tokenPrice}
              onChange={(e) => updateField("tokenPrice", e.target.value)}
              placeholder="10000"
              aria-invalid={!!validation.errors.tokenPrice || !!validation.errors.invariant}
              aria-describedby={
                [
                  validation.errors.tokenPrice && "tokenPrice-error",
                  validation.errors.invariant && "offering-invariant-error",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              className="ap-tabular w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
            />
            {validation.errors.tokenPrice ? (
              <p id="tokenPrice-error" role="alert" className="text-xs text-critical">
                {validation.errors.tokenPrice}
              </p>
            ) : null}
          </div>
        </div>

        {/* Live Invariant Verification Box */}
        <div
          className={`rounded-lg border p-3 text-xs leading-relaxed min-w-0 break-words ${
            matchesInvariant
              ? "border-verified/30 bg-verified-soft text-ink-strong"
              : "border-critical/30 bg-critical-soft text-critical"
          }`}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-1.5 font-semibold">
            <span>{matchesInvariant ? "✓ Invariant Satisfied:" : "⚠ Invariant Check:"}</span>
            <span>Target == Supply × Price</span>
          </div>
          {calculatedTarget !== null && parsedSupply !== null && parsedPrice !== null ? (
            <p className="mt-1 ap-tabular break-words">
              Supply ({formatWholeUnits(parsedSupply)}) × Price ({formatWholeUnits(parsedPrice)} mIDR) ={" "}
              {formatWholeUnits(calculatedTarget)} mIDR
              {matchesInvariant ? (
                <span className="ml-1 text-verified">
                  (matches offering target {formatWholeUnits(parsedTarget!)} mIDR exactly)
                </span>
              ) : hasValidTarget ? (
                <span className="ml-1 font-medium text-critical">
                  (does not match offering target {formatWholeUnits(parsedTarget!)} mIDR)
                </span>
              ) : null}
            </p>
          ) : (
            <p className="mt-1 text-ink-muted">
              Enter valid supply and price to evaluate the target invariant.
            </p>
          )}
          {validation.errors.invariant ? (
            <p id="offering-invariant-error" role="alert" className="mt-1 font-semibold text-critical break-words">
              {validation.errors.invariant}
            </p>
          ) : null}
        </div>
      </div>

      <LegalTitleDisclaimer className="max-w-2xl" />

      <div className="flex flex-col gap-2 min-w-0">
        <ActionButton
          label="Register property"
          tone="primary"
          disabled
          missingPrerequisite={missingPrerequisite}
          className="w-full sm:w-auto"
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
