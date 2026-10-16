"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { locations } = require("./config.mjs");
const USAGE = "lakeside code update [--check] [--channel preview|stable] [--tag code-vVERSION] [--repo OWNER/REPO]";
function options(input, env) {
  const result = { check: false, channel: env.LAKESIDE_CODE_UPDATE_CHANNEL || "preview", repo: env.LAKESIDE_CODE_UPDATE_REPO || "lakesidegamedev/lakeside-ops" };
  for (let i = 0; i < input.length; i++) {
    if (input[i] === "--check") result.check = true;
    else if (["--channel", "--tag", "--repo"].includes(input[i]) && input[i + 1] && !input[i + 1].startsWith("--")) { const key = input[i].slice(2); result[key] = input[++i]; }
    else throw Error(USAGE);
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(result.repo) || !["preview", "stable"].includes(result.channel) || result.tag && !/^code-v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(result.tag)) throw Error(USAGE);
  return result;
}
function selectRelease(releases, channel) {
  return releases.filter(row => !row.draft && /^code-v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(row.tag_name) && (channel === "preview" || !row.prerelease && !row.tag_name.slice(6).includes("-")))
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0];
}
function verify(bytes, manifest, name) {
  const rows = manifest.split(/\r?\n/).map(line => /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line)).filter(row => row && row[2] === name);
  if (rows.length !== 1 || crypto.createHash("sha256").update(bytes).digest("hex") !== rows[0][1].toLowerCase()) throw Error("Update checksum verification failed. Nothing was installed.");
}
async function main(input, env = process.env, dependencies = {}) {
  const opt = options(input, env);
  const run = dependencies.run || ((command, args, extra = {}) => require("cross-spawn").sync(command, args, { env, encoding: "utf8", timeout: 120000, ...extra }));
  const ghAvailable = run("gh", ["--version"]).status === 0;
  async function api(endpoint) {
    if (ghAvailable) {
      const result = run("gh", ["api", `repos/${opt.repo}/${endpoint}`]);
      if (result.status !== 0) throw Error("Cannot access update releases. Run gh auth login with repository access, or check the update repository.");
      return JSON.parse(result.stdout);
    }
    const response = await fetch(`https://api.github.com/repos/${opt.repo}/${endpoint}`, { signal: AbortSignal.timeout(30000), redirect: "error", headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) throw Error(`Update lookup failed (${response.status}). Private repositories require GitHub CLI: gh auth login.`);
    return response.json();
  }
  const release = opt.tag ? await api(`releases/tags/${encodeURIComponent(opt.tag)}`) : selectRelease(await api("releases?per_page=100"), opt.channel);
  if (!release || release.draft) throw Error(`No published terminal release found for ${opt.channel}.`);
  const assets = release.assets || [];
  const packages = assets.filter(row => /^lakesidegamedev-code-\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?\.tgz$/.test(row.name));
  const checksums = assets.find(row => row.name === "SHA256SUMS");
  if (packages.length !== 1 || !checksums) throw Error("Release is missing its unique npm package or SHA256SUMS.");
  console.log(`Installed: ${require("./package.json").version}. Available: ${release.tag_name} (${opt.repo}, ${opt.channel}).`);
  if (opt.check) { console.log(`Install with lakeside code update --repo ${opt.repo} --tag ${release.tag_name}. Exit other coding terminals first.`); return; }
  const receiptFile = path.join(locations(env).state, "update.json");
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8")); } catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
  if (receipt?.repo === opt.repo && receipt.tag === release.tag_name && packages[0].name === `lakesidegamedev-code-${require("./package.json").version}.tgz`) { console.log("Already up to date."); return; }
  if (fs.existsSync(path.resolve(__dirname, "../..", ".git"))) throw Error("This is a source checkout. Update it through Git; use the packaged global installation for self-update.");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "keir-code-update-"));
  try {
    for (const asset of [packages[0], checksums]) {
      const target = path.join(directory, asset.name);
      if (ghAvailable) {
        const result = run("gh", ["release", "download", release.tag_name, "--repo", opt.repo, "--pattern", asset.name, "--dir", directory]);
        if (result.status !== 0) throw Error("Update download failed. Check GitHub access and retry.");
      } else {
        const url = new URL(asset.browser_download_url);
        if (url.protocol !== "https:" || url.hostname !== "github.com" || !url.pathname.startsWith(`/${opt.repo}/releases/download/`)) throw Error("Unexpected release asset URL.");
        const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw Error(`Update download failed (${response.status}).`);
        const chunks = []; let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 128 * 1024 * 1024) throw Error("Update asset exceeds size limit.");
          chunks.push(chunk);
        }
        fs.writeFileSync(target, Buffer.concat(chunks), { mode: 0o600 });
      }
    }
    const archive = path.join(directory, packages[0].name);
    verify(fs.readFileSync(archive), fs.readFileSync(path.join(directory, "SHA256SUMS"), "utf8"), packages[0].name);
    console.log(`Checksum verified. Installing ${release.tag_name}...`);
    const installed = run("npm", ["install", "--global", archive, "--no-audit", "--no-fund"], { stdio: "inherit", timeout: 300000 });
    if (installed.status !== 0) throw Error("npm update failed. Review its output and retry; your configuration has not been changed.");
    const state = locations(env).state;
    fs.mkdirSync(state, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(state, "update.json"), JSON.stringify({ repo: opt.repo, tag: release.tag_name, updatedAt: new Date().toISOString() }) + "\n", { mode: 0o600 });
    console.log(`Updated to ${release.tag_name}. Start a new terminal with lakeside code. Provider settings, project contexts and VPS credentials are retained.`);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
module.exports = { main, options, selectRelease, verify };
