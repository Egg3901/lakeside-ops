import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addProject, resolveProject } from "./workspace/projects.mjs";

test("WSL opens and registers an existing Windows checkout with spaces without shell interpretation", { skip: process.platform === "win32" }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "keir-wsl-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const checkout = path.join(root, "My Project"), tools = path.join(root, "tools"), record = path.join(root, "translation.json");
  fs.mkdirSync(checkout); fs.mkdirSync(tools);
  fs.writeFileSync(path.join(tools, "wslpath"), `#!${process.execPath}\nconst fs=require('fs');fs.writeFileSync(process.env.ARGUMENT_RECORD,JSON.stringify(process.argv.slice(2)));console.log(process.env.LOCAL_CHECKOUT);\n`, { mode: 0o700 });
  const env = { ...process.env, WSL_DISTRO_NAME: "Ubuntu", PATH: tools, ARGUMENT_RECORD: record, LOCAL_CHECKOUT: checkout, LAKESIDE_CODE_CONFIG_DIR: path.join(root, "config") };
  const windows = "C:\\Users\\Owner\\My Project\\$(do-not-run)";
  assert.deepEqual(resolveProject([windows, "--continue"], env), [checkout, "--continue"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(record)), ["-a", "-u", windows]);
  assert.equal(addProject("AHDGame", windows, env).directory, checkout);
  assert.deepEqual(resolveProject(["AHDGame"], env), [checkout]);
  assert.deepEqual(resolveProject(["run", "C:\\keep-prompt-text"], env), ["run", "C:\\keep-prompt-text"]);
});
test("WSL conversion failure explains how to use a local checkout without creating one", { skip: process.platform === "win32" }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "keir-wsl-missing-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { WSL_DISTRO_NAME: "Ubuntu", PATH: root, LAKESIDE_CODE_CONFIG_DIR: root };
  assert.throws(() => addProject("AHDGame", "C:\\missing-project", env), /existing \/home/);
  assert.deepEqual(fs.readdirSync(root), []);
});
