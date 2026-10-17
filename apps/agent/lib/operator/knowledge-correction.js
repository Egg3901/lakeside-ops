'use strict';
// Only the idle verifier calls this path. Retrieved text never grants authority.
const crypto=require('node:crypto');
const {noteSources}=require('./knowledge');
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function correctKnowledge({note,project,accepts,call,readSource,propose,interrupted=()=>false}){
 if(!note?.verifiedAt||!note.verifiedCommit)return{status:'pending',reason:'Note has no source verification'};
 const docs=noteSources(note).filter(s=>s.type==='doc');
 if(docs.length!==1||!Number.isSafeInteger(docs[0].version))return{status:'pending',reason:'A single versioned document is required'};
 const ref=docs[0],byPath=new Map();
 for(const source of noteSources(note).filter(s=>s.type==='code')){
  const prior=byPath.get(source.path);
  if(prior&&prior.sha!==source.sha)return{status:'pending',reason:'Conflicting source identities'};
  byPath.set(source.path,{...source,quotes:[...new Set([...(prior?.quotes||[]),...(source.quotes||[])])]});
 }
 const sources=[...byPath.values()];
 if(!sources.length||sources.length>6)return{status:'pending',reason:'Bounded source dependencies required'};
 const operationId=digest({name:ref.name,version:ref.version,text:note.text,sources:sources.map(s=>({path:s.path,sha:s.sha}))});
 if(interrupted())return{status:'retry',reason:'Operator became busy'};
 const args={collection:'docs',project,name:ref.name};
 const doc=await call('knowledge_get',args);
 if(!doc||typeof doc.body!=='string'||doc.name!==ref.name||doc.project!==project||!accepts(doc))return{status:'pending',reason:'Document is outside correction scope'};
 const history=Array.isArray(doc.metadata?.keirCorrections)?doc.metadata.keirCorrections:[];
 if(history.some(r=>r?.operationId===operationId))return{status:'already-applied',name:ref.name,version:doc.version};
 if(doc.version!==ref.version)return{status:'conflict',reason:'Document changed since verification',name:ref.name};
 const evidence=[];
 for(const source of sources){
  const current=await readSource(source.path);
  const quotes=(source.quotes||[]).filter(q=>typeof q==='string'&&q.trim().length>=8&&q.length<=4000);
  if(!current||current.sha!==source.sha||!quotes.length||quotes.some(q=>!current.body.includes(q)))return{status:'pending',reason:'Source evidence changed or is incomplete'};
  evidence.push({path:source.path,sha:current.sha,commit:current.commit,quotes,body:current.body.slice(0,24000)});
 }
 if(interrupted())return{status:'retry',reason:'Operator became busy'};
 const patch=await propose({document:{name:doc.name,version:doc.version,body:doc.body},verifiedNote:note.text,evidence});
 if(patch?.status!=='corrected')return{status:'pending',name:ref.name,reason:'Correction remains uncertain'};
 if(typeof patch.oldText!=='string'||patch.oldText.length<12||patch.oldText.length>4000||typeof patch.newText!=='string'||patch.newText.trim().length<12||patch.newText.length>6000||typeof patch.reason!=='string'||patch.reason.trim().length<12)return{status:'pending',reason:'Invalid correction patch'};
 if(!doc.body.includes(patch.oldText)||doc.body.split(patch.oldText).length!==2)return{status:'pending',reason:'Correction needs one exact document anchor'};
 if(/\b(approv(?:al|e|ed)|authori[sz](?:ation|e|ed)|permission|egg|ariane|aruane)\b/i.test(patch.oldText+' '+patch.newText))return{status:'pending',reason:'Authorization passages require review'};
 if(patch.oldText===patch.newText)return{status:'pending',reason:'No correction produced'};
 // Recheck every dependency after drafting and immediately before saving.
 for(const source of evidence){const current=await readSource(source.path);if(current?.sha!==source.sha||current.commit!==source.commit)return{status:'pending',reason:'Source changed during correction'};}
 const receipt={operationId,at:new Date().toISOString(),reason:patch.reason.slice(0,600),fromVersion:doc.version,verifiedNote:note.id,sources:evidence.map(({body,...source})=>source)};
 const metadata={...(doc.metadata||{}),keirCorrections:[...history.slice(-19),receipt]};
 if(interrupted())return{status:'retry',reason:'Operator became busy'};
 const saved=await call('knowledge_save',{...args,expectedVersion:doc.version,title:doc.title,description:doc.description,tags:doc.tags,metadata,body:doc.body.replace(patch.oldText,patch.newText)});
 if(!saved?.ok||!Number.isSafeInteger(saved.version)||saved.version<=doc.version)return{status:'conflict',name:ref.name,reason:'Save did not confirm a new document version'};
 return{status:'corrected',name:ref.name,version:saved.version,operationId};
}
module.exports={correctKnowledge};
