"use strict";

// Self-contained so the same implementation executes inside the task sandbox.
// It reads task files only; file contents never become execution instructions.
function queryWorkspace(directory, queries, options={}) {
  const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
  const root=fs.realpathSync(directory),ignored=new Set([".git",".git.protected","node_modules","worktrees",".next","dist","build","coverage"]);
  let files,visited=0,scanBytes=0,outputBytes=0;const sources=new Map();
  const limits={files:8000,scanBytes:8*1024*1024,fileBytes:512*1024,outputBytes:18000};
  function inside(name){if(typeof name!=="string"||path.isAbsolute(name)||name.split(/[\\/]/).includes(".."))throw Error("Use a relative path inside the task repository");const full=fs.realpathSync(path.join(root,name));if(full!==root&&!full.startsWith(root+path.sep))throw Error("Path leaves the task repository");return full;}
  function inventory(){if(files)return files;files=[];const stack=[""];while(stack.length&&visited<limits.files){const rel=stack.pop();for(const e of fs.readdirSync(path.join(root,rel),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){if(++visited>limits.files)break;if(ignored.has(e.name)||e.isSymbolicLink())continue;const name=path.posix.join(rel,e.name);if(e.isDirectory())stack.push(name);else if(e.isFile())files.push(name);}}return files.sort();}
  const hash=b=>crypto.createHash("sha256").update(b).digest("hex");
  function source(name){if(sources.has(name))return sources.get(name);const full=inside(name),stat=fs.statSync(full);if(!stat.isFile()||stat.size>limits.fileBytes)throw Error("File is not regular text within the size limit");const data=fs.readFileSync(full);if(data.includes(0))throw Error("Binary file omitted");const value={data,lines:data.toString("utf8").split("\n"),sha256:hash(data)};sources.set(name,value);return value;}
  function declarations(s){
    if(s.declarations)return s.declarations;
    const found=[];let blockComment=false;
    for(let i=0;i<s.lines.length;i++){
      const text=s.lines[i];
      if(blockComment){if(text.includes("*/"))blockComment=false;continue;}
      if(/^\s*\/\*/.test(text)){if(!text.includes("*/",text.indexOf("/*")+2))blockComment=true;continue;}
      const m=/^(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|def|struct|fn)\s+([A-Za-z_$][\w$]*)/.exec(text);
      if(m)found.push({line:i+1,symbol:m[1]});
    }
    s.declarations=found;return found;
  }
  function line(name,n,text){return{path:name,line:n,citation:name+":"+n,text};}
  const words=text=>text.replace(/([a-z0-9])([A-Z])/g,"$1 $2").toLowerCase().replace(/[_-]+/g," ").replace(/\s+/g," ");
  if(!Array.isArray(queries)||!queries.length||queries.length>8)throw Error("Supply 1-8 evidence queries");
  const numbered=options.format==='numbered';
  const results=queries.map((q,queryIndex)=>{
    try{
      let value;
      if(q.op==="read"){
        const s=source(q.path);let start=Math.max(1,Number.isInteger(q.line)?q.line:1),end=s.lines.length,definition;
        if(q.symbol!==undefined){
          if(typeof q.symbol!=="string"||!/^[$A-Za-z_][$\w]{0,119}$/.test(q.symbol))throw Error("Supply one exact declaration identifier, not an expression");
          const outline=declarations(s),matches=outline.filter(x=>x.symbol===q.symbol);
          if(matches.length!==1)throw Error(matches.length?"Declaration is ambiguous; use explicit source lines":"Declaration not found; search or read explicit source lines");
          definition=matches[0];const index=outline.indexOf(definition);end=(outline[index+1]?.line||s.lines.length+1)-1;
          start=q.line===undefined?definition.line:start;
          if(start<definition.line||start>end)throw Error("Continuation line is outside the requested declaration window");
        }
        const count=Math.min(numbered?360:120,Math.max(1,Number.isInteger(q.lines)?q.lines:definition?end-start+1:numbered?360:60));
        let stop=Math.min(end,start-1+count);
        const render=()=>{
          const rows=s.lines.slice(start-1,stop).map((text,i)=>({line:start+i,text}));
          const result={op:q.op,path:q.path,sha256:s.sha256,totalLines:s.lines.length,
            ...(numbered?{encoding:'numbered-source-v1',excerpt:rows.map(row=>row.line+'|'+row.text).join('\n')}:{lines:rows}),truncated:stop<end};
          if(definition)Object.assign(result,{symbol:definition.symbol,declarationLine:definition.line,windowEndLine:end,selection:"textual declaration window, not an AST or dependency closure; use explicit lines for more context"});
          if(result.truncated)result.nextLine=stop+1;
          if(!definition&&s.lines.length>count&&(!numbered||start===1))result.outline=declarations(s).slice(0,40);
          return result;
        };
        value=render();
        if(numbered){
          const budget=Math.floor((limits.outputBytes-outputBytes)/(queries.length-queryIndex));
          // Reserve a fair share for later independent queries. Never cut a
          // source line or silently claim that a partial file was complete.
          if(Buffer.byteLength(JSON.stringify(value))>budget){
            let low=start-1,high=stop;
            while(low<high){stop=Math.ceil((low+high)/2);value=render();if(Buffer.byteLength(JSON.stringify(value))>budget)high=stop-1;else low=stop;}
            stop=low;value=render();
          }
          if(stop<start)return{op:q.op,error:'Source line exceeds the available output budget; narrow or separate this query',truncated:true};
        }
      }else if(q.op==="list"){
        const selected=inventory().filter(name=>!q.paths?.length||q.paths.some(p=>name.includes(p)));
        value={op:q.op,paths:selected.slice(0,160),truncated:selected.length>160||visited>=limits.files};
      }else if(q.op==="search"){
        if(!Array.isArray(q.terms)||!q.terms.length||q.terms.length>12||q.terms.some(t=>typeof t!=="string"||t.length<2||t.length>200))throw Error("Search requires 1-12 literal terms, each 2-200 characters");
        const terms=q.terms.map(t=>t.toLowerCase()),identifierTerms=q.terms.map(words),matches=[],sourceHashes={};let truncated=false;
        const max=Math.min(40,Math.max(1,q.maxMatches||20));
        for(const name of inventory()){
          if(q.paths?.length&&!q.paths.some(p=>name.includes(p)))continue;
          let s;try{s=source(name)}catch{continue}
          scanBytes+=s.data.length;if(scanBytes>limits.scanBytes){truncated=true;break}
          for(let i=0;i<s.lines.length;i++){const literal=s.lines[i].toLowerCase(),normalized=words(s.lines[i]);if(terms.some(t=>literal.includes(t))||identifierTerms.some(t=>normalized.includes(t))){matches.push(line(name,i+1,s.lines[i]));sourceHashes[name]=s.sha256;if(matches.length>=max){truncated=true;break}}}
          if(truncated)break;
        }
        value={op:q.op,terms:q.terms,sources:sourceHashes,matches,truncated:truncated||visited>=limits.files};
      }else throw Error("Unknown workspace evidence operation");
      const bytes=Buffer.byteLength(JSON.stringify(value));
      if(outputBytes+bytes>limits.outputBytes)return{op:q.op,error:"Output budget reached; narrow paths or line ranges",truncated:true};
      outputBytes+=bytes;return value;
    }catch(error){return{op:q?.op,error:error.message};}
  });
  return{trust:"evidence-only",results,limits,scanBytes};
}
function evidenceCommand(queries,options={}){
  const payload=Buffer.from(JSON.stringify({queries,options})).toString("base64");
  if(payload.length>5000)throw Error("Evidence query batch is too large");
  const script=`const query=${queryWorkspace.toString()};const input=JSON.parse(Buffer.from("${payload}","base64").toString());console.log(JSON.stringify(query(process.cwd(),input.queries,input.options)));`;
  const encoded=Buffer.from(script).toString("base64");
  return `cd repo && node -e 'eval(Buffer.from("${encoded}","base64").toString())'`;
}
module.exports={queryWorkspace,evidenceCommand};
