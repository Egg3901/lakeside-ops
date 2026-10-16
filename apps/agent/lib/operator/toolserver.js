"use strict";
// Loopback MCP endpoint that exposes the broker's tools to a headless Claude
// Code session. Each activation gets its own unguessable path bound to one job,
// its tool list and its abort signal; nothing else is reachable through it.
const http = require("node:http");
const crypto = require("node:crypto");
const { redactSecrets } = require("../text");

function createToolServer({ broker, normalizeImage, port = 0 }) {
  const sessions = new Map();
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(body === undefined ? "" : JSON.stringify(body)); };
    const route = /^\/mcp\/([a-f0-9]{48})(\/completion)?$/.exec(req.url || "");
    const token = route?.[1];
    const session = token && sessions.get(token);
    if (!session) return send(404, { error: "unknown session" });
    if (route[2]) {
      if (req.method !== "GET") return send(405, { error: "GET only" });
      res.setHeader("Cache-Control", "no-store");
      if (session.completion) return send(200, session.completion);
      session.waiters.add(res);
      res.once("close", () => session.waiters.delete(res));
      return;
    }
    if (req.method !== "POST") return send(405, { error: "POST only" });
    let raw = ""; for await (const chunk of req) { raw += chunk; if (raw.length > 2e6) return send(413, { error: "too large" }); }
    let msg; try { msg = JSON.parse(raw); } catch { return send(400, { error: "invalid json" }); }
    if (msg.id === undefined) return send(202);
    const ok = (result) => send(200, { jsonrpc: "2.0", id: msg.id, result });
    if (msg.method === "initialize") return ok({ protocolVersion: msg.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "keir", version: "1.0.0" } });
    if (msg.method === "ping") return ok({});
    if (msg.method === "tools/list") return ok({ tools: session.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })) });
    if (msg.method !== "tools/call") return send(200, { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
    const { name, arguments: input = {} } = msg.params || {};
    if (!session.tools.some((t) => t.name === name)) return ok({ isError: true, content: [{ type: "text", text: `tool ${name} is not available in this task` }] });
    const finishingCall=name === "finish" || name === "submit_result" || name === "finish_patch" || name === "edit_verify" && input.complete === true;
    if (session.completion || session.finishing || finishingCall && session.pending) return ok({ isError: true, content: [{ type: "text", text: "Activation is finished or another tool is still running; finish only after all tool results are verified." }] });
    session.pending++;
    if (finishingCall) session.finishing = true;
    try {
      if(name==='finish'&&session.job.resultSchema&&input.state==='done')throw new Error('Complete this structured task with submit_result and its required result object. Use finish only for waiting, blocked or dismissed work.');
      const submission=name==='submit_result';
      if(submission&&input.result===undefined)throw new Error('submit_result requires result matching the advertised task schema'+(session.job.resultSchema?.required?.length?'; required fields: '+session.job.resultSchema.required.join(', '):''));
      const submissionSummary=(typeof input.summary==='string'&&input.summary.trim()?input.summary:typeof input.result?.answer==='string'&&input.result.answer.trim()?input.result.answer:'Structured result submitted.').slice(0,4000);
      const effectiveInput=submission?{state:'done',result:input.result,summary:submissionSummary}:input;
      const result = await broker.tool(session.job, submission?'finish':name, effectiveInput, session.signal);
      const images = result?.image ? [result.image] : result?._images || [];
      const safe = result && typeof result === "object" ? { ...result } : result;
      if (safe && typeof safe === "object") { delete safe._images; delete safe.image; }
      const content = [{ type: "text", text: redactSecrets(JSON.stringify(safe ?? null)).slice(0, 22000) }];
      for (const source of images) {
        try { const img = normalizeImage(source); content.push({ type: "image", data: img.data, mimeType: img.media_type }); }
        catch (e) { content.push({ type: "text", text: e.message }); }
      }
      session.calls++;
      const finished=(name === "finish" || submission) && typeof result?.state === "string" ? {state:result.state,summary:effectiveInput.summary} : (name === "finish_patch" || name === "edit_verify" && input.complete === true) && session.job.codingContract?.allowCompleteOnPass === true && session.job.state === "done" && result?.finished?.state === "done" ? result.finished : null;
      if (finished) {
        session.completion = { version: 1, state: finished.state, summary: redactSecrets(String(finished.summary || "")).slice(0, 4000), resultDigest: session.job.resultReceipt?.sha256, validationDigest:session.job.validationReceipt?.digest, acceptedAt: Date.now(), toolCalls: session.calls };
        for (const waiter of session.waiters) { waiter.writeHead(200, { "Content-Type": "application/json" }); waiter.end(JSON.stringify(session.completion)); }
        session.waiters.clear();
      }
      return ok({ content });
    } catch (e) {
      return ok({ isError: true, content: [{ type: "text", text: redactSecrets(e.message) }] });
    } finally {
      session.pending--;
      if (finishingCall) session.finishing = false;
    }
  });
  const ready = new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
  server.unref();
  async function open(job, tools, signal) {
    if (job.resultSchema&&tools.some(tool=>tool.name==='finish')) tools = tools.filter(tool=>tool.name!=='submit_result').flatMap(tool => {
      if(tool.name!=='finish')return[tool];
      const properties={...tool.input_schema?.properties};delete properties.result;
      return[{...tool,description:'Report that this structured task is waiting, blocked or dismissed. To complete it, use submit_result with the full required deliverable. Never invent a result to clear a blocker.',
        input_schema:{...tool.input_schema,properties:{...properties,state:{type:'string',enum:['waiting','blocked','dismissed']}},required:(tool.input_schema?.required||[]).filter(name=>name!=='result')}},
        {name:'submit_result',description:'Submit the required structured deliverable and request completion. All normal finish, validation, pending-question and approval guards apply. Failure leaves the task open. The report is persisted; a separate duplicate summary is optional.',
          input_schema:{type:'object',properties:{result:job.resultSchema,summary:{type:'string',maxLength:4000}},required:['result'],additionalProperties:false}}];
    });
    const token = crypto.randomBytes(24).toString("hex");
    const session = { job, tools, signal, calls: 0, pending: 0, finishing: false, waiters: new Set() };
    sessions.set(token, session);
    const url = `http://127.0.0.1:${await ready}/mcp/${token}`;
    return { url, completionUrl: url + "/completion", tools, session, close: () => { sessions.delete(token); for (const waiter of session.waiters) { waiter.writeHead(410); waiter.end(); } session.waiters.clear(); } };
  }
  return { open, close: () => server.close() };
}
module.exports = { createToolServer };
