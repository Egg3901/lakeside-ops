'use strict';
// Host-side reviews qualify saved evidence. They are never part of a worker's prompt.
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
function artifactDigest(result){
 const {correctnessReview,cost,...artifact}=result;
 return crypto.createHash('sha256').update(JSON.stringify(canonical(artifact))).digest('hex');
}
function reviewStatus(result,review=result.correctnessReview){
 if(!review)return 'pending';
 if(!['pass','fail'].includes(review.verdict)||review.artifactSHA256!==artifactDigest(result)||
  typeof review.reviewer!=='string'||!review.reviewer.trim()||typeof review.rationale!=='string'||review.rationale.trim().length<20||
  !(review.scope==='full-deliverable-and-citations'||review.verdict==='fail'&&review.scope==='defect-found'))return 'invalid';
 return review.verdict;
}
function readReviewedResults(out){
 return require('./report.cjs').readResults(out).map(result=>{
  delete result.correctnessReview;
  if(typeof result.key!=='string'||!/^[A-Za-z0-9_.-]+$/.test(result.key))return result;
  const file=path.join(out,'trials',result.key,'correctness-review.json');
  if(fs.existsSync(file))try{result.correctnessReview=JSON.parse(fs.readFileSync(file,'utf8'));}catch{result.correctnessReview={invalid:true};}
  return result;
 });
}
module.exports={artifactDigest,reviewStatus,readReviewedResults};
