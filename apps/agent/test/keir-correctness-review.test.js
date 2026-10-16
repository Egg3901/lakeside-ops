'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {metrics,compare}=require('../../cli/bench/compare.cjs');
test('a perfect checklist with an incorrect narrative is not reported as reviewed accuracy',()=>{
 const r={caseId:'01-reconcile-deliveries',completed:true,grade:{score:100},wallMs:1000,report:'Nominal share is 1.00, divide by 0.73.'};
 const m=metrics([r]);assert.equal(m.checklistQualified,1);assert.equal(m.reviewedCorrect,0);assert.equal(m.reviewPending,1);
});
test('correctness review is bound to the complete result artifact and requires explained full review',()=>{
 const {artifactDigest,reviewStatus}=require('../../cli/bench/correctness-review.cjs');
 const r={key:'trial',caseId:'01-reconcile-deliveries',completed:true,grade:{score:100},report:'An actual reviewed answer',model:'model-a',runner:'provider-a'};
 const review={artifactSHA256:artifactDigest(r),verdict:'pass',scope:'full-deliverable-and-citations',reviewer:'Human reviewer',rationale:'Checked all requested calculations, completeness, citations and operational conclusion.'};
 assert.equal(reviewStatus(r,review),'pass');assert.equal(reviewStatus({...r,report:'A changed answer'},review),'invalid');
 assert.equal(reviewStatus({...r,model:'model-b'},review),'invalid');assert.equal(reviewStatus(r,{...review,scope:'checklist-only'}),'invalid');
 assert.equal(reviewStatus(r,{...review,rationale:''}),'invalid');
 assert.equal(metrics([{...r,correctnessReview:review}]).reviewedCorrect,1);
 assert.equal(metrics([{...r,correctnessReview:{...review,verdict:'fail'}}]).reviewedCorrect,0);
});
test('comparison rejects a shared short name when paid and subscription variants differ',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'keir-model-pair-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const [name,model] of [['a','meta/muse-spark-1.3'],['b','opencode-go/muse-spark-1.3-contributor']]){
  fs.mkdirSync(root+'/'+name);fs.writeFileSync(root+'/'+name+'/manifest.json',JSON.stringify({models:[['muse','Muse','opencode',model]],fixtureHashes:{ticket:'same'}}));
 }
 assert.throws(()=>compare(root+'/a',root+'/b'),/model|variant|provider/i);
});
test('saved reviews affect only matching artifacts in the rendered comparison',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'keir-reviewed-pair-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const {artifactDigest}=require('../../cli/bench/correctness-review.cjs');
 const key='sonnet__root__harness__01-reconcile-deliveries';
 for(const name of ['base','next']){
  const r={key,modelId:'sonnet',runner:'claude',model:'claude-sonnet-5-5',caseId:'01-reconcile-deliveries',environment:'root',harness:true,completed:true,wallMs:name==='base'?2000:1000,grade:{score:100},report:'A complete reviewed report'};
  const cell=root+'/'+name+'/trials/'+key;fs.mkdirSync(cell,{recursive:true});
  fs.writeFileSync(root+'/'+name+'/manifest.json',JSON.stringify({models:[['sonnet','Sonnet','claude','claude-sonnet-5-5']],fixtureHashes:{ticket:'same'}}));
  fs.writeFileSync(cell+'/result.json',JSON.stringify(r));
  fs.writeFileSync(cell+'/correctness-review.json',JSON.stringify({artifactSHA256:artifactDigest(r),verdict:name==='base'?'pass':'fail',scope:'full-deliverable-and-citations',reviewer:'Test reviewer',rationale:'Checked all requested reasoning and citations; candidate has a factual defect.'}));
 }
 const result=compare(root+'/base',root+'/next'),m=result.models[0];
 assert.equal(m.matchedChecklist.count,1);assert.equal(m.matchedReviewed.baseline.count,0);assert.equal(m.matchedReviewed.baseline.totalLatencyRatio,null);
 assert.equal(m.baseline.reviewedCorrect,1);assert.equal(m.candidate.reviewedCorrect,0);
 const html=require('../../cli/bench/compare.cjs').render(result);assert.match(html,/Reviewed correct/);assert.doesNotMatch(html,/fully correct/i);
});


test('comparison rejects changed report requirements even if old inputs are regraded',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'keir-protocol-pair-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const [name,outputProtocolVersion] of [['a',1],['b',2]]){
  fs.mkdirSync(root+'/'+name);fs.writeFileSync(root+'/'+name+'/manifest.json',JSON.stringify({outputProtocolVersion,models:[['sonnet','Sonnet','claude','claude-sonnet-5-5']],fixtureHashes:{ticket:'same'}}));
 }
 assert.throws(()=>compare(root+'/a',root+'/b'),/different report output protocols/);
});

test('comparison refuses mixed checklist versions within otherwise identical protocols',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'keir-grader-pair-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const [name,checklistVersion] of [['a',1],['b',2]]){
  fs.mkdirSync(root+'/'+name+'/trials/t',{recursive:true});fs.writeFileSync(root+'/'+name+'/manifest.json',JSON.stringify({outputProtocolVersion:2,models:[['sonnet','Sonnet','claude','claude-sonnet-5-5']],fixtureHashes:{ticket:'same'}}));
  fs.writeFileSync(root+'/'+name+'/trials/t/result.json',JSON.stringify({key:'t',caseId:'01-reconcile-deliveries',modelId:'sonnet',runner:'claude',model:'claude-sonnet-5-5',grade:{score:100,checklistVersion}}));
 }
 assert.throws(()=>compare(root+'/a',root+'/b'),/mixed checklist versions/);
});
