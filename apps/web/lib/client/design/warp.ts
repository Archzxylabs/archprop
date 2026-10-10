/* Archcore portal choreography, adapted with React lifecycle cleanup. */
import { byId, clamp } from "./dom";

export interface WarpController {
  section: HTMLElement;
  update(progress: number, scrollDistance: number): void;
  dispose(): void;
}

const portalExpandEnd = 0.12;
const portalFadeStart = 0.82;
const portalFadeEnd = 0.98;

export function createWarpMotion(reducedMotion: boolean): WarpController {
  const section = byId("warp-story");
  const portal = byId("warp-portal");
  const panels = [
    ...document.querySelectorAll<HTMLElement>("[data-warp-panel]"),
  ];
  const canvas = byId<HTMLCanvasElement>("warp-canvas");
  const context = canvas.getContext("2d");
  let currentIndex = -1;
  let progress = 0;
  let visible = false;
  let impulse = 0;
  let centerY = 1;
  let width = 0;
  let height = 0;

  const stars = Array.from(
    { length: window.innerWidth < 900 ? 420 : 980 },
    () => ({
      angle: Math.random() * Math.PI * 2,
      distance: Math.random() * 1.2,
      length: 0.008 + Math.random() * 0.055,
      width: 0.35 + Math.random() * 1.15,
      neon: Math.random() > 0.77,
      sparkle: Math.random() > 0.66,
      size: 0.7 + Math.random() * 2.4,
    }),
  );
  const dust = Array.from(
    { length: window.innerWidth < 900 ? 100 : 240 },
    () => ({
      angle: Math.random() * Math.PI * 2,
      distance: Math.random() * 1.22,
      size: 0.6 + Math.random() * 1.9,
      neon: Math.random() > 0.84,
      opacity: 0.28 + Math.random() * 0.54,
    }),
  );

  const resize = () => {
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize);
  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = entry?.isIntersecting ?? false;
    },
    { rootMargin: "100px" },
  );
  observer.observe(section);

  const setPanel = (index: number) => {
    if (index === currentIndex) return;
    currentIndex = index;
    panels.forEach((panel, i) => {
      panel.classList.toggle("is-active", i === index);
      panel.classList.toggle("is-past", i < index);
      panel.inert = i !== index;
      panel.setAttribute("aria-hidden", String(i !== index));
    });
  };

  const updatePortal = (value: number) => {
    if (reducedMotion) {
      centerY = 0.5;
      return;
    }
    const portalWidth = portal.clientWidth || innerWidth;
    const portalHeight = portal.clientHeight || innerHeight;
    const fullRadius = Math.hypot(portalWidth, portalHeight) * 0.52 + 24;
    const storyTop = section.getBoundingClientRect().top;
    const growth = clamp((innerHeight - storyTop) / (innerHeight * 1.38));
    const eased = growth * growth * (3 - 2 * growth);
    centerY = clamp(
      (innerHeight * (1 - eased * 0.5) - Math.max(storyTop, 0)) / portalHeight,
    );
    const fadeProgress = clamp(
      (value - portalFadeStart) / (portalFadeEnd - portalFadeStart),
    );
    const faded = fadeProgress * fadeProgress * (3 - 2 * fadeProgress);
    portal.style.setProperty("--portal-radius", `${fullRadius * eased}px`);
    portal.style.setProperty("--portal-y", `${centerY * 100}%`);
    portal.style.setProperty(
      "--counter-opacity",
      String(clamp((value - portalExpandEnd) / 0.045)),
    );
    portal.style.setProperty("--text-exit-scale", String(1 + faded * 0.55));
    portal.style.setProperty("--text-exit-opacity", String(1 - faded));
    portal.classList.toggle("is-exiting", fadeProgress > 0);
    portal.style.transform = `scale(${1 + faded * 0.5})`;
    portal.style.opacity = String(1 - faded);
  };

  let lastFrame = performance.now();
  let frameId = 0;
  const draw = (now: number) => {
    if (!reducedMotion) frameId = requestAnimationFrame(draw);
    if (!context || !visible) {
      lastFrame = now;
      return;
    }
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    context.clearRect(0, 0, width, height);
    const xCenter = width * 0.5;
    const yCenter = height * centerY;
    const radius = Math.max(width, height) * 0.76;
    impulse *= Math.pow(0.89, dt * 60);
    const speed = reducedMotion
      ? 0
      : 0.08 + Math.sin(progress * Math.PI) * 0.32 + impulse * 1.25;

    for (const star of stars) {
      const previous = star.distance;
      star.distance += speed * dt * (0.28 + star.distance * 1.8);
      if (star.distance > 1.34) {
        star.distance = Math.random() * 0.08;
        star.angle = Math.random() * Math.PI * 2;
      }
      const from = Math.max(
        previous - star.length * (0.7 + progress * 1.2 + impulse * 1.8),
        0,
      );
      const cos = Math.cos(star.angle);
      const sin = Math.sin(star.angle);
      context.beginPath();
      context.moveTo(
        xCenter + cos * from * radius,
        yCenter + sin * from * radius * 0.78,
      );
      context.lineTo(
        xCenter + cos * star.distance * radius,
        yCenter + sin * star.distance * radius * 0.78,
      );
      context.lineWidth = star.width * (0.5 + star.distance);
      context.strokeStyle = star.neon
        ? `rgba(204,255,0,${Math.min(0.82, 0.24 + star.distance * 0.6)})`
        : `rgba(255,255,255,${Math.min(0.78, 0.22 + star.distance * 0.54)})`;
      context.stroke();
      if (star.sparkle) {
        const size = star.size * (0.65 + star.distance * 0.55);
        context.fillStyle = star.neon
          ? "rgba(204,255,0,0.82)"
          : "rgba(255,255,255,0.86)";
        context.fillRect(
          xCenter + cos * star.distance * radius - size * 0.5,
          yCenter + sin * star.distance * radius * 0.78 - size * 0.5,
          size,
          size,
        );
      }
    }

    const drift = reducedMotion ? 0 : now * 0.000012;
    for (const mote of dust) {
      const distance = (mote.distance + drift * (0.35 + mote.distance)) % 1.22;
      const x = xCenter + Math.cos(mote.angle) * distance * radius;
      const y = yCenter + Math.sin(mote.angle) * distance * radius * 0.78;
      if (x < 0 || x > width || y < 0 || y > height) continue;
      context.fillStyle = mote.neon
        ? `rgba(204,255,0,${mote.opacity})`
        : `rgba(255,255,255,${mote.opacity})`;
      context.fillRect(x, y, mote.size, mote.size);
    }
  };
  frameId = requestAnimationFrame(draw);

  return {
    section,
    dispose() {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener("resize", resize);
    },
    update(value, scrollDistance) {
      updatePortal(value);
      setPanel(
        reducedMotion
          ? Math.min(2, Math.floor(value * 3))
          : value < portalExpandEnd
            ? -1
            : Math.min(
                2,
                Math.floor(
                  ((value - portalExpandEnd) /
                    (portalFadeStart - portalExpandEnd)) *
                    3,
                ),
              ),
      );
      progress = value;
      impulse = Math.max(impulse, Math.min(Math.abs(scrollDistance) / 72, 1));
    },
  };
}
