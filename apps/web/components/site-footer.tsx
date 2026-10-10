import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <Link className="brand footer-brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>ARCHPROP</span>
        </Link>
        <p>
          Real places. Defined economic rights. A clearer path to property
          participation.
        </p>
        <p className="footer-disclosure">
          Hackathon Demo — Synthetic / Simulated Data. Verification, documents,
          identity, currency and revenue are simulated.
        </p>
      </div>
      <div className="footer-links">
        <Link href="/marketplace">Properties</Link>
        <Link href="/owner">For owners</Link>
        <Link href="/verifier">Verification</Link>
        <Link href="/portfolio">Portfolio</Link>
        <Link href="/admin">Demo operator</Link>
      </div>
      <div className="end-wordmark" aria-hidden="true">
        ARCHPROP
      </div>
      <div className="footer-bottom">
        <span>© 2026 ARCHPROP</span>
        <span>ARBITRUM SEPOLIA · mIDR HAS NO REAL MONETARY VALUE</span>
        <a href="#main-content">BACK TO TOP ↑</a>
      </div>
    </footer>
  );
}
