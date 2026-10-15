/**
 * Copy-paste Lakeside Auth client (CommonJS port of lakeside-auth/client/lakeside-auth-client.ts).
 * No runtime dependencies; requires Node 18+.
 * Keep `internalToken` server-side. Never bundle this into browser code.
 */

class LakesideAuthClient {
  /** @param {{ baseUrl: string, internalToken: string }} options */
  constructor(options) {
    this._baseUrl = options.baseUrl.replace(/\/+$/, "");
    this._internalToken = options.internalToken;
  }

  /**
   * URL to use as an Express/http redirect target.
   * For AHD, pass the AHD sibling ingress (e.g. https://auth.ahousedividedgame.com)
   * as authOrigin so the browser sends the parent-domain game cookie.
   * @param {"ahd"|"discord"} provider
   * @param {string} returnUrl
   * @param {string} [authOrigin]
   */
  loginUrl(provider, returnUrl, authOrigin = this._baseUrl) {
    // `||`, not the default parameter alone: a default fires only for
    // `undefined`, so a caller reading an unset env var and coalescing it to ""
    // slipped straight past it and built `new URL(path, "/")`, which throws.
    // A misconfigured optional origin must degrade to the base URL, never take
    // the process down.
    const base = String(authOrigin || this._baseUrl || "").replace(/\/+$/, "");
    if (!/^https?:\/\//.test(base)) {
      throw new Error(
        `lakeside-auth: cannot build a login URL — no absolute auth origin (got ${JSON.stringify(base)})`
      );
    }
    const url = new URL(`/auth/${provider}`, `${base}/`);
    url.searchParams.set("return", returnUrl);
    return url.toString();
  }

  /** @param {string} code */
  async redeem(code) {
    return this._post("/internal/redeem", { code });
  }

  /** @param {string} sessionToken */
  async verify(sessionToken) {
    return this._post("/internal/verify", { sessionToken });
  }

  /**
   * @template T
   * @param {string} path
   * @param {Record<string, string>} body
   * @returns {Promise<T|null>}
   */
  async _post(path, body) {
    const response = await fetch(`${this._baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this._internalToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error(`Lakeside Auth ${path} failed (${response.status})`);
    return response.json();
  }
}

module.exports = { LakesideAuthClient };
