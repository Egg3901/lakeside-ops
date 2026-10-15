#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const makeCodeListPage = require("../code-list-page");
const makeTmuxTerminalPage = require("../tmux-terminal-page");
const fixtures = require("../code-agent-visual-fixtures");
const { FONT_LINKS, BASE_CSS, injectNav } = require("../ops-shell");

function loadPlaywright() {
  try {
    return require("playwright");
  } catch (firstError) {
    if (process.env.PLAYWRIGHT_MODULE) {
      return require(process.env.PLAYWRIGHT_MODULE);
    }
    throw new Error(
      "Playwright is required. Install it locally or set PLAYWRIGHT_MODULE to its module directory.",
      { cause: firstError }
    );
  }
}

const { chromium } = loadPlaywright();
const outputDir = path.resolve(process.argv[2] || "artifacts/code-agent-visual-qa");
const listHtml = injectNav(
  makeCodeListPage(FONT_LINKS, BASE_CSS),
  "/code",
  { role: "admin" },
  { mobileToggle: false }
);
const tmuxHtml = makeTmuxTerminalPage(FONT_LINKS);

function json(route, body) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installRoutes(page) {
  await page.route("http://visual.local/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.resourceType() === "document") {
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: url.pathname.startsWith("/code/tmux/") ? tmuxHtml : listHtml,
      });
    }
    if (url.pathname === "/api/me") return json(route, { role: "admin" });
    if (url.pathname === "/api/code/sessions") {
      return json(route, {
        sessions: fixtures.sessions,
        groups: fixtures.groups,
        costs: fixtures.costs,
      });
    }
    if (url.pathname === "/api/code/costs") return json(route, fixtures.costs);
    if (url.pathname.endsWith("/capture")) return json(route, fixtures.capture);
    if (url.pathname.includes("/capture")) return json(route, { unchanged: true, version: "fixture-v1" });
    if (url.pathname.endsWith("/delivery")) return json(route, { delivery: { eligible: false } });
    if (url.pathname === "/api/code/branches") return json(route, { branches: ["main", "development"] });
    if (request.resourceType() === "font" || request.resourceType() === "stylesheet") return route.abort();
    return route.fulfill({ status: 204, body: "" });
  });
}

async function snap(browser, name, pathname, viewport, theme) {
  const context = await browser.newContext({
    viewport,
    colorScheme: theme,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.addInitScript(({ fixedNow, selectedTheme }) => {
    Date.now = () => Date.parse(fixedNow);
    localStorage.setItem("ahd-theme", selectedTheme);
  }, { fixedNow: fixtures.FIXED_NOW, selectedTheme: theme });
  await installRoutes(page);
  await page.goto(`http://visual.local${pathname}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(pathname === "/code" ? ".session-card" : ".activity-host:not([hidden])");
  const overflowsViewport = await page.evaluate(() =>
    document.documentElement.scrollWidth > window.innerWidth + 1
  );
  if (overflowsViewport) throw new Error(`${name} overflows the viewport horizontally`);
  if (pageErrors.length) throw pageErrors[0];
  await page.screenshot({
    path: path.join(outputDir, `${name}.png`),
    fullPage: pathname === "/code" && viewport.width >= 600,
  });
  await context.close();
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    await snap(browser, "code-desktop-dark", "/code", { width: 1440, height: 1000 }, "dark");
    await snap(browser, "code-mobile-dark", "/code", { width: 390, height: 844 }, "dark");
    await snap(browser, "code-desktop-light", "/code", { width: 1440, height: 1000 }, "light");
    await snap(browser, "code-mobile-light", "/code", { width: 390, height: 844 }, "light");
    await snap(browser, "tmux-desktop-dark", "/code/tmux/gpt-living-workspace", { width: 1440, height: 1000 }, "dark");
    await snap(browser, "tmux-mobile-dark", "/code/tmux/gpt-living-workspace", { width: 390, height: 844 }, "dark");
    await snap(browser, "tmux-desktop-light", "/code/tmux/gpt-living-workspace", { width: 1440, height: 1000 }, "light");
    await snap(browser, "tmux-mobile-light", "/code/tmux/gpt-living-workspace", { width: 390, height: 844 }, "light");
  } finally {
    await browser.close();
  }
  process.stdout.write(`${outputDir}\n`);
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
