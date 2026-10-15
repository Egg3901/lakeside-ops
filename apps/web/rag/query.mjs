import Database from "better-sqlite3";
const DB = process.env.RAG_DB || "/root/projects/LSGD-ops-dash/rag/index.db";
const q = process.argv.slice(2).join(" ");
const { pipeline, env } = await import("@huggingface/transformers");
env.allowLocalModels = false;
const embed = await pipeline("feature-extraction", "nomic-ai/nomic-embed-text-v1.5", { dtype: "q8" });
const t0 = Date.now();
const out = await embed(["search_query: " + q], { pooling: "mean", normalize: true, padding: "max_length", truncation: true, max_length: 512 });
const qv = Float32Array.from(out.data);
const ms = Date.now() - t0;
const db = new Database(DB, { readonly: true });
const rows = db.prepare("SELECT path, ord, text, vec, dims FROM chunks").all();
const scored = rows.map(r => {
  const v = new Float32Array(r.vec.buffer, r.vec.byteOffset, r.dims);
  let d = 0; for (let i = 0; i < r.dims; i++) d += qv[i] * v[i];
  return { path: r.path, ord: r.ord, score: d, snip: r.text.slice(0, 90).replace(/\s+/g, " ") };
}).sort((a, b) => b.score - a.score).slice(0, 5);
console.log(`query embed ${ms}ms | searched ${rows.length} chunks`);
for (const s of scored) console.log(`  ${s.score.toFixed(3)}  ${s.path}#${s.ord}  ${s.snip}`);
