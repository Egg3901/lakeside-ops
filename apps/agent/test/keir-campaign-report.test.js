'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {aggregate,frontier}=require('../../cli/bench/campaign-report.cjs');
const model=rows=>({id:'example',label:'Example',status:{state:'complete'},investigation:rows,coding:[]});
test('campaign accuracy counts incomplete answers and wrong patches as failures, not speed wins',()=>{
 const m=aggregate({...model([{completed:true,grade:{score:100},wallMs:1000},{completed:false,grade:{score:100},wallMs:90000}]),coding:[{mode:'optimized',qualified:false,completed:true,wallMs:100}]});
 assert.equal(m.correct,1);assert.equal(m.accuracy,100/12);assert.equal(m.medianCorrectSeconds,1);assert.equal(m.meanWallSeconds,91.1/3);
});
test('partial usage cannot put a model on the cost frontier and unavailable models have no accuracy',()=>{
 const rows=Array.from({length:12},()=>({completed:true,grade:{score:100},wallMs:1000,cost:{estimateUSD:.01,status:'estimated',normalizedTokens:{uncachedInput:100,cachedRead:20,cacheWrite5m:0,cacheWrite1h:0,output:10}}}));
 const full=aggregate(model(rows));assert.equal(full.costCoverage,12);assert.equal(full.tokens,1560);assert.ok(Math.abs(full.costPerAttemptUSD-.01)<1e-10);
 const partial=aggregate(model(rows.map((r,i)=>i? r:{...r,cost:{estimateUSD:null,status:'missing-usage'}})));assert.equal(partial.costCoverage,11);assert.equal(partial.costPerAttemptUSD,null);
 const absent=aggregate({...model([]),status:{state:'provider-unavailable'}});assert.equal(absent.accuracy,null);assert.equal(absent.tokens,null);
});
test('Pareto dominance requires at least one strict improvement, preserving equal tradeoffs',()=>{
 assert.deepEqual(frontier([{id:'a',accuracy:90,x:2},{id:'same',accuracy:90,x:2},{id:'b',accuracy:90,x:3},{id:'c',accuracy:100,x:4},{id:'unknown',accuracy:100,x:null}],'x'),['a','same','c']);
});
test('subjective quality scores are bound to artifacts and require complete explained rubric dimensions',()=>{
 const {validateRating}=require('../../cli/bench/quality-review.cjs'),rubric=require('../../cli/bench/quality-rubric.json'),entry={reviewId:'blind',artifactSHA:'hash'};
 const rating={...entry,reviewer:'One manual blinded code review',dimensions:Object.fromEntries(Object.keys(rubric.dimensions).map(k=>[k,{score:3,reason:'Clear and reviewable implementation with one documented weakness.'}]))};
 assert.equal(validateRating(rating,entry,rubric).total,15);assert.throws(()=>validateRating({...rating,artifactSHA:'changed'},entry,rubric),/artifact/);assert.throws(()=>validateRating({...rating,dimensions:{}},entry,rubric),/dimension/);
});
