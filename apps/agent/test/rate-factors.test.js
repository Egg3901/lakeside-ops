"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {calculate,calculateBatch,unsupportedNumbers}=require("../lib/operator/knowledge");
test("evidence-backed rate factors avoid a redundant model retry and retain derivation receipts",()=>{
 const result=calculateBatch([{id:"build",expression:"ceil(8500*1.12)"}],[8500,0.12]);
 assert.equal(result[0].value,9520);
 assert.deepEqual(result[0].literalDerivations,[{literal:1.12,source:0.12,expression:"1 + 0.12"}]);
 assert.equal(calculate("10000*0.85",[10000,0.15]),8500);
 assert.equal(calculate("1.35",[0.35]),1.35);
 assert.equal(calculate("1 + 0.12",[0.12]),1.12);
});
test("rate normalization cannot invent data, tolerate a different rate, or claim prose support",()=>{
 for(const [expression,evidence]of [["1.12",[]],["1.121",[0.12]],["1.35",[0.12]],["32337",[0.12]],["1.12",[12]]])assert.throws(()=>calculate(expression,evidence),/not in anything/);
 assert.deepEqual(unsupportedNumbers("Multiplier 1.12",[0.12]),["1.12"]);
 assert.equal(calculate("1.12",[1.12]),1.12);
});
