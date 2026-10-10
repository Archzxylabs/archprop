import Link from "next/link";
import { VILLA_NUSA } from "@archprop/shared";
import {
  DemoDisclosure,
  LegalTitleDisclaimer,
} from "@/components/demo-disclosure";
import { LandingMotion } from "@/components/design-motion";
import { PropertyScene } from "@/components/property-scene";
import { PropertyCatalog } from "@/components/property-catalog";
import { buildMarketplaceCards } from "@/lib/client/listings";
import { chainUnavailable, formatBps } from "@/lib/client/view-models";

const FAQ_GROUPS = [
  {
    id: "rights",
    kicker: "PROPERTY / PARTICIPATION",
    title: "What you get",
    intro:
      "A property behind every agreement. Clear limits on what a token represents.",
    questions: [
      [
        "Does a token give me legal title to the land?",
        "No. AVNUSA represents units of defined economic participation in a synthetic agreement. This token does not represent direct legal title to the land.",
      ],
      [
        "What rights does Villa Nusa offer?",
        "The demo agreement offers 30% economic participation, represented by 300,000 AVNUSA. It covers participation in distributable rental income and net exit proceeds under the agreement.",
      ],
      [
        "Are all three properties open for investment?",
        "Villa Nusa is the primary demo asset. Ubud Retreat is coming soon and Lombok Residence is pending demo verification. They have no live offering; investment availability requires confirmed chain state.",
      ],
    ],
  },
  {
    id: "funding",
    kicker: "FUNDING / PROTECTION",
    title: "How funding works",
    intro:
      "Published terms upfront. Confirmed chain state before an economic action.",
    questions: [
      [
        "What is mIDR?",
        "mIDR — Demo Currency — No Real Monetary Value. It is a zero-decimal mock token on Arbitrum Sepolia, not real rupiah, a deposit, or a redeemable currency.",
      ],
      [
        "Where does my demo investment go?",
        "An eligible investor approves mIDR and invests through the offering escrow. Demo funds remain in escrow until the offering succeeds. Allocation and funding are read directly from the chain.",
      ],
      [
        "What happens if an offering fails?",
        "After its deadline, an unsuccessful offering can be marked failed. Investors can claim their recorded demo payment through the escrow refund path. A successful offering permits token claims instead.",
      ],
      [
        "When can a holder claim revenue?",
        "Simulated revenue must first be attested, deposited and published as a funded epoch. Eligibility, claimable amounts and claim deadlines come from the revenue distributor. No return is guaranteed.",
      ],
    ],
  },
  {
    id: "evidence",
    kicker: "VERIFICATION / EVIDENCE",
    title: "What stands behind it",
    intro:
      "Independent demo roles, evidence hashes, and a visible on-chain trail.",
    questions: [
      [
        "What must be verified before issuance?",
        "Both ownership and valuation need valid attestations from the matching independent demo verifier roles. An owner cannot self-verify. The registry enforces the gate on-chain.",
      ],
      [
        "Are the verification and documents real?",
        "Hackathon Demo — Synthetic / Simulated Data. Documents, verifier roles, identity approval and property revenue are simulated. The demo does not connect to BPN, a real KJPP, real KYC, banking rails or regulatory infrastructure.",
      ],
      [
        "How do I inspect the on-chain proof?",
        "The property page shows evidence hashes, verifier addresses and available contract references. Real transaction hashes link to Arbiscan after broadcast; the UI does not fabricate a receipt or verification result.",
      ],
      [
        "How do I list a property?",
        "Start in the owner workspace. The four-step flow covers property details, synthetic documents, independent verification and offering preparation. Live actions remain unavailable until their required integrations exist.",
      ],
    ],
  },
] as const;

export default function HomePage() {
  const cards = buildMarketplaceCards(() =>
    chainUnavailable(
      "Open the property page to read confirmed offering funding. No funding read has been made on this landing page.",
    ),
  );
  return (
    <div className="landing-page" id="top">
      <LandingMotion />
      <section className="story" id="story" aria-label="About Archprop">
        <div className="story-sticky">
          <div className="story-grid" aria-hidden="true" />
          <div className="story-copy">
            <div className="story-panel is-active" data-story-panel="0">
              <div className="eyebrow">
                <span className="eyebrow-line" /> PROPERTY MARKETPLACE /
                ARBITRUM SEPOLIA
              </div>
              <h1>
                Real places.
                <br />
                <em>Clear potential</em>
              </h1>
              <p>
                Discover property-backed economic rights. Review the evidence,
                understand the offering, and participate in a property’s story.
              </p>
              <div className="hero-actions">
                <Link className="button button-dark" href="/marketplace">
                  Explore Properties <span aria-hidden="true">↗</span>
                </Link>
                <Link className="text-link" href="/owner">
                  List a Property <span aria-hidden="true">↗</span>
                </Link>
              </div>
              <DemoDisclosure variant="inline" className="hero-disclosure" />
            </div>
            <div className="story-panel" data-story-panel="1">
              <div className="eyebrow">
                <span className="eyebrow-line" /> 01 / VERIFICATION
              </div>
              <h2>
                Evidence first.
                <br />
                <em>Always</em>
              </h2>
              <p>
                Ownership and valuation are independently attested by demo
                verifiers. No verification, no issuance. The gate is enforced
                on-chain.
              </p>
              <div className="story-points">
                <span>
                  <b>Ownership</b> demo legal attestation
                </span>
                <span>
                  <b>Valuation</b> demo appraisal attestation
                </span>
              </div>
              <DemoDisclosure variant="inline" className="hero-disclosure" />
            </div>
            <div className="story-panel" data-story-panel="2">
              <div className="eyebrow">
                <span className="eyebrow-line" /> 02 / ECONOMIC RIGHTS
              </div>
              <h2>
                A real place.
                <br />
                <em>Defined rights</em>
              </h2>
              <p>
                Villa Nusa offers {formatBps(VILLA_NUSA.economicRightsBps)}{" "}
                economic participation through a demo agreement. Rental
                distributions and net exit participation, with the terms in
                view.
              </p>
              <div className="story-tags">
                <span>VILLA NUSA</span>
                <span>300,000 AVNUSA</span>
                <span>0 DECIMALS</span>
              </div>
              <p className="hero-disclosure">
                This token does not represent direct legal title to the land.
              </p>
            </div>
            <div className="story-panel" data-story-panel="3">
              <div className="eyebrow">
                <span className="eyebrow-line" /> 03 / TRANSPARENCY
              </div>
              <h2>
                Every step.
                <br />
                <em>In the open</em>
              </h2>
              <p>
                Follow verification, funding and simulated revenue through
                confirmed on-chain records. Clear terms before you act, visible
                proof after.
              </p>
              <div className="story-points">
                <span>
                  <b>Escrow</b> demo funding protected
                </span>
                <span>
                  <b>On-chain</b> receipt-backed progress
                </span>
              </div>
              <p className="hero-disclosure">
                mIDR — Demo Currency — No Real Monetary Value
              </p>
            </div>
          </div>
          <div className="story-visual">
            <div className="visual-glow" />
            <PropertyScene />
            <div className="visual-orbit visual-orbit-a" aria-hidden="true" />
            <div className="visual-orbit visual-orbit-b" aria-hidden="true" />
            <div className="visual-hud hud-bottom">
              <span id="hud-spec">PROPERTY / 01</span>
              <span>ILLUSTRATIVE VILLA ↘</span>
            </div>
          </div>
          <div className="story-foot">
            <span className="scroll-cue">
              SCROLL <span />
            </span>
            <div className="story-steps" aria-label="Story chapters">
              {["START", "VERIFICATION", "RIGHTS", "PROOF"].map(
                (label, index) => (
                  <button
                    className={index === 0 ? "is-active" : ""}
                    key={label}
                    type="button"
                    data-step={index}
                  >
                    {label}
                  </button>
                ),
              )}
              <div className="story-step-line">
                <i id="story-progress" />
              </div>
            </div>
          </div>
        </div>
      </section>
      <section
        className="marquee-section"
        aria-label="Verified property, defined economic rights, transparent funding and simulated revenue"
      >
        <div className="marquee-intro eyebrow">
          BUILT AROUND WHAT STANDS BEHIND IT
        </div>
        <div className="marquee marquee-bold">
          <div className="marquee-track" aria-hidden="true">
            PROPERTY <i>✦</i> EVIDENCE <i>✦</i> PARTICIPATION <i>✦</i> PROPERTY{" "}
            <i>✦</i> EVIDENCE <i>✦</i> PARTICIPATION <i>✦</i>
          </div>
        </div>
        <div className="marquee marquee-outline">
          <div className="marquee-track" aria-hidden="true">
            VILLA NUSA <i>•</i> BALI <i>•</i> DEFINED RIGHTS <i>•</i> VILLA NUSA{" "}
            <i>•</i> BALI <i>•</i> DEFINED RIGHTS <i>•</i>
          </div>
        </div>
      </section>
      <section
        className="warp-story"
        id="warp-story"
        aria-label="The property participation journey"
      >
        <div className="warp-sticky">
          <div className="warp-portal" id="warp-portal">
            <canvas id="warp-canvas" aria-hidden="true" />
            <div className="warp-noise" aria-hidden="true" />
            <div className="warp-panel" data-warp-panel="0">
              <span className="eyebrow">FROM PROPERTY TO PARTICIPATION</span>
              <h2>
                Start with
                <br />
                <em>the evidence</em>
              </h2>
              <p>Understand the place. Know what stands behind it.</p>
            </div>
            <div className="warp-panel" data-warp-panel="1">
              <span className="eyebrow">ONE JOURNEY / EVERY GATE</span>
              <h2>
                <span>Verify</span>
                <b>→</b>
                <strong>Participate</strong>
              </h2>
              <p>
                Independent demo attestations. Defined rights. Escrow-backed
                funding.
              </p>
            </div>
            <div className="warp-panel" data-warp-panel="2">
              <span className="eyebrow">EVERY ACTION HAS A TRAIL</span>
              <h2>
                Clear terms.
                <br />
                <em>Visible proof</em>
              </h2>
              <p>
                On-chain records from first attestation to simulated
                distribution.
              </p>
            </div>
            <div className="warp-counter">
              <span>01</span>
              <i />
              <span>03</span>
            </div>
          </div>
        </div>
      </section>
      <div className="catalog-scroll-story" id="catalog-scroll-story">
        <section
          className="catalog-section"
          id="properties"
          aria-labelledby="catalog-title"
        >
          <PropertyCatalog cards={cards} mode="story" />
        </section>
      </div>
      <section
        className="how-section"
        id="how-it-works"
        aria-labelledby="how-title"
      >
        <div className="how-shell">
          <div className="how-intro">
            <div className="eyebrow">
              <span className="eyebrow-line" /> HOW IT WORKS
            </div>
            <h2 id="how-title">
              A real property.
              <br />
              <em>A clear journey</em>
            </h2>
            <p>
              From evidence to economic participation. Understand each step and
              the on-chain gate that comes with it.
            </p>
            <Link className="text-link" href={`/property/${VILLA_NUSA.id}`}>
              Meet Villa Nusa <span aria-hidden="true">↗</span>
            </Link>
            <div className="how-progress" aria-hidden="true">
              <span id="how-current">01</span>
              <i />
              <span>03</span>
              <small>SCROLL TO EXPLORE</small>
            </div>
          </div>
          <div className="how-timeline">
            <article className="timeline-step">
              <span className="timeline-number">01</span>
              <div className="timeline-content">
                <span className="timeline-kicker">
                  PROPERTY / INDEPENDENT EVIDENCE
                </span>
                <h3>Know what’s behind it</h3>
                <p>
                  Review the property and its synthetic documents. Independent
                  demo verifiers attest ownership and valuation before issuance
                  becomes possible.
                </p>
                <div className="flow-card">
                  <div className="flow-card-top">
                    <span>PROPERTY CONCEPT</span>
                    <span>01 / REVIEW</span>
                  </div>
                  <div className="flow-gpu-head">
                    <div className="flow-property-icon" aria-hidden="true">
                      ⌂
                    </div>
                    <div>
                      <small>BALI / PT NUSA PROPERTIES</small>
                      <strong>Villa Nusa</strong>
                    </div>
                  </div>
                  <div className="flow-spec-grid">
                    <span>
                      <small>PUBLISHED VALUE</small>
                      <strong>10B mIDR</strong>
                    </span>
                    <span>
                      <small>REQUIRED ATTESTATIONS</small>
                      <strong>Ownership + valuation</strong>
                    </span>
                  </div>
                  <div className="flow-card-bottom">
                    <i />
                    <span>Hackathon Demo — Synthetic / Simulated Data</span>
                  </div>
                </div>
                <div className="flow-detail-row">
                  <span>01</span>
                  <p>No verification, no issuance.</p>
                </div>
              </div>
            </article>
            <article className="timeline-step">
              <span className="timeline-number">02</span>
              <div className="timeline-content">
                <span className="timeline-kicker">
                  AGREEMENT / DEFINED PARTICIPATION
                </span>
                <h3>Understand your rights</h3>
                <p>
                  Read the demo economic-rights agreement. See the offered
                  participation, token supply and price before considering an
                  investment.
                </p>
                <div className="flow-card flow-card-quote">
                  <div className="flow-card-top">
                    <span>PUBLISHED TERMS</span>
                    <span>02 / RIGHTS</span>
                  </div>
                  <div className="flow-quote-heading">
                    <span>Economic participation</span>
                    <strong>{formatBps(VILLA_NUSA.economicRightsBps)}</strong>
                  </div>
                  <div className="flow-range" aria-hidden="true">
                    <i />
                    <span />
                  </div>
                  <div className="flow-range-labels">
                    <span>DEFINED ECONOMIC RIGHTS</span>
                    <span>WHOLE PROPERTY</span>
                  </div>
                  <div className="flow-quote-lines">
                    <div>
                      <span>Fixed supply</span>
                      <strong>300,000 AVNUSA</strong>
                    </div>
                    <div>
                      <span>Published offering target</span>
                      <strong>3B mIDR</strong>
                    </div>
                  </div>
                  <div className="flow-card-bottom">
                    <i />
                    <span>
                      Economic participation. No direct legal land title.
                    </span>
                  </div>
                </div>
                <div className="flow-detail-row">
                  <span>02</span>
                  <p>
                    Rental distributions and net exit participation under the
                    agreement.
                  </p>
                </div>
              </div>
            </article>
            <article className="timeline-step">
              <span className="timeline-number">03</span>
              <div className="timeline-content">
                <span className="timeline-kicker">
                  ESCROW / CONFIRMED ON-CHAIN STATE
                </span>
                <h3>Follow every step</h3>
                <p>
                  Eligible demo investors fund an open offering with mIDR. Token
                  claims follow successful funding; simulated revenue follows a
                  funded, attested epoch.
                </p>
                <div className="flow-card flow-card-workspace">
                  <div className="flow-card-top">
                    <span>PROCESS EXPLAINER</span>
                    <span>03 / PROOF</span>
                  </div>
                  <div className="flow-workspace-status">
                    <i />
                    <span>RECEIPT-BACKED ACTIONS</span>
                  </div>
                  <div className="flow-terminal">
                    <span>01 / Independent attestations required</span>
                    <span>02 / Successful funding before token claims</span>
                    <span>
                      03 / Revenue attestation before distribution <i>▍</i>
                    </span>
                  </div>
                  <div className="flow-workspace-tools">
                    <span>REGISTRY ↗</span>
                    <span>ESCROW ↗</span>
                    <span>ARBISCAN ↗</span>
                  </div>
                  <div className="flow-card-bottom">
                    <i />
                    <span>mIDR — Demo Currency — No Real Monetary Value</span>
                  </div>
                </div>
                <div className="flow-detail-row">
                  <span>03</span>
                  <p>
                    This explains the flow; it does not report a live
                    transaction.
                  </p>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>
      <section
        className="provider-section"
        id="provider"
        aria-labelledby="provider-title"
      >
        <div className="provider-shell">
          <div className="provider-art" aria-hidden="true">
            <div className="provider-ring ring-one" />
            <div className="provider-ring ring-two" />
            <PropertyScene variant="provider" />
            <span className="provider-node node-one" />
            <span className="provider-node node-two" />
            <span className="provider-node node-three" />
          </div>
          <div className="provider-copy" data-reveal>
            <div className="eyebrow">FOR PROPERTY OWNERS</div>
            <h2 id="provider-title">
              Your property.
              <br />
              <em>More possibility</em>
            </h2>
            <p>
              Give investors a clear view of the asset behind the agreement.
              Submit the property, publish synthetic evidence, and follow
              independent verification before preparing an offering.
            </p>
            <div className="provider-stats">
              <span>
                <strong>4 steps</strong>
                <small>details to offering preparation</small>
              </span>
              <span>
                <strong>2 checks</strong>
                <small>ownership and valuation required</small>
              </span>
            </div>
            <Link className="button button-white" href="/owner">
              List a Property <span aria-hidden="true">↗</span>
            </Link>
            <small className="provider-note">
              Hackathon Demo — Synthetic / Simulated Data
            </small>
          </div>
        </div>
      </section>
      <section className="faq-section" id="faq" aria-labelledby="faq-title">
        <div className="faq-shell">
          <div className="faq-left">
            <div className="eyebrow">
              <span className="eyebrow-line" /> GOOD TO KNOW
            </div>
            <h2 id="faq-title">
              A clearer
              <br />
              <em>picture</em>
            </h2>
            <p>
              The details behind a property offering: economic rights, funding,
              evidence and the limits of this demo.
            </p>
            <div className="faq-policy-note">
              <span>HACKATHON / SIMULATED DATA</span>
              <p>
                A technical demonstration on Arbitrum Sepolia. All documents,
                verification, currency and revenue are synthetic or simulated.
              </p>
            </div>
            <div className="faq-progress" aria-hidden="true">
              <span id="faq-current">01</span>
              <i />
              <span>03</span>
              <small>SCROLL FOR DETAILS</small>
            </div>
          </div>
          <div className="faq-timeline">
            {FAQ_GROUPS.map((group, index) => (
              <section
                className="faq-group"
                key={group.id}
                aria-labelledby={`faq-${group.id}-title`}
              >
                <span className="faq-number" aria-hidden="true">
                  0{index + 1}
                </span>
                <div className="faq-group-content">
                  <span className="faq-kicker">{group.kicker}</span>
                  <h3 id={`faq-${group.id}-title`}>{group.title}</h3>
                  <p className="faq-group-intro">{group.intro}</p>
                  <div className="faq-list">
                    {group.questions.map(([question, answer]) => (
                      <details key={question}>
                        <summary>
                          {question}
                          <span aria-hidden="true">+</span>
                        </summary>
                        <p>{answer}</p>
                      </details>
                    ))}
                  </div>
                </div>
              </section>
            ))}
          </div>
        </div>
      </section>
      <section className="end-section">
        <div className="end-top" data-reveal>
          <div className="eyebrow">NEXT / PROPERTY</div>
          <h2>
            Your next chapter.
            <br />
            <em>Grounded in a real place</em>
          </h2>
          <Link className="button button-accent" href="/marketplace">
            Explore Properties <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>
      <div className="landing-legal">
        <LegalTitleDisclaimer />
      </div>
    </div>
  );
}
