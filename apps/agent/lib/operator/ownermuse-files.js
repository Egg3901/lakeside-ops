"use strict";
// Typed local drafting without exposing an interpreter or command string to the
// model. Isolated Python ignores workspace modules and environment import
// paths; the fixed program runs inside the existing networkless sandbox.
const PROGRAM = `import base64,json,os,pathlib
r=json.loads(base64.b64decode(__import__('sys').argv[1]))
def emit(value):
 out=json.dumps(value,ensure_ascii=False)
 if len(out.encode())>22000: raise ValueError('Local file response is too large; split the file or directory')
 print(out)
root=pathlib.Path('/workspace').resolve()
p=root/r['path']
if not p.resolve().is_relative_to(root): raise ValueError('Path escapes isolated workspace')
if r['operation']=='write':
 p.parent.mkdir(parents=True,exist_ok=True)
if r['operation']=='write':
 p.write_text(r['text']); emit({'saved':r['path']})
elif r['operation']=='read':
 if p.stat().st_size>100000: raise ValueError('File exceeds read limit')
 emit({'path':r['path'],'text':p.read_text()})
else:
 emit({'path':r['path'],'entries':sorted(x.name for x in p.iterdir())[:200]})
`;
async function localFile(sandbox, job, input, signal) {
  if (!["read", "write", "list"].includes(input.operation) || typeof input.path !== "string" || !/^[a-zA-Z0-9_.\/-]{1,240}$/.test(input.path) || input.path.startsWith("/") || input.path.split("/").some(p => p === ".." || p === ".git")) throw new Error("Use a bounded relative workspace path outside .git");
  if (input.operation === "write" && (job.investigation || typeof input.text !== "string")) throw new Error("Read-only investigation or missing draft text");
  const request = Buffer.from(JSON.stringify({ operation: input.operation, path: input.path, text: input.text })).toString("base64");
  const program = Buffer.from(PROGRAM).toString("base64");
  const command = `/usr/bin/python3 -I -c 'import base64;exec(base64.b64decode("${program}"))' '${request}'`;
  if (Buffer.byteLength(command) > 16000) throw new Error("Local draft exceeds the 16000-byte encoded sandbox command limit, including UTF-8, JSON and base64 overhead. Split it into smaller files.");
  const result = await sandbox.run(job.id, command, signal);
  if (result.code !== 0) throw new Error(`Local file operation failed: ${String(result.output).slice(-500)}`);
  return JSON.parse(result.output);
}
module.exports = { localFile };
