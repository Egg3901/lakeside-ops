'use strict';
// USD per million tokens, standard API equivalents, checked 2026-10-16.
// Subscription allowance consumption and actual invoices are not measured here.
const fs=require('node:fs'),path=require('node:path');
const rates={
 sol:{input:2,output:10,read:.1,write:2.5,source:'https://developers.openai.com/api/docs/models/gpt-6.1-sol'},
 luna:{input:.1,output:.5,read:.01,write:.125,source:'https://developers.openai.com/api/docs/models/gpt-6-luna'},
 opus:{input:4,output:20,read:.2,write:5,write1h:8,source:'https://platform.claude.com/docs/en/about-claude/pricing'},
 sonnet:{input:2,output:10,read:.1,write:2.5,write1h:4,source:'https://platform.claude.com/docs/en/about-claude/pricing'},
 gemini:{input:.75,output:3.75,read:.075,write:.75,source:'https://ai.google.dev/gemini-api/docs/pricing'},
 deepseek:{input:.3,output:1.2,read:.006,write:.3,source:'https://ollama.com/pricing'},
 muse:{input:1.25,output:4.25,read:.15,write:1.25,source:'https://dev.meta.ai/docs/pricing-rate-limits'},
 mimo:{input:.14,output:.28,read:.0028,write:.14,source:'https://opencode.ai/inference/v1/models'},
 step:{input:1,output:2.7,read:.1,write:1,source:'https://opencode.ai/inference/v1/models'},
 glm:{input:.15,output:.5,read:.03,write:.15,source:'https://dev.opencode.ai/v2/docs/console/models/'},
 minimax:{input:.3,output:1.2,read:.06,write:.3,source:'https://dev.opencode.ai/v2/docs/console/models/'},
};
function estimate(r,cell){
 let rate=rates[r.modelId];
 if(r.modelId==='mimo'&&r.model==='opencode/mimo-v2.6-flash-free')rate={input:0,output:0,read:0,write:0,source:'https://dev.opencode.ai/v2/docs/console/models/'};
 let u=r.activation?.usage,reasoning=0;
 if(cell&&['opencode','ollama'].includes(r.runner)){
  const root=path.join(cell,'state/opencode-runtime');
  if(fs.existsSync(root))for(const dir of fs.readdirSync(root)){const file=path.join(root,dir,'transcript.json');if(fs.existsSync(file)){const t=JSON.parse(fs.readFileSync(file)).info?.tokens;if(t){u={input_tokens:t.input,output_tokens:t.output,cache_read_input_tokens:t.cache?.read,cache_creation_input_tokens:t.cache?.write};reasoning=t.reasoning||0;break;}}}
 }
 const base={currency:'USD',basis:'published standard API-equivalent estimate',checkedAt:'2026-10-16',actualBilledUSD:null,source:rate?.source||null};
 if(!rate)return{...base,estimateUSD:null,status:'unverified-rate'};
 if(!u||![u.input_tokens,u.output_tokens].every(Number.isFinite))return{...base,estimateUSD:null,status:'missing-usage'};
 let input=u.input_tokens,read=u.cache_read_input_tokens||0,write=u.cache_creation_input_tokens||0,write1h=u.cache_creation?.ephemeral_1h_input_tokens||0,output=u.output_tokens+reasoning;
 // Codex and Antigravity prompt totals include cached input. OpenCode and
 // Claude expose uncached input separately. OpenCode separates reasoning from visible output; native counters include it.
 if(['codex','agy'].includes(r.runner))input=Math.max(0,input-read-write);
 if(r.modelId==='deepseek'){
  const d=new Date(r.startedAt),weekday=d.getUTCDay()>0&&d.getUTCDay()<6;
  if(!weekday||d.getUTCHours()<12||d.getUTCHours()>=18)rate={...rate,input:.15,output:.6,read:.003};
 }
 const estimateUSD=(input*rate.input+read*rate.read+Math.max(0,write-write1h)*rate.write+write1h*(rate.write1h??rate.write)+output*rate.output)/1e6;
 return{...base,estimateUSD,status:'estimated',ratesPerMillion:rate,normalizedTokens:{uncachedInput:input,cachedRead:read,cacheWrite5m:Math.max(0,write-write1h),cacheWrite1h:write1h,output,reasoningSeparatelyReported:reasoning},note:'Recorded usage only. Timed-out calls can lack usage; totals are partial. Standard pricing assumes no request crossed a long-context premium threshold. Antigravity reasoning tokens may be underreported. DeepSeek uses the start-time peak/off-peak tariff.'};
}
module.exports={estimate,rates};
