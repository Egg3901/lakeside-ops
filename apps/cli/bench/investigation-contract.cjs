'use strict';
// Describe the requested deliverable, never its factual answers. Canonical
// citation/alternative shapes prevent empty objects from satisfying completion.
function investigationContract(fields,{booleanFields=[],stringFields=[],minimumAlternatives=2}={}){
 const text={type:'string',minLength:1};
 return{type:'object',properties:{answer:text,facts:{type:'object',properties:Object.fromEntries(fields.map(name=>[name,{type:booleanFields.includes(name)?'boolean':stringFields.includes(name)?'string':'number'}])),required:fields},evidence:{type:'array',minItems:3,items:{type:'object',properties:{path:text,line:{type:'integer',minimum:1},claim:text},required:['path','line','claim']}},rejectedHypotheses:{type:'array',minItems:minimumAlternatives,items:{type:'object',properties:{hypothesis:text,evidence:text},required:['hypothesis','evidence']}},disposition:{...text,description:'The evidence-supported operational conclusion and action, separate from execution state.'}},required:['answer','facts','evidence','rejectedHypotheses','disposition']};
}
module.exports={investigationContract};
