class LegacySessionUnavailable extends Error {
  constructor() { super("Legacy session check unavailable"); }
}

/** Pin one deployment and forward only its exact cookie. No local JWT fallback. */
function createLegacyAhdVerifier(config, fetcher = fetch) {
  const origin = new URL(config.origin);
  const cookieName = config.cookieName;
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("Legacy origin must be an HTTPS origin");
  }
  if (!/^auth-token-[a-z0-9-]+$/.test(cookieName)) throw new Error("Exact legacy cookie name required");
  const endpoint = new URL("/api/auth/session", origin).toString();
  return async function verify(cookieHeader) {
    const values = (cookieHeader ?? "").split(";").map(part => part.trim())
      .filter(part => part.startsWith(`${cookieName}=`))
      .map(part => part.slice(cookieName.length + 1));
    if (values.length !== 1 || !values[0] || values[0].length > 8192 || /[\r\n]/.test(values[0])) return null;
    try {
      const response = await fetcher(endpoint, {
        method: "GET",
        headers: { Cookie: `${cookieName}=${values[0]}`, Accept: "application/json" },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 401) { await response.body?.cancel(); return null; }
      if (response.status !== 200 || response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
        await response.body?.cancel();
        throw new LegacySessionUnavailable();
      }
      const reader = response.body?.getReader();
      if (!reader) throw new LegacySessionUnavailable();
      let size = 0;
      const chunks = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 16384) throw new LegacySessionUnavailable();
          chunks.push(value);
        }
      } finally { await reader.cancel(); }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new LegacySessionUnavailable();
      const data = body;
      const now = Math.floor(Date.now() / 1000);
      if (data.active !== true || typeof data.sub !== "string" || !/^[a-f0-9]{24}$/.test(data.sub) ||
          typeof data.username !== "string" || !data.username ||
          typeof data.iat !== "number" || !Number.isSafeInteger(data.iat) || data.iat < 0 || data.iat > now + 60 ||
          typeof data.exp !== "number" || !Number.isSafeInteger(data.exp) || data.exp <= now || data.exp <= data.iat) {
        throw new LegacySessionUnavailable();
      }
      if (data.email !== undefined && typeof data.email !== "string") throw new LegacySessionUnavailable();
      const identity = { provider: "ahd", id: data.sub, username: data.username };
      // Contact metadata for legacy consumers, never ownership or verified-email proof.
      if (typeof data.email === "string" && data.email) identity.email = data.email;
      return { identity, issuedAt: data.iat, expiresAt: data.exp };
    } catch { throw new LegacySessionUnavailable(); }
  };
}

const verifyProductionGameSession = createLegacyAhdVerifier({
  origin: process.env.AHD_SESSION_ORIGIN || "https://ahousedividedgame.com",
  cookieName: process.env.AHD_SESSION_COOKIE_NAME || "auth-token-main-site",
});
module.exports = { createLegacyAhdVerifier, LegacySessionUnavailable, verifyProductionGameSession };
