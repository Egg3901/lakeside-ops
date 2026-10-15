"use strict";

const RELEASE = Object.freeze({
  version: "2.0.2",
  tag: "v2.0.2",
  website: "https://www.ahousedividedgame.com",
  game: "https://ahousedividedgame.com",
  logo: "https://cdn.ahousedividedgame.com/static/ahd-logo.png",
  assets: Object.freeze({
    windows: "AHDClient_2.0.2_x64-setup.exe",
    macAppleSilicon: "AHDClient_1.0.3_aarch64.dmg",
    macIntel: "AHDClient_1.0.3_x64.dmg",
    linuxAppImage: "AHDClient_2.0.0_amd64.AppImage",
    linuxDeb: "AHDClient_2.0.0_amd64.deb",
    checksums: "SHA256SUMS",
  }),
  sizes: Object.freeze({
    windows: "73 MB",
    macAppleSilicon: "5.2 MB",
    macIntel: "5.4 MB",
    linuxAppImage: "244 MB",
    linuxDeb: "173 MB",
  }),
});

function releaseAsset(filename) {
  return `/downloads/${encodeURIComponent(filename)}`;
}

function sizeOf(key) {
  return RELEASE.sizes[key] ? ` <span class="size">${RELEASE.sizes[key]}</span>` : "";
}

function makeDownloadPortal() {
  const a = RELEASE.assets;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Download AHDClient for Windows, macOS, or Linux.">
  <meta name="theme-color" content="#14141c">
  <title>Download AHDClient | Lakeside Games</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap">
  <style>
    :root {
      color-scheme: dark;
      --background: #14141c;
      --foreground: #e8e8ee;
      --muted: #8f8f9d;
      --primary: #dc2626;
      --primary-dark: #991b1b;
      --primary-hover: #b91c1c;
      --card: #1d1d2a;
      --card-elevated: #26263a;
      --card-muted: #11111a;
      --card-border: #2a2a3d;
      --gold: #d4af37;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--foreground);
      background: var(--background);
      font-family: Geist, -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", sans-serif;
      font-size: .875rem;
      line-height: 1.5;
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: .025;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E");
    }

    a { color: inherit; }

    .site-header {
      position: sticky;
      top: 0;
      z-index: 10;
      background: rgba(20, 20, 28, .85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--card-border);
    }

    .site-header-inner {
      width: min(1120px, calc(100% - 40px));
      margin: 0 auto;
      padding: 14px 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    .wordmark {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: var(--foreground);
      text-decoration: none;
      font-family: Fraunces, Georgia, serif;
      font-size: 17px;
      font-weight: 600;
      letter-spacing: -.01em;
    }

    .wordmark img { width: 30px; height: 30px; border-radius: 6px; }

    .header-actions { display: flex; align-items: center; gap: 12px; }

    .version {
      color: var(--muted);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .signin {
      color: var(--muted);
      text-decoration: none;
      font-size: 14px;
      font-weight: 600;
      white-space: nowrap;
    }

    .signin:hover { color: var(--foreground); }

    .signup {
      padding: 8px 16px;
      border-radius: 6px;
      background: var(--primary);
      color: #fff;
      text-decoration: none;
      font-size: 14px;
      font-weight: 700;
      white-space: nowrap;
    }

    .signup:hover { background: var(--primary-hover); }

    main {
      width: min(1120px, calc(100% - 40px));
      margin: 0 auto;
      padding: 64px 0 60px;
      position: relative;
    }

    .eyebrow {
      color: var(--primary);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .14em;
      text-transform: uppercase;
      margin-bottom: 16px;
    }

    h1 {
      margin: 0;
      font-family: Fraunces, Georgia, serif;
      font-size: clamp(40px, 6vw, 68px);
      font-weight: 500;
      letter-spacing: -.02em;
      line-height: 1.04;
    }

    .hero { max-width: 720px; margin-bottom: 44px; }

    .hero p {
      max-width: 620px;
      margin: 20px 0 0;
      color: var(--muted);
      font-size: clamp(16px, 2vw, 18px);
    }

    .platforms {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
    }

    .platform {
      padding: 24px;
      display: flex;
      flex-direction: column;
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      box-shadow: 0 4px 12px -1px #0009, 0 2px 4px -2px #00000080;
    }

    .platform-mark {
      width: 40px;
      height: 40px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(220, 38, 38, .4);
      border-radius: 8px;
      color: #f87171;
      background: rgba(220, 38, 38, .1);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .04em;
    }

    h2 { margin: 18px 0 4px; font-size: 20px; letter-spacing: -.01em; }
    .requirement { color: var(--muted); font-size: 13px; margin-bottom: 20px; }
    .actions { margin-top: auto; display: grid; gap: 8px; }

    .button {
      min-height: 44px;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      border: 1px solid var(--card-border);
      border-radius: 6px;
      background: var(--card-elevated);
      color: var(--foreground);
      text-decoration: none;
      font-size: 14px;
      font-weight: 600;
    }

    .button:hover { border-color: #3f3f55; }
    .button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

    .button.primary { background: var(--primary); border-color: transparent; color: #fff; }
    .button.primary:hover { background: var(--primary-hover); }

    .button .size { color: var(--muted); font-size: 12px; font-weight: 500; font-variant-numeric: tabular-nums; }
    .button.primary .size { color: rgba(255, 255, 255, .75); }

    .notes {
      margin-top: 28px;
      padding: 18px 4px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      color: var(--muted);
      border-top: 1px solid var(--card-border);
      font-size: 13px;
    }

    .notes strong { color: var(--foreground); }
    .notes-links { display: flex; gap: 16px; white-space: nowrap; }
    .notes a { color: var(--foreground); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--primary); }
    .notes a:hover { color: #fff; }

    footer {
      width: min(1120px, calc(100% - 40px));
      margin: 0 auto;
      padding: 20px 0 32px;
      color: var(--muted);
      font-size: 12px;
      border-top: 1px solid var(--card-border);
    }

    @media (max-width: 820px) {
      main { padding-top: 40px; }
      .platforms { grid-template-columns: 1fr; }
      .notes { align-items: flex-start; flex-direction: column; }
    }

    @media (max-width: 480px) {
      .site-header-inner, main, footer { width: min(100% - 28px, 1120px); }
      .wordmark span { display: none; }
      .version { display: none; }
      .hero { margin-bottom: 32px; }
      .platform { padding: 20px; }
      .notes-links { flex-wrap: wrap; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; }
    }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="site-header-inner">
      <a class="wordmark" href="${RELEASE.game}" aria-label="A House Divided home">
        <img src="${RELEASE.logo}" alt="" onerror="this.style.display='none'">
        <span>A House Divided</span>
      </a>
      <div class="header-actions">
        <span class="version">AHDClient ${RELEASE.version}</span>
        <a class="signin" href="${RELEASE.game}/login">Sign in</a>
        <a class="signup" href="${RELEASE.game}/register">Sign up</a>
      </div>
    </div>
  </header>

  <main>
    <section class="hero" aria-labelledby="download-title">
      <div class="eyebrow">A House Divided · Desktop</div>
      <h1 id="download-title">Your country.<br>Your machine.</h1>
      <p>Play A House Divided locally with AHDClient, or open the live multiplayer game from the same app. Choose your desktop platform below.</p>
    </section>

    <section class="platforms" aria-label="Desktop downloads">
      <article class="platform">
        <div class="platform-mark" aria-hidden="true">WIN</div>
        <h2>Windows</h2>
        <div class="requirement">Version 2.0.2 · Windows 10 or newer, 64-bit</div>
        <div class="actions">
          <a class="button primary" href="${releaseAsset(a.windows)}"><span>Installer (.exe)</span>${sizeOf("windows")}</a>
        </div>
      </article>

      <article class="platform">
        <div class="platform-mark" aria-hidden="true">MAC</div>
        <h2>macOS</h2>
        <div class="requirement">Legacy version 1.0.3 · macOS 11 or newer</div>
        <div class="actions">
          <a class="button primary" href="${releaseAsset(a.macAppleSilicon)}"><span>Apple silicon (.dmg)</span>${sizeOf("macAppleSilicon")}</a>
          <a class="button" href="${releaseAsset(a.macIntel)}"><span>Intel (.dmg)</span>${sizeOf("macIntel")}</a>
        </div>
      </article>

      <article class="platform">
        <div class="platform-mark" aria-hidden="true">LNX</div>
        <h2>Linux</h2>
        <div class="requirement">Version 2.0.0 · 64-bit desktop Linux</div>
        <div class="actions">
          <a class="button primary" href="${releaseAsset(a.linuxAppImage)}"><span>AppImage</span>${sizeOf("linuxAppImage")}</a>
          <a class="button" href="${releaseAsset(a.linuxDeb)}"><span>Debian / Ubuntu (.deb)</span>${sizeOf("linuxDeb")}</a>
        </div>
      </article>
    </section>

    <aside class="notes" aria-label="Download notes">
      <div><strong>Windows 2.0.2:</strong> Fixes local game startup and account linking, adds entitlement-aware Singleplayer and Sandbox access, introduces the historical world-building loader, and enables signed in-app updates for later releases.</div>
      <div><strong>Signing notice:</strong> These preview builds are not publicly code-signed or notarized. Your operating system may ask you to approve the app before first launch.</div>
      <div class="notes-links">
        <a href="${releaseAsset(a.checksums)}">Checksums</a>
        <a href="${RELEASE.website}">Game website</a>
      </div>
    </aside>
  </main>

  <footer>Lakeside Games Development</footer>
</body>
</html>`;
}

module.exports = { RELEASE, makeDownloadPortal, releaseAsset };
