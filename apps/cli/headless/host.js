"use strict";
// Where this host keeps provider binaries, credentials and the optional
// provider launcher. Everything resolves from HOME, PATH or an explicit
// override, so a standalone install works under any account. On the studio
// VPS HOME is /root, which resolves to the same files as before.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const home = () => process.env.HOME || os.homedir();
const executable = (file) => { try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; } };

// User-level install locations first, then the caller's PATH, then the system.
function searchPath() {
  const h = home();
  const dirs = [path.join(h, ".local/bin"), path.join(h, ".hermes/node/bin"), path.join(h, ".opencode/bin"),
    ...String(process.env.PATH || "").split(path.delimiter), "/usr/local/bin", "/usr/bin", "/bin"];
  return [...new Set(dirs.filter(Boolean))].join(path.delimiter);
}

// Each engine's own installer location comes first, so a second copy elsewhere
// on PATH (for example a newer claude in ~/.local/bin) is not picked silently.
const INSTALLED = { claude: ".hermes/node/bin", codex: ".hermes/node/bin", opencode: ".opencode/bin", agy: ".local/bin", muse: ".local/bin" };

// An explicit LAKESIDE_<NAME>_BIN wins; then the engine's install location; then
// the search path; otherwise the bare name, so spawn reports a clear ENOENT.
function bin(name) {
  const override = process.env[`LAKESIDE_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_BIN`];
  if (override) return override;
  const dirs = [...(INSTALLED[name] ? [path.join(home(), INSTALLED[name])] : []), ...searchPath().split(path.delimiter)];
  for (const dir of dirs) if (executable(path.join(dir, name))) return path.join(dir, name);
  return name;
}

const credential = (relative) => path.join(home(), relative);

// The studio launcher adds admission control and hides Git metadata from the
// engine. Without it, engines run directly in their disposable worktree.
function providerRunner() {
  const file = process.env.LAKESIDE_PROVIDER_RUNNER || path.join(home(), "bin/provider-agent-run.sh");
  return executable(file) ? file : null;
}

module.exports = { home, searchPath, bin, credential, providerRunner };
