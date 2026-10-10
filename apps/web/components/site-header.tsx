"use client";

import Link from "next/link";
import { useState } from "react";
import type { ReactNode } from "react";
import { VILLA_NUSA } from "@archprop/shared";
import { EXPECTED_CHAIN_ID } from "@/lib/client/view-models";

const NAV_ITEMS = [
  { href: "/marketplace", label: "Marketplace" },
  { href: `/property/${VILLA_NUSA.id}`, label: "Property" },
  { href: "/owner", label: "Owner" },
  { href: "/verifier", label: "Verifier" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/admin", label: "Admin" },
] as const;

/**
 * Site navigation.
 *
 * The six destinations plus the wordmark only fit side by side on genuinely
 * wide viewports, so the inline nav is gated behind `xl` (1280px). Below that —
 * phones *and* tablets, roughly 320–1279px — the destinations collapse into a
 * disclosure whose trigger keeps a visible focus ring and an accessible name,
 * and whose panel is a labelled `<nav>` in both layouts. Showing the inline nav
 * from `sm` instead would collide with the wordmark and the wallet/network
 * labels around 640–900px.
 *
 * The wallet and network labels are revealed only where the inline nav is also
 * shown, so the header never has to squeeze a chip between the wordmark and the
 * menu trigger. Wallet status itself is rendered by the wallet connection area,
 * which FE-002 supplies. Until then the header shows the expected network and
 * states that no wallet is connected rather than rendering a fake address or
 * balance.
 */
export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/75">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:gap-6 sm:px-5">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2.5 rounded-lg"
          aria-label="Archprop home"
        >
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-deep text-sm font-bold text-ink-inverse"
            aria-hidden="true"
          >
            A
          </span>
          <span className="flex min-w-0 flex-col leading-none">
            <span className="truncate text-base font-semibold tracking-tight text-ink-strong">
              Archprop
            </span>
            <span className="truncate text-2xs text-ink-subtle">
              Real-World Asset Marketplace
            </span>
          </span>
        </Link>

        {/* Inline navigation from `xl` up, where six links fit beside the wordmark. */}
        <nav aria-label="Primary" className="hidden xl:block">
          <ul className="flex items-center gap-0.5">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="rounded-lg px-2.5 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink-strong lg:px-3"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          {/* Network and wallet labels appear only alongside the inline nav,
              where there is room for them without crowding the wordmark. */}
          <span className="hidden rounded-lg border border-line px-2.5 py-1.5 text-2xs font-medium text-ink-subtle xl:inline-flex">
            Arbitrum Sepolia · {EXPECTED_CHAIN_ID}
          </span>
          <span className="hidden rounded-lg border border-line bg-surface-sunken px-3 py-1.5 text-xs font-semibold text-ink-subtle xl:inline-flex">
            Wallet not connected
          </span>

          {/* Compact disclosure below `xl`, where the inline nav cannot fit. */}
          <button
            type="button"
            className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand xl:hidden"
            aria-expanded={menuOpen}
            aria-controls="primary-nav-mobile"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? "Close" : "Menu"}
          </button>
        </div>
      </div>

      {menuOpen ? (
        <nav
          id="primary-nav-mobile"
          aria-label="Primary"
          className="border-t border-line bg-surface xl:hidden"
        >
          <ul className="mx-auto flex max-w-6xl flex-col px-4 py-2">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded-lg px-2 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}

export interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  className?: string;
}

/** Standard section heading used across pages. */
export function SectionHeading({
  eyebrow,
  title,
  description,
  className = "",
}: SectionHeadingProps) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {eyebrow ? <p className="ap-eyebrow">{eyebrow}</p> : null}
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      {description ? (
        <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">{description}</p>
      ) : null}
    </div>
  );
}
