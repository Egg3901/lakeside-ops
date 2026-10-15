"use strict";
// Executed inside the task's network-isolated bubblewrap namespace. Replaying
// the bounded input log keeps state across calls without a resident browser.
const fs = require("node:fs");
const { chromium } = require("/opt/computer-runtime/node_modules/playwright");
(async () => {
  const { html, steps } = JSON.parse(fs.readFileSync("/workspace/.keir-computer/request.json", "utf8"));
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  try {
    const context = await browser.newContext({ viewport: { width: 960, height: 640 }, acceptDownloads: false, serviceWorkers: "block" });
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    page.on("dialog", (dialog) => dialog.dismiss());
    context.on("page", (popup) => { if (popup !== page) popup.close().catch(() => {}); });
    page.setDefaultTimeout(3000);
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 5000 });
    for (const step of steps) {
      if (step.action === "click") await page.mouse.click(step.x, step.y);
      else if (step.action === "type") await page.keyboard.insertText(step.text);
      else if (step.action === "key") await page.keyboard.press(step.key);
      else if (step.action === "scroll") await page.mouse.wheel(0, step.y);
      await page.waitForTimeout(80);
    }
    await page.screenshot({ path: "/workspace/.keir-computer/screen.png", timeout: 5000, animations: "disabled" });
    const out = { title: await page.title(), text: (await page.locator("body").innerText({ timeout: 3000 })).slice(0, 6000) };
    fs.writeFileSync("/workspace/.keir-computer/result.json", JSON.stringify(out));
  } finally { await browser.close(); }
})().catch((e) => { console.error(String(e.message).slice(0, 500)); process.exit(1); });
