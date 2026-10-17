"use strict";

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";
// Add destinations here only after reviewing their target and validation.
// A submitted request must never choose a Railway variable or service directly.
const DESTINATIONS = Object.freeze({
  posthog: Object.freeze({
    label: "PostHog project key",
    variableName: "NEXT_PUBLIC_POSTHOG_KEY",
    validate: (value) => /^phc_[A-Za-z0-9_-]{12,200}$/.test(value),
    hint: "Public project key, starting with phc_",
  }),
});

function parseCredential(destinationId, value) {
  if (typeof destinationId !== "string" || !Object.hasOwn(DESTINATIONS, destinationId)) return null;
  const destination = DESTINATIONS[destinationId];
  if (!destination || typeof value !== "string") return null;
  const secret = value.trim();
  return destination.validate(secret) ? { destination, secret } : null;
}

// Only this deployment's own sign-in hosts may submit. Pass the configured SSO
// hosts; the studio host is the default for existing callers.
function isOpsOrigin(origin, hosts = ["ops.lakesidegames.net"]) {
  return typeof origin === "string" && hosts.some((host) => origin === `https://${host}`);
}

async function readCredentialSubmission(req) {
  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    return { error: "Expected JSON", status: 415 };
  }
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 1024) return { error: "Request too large", status: 413 };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { error: "Invalid request", status: 400 }; }
  const credential = parseCredential(parsed?.destination, parsed?.value);
  if (!credential) return { error: "Choose a supported credential and enter a valid value", status: 400 };
  return credential;
}

function railwayConfig(env = process.env) {
  const token = env.RAILWAY_API_TOKEN || "";
  const projectId = env.RAILWAY_PROJECT_ID || "";
  const serviceId = env.RAILWAY_MAIN_SERVICE_ID || "";
  if (!token || !projectId || !serviceId) return null;
  return { token, projectId, serviceId };
}

async function railwayRequest(config, query, variables, stage, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(RAILWAY_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Railway request failed");
    const body = await response.json();
    if (body.errors?.length) throw new Error("Railway request failed");
    return body.data;
  } catch {
    // Upstream errors can echo input values. Only this fixed stage label may
    // reach local logs; never log the response body or request variables.
    throw Object.assign(new Error("Railway request failed"), { stage });
  }
}

async function saveCredential(credential, config, fetchImpl = fetch) {
  const project = await railwayRequest(config, `query($id: String!) {
    project(id: $id) {
      services { edges { node { id name } } }
      environments { edges { node { id name } } }
    }
  }`, { id: config.projectId }, "lookup", fetchImpl);
  const services = project?.project?.services?.edges?.map((edge) => edge.node) || [];
  const environments = project?.project?.environments?.edges?.map((edge) => edge.node) || [];
  const mainService = services.find((service) => service.id === config.serviceId);
  const production = environments.filter((environment) => environment.name.toLowerCase() === "production");
  // Service IDs are stable across renames. The configured ID is the fixed
  // destination; the browser cannot choose a different service.
  if (!mainService || production.length !== 1) {
    throw Object.assign(new Error("Railway target is not configured"), { stage: "target" });
  }

  const data = await railwayRequest(config, `mutation($input: VariableUpsertInput!) {
    variableUpsert(input: $input)
  }`, { input: {
    projectId: config.projectId,
    environmentId: production[0].id,
    serviceId: config.serviceId,
    name: credential.destination.variableName,
    value: credential.secret,
  } }, "write", fetchImpl);
  if (data?.variableUpsert !== true) {
    throw Object.assign(new Error("Railway did not confirm the update"), { stage: "confirmation" });
  }
}

const CSS = `
.credential-wrap{max-width:720px;margin:0 auto;padding:var(--s-8) 0}
.credential-wrap h1{font-size:clamp(1.5rem,3vw,2rem);letter-spacing:-.025em}
.credential-wrap p{color:var(--text-3);line-height:1.6;margin-top:var(--s-3)}
.credential-card{margin-top:var(--s-6);padding:var(--s-6);border:1px solid var(--border);border-radius:var(--r-lg);background:var(--surface);box-shadow:var(--e1)}
.credential-card label{display:block;font-weight:700;margin-bottom:var(--s-2)}
.credential-card input,.credential-card select{width:100%;padding:var(--s-3);border:1px solid var(--border);border-radius:var(--r-md);background:var(--surface);color:var(--text);font:inherit;margin-bottom:var(--s-4)}
.credential-card button{margin-top:var(--s-4);padding:var(--s-3) var(--s-5);border:0;border-radius:var(--r-md);background:var(--accent);color:white;font:inherit;font-weight:700;cursor:pointer}
.credential-card button:disabled{opacity:.6;cursor:wait}
.credential-status{min-height:1.5em;margin-top:var(--s-3)}
`;

const BODY = `<div class="credential-wrap">
  <h1>Credentials</h1>
  <p>Send approved credentials to their production deployment. Values are never shown or stored in Ops. Each destination has a fixed target and validation rule.</p>
  <form id="credential-form" class="credential-card" autocomplete="off">
    <label for="credential-destination">Destination</label>
    <select id="credential-destination" name="destination" required>
      <option value="posthog">A House Divided · PostHog project key</option>
    </select>
    <p>After the PostHog DPA is signed, this saves <code>NEXT_PUBLIC_POSTHOG_KEY</code> to AHD Production on Railway and starts a new build.</p>
    <label for="credential-value">Credential value</label>
    <input id="credential-value" name="value" type="password" autocomplete="off" spellcheck="false" required maxlength="204" placeholder="phc_…" aria-describedby="credential-hint">
    <p id="credential-hint">Public project key, starting with phc_</p>
    <button type="submit">Save to AHD deployment</button>
    <p id="credential-status" class="credential-status" role="status" aria-live="polite"></p>
  </form>
</div>
<script>
(function(){
  var form=document.getElementById('credential-form');
  var destination=document.getElementById('credential-destination');
  var input=document.getElementById('credential-value');
  var status=document.getElementById('credential-status');
  var button=form.querySelector('button');
  form.addEventListener('submit',async function(event){
    event.preventDefault();
    button.disabled=true;
    status.textContent='Saving…';
    try {
      var response=await fetch('/api/settings/credentials',{
        method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({destination:destination.value,value:input.value})
      });
      var result=await response.json();
      status.textContent=response.ok?'Saved. Railway will build and deploy the update.':(result.error||'Could not save the key.');
    } catch {
      status.textContent='Could not save the key. Please retry.';
    } finally {
      input.value='';
      button.disabled=false;
    }
  });
})();
</script>`;

module.exports = { DESTINATIONS, parseCredential, isOpsOrigin, readCredentialSubmission, railwayConfig, saveCredential, CSS, BODY };
