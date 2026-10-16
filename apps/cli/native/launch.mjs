// @ts-check
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fork } from "node:child_process";
import { loadBackends } from "./backends.mjs";

/** @param {{backend: string, args: string[], nativeRun?: string, nativeModel?: string, carry?: string}} settings @param {NodeJS.ProcessEnv} env */
export async function startNativeBridge(settings, env) {
  const backend = loadBackends(env).find(row => row.id === settings.backend);
  if (!backend) throw new Error(`Unknown backend ${settings.backend}. Use lakeside code backends to list configured backends.`);
  if (settings.args.length > 1 || settings.args[0]?.startsWith("-")) throw new Error("Native backend accepts one project path, --model, --resume-run and --carry. Other engine flags require --backend api.");
  const directory = path.resolve(settings.args[0] || process.cwd());
  const options = { backend, directory, runId: settings.nativeRun, model: settings.nativeModel, carry: settings.carry };
  const child = fork(fileURLToPath(new URL("./host.mjs", import.meta.url)), [], { env: { ...env, LAKESIDE_NATIVE_OPTIONS: JSON.stringify(options) }, stdio: ["ignore", "ignore", "ignore", "ipc"] });
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    const connection = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Native bridge startup deadline exceeded")), 10000);
      child.once("error", reject);
      child.once("exit", () => reject(new Error("Native bridge exited during startup")));
      child.on("message", value => {
        if (!value || typeof value !== "object") return;
        const row = /** @type {Record<string, unknown>} */ (value);
        if (row.type === "error") reject(new Error(typeof row.message === "string" ? row.message : "Native bridge failed"));
        if (row.type === "ready" && typeof row.url === "string" && typeof row.token === "string") resolve({ url: row.url, token: row.token });
      });
    });
    clearTimeout(timer);
    return { connection, async close() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await new Promise(resolve => {
        const deadline = setTimeout(() => { child.kill("SIGKILL"); resolve(undefined); }, 5000);
        child.once("exit", () => { clearTimeout(deadline); resolve(undefined); });
      });
    } };
  } catch (error) { clearTimeout(timer); child.kill("SIGTERM"); throw error; }
}
