import os from "node:os";
import path from "node:path";

export function locations(env = process.env) {
  const config = env.LAKESIDE_CODE_CONFIG_DIR || path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "lakeside-code");
  const state = env.LAKESIDE_CODE_STATE_DIR || path.join(env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "lakeside-code");
  return { config, state, peers: env.LAKESIDE_CODE_PEERS || path.join(config, "peers.json"), handoffs: path.join(state, "handoffs") };
}
export default { locations };
