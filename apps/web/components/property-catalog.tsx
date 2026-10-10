"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { VILLA_NUSA } from "@archprop/shared";
import { ChainValue } from "@/components/chain-state";
import { StatusBadge } from "@/components/status-badge";
import { LegalTitleDisclaimer } from "@/components/demo-disclosure";
import { findListing } from "@/lib/client/listings";
import {
  formatBps,
  formatCompact,
  formatWholeUnits,
  type PropertyCardView,
} from "@/lib/client/view-models";

type Filter = "all" | "demo" | "upcoming";

export function PropertyCatalog({
  cards,
  mode = "grid",
  mismatch = null,
}: {
  cards: PropertyCardView[];
  mode?: "grid" | "story";
  mismatch?: string | null;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [units, setUnits] = useState(100);
  const dialog = useRef<HTMLDialogElement>(null);
  const savedOverflow = useRef("");
  const estimateOpen = useRef(false);
  const lastFilter = useRef(filter);
  const visible = cards.filter(
    (card) =>
      filter === "all" || (filter === "demo" ? !!card.assetId : !card.assetId),
  );

  useEffect(() => {
    window.dispatchEvent(new Event("archprop:catalog-change"));
    if (lastFilter.current !== filter) {
      const chapter = document.getElementById("catalog-scroll-story");
      document
        .getElementById("catalog-window")
        ?.scrollTo({ left: 0, behavior: "instant" });
      if (
        chapter &&
        innerWidth > 900 &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        window.scrollTo({ top: chapter.offsetTop, behavior: "instant" });
      }
      lastFilter.current = filter;
    }
  }, [filter]);
  useEffect(
    () => () => {
      if (estimateOpen.current)
        document.body.style.overflow = savedOverflow.current;
    },
    [],
  );

  const openEstimate = () => {
    savedOverflow.current = document.body.style.overflow;
    dialog.current?.showModal();
    estimateOpen.current = true;
    document.body.style.overflow = "hidden";
  };
  const move = (direction: number) => {
    const chapter = document.getElementById("catalog-scroll-story");
    const viewport = document.getElementById("catalog-window");
    if (!viewport) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (chapter && innerWidth > 900 && !reduced) {
      const travel = viewport.scrollWidth - viewport.clientWidth;
      if (travel <= 0) return;
      const range = Math.max(chapter.offsetHeight - innerHeight, 1);
      window.scrollBy({
        top: (direction * 383 * range) / travel,
        behavior: "smooth",
      });
    } else
      viewport.scrollBy({
        left: direction * 383,
        behavior: reduced ? "instant" : "smooth",
      });
  };

  return (
    <>
      <div className="catalog-top" data-reveal>
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> PROPERTY COLLECTION / HACKATHON
            DEMO
          </div>
          {mode === "story" ? (
            <h2 id="catalog-title">
              Find your place.
              <br />
              <em>See the potential</em>
            </h2>
          ) : null}
          <p>
            Explore the property, review its evidence, and understand the
            economic rights before participating.
          </p>
        </div>
        <div className="catalog-controls">
          <div
            className="filter-group"
            role="group"
            aria-label="Property filters"
          >
            {(
              [
                ["all", "All properties"],
                ["demo", "Demo asset"],
                ["upcoming", "Upcoming"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={filter === value ? "is-active" : ""}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === "story" ? (
            <div className="catalog-arrows">
              <button
                type="button"
                onClick={() => move(-1)}
                aria-label="Previous property"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => move(1)}
                aria-label="Next property"
              >
                →
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div
        className={mode === "story" ? "catalog-window" : "property-grid-window"}
        id={mode === "story" ? "catalog-window" : undefined}
      >
        <ul
          className={mode === "story" ? "offer-track" : "property-grid"}
          id={mode === "story" ? "offer-track" : undefined}
        >
          {visible.map((card, index) => (
            <li
              className="offer-card is-in-view property-card"
              key={card.externalId}
            >
              <div className="offer-visual property-visual">
                <span className="offer-index">
                  AP / {String(index + 1).padStart(2, "0")}
                </span>
                <span className="offer-badge">
                  {card.assetId ? "PRIMARY DEMO" : "UPCOMING PROPERTY"}
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={card.imageUrl ?? undefined}
                  alt={`${card.name}, ${card.location} — illustrative property concept`}
                />
                <span className="property-image-label">
                  ILLUSTRATIVE / SYNTHETIC
                </span>
              </div>
              <div className="offer-body">
                <div className="offer-type">{card.location} / PROPERTY</div>
                <h3>{card.name}</h3>
                <StatusBadge status={card.presentationStatus} />
                <p className="offer-desc">
                  {findListing(card.externalId)?.summary}
                </p>
                {card.fundamentals ? (
                  <div className="offer-specs">
                    <div>
                      <small>PROPERTY VALUE</small>
                      <strong>
                        {formatCompact(card.fundamentals.indicativeValue)} mIDR
                      </strong>
                    </div>
                    <div>
                      <small>OFFERING TARGET</small>
                      <strong>
                        {formatCompact(card.fundamentals.offeringTarget)} mIDR
                      </strong>
                    </div>
                    <div>
                      <small>ECONOMIC RIGHTS</small>
                      <strong>
                        {formatBps(card.fundamentals.economicRightsBps)}
                      </strong>
                    </div>
                    <div>
                      <small>FIXED SUPPLY</small>
                      <strong>
                        {formatWholeUnits(card.fundamentals.tokenSupply)} AVNUSA
                      </strong>
                    </div>
                  </div>
                ) : (
                  <div className="upcoming-terms">
                    <span className="eyebrow">DETAILS TO FOLLOW</span>
                    <p>
                      Offering terms will appear after the property publishes
                      its fundamentals.
                    </p>
                  </div>
                )}
                <div className="property-funding">
                  <span className="eyebrow">FUNDING / CHAIN READ</span>
                  <ChainValue
                    state={
                      card.funding.status === "unavailable"
                        ? {
                            ...card.funding,
                            reason: card.assetId
                              ? "Live funding is unavailable in this environment. Review the property for its current offering status."
                              : "No on-chain offering is available for this property.",
                          }
                        : card.funding
                    }
                    label="funding progress"
                  >
                    {(funding) => (
                      <>
                        <div className="funding-readout">
                          <strong>{formatBps(funding.percentBps)}</strong>
                          <span>
                            {formatCompact(funding.raisedAmount)} /{" "}
                            {formatCompact(funding.targetAmount)} mIDR
                          </span>
                        </div>
                        <progress
                          className="funding-meter"
                          value={
                            funding.raisedAmount > funding.targetAmount
                              ? 10000
                              : funding.percentBps
                          }
                          max={10000}
                          aria-label={`${card.name} funding progress`}
                        />
                        {card.fundamentals &&
                        funding.targetAmount !==
                          card.fundamentals.offeringTarget ? (
                          <p role="alert" className="text-critical text-xs">
                            The live offering target differs from the published
                            offering size. Investment is disabled until they
                            agree.
                          </p>
                        ) : null}
                      </>
                    )}
                  </ChainValue>
                  {card.externalId === VILLA_NUSA.externalId && mismatch ? (
                    <p role="alert" className="text-critical text-xs">
                      {mismatch} Investment is disabled until live terms match.
                    </p>
                  ) : null}
                </div>
                {card.fundamentals ? (
                  <div className="offer-bottom">
                    <div className="offer-price">
                      <small>PER AVNUSA / DEMO CURRENCY</small>
                      <strong>
                        {formatWholeUnits(card.fundamentals.tokenPrice)}
                      </strong>
                      <span> mIDR</span>
                    </div>
                    <button type="button" onClick={openEstimate}>
                      Estimate <span aria-hidden="true">↗</span>
                    </button>
                  </div>
                ) : null}
                {card.assetId ? (
                  <Link
                    className="property-card-link text-link"
                    href={`/property/${card.assetId}`}
                  >
                    View property <span aria-hidden="true">↗</span>
                  </Link>
                ) : (
                  <p className="property-card-link upcoming-label">
                    No on-chain asset yet <span aria-hidden="true">↗</span>
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="catalog-bottom">
        <span>
          <i /> mIDR — DEMO CURRENCY — NO REAL MONETARY VALUE
        </span>
        <span>
          {mode === "story"
            ? "SCROLL / SWIPE TO EXPLORE"
            : `${visible.length} PROPERTIES`}{" "}
          <b>↗</b>
        </span>
      </div>
      <dialog
        ref={dialog}
        className="quote-overlay participation-dialog"
        aria-labelledby="quote-title"
        onClose={() => {
          document.body.style.overflow = savedOverflow.current;
          estimateOpen.current = false;
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div
          className="quote-backdrop"
          aria-hidden="true"
          onClick={() => dialog.current?.close()}
        />
        <div className="quote-drawer">
          <button
            className="quote-close"
            type="button"
            aria-label="Close estimate"
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
          <div className="eyebrow">
            PARTICIPATION ESTIMATE / PUBLISHED TERMS
          </div>
          <h2 id="quote-title">
            A place in
            <br />
            <em>the picture</em>
          </h2>
          <div className="quote-gpu">
            <strong>Villa Nusa</strong>
            <span>Bali / AVNUSA</span>
          </div>
          <label className="quote-label" htmlFor="participation-range">
            Economic-rights units{" "}
            <strong>{formatWholeUnits(BigInt(units))} AVNUSA</strong>
          </label>
          <input
            id="participation-range"
            type="range"
            min={1}
            max={VILLA_NUSA.tokenSupply.toString()}
            step={1}
            value={units}
            onChange={(event) => setUnits(Number(event.target.value))}
          />
          <div className="range-scale">
            <span>1 AVNUSA</span>
            <span>300,000 AVNUSA</span>
          </div>
          <div className="quote-breakdown">
            <div>
              <span>Published token price</span>
              <strong>{formatWholeUnits(VILLA_NUSA.tokenPrice)} mIDR</strong>
            </div>
            <div>
              <span>Rights in the whole property</span>
              <strong>
                {((units / Number(VILLA_NUSA.tokenSupply)) * 30).toLocaleString(
                  "en-US",
                  { maximumFractionDigits: 4 },
                )}
                %
              </strong>
            </div>
            <div>
              <span>Wallet gas</span>
              <strong>Not included</strong>
            </div>
            <div className="quote-total">
              <span>Illustrative amount</span>
              <strong>
                {formatWholeUnits(BigInt(units) * VILLA_NUSA.tokenPrice)} mIDR
              </strong>
            </div>
          </div>
          <p className="quote-note">
            Calculation only; this does not reserve tokens or submit an
            investment. Available allocation and investment eligibility require
            a live chain read. mIDR — Demo Currency — No Real Monetary Value.
          </p>
          <LegalTitleDisclaimer />
          <Link
            className="button button-accent quote-action"
            href={`/property/${VILLA_NUSA.id}`}
            onClick={() => dialog.current?.close()}
          >
            Review Villa Nusa <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </dialog>
    </>
  );
}
