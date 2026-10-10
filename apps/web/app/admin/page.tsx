import Link from "next/link";
import { DemoDisclosure } from "@/components/demo-disclosure";
import {
  ConnectWalletPrompt,
  DisabledActionHint,
} from "@/components/chain-state";
import { EXPECTED_CHAIN_ID } from "@/lib/client/view-models";

/**
 * Admin / demo operator shell.
 *
 * This route describes the operator responsibilities the demo stands in for and
 * states exactly which prerequisite each one is missing. Every action is
 * disabled because FE-001 ships no wallet writes and no chain adapter — there
 * is nothing real behind a button here yet, so no approval, transaction, role
 * grant, or revenue deposit is ever simulated or shown as successful.
 *
 * The operator does not verify assets. Verifiers attest and the registry
 * advances the lifecycle; this surface only sequences the surrounding demo
 * responsibilities.
 */

interface OperatorActionProps {
  title: string;
  description: string;
  /** The missing prerequisite that keeps the action disabled. */
  missing: string;
}

function OperatorAction({ title, description, missing }: OperatorActionProps) {
  return (
    <li className="rounded-card border border-line bg-surface p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink-strong">{title}</h3>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-ink-muted">
            {description}
          </p>
        </div>
        <button
          type="button"
          disabled
          className="shrink-0 cursor-not-allowed rounded-lg border border-line bg-surface-sunken px-3 py-1.5 text-xs font-semibold text-ink-subtle"
        >
          Disabled
        </button>
      </div>
      <DisabledActionHint missing={missing} className="mt-3" />
    </li>
  );
}

export default function AdminPage() {
  return (
    <div className="ap-page mx-auto max-w-6xl px-4 py-10 sm:px-5">
      <p className="ap-eyebrow">Admin · Demo Operator</p>
      <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-ink-strong">
        Admin &amp; demo operator
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
        This surface lists the operator responsibilities the ARCHPROP demo
        stands in for and states exactly which prerequisite each one is missing.
        No action here is live: the FE-001 shell ships no wallet writes and no
        chain adapter, so nothing is simulated, queued, or reported as successful.
      </p>

      <DemoDisclosure className="mt-6" />

      <ConnectWalletPrompt className="mt-6" />

      {/* Network and wallet prerequisites */}
      <section aria-labelledby="admin-environment-heading" className="mt-10">
        <h2 id="admin-environment-heading" className="text-lg font-semibold text-ink-strong">
          Environment
        </h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-card border border-line bg-surface p-4">
            <dt className="text-ink-subtle">Expected network</dt>
            <dd className="mt-0.5 text-sm font-medium text-ink-strong">
              Arbitrum Sepolia · {EXPECTED_CHAIN_ID}
            </dd>
          </div>
          <div className="rounded-card border border-line bg-surface p-4">
            <dt className="text-ink-subtle">Wallet connection</dt>
            <dd className="mt-0.5 text-sm font-medium text-ink-strong">
              Not connected — required before any operator action
            </dd>
          </div>
        </dl>
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-ink-subtle">
          A connected wallet on the expected network is a precondition for every
          action below. Without it there is no signer, no nonce, and no way to
          submit a transaction — so the shell reports the missing prerequisite
          rather than an outcome.
        </p>
      </section>

      {/* Operator responsibilities */}
      <section aria-labelledby="admin-responsibilities-heading" className="mt-10">
        <h2 id="admin-responsibilities-heading" className="text-lg font-semibold text-ink-strong">
          Demo operator responsibilities
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Each item is a responsibility this demo stands in for. None is live
          yet; the stated prerequisite is the real reason it is disabled.
        </p>

        <ul className="mt-4 flex flex-col gap-3">
          <OperatorAction
            title="Investor identity approval"
            description="Approve or reject an investor's verified identity record so they may participate in an offering. In the demo, identity records are synthetic and carry no real KYC status."
            missing="a connected wallet and a chain adapter for the identity registry"
          />
          <OperatorAction
            title="Verifier and role awareness"
            description="Review which accounts hold verifier roles and confirm they are the accounts signing attestations. The registry grants these roles on-chain; the demo cannot read them yet."
            missing="a chain adapter to read role assignments from the registry"
          />
          <OperatorAction
            title="Revenue attestation (simulated)"
            description="Sequence a simulated revenue attestation so the demo can show how a signed revenue record enters the attestation store. No deposit, transfer, or distribution is ever recorded or shown as successful."
            missing="a connected wallet and the reviewed revenue-distribution write path"
          />
          <OperatorAction
            title="Distribution preview (simulated)"
            description="Preview how a recorded revenue attestation would be allocated across token holders. The preview is not a distribution and never becomes one from this surface."
            missing="a chain adapter to read holder balances and entitlement state"
          />
        </ul>
      </section>

      {/* What this surface is not */}
      <section aria-labelledby="admin-boundary-heading" className="mt-10">
        <h2 id="admin-boundary-heading" className="text-lg font-semibold text-ink-strong">
          What this surface does not do
        </h2>
        <ul className="mt-3 flex max-w-3xl flex-col gap-2 text-sm leading-relaxed text-ink-muted">
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-ink-subtle">·</span>
            <span>
              It does not verify assets. Verifiers attest ownership and
              valuation, and the registry advances the lifecycle from those
              attestations — an owner can never self-verify, and this surface
              cannot override that.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-ink-subtle">·</span>
            <span>
              It does not mint tokens. Asset registration creates the asset
              record only; PropertyToken issuance happens later, after
              verification and issuance prerequisites are met.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-ink-subtle">·</span>
            <span>
              It does not display balances, funding progress, claimable
              revenue, or attestations. Those are chain reads, and this surface
              shows their missing prerequisite instead of a placeholder value.
            </span>
          </li>
        </ul>
      </section>

      <p className="mt-10 max-w-2xl text-xs leading-relaxed text-ink-subtle">
        Live wallet and chain integration is scheduled as FE-002. See the{" "}
        <Link href="/verifier" className="text-brand underline">
          verifier queue
        </Link>{" "}
        and{" "}
        <Link href="/owner" className="text-brand underline">
          owner console
        </Link>{" "}
        for the current asset views.
      </p>
    </div>
  );
}
