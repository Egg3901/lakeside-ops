const { pipeline, env } = await import("@huggingface/transformers");
env.allowLocalModels = false;
const S = ("export const TARGET_SUPPLIER_MARGIN = 0.15;\nexport function computeLotCost(p){return p*(1-TARGET_SUPPLIER_MARGIN);}\n").repeat(60);
for (const [id,dtype,clen] of [["Xenova/bge-small-en-v1.5","q8",1800],
                               ["nomic-ai/nomic-embed-text-v1.5","q8",6000],
                               ["onnx-community/Qwen3-Embedding-0.6B-ONNX","q8",6000]]) {
  try{
    const pipe = await pipeline("feature-extraction", id, { dtype });
    const txt = S.slice(0, clen);
    await pipe(txt, { pooling:"mean", normalize:true });
    for (const B of [1,8,16]) {
      const t = Date.now();
      await pipe(Array(B).fill(txt), { pooling:"mean", normalize:true });
      const el = Date.now()-t;
      console.log(JSON.stringify({model:id.split("/")[1],chunk:clen,batch:B,ms_per_embed:Math.round(el/B)}));
    }
  }catch(e){ console.log(JSON.stringify({model:id,err:String(e.message).slice(0,80)})); }
}
