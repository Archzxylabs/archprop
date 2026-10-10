/* Optional real-browser layout and motion checks; no product dependency. */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const { chromium } = await import(
  process.env.ARCHPROP_PLAYWRIGHT_MODULE || "playwright"
);
const baseUrl = process.env.ARCHPROP_BASE_URL || "http://localhost:3000";
const outputDir =
  process.env.ARCHPROP_DESIGN_OUTPUT ||
  join(tmpdir(), "archprop-design-review");
await mkdir(outputDir, { recursive: true });
import assert from "node:assert/strict";
import fs from "node:fs";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
  headless: true,
  args: ["--no-sandbox"],
});
const issues = [];
const errors = [];
const results = [];
const page = await browser.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(baseUrl + "/owner", { waitUntil: "networkidle" });
const ownerPropertyRoute = await page
  .getByRole("link", { name: "Manage property", exact: true })
  .getAttribute("href");
assert.ok(ownerPropertyRoute);
const routes = [
  "/",
  "/marketplace",
  "/property/ARCHPROP-001",
  "/owner",
  "/owner/property/new",
  ownerPropertyRoute,
  "/verifier",
  "/verifier/ARCHPROP-001",
  "/portfolio",
  "/admin",
];
try {
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      const response = await page.goto(baseUrl + route, {
        waitUntil: "networkidle",
      });
      await page.waitForTimeout(80);
      const report = await page.evaluate(() => ({
        h1: document.querySelectorAll("h1").length,
        overflow: document.documentElement.scrollWidth > innerWidth,
        width: document.documentElement.scrollWidth,
        color: getComputedStyle(document.documentElement)
          .getPropertyValue("--accent")
          .trim(),
        font: getComputedStyle(document.querySelector("h1")).fontFamily,
      }));
      if (response.status() !== 200 || report.h1 !== 1 || report.overflow)
        issues.push({ width, route, status: response.status(), ...report });
      if (route === "/marketplace" && [375, 1440].includes(width)) {
        await page.waitForTimeout(2100);
        await page.screenshot({
          path: `${outputDir}/marketplace-${width}.png`,
          fullPage: true,
        });
      }
      if (route === "/property/ARCHPROP-001" && [375, 1440].includes(width)) {
        await page.waitForTimeout(2100);
        await page.screenshot({
          path: `${outputDir}/property-${width}.png`,
          fullPage: true,
        });
      }
      if (route === "/owner/property/new" && width === 1440) {
        await page.waitForTimeout(2100);
        await page.screenshot({
          path: `${outputDir}/owner-form.png`,
          fullPage: true,
        });
      }
      results.push({ width, route, ...report });
    }
    console.log("Checked route set at", width);
  }
  fs.writeFileSync(
    `${outputDir}/layout-results.json`,
    JSON.stringify({ issues, errors, results }, null, 2),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
  const chapterHeight = await page
    .locator("#story")
    .evaluate((el) => el.offsetHeight - innerHeight);
  for (const [index, p] of [0.02, 0.3, 0.55, 0.8].entries()) {
    await page.evaluate(
      (y) => window.scrollTo({ top: y, behavior: "instant" }),
      chapterHeight * p,
    );
    await page.waitForTimeout(1000);
    assert.equal(
      await page
        .locator(".story-panel.is-active")
        .getAttribute("data-story-panel"),
      String(index),
    );
    assert.equal(
      await page
        .locator(".story-panel:not(.is-active)")
        .first()
        .evaluate((el) => el.inert),
      true,
    );
    await page.waitForTimeout(2100);
    await page.screenshot({ path: `${outputDir}/chapter-${index}.png` });
  }
  const warp = await page.locator("#warp-story").evaluate((el) => ({
    top: el.offsetTop,
    range: el.offsetHeight - innerHeight,
  }));
  for (const [index, p] of [0.2, 0.5, 0.75].entries()) {
    await page.evaluate(
      (y) => window.scrollTo({ top: y, behavior: "instant" }),
      warp.top + warp.range * p,
    );
    await page.waitForTimeout(1100);
    assert.equal(
      await page
        .locator(".warp-panel.is-active")
        .getAttribute("data-warp-panel"),
      String(index),
    );
    await page.waitForTimeout(2100);
    await page.screenshot({ path: `${outputDir}/portal-${index}.png` });
  }
  const catalog = await page
    .locator("#catalog-scroll-story")
    .evaluate((el) => ({
      top: el.offsetTop,
      range: el.offsetHeight - innerHeight,
    }));
  await page.evaluate(
    (y) => window.scrollTo({ top: y, behavior: "instant" }),
    catalog.top,
  );
  await page.waitForTimeout(900);
  await page.waitForTimeout(2100);
  await page.screenshot({ path: `${outputDir}/catalog.png` });
  await page.evaluate(
    (y) => window.scrollTo({ top: y, behavior: "instant" }),
    await page
      .locator("#catalog-scroll-story")
      .evaluate((el) => el.offsetTop + el.offsetHeight - innerHeight - 1),
  );
  await page.waitForTimeout(500);
  assert.ok(
    (await page.locator("#catalog-window").evaluate((el) => el.scrollLeft)) > 0,
  );
  await page.getByRole("button", { name: "Upcoming", exact: true }).click();
  await page.waitForTimeout(700);
  assert.equal(await page.locator(".property-card").count(), 2);
  await page.goto(baseUrl + "/marketplace", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Demo asset", exact: true }).click();
  assert.equal(await page.locator(".property-card").count(), 1);
  await page.getByRole("button", { name: "Estimate", exact: true }).click();
  assert.equal(await page.locator("dialog").evaluate((el) => el.open), true);
  assert.equal(
    await page
      .locator("dialog")
      .evaluate((el) => el.contains(document.activeElement)),
    true,
  );
  await page.locator("#participation-range").focus();
  await page.locator("#participation-range").press("End");
  await page.waitForTimeout(2100);
  await page.screenshot({ path: `${outputDir}/estimate.png` });
  assert.ok(
    await page
      .locator(".quote-total")
      .innerText()
      .then((s) => s.replace(/\s/g, "").includes("3000000000mIDR")),
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("dialog").evaluate((el) => el.open), false);
  assert.equal(await page.evaluate(() => document.body.style.overflow), "");
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(2100);
  await page.waitForTimeout(2100);
  await page.screenshot({ path: `${outputDir}/mobile-hero.png` });
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  assert.equal(await page.locator("#primary-nav-mobile a").count(), 6);
  await page.waitForTimeout(2100);
  await page.screenshot({ path: `${outputDir}/mobile-menu.png` });
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#primary-nav-mobile").count(), 0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".story-panel[inert]").count(), 0);
  assert.ok(
    (await page.locator("#story").evaluate((el) => el.offsetHeight)) <
      900 * 4.4,
  );
  assert.equal(
    await page
      .locator(".boot-screen")
      .evaluate((el) => getComputedStyle(el).display),
    "none",
  );
  await page.locator("#faq").scrollIntoViewIfNeeded();
  await page
    .locator("#faq summary")
    .filter({ hasText: "Does a token give me legal title to the land?" })
    .click();
  assert.equal(
    await page
      .locator("#faq details")
      .first()
      .evaluate((el) => el.open),
    true,
  );
  await page.waitForTimeout(2100);
  await page.screenshot({ path: `${outputDir}/reduced-motion-faq.png` });
  const plain = await browser.newPage({
    javaScriptEnabled: false,
    viewport: { width: 375, height: 900 },
  });
  await plain.goto(baseUrl, { waitUntil: "networkidle" });
  assert.equal(await plain.locator(".no-script-navigation a").count(), 6);
  assert.equal(await plain.locator(".story-panel").count(), 4);
  for (const panel of await plain.locator(".story-panel").all())
    assert.equal(
      await panel.evaluate((el) => getComputedStyle(el).opacity),
      "1",
    );
  assert.equal(
    await plain
      .locator(".property-scene-fallback")
      .first()
      .evaluate((el) => getComputedStyle(el).display),
    "block",
  );
  assert.equal(
    await plain.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await plain.screenshot({
    path: `${outputDir}/no-javascript.png`,
    fullPage: true,
  });
  await plain.close();
  console.log(
    JSON.stringify(
      {
        issues,
        errors,
        checked: results.length,
        interactions:
          "hero, portal, catalog, filters, estimator, focus, escape, menu, reduced-motion, FAQ and no-JavaScript content passed",
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    `${outputDir}/results.json`,
    JSON.stringify({ issues, errors, results }, null, 2),
  );
  assert.equal(issues.length, 0);
  assert.equal(errors.length, 0);
} finally {
  await browser.close();
}
