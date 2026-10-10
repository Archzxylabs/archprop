"use client";

import { useEffect, useRef } from "react";
import { clamp } from "@/lib/client/design/dom";

type Point = [number, number, number];
type Face = { points: Point[]; color: string; layer: number };

/** A procedural architectural model. Source camera, assembly, pointer and orbit timings are retained. */
export function PropertyScene({
  variant = "hero",
}: {
  variant?: "hero" | "provider";
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !host) {
      host?.classList.add("scene-unavailable");
      return;
    }
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = media.matches;
    let width = 1,
      height = 1,
      raf = 0,
      visible = true;
    let progress = 0,
      px = 0,
      py = 0,
      tx = 0,
      ty = 0,
      last = performance.now();
    const smooth = (a: number, b: number, value: number) => {
      const t = clamp((value - a) / (b - a));
      return t * t * (3 - 2 * t);
    };
    const particles = Array.from(
      { length: variant === "hero" ? 140 : 70 },
      (_, i) => ({
        angle: i * 2.39996,
        radius: 2.8 + (i % 17) * 0.12,
        size: 0.7 + (i % 4) * 0.4,
      }),
    );
    const resize = () => {
      width = host.clientWidth;
      height = host.clientHeight;
      const dpr = Math.min(devicePixelRatio || 1, 1.6);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const pointer = (event: PointerEvent) => {
      if (reduced || !["mouse", "pen"].includes(event.pointerType)) return;
      tx = (event.clientX / innerWidth) * 2 - 1;
      ty = (event.clientY / innerHeight) * 2 - 1;
    };
    const resetPointer = () => {
      tx = 0;
      ty = 0;
    };
    const draw = (now: number) => {
      if (!reduced) raf = requestAnimationFrame(draw);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (!visible || !width || !height) return;
      const story = document.getElementById("story");
      const target =
        variant === "hero" && story
          ? clamp(
              -story.getBoundingClientRect().top /
                Math.max(story.offsetHeight - innerHeight, 1),
            )
          : 0;
      progress += (target - progress) * Math.min(1, dt * 7);
      const ease = 1 - Math.exp(-dt * 8);
      px += (tx - px) * ease;
      py += (ty - py) * ease;
      const t = reduced ? 0 : now / 1000;
      const assembly =
        reduced || variant === "provider"
          ? 0
          : smooth(0.12, 0.31, progress) * (1 - smooth(0.61, 0.78, progress));
      const morph = reduced
        ? 0
        : smooth(0.15, 0.34, progress) * (1 - smooth(0.55, 0.72, progress));
      const yaw =
        (variant === "provider" ? -0.48 : -0.55 + progress * 2.95) +
        px * 0.16 +
        Math.sin(t * 0.3) * 0.035;
      const pitch = 0.52 + Math.sin(progress * Math.PI * 2) * 0.15 + py * 0.1;
      const scale = Math.min(width / 6.8, height / 6.5) * (1 - assembly * 0.14);
      const centerX = width * 0.5 - assembly * scale * 0.25;
      const centerY = height * 0.55 + Math.sin(t * 0.75) * scale * 0.07;
      const project = ([x, y, z]: Point) => {
        const a = x * Math.cos(yaw) + z * Math.sin(yaw);
        const b = z * Math.cos(yaw) - x * Math.sin(yaw);
        return {
          x: centerX + a * scale,
          y: centerY + (b * Math.sin(pitch) - y * Math.cos(pitch)) * scale,
          depth: b * Math.cos(pitch) + y * Math.sin(pitch),
        };
      };
      ctx.clearRect(0, 0, width, height);
      const shadow = ctx.createRadialGradient(
        centerX,
        centerY + scale * 1.2,
        0,
        centerX,
        centerY + scale * 1.2,
        scale * 2.7,
      );
      shadow.addColorStop(
        0,
        variant === "provider" ? "#ccff0028" : "#00000020",
      );
      shadow.addColorStop(1, "#00000000");
      ctx.save();
      ctx.translate(centerX, centerY + scale * 1.2);
      ctx.scale(1, 0.28);
      ctx.fillStyle = shadow;
      ctx.beginPath();
      ctx.arc(0, 0, scale * 2.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      particles.forEach((p, i) => {
        const a = p.angle + t * 0.008 + progress * 0.22;
        const spread = 1 - morph * 0.35;
        const x = centerX + Math.cos(a) * p.radius * scale * spread;
        const y = centerY + Math.sin(a) * p.radius * scale * 0.65 * spread;
        ctx.fillStyle =
          i % 3
            ? "#ccff0080"
            : variant === "provider"
              ? "#ffffff85"
              : "#00000035";
        ctx.fillRect(x, y, p.size, p.size);
      });
      const faces: Face[] = [];
      const box = (
        x: number,
        y: number,
        z: number,
        w: number,
        h: number,
        d: number,
        colors: [string, string, string],
        layer = 0,
      ) => {
        const points: Point[] = [
          [x, y, z],
          [x + w, y, z],
          [x + w, y, z + d],
          [x, y, z + d],
          [x, y + h, z],
          [x + w, y + h, z],
          [x + w, y + h, z + d],
          [x, y + h, z + d],
        ];
        [
          [4, 5, 6, 7],
          [0, 1, 5, 4],
          [1, 2, 6, 5],
          [2, 3, 7, 6],
          [3, 0, 4, 7],
        ].forEach((indices, i) =>
          faces.push({
            points: indices.map((j) => points[j]!),
            color: colors[i === 0 ? 0 : i % 2 ? 1 : 2],
            layer,
          }),
        );
      };
      const white: [string, string, string] = ["#ffffff", "#dadada", "#b8b8b8"];
      const black: [string, string, string] = ["#292929", "#060606", "#181818"];
      const lime: [string, string, string] = ["#ccff00", "#a9cd13", "#8da800"];
      // Floating site, pool, stepping stones and two interlocking villa volumes.
      box(-2.4, -0.3, -1.9, 4.8, 0.2, 3.8, white);
      box(-2.4, -0.34, -1.9, 4.8, 0.04, 3.8, black);
      box(-1.9, -0.09, 0.75, 2.7, 0.045, 0.8, black);
      box(-1.82, -0.04, 0.83, 2.54, 0.02, 0.64, lime);
      for (let i = 0; i < 6; i++)
        box(1.17, -0.06, -0.05 + i * 0.27, 0.68, 0.035, 0.17, white);
      box(-1.65, 0, -1.3, 2.65, 1.15, 1.65, black);
      box(-1.8, 1.15 + assembly * 0.75, -1.45, 3, 0.16, 1.95, white, 1);
      box(-1.67, 0, -1.31, 0.16, 1.15, 1.68, white);
      box(0.84, 0, -1.3, 0.16, 1.15, 1.68, white);
      for (let i = 0; i < 6; i++)
        box(-1.45 + i * 0.4, 0.12, 0.36, 0.024, 0.93, 0.028, white);
      box(-1.5, 0.1, 0.36, 2.24, 0.024, 0.03, white);
      box(-0.8, 1.31 + assembly * 0.35, -1.3, 2.25, 0.86, 1.1, white, 1);
      box(-0.65, 1.44 + assembly * 0.35, -0.185, 1.88, 0.58, 0.024, black, 1);
      for (let i = 0; i < 5; i++)
        box(
          -0.48 + i * 0.36,
          1.44 + assembly * 0.35,
          -0.15,
          0.025,
          0.58,
          0.018,
          white,
          1,
        );
      box(-0.94, 2.17 + assembly * 1.35, -1.42, 2.53, 0.13, 1.36, white, 2);
      box(-0.96, 2.29 + assembly * 1.35, -0.07, 2.54, 0.025, 0.07, lime, 2);
      // Slatted terrace canopy, accent planters and sculptural trees.
      for (let i = 0; i < 7; i++)
        box(
          1.12,
          0.95 + assembly * 0.45,
          -1.4 + i * 0.17,
          0.8,
          0.06,
          0.055,
          black,
          1,
        );
      for (const [x, z] of [
        [-2, -1.4],
        [1.84, 0.54],
        [1.84, 1.3],
      ] as const) {
        box(x - 0.13, 0, z - 0.13, 0.3, 0.17, 0.3, white);
        box(x - 0.03, 0.17, z - 0.03, 0.05, 0.67, 0.05, black);
        box(x - 0.22, 0.55, z - 0.22, 0.44, 0.47, 0.44, lime);
      }
      faces
        .map((f) => ({ ...f, vertices: f.points.map(project) }))
        .sort(
          (a, b) =>
            a.vertices.reduce((s, p) => s + p.depth, 0) / 4 -
            b.vertices.reduce((s, p) => s + p.depth, 0) / 4,
        )
        .forEach((face) => {
          ctx.beginPath();
          face.vertices.forEach((p, i) =>
            i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
          );
          ctx.closePath();
          ctx.fillStyle = face.color;
          ctx.fill();
          ctx.strokeStyle = "#00000018";
          ctx.lineWidth = 0.65;
          ctx.stroke();
        });
      if (assembly > 0.05) {
        ctx.strokeStyle = `rgba(204,255,0,${assembly * 0.6})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
        for (const x of [-1.6, 1]) {
          const a = project([x, 1.15, 0.4]),
            b = project([x, 1.15 + assembly * 0.75, 0.4]);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    };
    const resizeObserver = new ResizeObserver(() => {
      resize();
      if (reduced) draw(performance.now());
    });
    resizeObserver.observe(host);
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? false;
        if (reduced && visible) draw(performance.now());
      },
      { rootMargin: "200px" },
    );
    observer.observe(host);
    const preference = () => {
      reduced = media.matches;
      cancelAnimationFrame(raf);
      resetPointer();
      raf = requestAnimationFrame(draw);
    };
    resize();
    raf = requestAnimationFrame(draw);
    window.addEventListener("pointermove", pointer, { passive: true });
    window.addEventListener("blur", resetPointer);
    media.addEventListener("change", preference);
    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      observer.disconnect();
      window.removeEventListener("pointermove", pointer);
      window.removeEventListener("blur", resetPointer);
      media.removeEventListener("change", preference);
    };
  }, [variant]);
  return (
    <div
      className={
        variant === "hero"
          ? "gpu-canvas property-scene"
          : "provider-gpu-canvas property-scene"
      }
      role="img"
      aria-label="Illustrative Villa Nusa architectural model with scroll-driven rotation and exploded layers"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="property-scene-fallback"
        src="/properties/villa-nusa.svg"
        alt=""
        aria-hidden="true"
      />
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}
