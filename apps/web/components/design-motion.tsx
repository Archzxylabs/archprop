"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { clamp } from "@/lib/client/design/dom";
import { createWarpMotion } from "@/lib/client/design/warp";

/** Shared boot, page progress, scroll-aware navigation and route reveals. */
export function DesignChrome() {
  const pathname = usePathname();
  const bootRef = useRef<HTMLDivElement>(null);
  const percentRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const boot = bootRef.current;
    const percent = percentRef.current;
    let raf = 0;
    if (!boot || !percent) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const started = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.min(1, (now - started) / 1180);
      percent.textContent = `${String(Math.round((1 - Math.pow(1 - elapsed, 3)) * 100)).padStart(3, "0")}%`;
      if (elapsed < 1) raf = requestAnimationFrame(tick);
      else boot.classList.add("is-done");
    };
    if (media.matches) boot.classList.add("is-done");
    else {
      boot.classList.remove("is-done");
      raf = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    let last = scrollY,
      raf = 0;
    const bar = document.getElementById("page-progress");
    const header = document.getElementById("site-header");
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      raf = 0;
      const y = scrollY;
      if (bar)
        bar.style.transform = `scaleX(${clamp(y / Math.max(document.documentElement.scrollHeight - innerHeight, 1))})`;
      if (Math.abs(y - last) > 3)
        header?.classList.toggle(
          "is-hidden",
          !media.matches &&
            y > 170 &&
            y > last &&
            header.querySelector('[aria-expanded="true"]') === null &&
            !header.matches(":focus-within"),
        );
      last = y;
      const footer = document.querySelector<HTMLElement>(".site-footer");
      if (footer && !media.matches)
        footer.style.setProperty(
          "--end-rise",
          `${(1 - clamp((innerHeight - footer.getBoundingClientRect().top) / innerHeight)) * 78}px`,
        );
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }),
      { threshold: 0.1, rootMargin: "0px 0px -8% 0px" },
    );
    const reveal = () => {
      document.body.classList.toggle("motion-ready", !media.matches);
      document
        .querySelectorAll<HTMLElement>("[data-reveal], .ap-page > section")
        .forEach((el) => {
          if (!media.matches) {
            el.dataset.reveal = "";
            observer.observe(el);
          } else el.classList.add("is-visible");
        });
      if (media.matches) header?.classList.remove("is-hidden");
    };
    header?.classList.remove("is-hidden");
    reveal();
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    media.addEventListener("change", reveal);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      media.removeEventListener("change", reveal);
      document.body.classList.remove("motion-ready");
    };
  }, [pathname]);
  return (
    <>
      <div className="boot-screen is-done" ref={bootRef} aria-hidden="true">
        <div className="boot-center">
          <span className="boot-symbol">
            A<span />
          </span>
          <strong>ARCHPROP</strong>
          <small>PREPARING YOUR PROPERTY SPACE</small>
        </div>
        <div className="boot-bottom">
          <span>REAL PLACES. CLEAR PARTICIPATION.</span>
          <span className="boot-percent" ref={percentRef}>
            000%
          </span>
        </div>
      </div>
      <div className="page-progress" id="page-progress" aria-hidden="true" />
    </>
  );
}

/** Exact Archcore chapter thresholds, portal, horizontal catalog and timeline choreography. */
export function LandingMotion() {
  useEffect(() => {
    const story = document.getElementById("story");
    if (!story) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = media.matches,
      raf = 0,
      lastY = scrollY;
    let warp = createWarpMotion(reduced);
    const panels = Array.from(
      story.querySelectorAll<HTMLElement>("[data-story-panel]"),
    );
    const buttons = Array.from(
      story.querySelectorAll<HTMLButtonElement>("[data-step]"),
    );
    const chapter = document.getElementById("catalog-scroll-story");
    const viewport = document.getElementById("catalog-window");
    const cardObserver = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) =>
          e.target.classList.toggle(
            "is-in-view",
            reduced || e.intersectionRatio >= 0.3,
          ),
        ),
      { root: viewport, threshold: 0.3 },
    );
    const resizeCatalog = () => {
      cardObserver.disconnect();
      viewport
        ?.querySelectorAll(".offer-card")
        .forEach((card) => cardObserver.observe(card));
      if (chapter && viewport) {
        const travel = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
        chapter.style.height =
          innerWidth <= 900 || reduced
            ? "auto"
            : `${Math.ceil(innerHeight + (travel > 30 ? travel * 2.35 + 260 : 0))}px`;
      }
    };
    const progressOf = (el: HTMLElement) =>
      clamp(
        -el.getBoundingClientRect().top /
          Math.max(el.offsetHeight - innerHeight, 1),
      );
    const timeline = (
      id: string,
      selector: string,
      contentSelector: string,
      currentId: string,
      prefix: string,
      focus: number,
    ) => {
      const section = document.getElementById(id);
      if (!section) return;
      const steps = Array.from(section.querySelectorAll<HTMLElement>(selector));
      const centers = steps.map(
        (el) =>
          el.getBoundingClientRect().top +
          (id === "faq" ? 125 : Math.min(el.offsetHeight * 0.34, 125)),
      );
      let nearest = 0;
      centers.forEach((center, i) => {
        if (
          Math.abs(center - innerHeight * focus) <
          Math.abs(centers[nearest]! - innerHeight * focus)
        )
          nearest = i;
      });
      steps.forEach((el, i) => {
        el.classList.toggle("is-active", i === nearest);
        const content = el.querySelector<HTMLElement>(contentSelector);
        if (content && !reduced) {
          const old =
            parseFloat(el.style.getPropertyValue(`--${prefix}-lift`)) || 0;
          const reveal = clamp(
            (innerHeight * 0.97 - (content.getBoundingClientRect().top - old)) /
              (innerHeight * 0.45),
          );
          el.style.setProperty(
            `--${prefix}-lift`,
            `${((1 - reveal) * 64).toFixed(1)}px`,
          );
          el.style.setProperty(
            `--${prefix}-opacity`,
            (0.45 + reveal * 0.55).toFixed(3),
          );
        }
      });
      const progress =
        clamp(
          (innerHeight * focus - centers[0]!) /
            Math.max(centers.at(-1)! - centers[0]!, 1),
        ) * 100;
      section.style.setProperty(
        id === "faq" ? "--faq-progress" : "--timeline-progress",
        `${progress}%`,
      );
      section.style.setProperty("--how-progress", `${progress}%`);
      const counter = document.getElementById(currentId);
      if (counter) counter.textContent = String(nearest + 1).padStart(2, "0");
    };
    const update = () => {
      raf = 0;
      const value = progressOf(story);
      const index = Math.min(3, Math.floor(value * 4));
      panels.forEach((panel, i) => {
        panel.classList.toggle("is-active", i === index);
        panel.inert = !reduced && i !== index;
        panel.setAttribute("aria-hidden", String(!reduced && i !== index));
      });
      buttons.forEach((button, i) => {
        button.classList.toggle("is-active", i === index);
        button.setAttribute("aria-current", i === index ? "step" : "false");
      });
      const line = document.getElementById("story-progress");
      if (line) line.style.width = `${value * 100}%`;
      const hud = document.getElementById("hud-spec");
      if (hud)
        hud.textContent =
          [
            "PROPERTY / 01",
            "OWNERSHIP + VALUATION",
            "30% ECONOMIC RIGHTS",
            "ESCROW / mIDR",
          ][index] ?? "PROPERTY / 01";
      if (!reduced) warp.update(progressOf(warp.section), scrollY - lastY);
      if (chapter && viewport && innerWidth > 900 && !reduced) {
        const p = progressOf(chapter);
        viewport.scrollLeft =
          Math.max(0, viewport.scrollWidth - viewport.clientWidth) * p;
        chapter.style.setProperty("--catalog-progress", `${p * 100}%`);
      }
      timeline(
        "how-it-works",
        ".timeline-step",
        ".flow-card",
        "how-current",
        "step",
        0.52,
      );
      timeline(
        "faq",
        ".faq-group",
        ".faq-group-content",
        "faq-current",
        "faq",
        0.4,
      );
      const provider = document.getElementById("provider");
      if (provider && !reduced) {
        const rect = provider.getBoundingClientRect();
        const p = clamp((innerHeight - rect.top) / (innerHeight + rect.height));
        provider.style.setProperty("--provider-y", `${(0.5 - p) * 95}px`);
      }
      lastY = scrollY;
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const resize = () => {
      resizeCatalog();
      schedule();
    };
    const handlers = buttons.map((button, index) => {
      const click = () => {
        const range = story.offsetHeight - innerHeight;
        window.scrollTo({
          top: story.offsetTop + range * ((index + 0.12) / 4),
          behavior: reduced ? "instant" : "smooth",
        });
      };
      button.addEventListener("click", click);
      return () => button.removeEventListener("click", click);
    });
    const faq = Array.from(document.querySelectorAll("#faq details"));
    faq.forEach((el) => el.addEventListener("toggle", schedule));
    const preference = () => {
      reduced = media.matches;
      warp.dispose();
      warp = createWarpMotion(reduced);
      resize();
    };
    resizeCatalog();
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", resize);
    window.addEventListener("archprop:catalog-change", resize);
    media.addEventListener("change", preference);
    return () => {
      cancelAnimationFrame(raf);
      warp.dispose();
      cardObserver.disconnect();
      handlers.forEach((fn) => fn());
      faq.forEach((el) => el.removeEventListener("toggle", schedule));
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", resize);
      window.removeEventListener("archprop:catalog-change", resize);
      media.removeEventListener("change", preference);
    };
  }, []);
  return null;
}
