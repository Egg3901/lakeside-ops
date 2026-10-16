'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const canonical=files=>JSON.stringify(Object.fromEntries(Object.keys(files).sort().map(k=>[k,files[k]])));
function validateRating(rating,entry,rubric){
 if(rating.reviewId!==entry.reviewId||rating.artifactSHA!==entry.artifactSHA)throw Error('Review does not match the blinded artifact');
 const keys=Object.keys(rubric.dimensions).sort();if(JSON.stringify(Object.keys(rating.dimensions||{}).sort())!==JSON.stringify(keys))throw Error('Every rubric dimension is required');
 for(const k of keys){const d=rating.dimensions[k];if(!Number.isInteger(d.score)||d.score<0||d.score>4||typeof d.reason!=='string'||d.reason.trim().length<20)throw Error('Scores require anchored0..4 values and substantive reasons');}
 if(typeof rating.reviewer!=='string'||rating.reviewer.trim().length<10)throw Error('Reviewer attribution required');
 return{...rating,total:keys.reduce((s,k)=>s+rating.dimensions[k].score,0),maximum:20,rubricVersion:rubric.version,rubricSHA:digest(JSON.stringify(rubric))};
}
function main(args){const [command,out]=args;if(!['export','apply'].includes(command)||!out||!path.isAbsolute(out))throw Error('quality-review export|apply ABSOLUTE_CAMPAIGN');
 const manifest=JSON.parse(fs.readFileSync(out+'/manifest.json')),rubric=JSON.parse(fs.readFileSync(__dirname+'/quality-rubric.json')),dir=out+'/quality-review';fs.mkdirSync(dir,{recursive:true,mode:0o700});const mapfile=dir+'/private-mapping.json';const mapping=fs.existsSync(mapfile)?JSON.parse(fs.readFileSync(mapfile)):{};
 for(const [id] of manifest.models){const trials=out+'/models/'+id+'/quality/trials';if(!fs.existsSync(trials))continue;for(const key of fs.readdirSync(trials)){const cell=trials+'/'+key,p=cell+'/patch-files.json';if(!fs.existsSync(cell+'/result.json')||!fs.existsSync(p))continue;const files=JSON.parse(fs.readFileSync(p)),artifactSHA=digest(canonical(files));let entry=mapping[id];if(entry&&entry.artifactSHA!==artifactSHA)throw Error('Reviewed artifact changed');if(!entry)mapping[id]=entry={reviewId:crypto.randomUUID(),artifactSHA,key,cell};
  if(command==='export'){const file=dir+'/blind-'+entry.reviewId+'.json';if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify({reviewId:entry.reviewId,artifactSHA,task:'03-durable-outbox',rubric,files},null,2),{mode:0o600});}
  else{const file=dir+'/rating-'+entry.reviewId+'.json';if(!fs.existsSync(file))continue;const rating=validateRating(JSON.parse(fs.readFileSync(file)),entry,rubric);fs.writeFileSync(cell+'/quality-review.json',JSON.stringify({...rating,reviewedAt:new Date().toISOString()},null,2));}
 }}
 fs.writeFileSync(mapfile,JSON.stringify(mapping,null,2),{mode:0o600});console.log(command==='export'?'Blinded artifacts ready in '+dir:'Validated reviews applied');return mapping;
}
module.exports={main,validateRating,digest,canonical};if(require.main===module)main(process.argv.slice(2));
