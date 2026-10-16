'use strict';
// Serialized into the task sandbox. Commands come only from the trusted job
// contract; edit text is JSON data and never evaluated by the editor.
function editWorkspace(directory,{contract,edits=[],verifyOnly=false}){
 const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),root=fs.realpathSync(directory);
 const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
 if(!contract||!Array.isArray(contract.editablePaths)||!contract.editablePaths.length||typeof contract.checkCommand!=='string'||!contract.checkCommand||!contract.protectedHashes||!Object.keys(contract.protectedHashes).length)throw Error('Trusted coding validation contract required');
 const allowed=new Set(contract.editablePaths);
 function file(name){if(typeof name!=='string'||path.isAbsolute(name)||name.split(/[\\/]/).includes('..'))throw Error('Path outside coding scope');const p=fs.realpathSync(path.join(root,name));if(!p.startsWith(root+path.sep)||!fs.statSync(p).isFile()||fs.statSync(p).size>128000)throw Error('Path outside coding scope');return p;}
 function protectedInputs(){for(const [name,expected]of Object.entries(contract.protectedHashes))if(hash(fs.readFileSync(file(name)))!==expected)throw Error('A protected validation input changed: '+name);}
 function digest(){return hash(JSON.stringify({contract,files:Object.fromEntries([...allowed].sort().map(name=>[name,hash(fs.readFileSync(file(name)))]))}));}
 protectedInputs();if(verifyOnly)return{digest:digest()};
 if(!Array.isArray(edits)||edits.length>8)throw Error('Supply0-8 scoped edits');
 const staged=new Map(),changes=[];
 for(const edit of edits){if(!allowed.has(edit.path))throw Error('Edit path outside configured scope');if(typeof edit.oldText!=='string'||!edit.oldText||typeof edit.newText!=='string')throw Error('Nonempty oldText and string newText required');const p=file(edit.path),text=staged.has(p)?staged.get(p):fs.readFileSync(p,'utf8'),at=text.indexOf(edit.oldText);if(at<0||text.indexOf(edit.oldText,at+1)>=0)throw Error('oldText must occur exactly once: '+edit.path);const next=text.slice(0,at)+edit.newText+text.slice(at+edit.oldText.length);staged.set(p,next);changes.push({path:edit.path,before:hash(text),after:hash(next)});}
 // Check all edit preconditions before changing any file.
 for(const [p,text]of staged)fs.writeFileSync(p,text);
 const check=cp.spawnSync('/usr/bin/bash',['--noprofile','--norc','-c',contract.checkCommand],{cwd:root,encoding:'utf8',timeout:20000,maxBuffer:16000});
 protectedInputs();const passed=check.status===0&&!check.error;
 return{passed,changes,check:{code:check.status,signal:check.signal,output:((check.stdout||'')+(check.stderr||'')).slice(0,10000),error:check.error?.message},digest:passed?digest():null};
}
function command(payload){const data=Buffer.from(JSON.stringify(payload)).toString('base64'),fn=Buffer.from('('+editWorkspace.toString()+')').toString('base64');const result=`cd repo && node -e 'const f=eval(Buffer.from("${fn}","base64").toString());try{console.log(JSON.stringify(f(process.cwd(),JSON.parse(Buffer.from(process.argv[1],"base64").toString()))))}catch(error){console.log(JSON.stringify({error:error.message}));process.exitCode=1}' '${data}'`;if(result.length>16000)throw Error('Edit batch too large; split into smaller patches');return result;}
function createEditVerify({sandbox,ledger,now=Date.now}){
 async function execute(job,payload,signal){if(!job.codingContract)throw Error('Trusted coding validation contract required');const r=await sandbox.run(job.id,command({contract:job.codingContract,...payload}),signal,{timeoutMs:25000});let parsed;try{parsed=JSON.parse(r.output)}catch{throw Error('Invalid coding validation response')}if(r.code!==0||r.truncated||parsed.error)throw Error(parsed.error||'Scoped edit/validation failed');return parsed}
 return{
  async apply(job,input,signal){delete job.validationReceipt;const result=await execute(job,{edits:input.edits},signal);if(result.passed)job.validationReceipt={digest:result.digest,at:now(),checkCommand:job.codingContract.checkCommand};ledger.audit('edit_verify',{job:job.id,passed:result.passed,digest:result.digest,changes:result.changes});ledger.save();return result;},
  async assertFresh(job,signal){if(!job.validationReceipt)throw Error('A passing scoped validation receipt is required before done');const current=await execute(job,{verifyOnly:true},signal);if(current.digest!==job.validationReceipt.digest)throw Error('Patch changed after validation; receipt is stale. Revalidate the actual patch before done.');}
 };
}
module.exports={editWorkspace,command,createEditVerify};
