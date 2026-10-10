import type { LifecycleStatus, PresentationStatus } from "@archprop/shared";
import type { ReactNode } from "react";

/**
 * Consistent status presentation.
 *
 * Lifecycle names come from the frozen registry enum. `DRAFT`, `COMING_SOON`,
 * and `VERIFICATION_PENDING` are presentation-only states and are labelled as
 * such; the UI never invents a chain status.
 */

const LIFECYCLE_LABELS: Record<LifecycleStatus, string> = {
  SUBMITTED: "Submitted",
  UNDER_VERIFICATION: "Under Verification",
  VERIFIED: "Verified",
  ISSUANCE_READY: "Issuance Ready",
  OFFERING: "Open for Investment",
  FUNDED: "Funded",
  ACTIVE: "Active",
  REJECTED: "Rejected",
  FAILED: "Failed",
};

/**
 * Visual tone per status. Institutional and muted — no neon, no
 * trading-app semantics.
 */
const LIFECYCLE_TONES: Record<LifecycleStatus, "verified" | "pending" | "neutral" | "critical"> = {
  SUBMITTED: "neutral",
  UNDER_VERIFICATION: "pending",
  VERIFIED: "verified",
  ISSUANCE_READY: "verified",
  OFFERING: "pending",
  FUNDED: "verified",
  ACTIVE: "verified",
  REJECTED: "critical",
  FAILED: "critical",
};

const PRESENTATION_LABELS: Record<
  "DRAFT" | "COMING_SOON" | "VERIFICATION_PENDING",
  { label: string; tone: "pending" | "neutral" }
> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  COMING_SOON: { label: "Coming Soon", tone: "pending" },
  VERIFICATION_PENDING: { label: "Verification Pending", tone: "pending" },
};

const TONE_CLASSES: Record<"verified" | "pending" | "neutral" | "critical", string> = {
  verified: "bg-verified-soft text-verified border-verified/25",
  pending: "bg-pending-soft text-pending border-pending/25",
  neutral: "bg-neutral-soft text-neutral border-neutral/20",
  critical: "bg-critical-soft text-critical border-critical/25",
};

const TONE_DOTS: Record<"verified" | "pending" | "neutral" | "critical", string> = {
  verified: "bg-verified",
  pending: "bg-pending",
  neutral: "bg-neutral",
  critical: "bg-critical",
};

export type StatusTone = "verified" | "pending" | "neutral" | "critical";

export interface StatusBadgeProps {
  status: PresentationStatus;
  /**
   * Optional chain-derived detail. When present it is shown as explanatory
   * text rather than replacing the frozen status name.
   */
  detail?: string;
  className?: string;
}

export function statusToneFor(status: PresentationStatus): StatusTone {
  if (status in PRESENTATION_LABELS) {
    return PRESENTATION_LABELS[status as keyof typeof PRESENTATION_LABELS].tone;
  }
  return LIFECYCLE_TONES[status as LifecycleStatus];
}

export function statusLabelFor(status: PresentationStatus): string {
  if (status in PRESENTATION_LABELS) {
    return PRESENTATION_LABELS[status as keyof typeof PRESENTATION_LABELS].label;
  }
  return LIFECYCLE_LABELS[status as LifecycleStatus];
}

export function StatusBadge({ status, detail, className = "" }: StatusBadgeProps) {
  const tone = statusToneFor(status);
  const label = statusLabelFor(status);
  const isPresentationOnly = status in PRESENTATION_LABELS;

  return (
    <span className="inline-flex flex-col gap-0.5">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${TONE_CLASSES[tone]} ${className}`}
      >
        <span className={`size-1.5 shrink-0 rounded-full ${TONE_DOTS[tone]}`} aria-hidden="true" />
        {label}
      </span>
      {isPresentationOnly ? (
        <span className="text-2xs text-ink-subtle">Presentation state only</span>
      ) : null}
      {detail ? <span className="text-2xs text-ink-subtle">{detail}</span> : null}
    </span>
  );
}

export interface ChipProps {
  children: ReactNode;
  tone?: StatusTone;
  className?: string;
}

/** Neutral metadata chip for non-status facts. */
export function Chip({ children, tone = "neutral", className = "" }: ChipProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
