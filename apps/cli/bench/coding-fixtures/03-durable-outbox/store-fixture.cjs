'use strict';
const copy=x=>x===undefined?undefined:structuredClone(x);
function createStore(seed=[]){const rows=new Map(seed.map(x=>[x.id,copy(x)]));return{
 async get(id){return copy(rows.get(id)||null)},async list(){return [...rows.values()].map(copy)},
 async cas(id,revision,next){if((rows.get(id)?.revision||0)!==revision)return false;if(next.id!==id||next.revision!==revision+1)throw Error('Invalid store revision');rows.set(id,copy(next));return true;}
};}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};}
const approval={verified:true,actor:'Egg'};
const authorized=async receipt=>receipt?.verified===true&&receipt?.actor==='Egg';
module.exports={createStore,deferred,approval,authorized};
