import type { Metadata } from "next";
import { DesignChrome } from "@/components/design-motion";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { WalletProvider } from "@/lib/client/wallet-context";
import "../styles/globals.css";

/**
 * Root layout.
 *
 * The header and footer are shared chrome. Every route renders inside this
 * shell so the demo disclosure and network label are never missing.
 */
export const metadata: Metadata = {
  title: {
    default: "Archprop — Real-World Asset Marketplace",
    template: "%s · Archprop",
  },
  icons: { icon: "/favicon.svg" },
  description:
    "A two-sided marketplace for property-backed real-world assets. Owners list assets, verifiers attest ownership and valuation, and investors participate in defined economic rights.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-canvas">
        <noscript>
          {/* eslint-disable-next-line @next/next/no-css-tags -- Needed only when the app cannot hydrate. */}
          <link rel="stylesheet" href="/no-script.css" />
        </noscript>
        <WalletProvider>
          <DesignChrome />
          <a className="skip-link" href="#main-content">
            Skip to content
          </a>
          <SiteHeader />
          <main id="main-content" className="flex-1" tabIndex={-1}>
            {children}
          </main>
          <SiteFooter />
        </WalletProvider>
      </body>
    </html>
  );
}
