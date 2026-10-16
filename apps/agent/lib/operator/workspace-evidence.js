"use strict";

// Self-contained so the same implementation executes inside the task sandbox.
// It reads task files only; file contents never become execution instructions.
function queryWorkspace(directory, queries) {
  const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
  const root=fs.realpathSync(directory),ignored=new Set([".git",".git.protected","node_modules","worktrees",".next","dist","build","coverage"]);
  let files,visited=0,scanBytes=0,outputBytes=0;const sources=new Map();
  const limits={files:8000,scanBytes:8*1024*1024,fileBytes:512*1024,outputBytes:18000};
  function inside(name){if(typeof name!=="string"||path.isAbsolute(name)||name.split(/[\\/]/).includes(".."))throw Error("Use a relative path inside the task repository");const full=fs.realpathSync(path.join(root,name));if(full!==root&&!full.startsWith(root+path.sep))throw Error("Path leaves the task repository");return full;}
  function inventory(){if(files)return files;files=[];const stack=[""];while(stack.length&&visited<limits.files){const rel=stack.pop();for(const e of fs.readdirSync(path.join(root,rel),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){if(++visited>limits.files)break;if(ignored.has(e.name)||e.isSymbolicLink())continue;const name=path.posix.join(rel,e.name);if(e.isDirectory())stack.push(name);else if(e.isFile())files.push(name);}}return files.sort();}
  const hash=b=>crypto.createHash("sha256").update(b).digest("hex");
  function source(name){if(sources.has(name))return sources.get(name);const full=inside(name),stat=fs.statSync(full);if(!stat.isFile()||stat.size>limits.fileBytes)throw Error("File is not regular text within the size limit");const data=fs.readFileSync(full);if(data.includes(0))throw Error("Binary file omitted");const value={data,lines:data.toString("utf8").split("\n"),sha256:hash(data)};sources.set(name,value);return value;}
  function line(name,n,text,sha256){return{path:name,line:n,citation:name+":"+n,text,sha256};}
  if(!Array.isArray(queries)||!queries.length||queries.length>8)throw Error("Supply 1-8 evidence queries");
  const results=queries.map(q=>{
    try{
      let value;
      if(q.op==="read"){
        const s=source(q.path),start=Math.max(1,Number.isInteger(q.line)?q.line:1),count=Math.min(120,Math.max(1,Number.isInteger(q.lines)?q.lines:60));
        value={op:q.op,path:q.path,sha256:s.sha256,totalLines:s.lines.length,lines:s.lines.slice(start-1,start-1+count).map((text,i)=>({line:start+i,text})),truncated:start-1+count<s.lines.length};
      }else if(q.op==="list"){
        const selected=inventory().filter(name=>!q.paths?.length||q.paths.some(p=>name.includes(p)));
        value={op:q.op,paths:selected.slice(0,160),truncated:selected.length>160||visited>=limits.files};
      }else if(q.op==="search"){
        if(!Array.isArray(q.terms)||!q.terms.length||q.terms.length>12||q.terms.some(t=>typeof t!=="string"||t.length<2||t.length>200))throw Error("Search requires 1-12 literal terms, each 2-200 characters");
        const terms=q.terms.map(t=>t.toLowerCase()),matches=[];let truncated=false;
        const max=Math.min(40,Math.max(1,q.maxMatches||20));
        for(const name of inventory()){
          if(q.paths?.length&&!q.paths.some(p=>name.includes(p)))continue;
          let s;try{s=source(name)}catch{continue}
          scanBytes+=s.data.length;if(scanBytes>limits.scanBytes){truncated=true;break}
          for(let i=0;i<s.lines.length;i++)if(terms.some(t=>s.lines[i].toLowerCase().includes(t))){matches.push(line(name,i+1,s.lines[i],s.sha256));if(matches.length>=max){truncated=true;break}}
          if(truncated)break;
        }
        value={op:q.op,terms:q.terms,matches,truncated:truncated||visited>=limits.files};
      }else throw Error("Unknown workspace evidence operation");
      const bytes=Buffer.byteLength(JSON.stringify(value));
      if(outputBytes+bytes>limits.outputBytes)return{op:q.op,error:"Output budget reached; narrow paths or line ranges",truncated:true};
      outputBytes+=bytes;return value;
    }catch(error){return{op:q?.op,error:error.message};}
  });
  return{trust:"evidence-only",results,limits,scanBytes};
}
function evidenceCommand(queries){
  const payload=Buffer.from(JSON.stringify(queries)).toString("base64");
  if(payload.length>5000)throw Error("Evidence query batch is too large");
  const script=`const query=${queryWorkspace.toString()};console.log(JSON.stringify(query(process.cwd(),JSON.parse(Buffer.from("${payload}","base64").toString()))));`;
  const encoded=Buffer.from(script).toString("base64");
  return `cd repo && node -e 'eval(Buffer.from("${encoded}","base64").toString())'`;
}
module.exports={queryWorkspace,evidenceCommand};
