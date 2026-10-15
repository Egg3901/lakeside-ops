const CANDS = [
  ["onnx-community/Qwen3-Embedding-0.6B-ONNX", 32768, "q8"],
  ["onnx-community/embeddinggemma-300m-ONNX", 2048, "q8"],
  ["nomic-ai/nomic-embed-text-v1.5", 8192, "q8"],
  ["Xenova/bge-small-en-v1.5", 512, "q8"],
];
const SAMPLE = ("export const TARGET_SUPPLIER_MARGIN = 0.15;\n" +
  "export function computeLotCost(price){ return price * (1 - TARGET_SUPPLIER_MARGIN); }\n").repeat(60);
const { pipeline, env } = await import("@huggingface/transformers");
env.allowLocalModels = false;
for (const [id, ctx, dtype] of CANDS) {
  try {
    const t0 = Date.now();
    const pipe = await pipeline("feature-extraction", id, { dtype });
    const load = Date.now() - t0;
    const t1 = Date.now();
    let dims = 0;
    for (let i = 0; i < 3; i++) {
      const o = await pipe(SAMPLE.slice(0, 6000), { pooling: "mean", normalize: true });
      dims = o.data.length;
    }
    const per = (Date.now() - t1) / 3;
    console.log(JSON.stringify({ id, ok: true, load_ms: load, ms_per_embed: Math.round(per), dims, ctx }));
  } catch (e) {
    console.log(JSON.stringify({ id, ok: false, err: String(e.message || e).slice(0, 120) }));
  }
}
