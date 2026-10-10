export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-6 px-5 py-10 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-ink-strong">Archprop</p>
          <p className="max-w-sm text-xs leading-relaxed text-ink-muted">
            A two-sided marketplace for property-backed real-world assets. Owners
            list assets, verifiers attest ownership and valuation, and investors
            participate in defined economic rights.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <p className="ap-eyebrow">Hackathon Demo</p>
          <p className="max-w-sm text-xs leading-relaxed text-ink-muted">
            Identity approval, verification, documents, mIDR balances, and
            revenue in this environment are synthetic. This product does not
            grant legal title, is not a security offering, and is not KYC,
            banking, or regulatory infrastructure.
          </p>
        </div>
      </div>
    </footer>
  );
}
