const { pipeline, env } = await import("@huggingface/transformers");
env.allowLocalModels = false;
const embed = await pipeline("feature-extraction", "nomic-ai/nomic-embed-text-v1.5", { dtype: "q8" });
const base = "export const X = 1; function f(){ return 42; }\n";
const rss = () => Math.round(process.memoryUsage().rss / 1048576);
async function trial(label, opts, varyLen) {
  const t0 = Date.now(); const r0 = rss();
  for (let i = 0; i < 24; i++) {
    const len = varyLen ? 500 + ((i * 917) % 5500) : 6000;
    const batch = Array(8).fill(base.repeat(200).slice(0, len));
    await embed(batch, { pooling: "mean", normalize: true, ...opts });
  }
  const secs = (Date.now() - t0) / 1000;
  console.log(`${label}: ${(192/secs).toFixed(2)} chunks/s | RSS ${r0}->${rss()} MB (+${rss()-r0})`);
}
await trial("A varying len, default pad ", {}, true);
await trial("B varying len, pad=max_len", { padding: "max_length", truncation: true, max_length: 2048 }, true);
