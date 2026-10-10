"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { VILLA_NUSA } from "@archprop/shared";
import { EXPECTED_CHAIN_ID } from "@/lib/client/view-models";
import { useWallet } from "@/lib/client/wallet-context";

const NAV_ITEMS = [
  { href: "/marketplace", label: "Marketplace" },
  { href: `/property/${VILLA_NUSA.id}`, label: "Property" },
  { href: "/owner", label: "Owner" },
  { href: "/verifier", label: "Verifier" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/admin", label: "Admin" },
  { href: "/faucet", label: "Faucet" },
] as const;

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const wallet = useWallet();
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        document.getElementById("menu-button")?.focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);
  return (
    <header className="site-header" id="site-header">
      <div className="nav-shell">
        <Link
          href="/"
          className="brand min-w-0"
          aria-label="Archprop home"
          onClick={() => setMenuOpen(false)}
        >
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>ARCHPROP</span>
        </Link>
        <nav aria-label="Primary" className="hidden xl:block">
          <ul className="nav-links">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={pathname === item.href ? "page" : undefined}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="nav-actions">
          <span className="nav-status network-status hidden xl:inline-flex">
            Arbitrum Sepolia · {EXPECTED_CHAIN_ID}
          </span>
          {wallet.isConnected && wallet.address ? (
            <div className="wallet-actions hidden xl:inline-flex">
              {wallet.isWrongNetwork ? (
                <button
                  type="button"
                  className="network-error"
                  onClick={wallet.switchChain}
                >
                  Wrong Network
                </button>
              ) : null}
              <span className="wallet-address">
                {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
              </span>
              <button
                type="button"
                className="wallet-disconnect"
                onClick={wallet.disconnect}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div className="wallet-actions hidden xl:inline-flex">
              <span className="nav-status hidden xl:inline-flex">
                Wallet not connected
              </span>
              <button
                type="button"
                className="button button-accent button-small"
                onClick={wallet.connect}
                disabled={wallet.isConnecting}
              >
                {wallet.isConnecting ? "Connecting…" : "Connect"}
                <span aria-hidden="true">↗</span>
              </button>
            </div>
          )}
          <Link
            href="/marketplace"
            className="button button-accent button-small compact-explore xl:hidden"
          >
            Explore <span aria-hidden="true">↗</span>
          </Link>
          <button
            type="button"
            className="ap-menu-button xl:hidden"
            id="menu-button"
            aria-expanded={menuOpen}
            aria-controls="primary-nav-mobile"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span />
            <span />
          </button>
        </div>
      </div>
      <noscript>
        <nav
          className="no-script-navigation"
          aria-label="Navigation without JavaScript"
        >
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
      </noscript>
      {menuOpen ? (
        <nav
          id="primary-nav-mobile"
          aria-label="Primary"
          className="mobile-nav xl:hidden"
        >
          <ul>
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={pathname === item.href ? "page" : undefined}
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                  <span aria-hidden="true">↗</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mobile-wallet">
            <span className="nav-status">
              <span />
              Arbitrum Sepolia · {EXPECTED_CHAIN_ID}
            </span>
            {wallet.isConnected && wallet.address ? (
              <>
                <span className="wallet-address">
                  {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
                </span>
                {wallet.isWrongNetwork ? (
                  <button
                    className="network-error"
                    type="button"
                    onClick={wallet.switchChain}
                  >
                    Wrong Network — Switch
                  </button>
                ) : null}
                <button
                  type="button"
                  className="button button-dark button-small"
                  onClick={wallet.disconnect}
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button
                type="button"
                className="button button-accent button-small"
                disabled={wallet.isConnecting}
                onClick={wallet.connect}
              >
                {wallet.isConnecting ? "Connecting…" : "Connect Wallet"}
                <span aria-hidden="true">↗</span>
              </button>
            )}
            {wallet.error ? (
              <p role="alert" className="text-critical text-xs">
                {wallet.error}
              </p>
            ) : null}
          </div>
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
export function SectionHeading({
  eyebrow,
  title,
  description,
  className = "",
}: SectionHeadingProps) {
  return (
    <div className={`section-heading ${className}`}>
      {eyebrow ? <p className="ap-eyebrow">{eyebrow}</p> : null}
      <h2>{title}</h2>
      {description ? (
        <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">
          {description}
        </p>
      ) : null}
    </div>
  );
}
