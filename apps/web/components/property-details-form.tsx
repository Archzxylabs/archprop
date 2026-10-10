"use client";

import { useState } from "react";
import type { CreatePropertyRequest } from "@archprop/shared";
import { ActionButton } from "@/components/transaction-lifecycle";
import { LegalTitleDisclaimer } from "@/components/demo-disclosure";
import {
  CANONICAL_VILLA_NUSA_PRESET,
  formatBps,
  formatWholeUnits,
  isCanonicalUnsignedDecimal,
  normalizeDecimalString,
  validateCreatePropertyRequest,
} from "@/lib/client/view-models";

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

export function PropertyDetailsForm() {
  const [formState, setFormState] = useState<CreatePropertyRequest>(
    CANONICAL_VILLA_NUSA_PRESET,
  );

  const validation = validateCreatePropertyRequest(formState);

  const updateField = (
    field: keyof CreatePropertyRequest,
    value: string | number,
  ) => {
    setFormState((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleResetToPreset = () => {
    setFormState(CANONICAL_VILLA_NUSA_PRESET);
  };

  // Invariant calculation preview
  const supplyNorm = normalizeDecimalString(formState.tokenSupply ?? "");
  const priceNorm = normalizeDecimalString(formState.tokenPrice ?? "");
  const targetNorm = normalizeDecimalString(formState.offeringTarget ?? "");

  const hasValidSupply =
    isCanonicalUnsignedDecimal(supplyNorm) && BigInt(supplyNorm) > 0n;
  const hasValidPrice =
    isCanonicalUnsignedDecimal(priceNorm) && BigInt(priceNorm) > 0n;
  const hasValidTarget =
    isCanonicalUnsignedDecimal(targetNorm) && BigInt(targetNorm) > 0n;

  const calculatedTarget =
    hasValidSupply && hasValidPrice
      ? BigInt(supplyNorm) * BigInt(priceNorm)
      : null;

  const matchesInvariant =
    calculatedTarget !== null &&
    hasValidTarget &&
    BigInt(targetNorm) === calculatedTarget;

  const missingPrerequisite = !validation.isValid
    ? "valid property parameters matching required invariants"
    : "a connected owner wallet on Arbitrum Sepolia";

  return (
    <form
      className="mt-4 flex flex-col gap-6"
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
          className="rounded border border-line-strong bg-surface px-3 py-1.5 font-medium text-ink transition-colors hover:bg-surface-sunken hover:text-brand"
        >
          Reset to Villa Nusa preset
        </button>
      </div>

      {/* Asset Identity */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
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
            className="rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle"
          />
          {validation.errors.externalId ? (
            <p id="externalId-error" role="alert" className="text-xs text-critical">
              {validation.errors.externalId}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
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
            className="rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle"
          />
          {validation.errors.name ? (
            <p id="name-error" role="alert" className="text-xs text-critical">
              {validation.errors.name}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
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
            className="rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle"
          />
          {validation.errors.location ? (
            <p id="location-error" role="alert" className="text-xs text-critical">
              {validation.errors.location}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
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
            className="rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle"
          />
          {validation.errors.propertyType ? (
            <p id="propertyType-error" role="alert" className="text-xs text-critical">
              {validation.errors.propertyType}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
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
            className="rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle"
          />
          {validation.errors.issuerName ? (
            <p id="issuerName-error" role="alert" className="text-xs text-critical">
              {validation.errors.issuerName}
            </p>
          ) : null}
        </div>
      </div>

      {/* Description */}
      <div className="flex flex-col gap-1.5">
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
          className="rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle"
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
          <div className="flex flex-col gap-1.5">
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
              className="ap-tabular rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle"
            />
            {validation.errors.indicativeValue ? (
              <p id="indicativeValue-error" role="alert" className="text-xs text-critical">
                {validation.errors.indicativeValue}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
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
              aria-describedby={validation.errors.offeringTarget ? "offeringTarget-error" : undefined}
              className="ap-tabular rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle"
            />
            {validation.errors.offeringTarget ? (
              <p id="offeringTarget-error" role="alert" className="text-xs text-critical">
                {validation.errors.offeringTarget}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="economicRightsBps" className="text-sm font-medium text-ink-muted">
              Economic rights (bps)
            </label>
            <input
              id="economicRightsBps"
              name="economicRightsBps"
              type="text"
              inputMode="numeric"
              value={formState.economicRightsBps.toString()}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value, 10);
                updateField("economicRightsBps", Number.isNaN(parsed) ? (e.target.value as unknown as number) : parsed);
              }}
              placeholder="3000"
              aria-invalid={!!validation.errors.economicRightsBps}
              aria-describedby="economicRightsBps-hint"
              className="ap-tabular rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle"
            />
            <p id="economicRightsBps-hint" className="text-xs text-ink-subtle">
              {Number.isInteger(Number(formState.economicRightsBps)) && Number(formState.economicRightsBps) >= 0
                ? `${formatBps(Number(formState.economicRightsBps))} participation`
                : "Basis points (100 bps = 1%)"}
            </p>
            {validation.errors.economicRightsBps ? (
              <p role="alert" className="text-xs text-critical">
                {validation.errors.economicRightsBps}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
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
              aria-describedby={validation.errors.tokenSupply ? "tokenSupply-error" : undefined}
              className="ap-tabular rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle"
            />
            {validation.errors.tokenSupply ? (
              <p id="tokenSupply-error" role="alert" className="text-xs text-critical">
                {validation.errors.tokenSupply}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-2">
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
              aria-describedby={validation.errors.tokenPrice ? "tokenPrice-error" : undefined}
              className="ap-tabular rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle"
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
          className={`rounded-lg border p-3 text-xs leading-relaxed ${
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
          {calculatedTarget !== null ? (
            <p className="mt-1 ap-tabular">
              Supply ({formatWholeUnits(BigInt(supplyNorm))}) × Price ({formatWholeUnits(BigInt(priceNorm))} mIDR) ={" "}
              {formatWholeUnits(calculatedTarget)} mIDR
              {matchesInvariant ? (
                <span className="ml-1 text-verified">
                  (matches offering target {formatWholeUnits(BigInt(targetNorm))} mIDR exactly)
                </span>
              ) : hasValidTarget ? (
                <span className="ml-1 text-critical font-medium">
                  (does not match offering target {formatWholeUnits(BigInt(targetNorm))} mIDR)
                </span>
              ) : null}
            </p>
          ) : (
            <p className="mt-1 text-ink-muted">
              Enter valid supply and price to evaluate the target invariant.
            </p>
          )}
          {validation.errors.invariant ? (
            <p className="mt-1 font-semibold text-critical">{validation.errors.invariant}</p>
          ) : null}
        </div>
      </div>

      <LegalTitleDisclaimer className="max-w-2xl" />

      <div className="flex flex-col gap-2">
        <ActionButton
          label="Register property"
          tone="primary"
          disabled
          missingPrerequisite={missingPrerequisite}
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
