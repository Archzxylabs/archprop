import type { ReactNode } from "react";

/**
 * Demo disclosure.
 *
 * Every verification, identity, document, mIDR, and revenue surface in
 * ARCHPROP is synthetic or simulated. This banner states that plainly wherever
 * it matters, rather than relying on a footer the user may never see.
 */

export const DEMO_DISCLOSURE_TEXT =
  "Hackathon Demo — Synthetic / Simulated Data";

export const DEMO_DISCLOSURE_DETAIL =
  "Verification, identity approval, documents, mIDR, and revenue in this demo are synthetic. " +
  "Nothing here represents real legal title, real money, KYC, banking rails, or regulatory approval.";

export interface DemoDisclosureProps {
  /** Short inline form, or the full explanatory form. */
  variant?: "inline" | "full";
  className?: string;
  children?: ReactNode;
}

export function DemoDisclosure({ variant = "full", className = "", children }: DemoDisclosureProps) {
  if (variant === "inline") {
    return (
      <p className={`text-xs text-ink-subtle ${className}`}>
        <span className="font-semibold text-ink-muted">{DEMO_DISCLOSURE_TEXT}</span>
        {children ? <> — {children}</> : null}
      </p>
    );
  }

  return (
    <aside
      aria-label="Demo data disclosure"
      className={`rounded-card border border-accent-line bg-accent-soft px-4 py-3 ${className}`}
    >
      <p className="text-sm font-semibold text-ink-strong">{DEMO_DISCLOSURE_TEXT}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{DEMO_DISCLOSURE_DETAIL}</p>
      {children ? <div className="mt-2 text-xs text-ink-muted">{children}</div> : null}
    </aside>
  );
}

/**
 * The mandatory economic-rights disclaimer.
 *
 * AVNUSA represents defined economic participation rights in a demo agreement —
 * never legal title to the land.
 */
export function LegalTitleDisclaimer({ className = "" }: { className?: string }) {
  return (
    <p
      className={`rounded-card border border-brand-line bg-brand-soft px-4 py-3 text-sm font-medium text-ink-strong ${className}`}
    >
      This token does not represent direct legal title to the land.
    </p>
  );
}
