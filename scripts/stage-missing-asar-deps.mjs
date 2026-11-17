#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const [, , projectRootArg, stageDirArg, referenceAsarArg] = process.argv;
if (!projectRootArg || !stageDirArg) {
  console.error("Usage: node stage-missing-asar-deps.mjs <projectRoot> <stageDir> [referenceAsar]");
  process.exit(1);
}

const projectRoot = resolve(projectRootArg);
const stageDir = resolve(stageDirArg);
const referenceAsar = referenceAsarArg && existsSync(resolve(referenceAsarArg)) ? resolve(referenceAsarArg) : null;

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

let refNodeModules = null;
if (referenceAsar) {
  try {
    const buf = readFileSync(referenceAsar);
    const hLen = buf.readUInt32LE(12);
    const header = JSON.parse(buf.toString("utf8", 16, 16 + hLen));
    refNodeModules = header.files?.node_modules?.files ?? null;
  } catch {}
}

function hasRefPackage(pkgName) {
  if (!refNodeModules) return false;
  if (pkgName.startsWith("@")) {
    const [scope, name] = pkgName.split("/");
    return Boolean(refNodeModules[scope]?.files?.[name]);
  }
  return Boolean(refNodeModules[pkgName]);
}

function resolvePackageDir(pkgName, fromDir) {
  const candidates = [];
  if (fromDir) {
    candidates.push(join(fromDir, "node_modules", pkgName));
    try {
      const realParent = dirname(realpathSync(fromDir));
      candidates.push(join(realParent, pkgName));
      candidates.push(join(dirname(realParent), pkgName));
    } catch {}
  }
  candidates.push(join(projectRoot, "node_modules", pkgName));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const visited = new Set();
const staged = [];
function collect(pkgName, fromDir) {
  if (!pkgName || pkgName.startsWith("@openbot/") || visited.has(pkgName)) return;
  visited.add(pkgName);
  const pkgDir = resolvePackageDir(pkgName, fromDir);
  if (!pkgDir) return;
  if (!hasRefPackage(pkgName)) {
    const dest = join(stageDir, pkgName);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(realpathSync(pkgDir), dest, { recursive: true, dereference: true });
    staged.push(pkgName);
  }
  try {
    const depPkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    for (const sub of Object.keys(depPkg.dependencies || {})) {
      collect(sub, pkgDir);
    }
  } catch {}
}

const rootPkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
for (const dep of Object.keys(rootPkg.dependencies || {})) {
  collect(dep, projectRoot);
}

console.log(JSON.stringify({ status: "ok", staged }));
