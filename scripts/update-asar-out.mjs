#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const [, , asarPathArg, outDirArg, unpackedDirArg, nodeModulesDirArg] = process.argv;
if (!asarPathArg || !outDirArg) {
  console.error("Usage: node update-asar-out.mjs <asarPath> <outDir> [unpackedDir] [nodeModulesDir]");
  process.exit(1);
}

const asarPath = resolve(asarPathArg);
const outDir = resolve(outDirArg);
const unpackedDir = unpackedDirArg ? resolve(unpackedDirArg) : null;
const nodeModulesDir = nodeModulesDirArg && existsSync(resolve(nodeModulesDirArg)) ? resolve(nodeModulesDirArg) : null;

const BLOCK_SIZE = 4 * 1024 * 1024;
const UNPACKED_MAIN_FILES = new Set(["agent-database-host.js", "voice-speech-host.js", "voice-transcription-host.js"]);

function computeIntegrity(buf) {
  const hash = createHash("sha256").update(buf).digest("hex");
  const blocks = [];
  if (buf.length === 0) {
    blocks.push(createHash("sha256").update(Buffer.alloc(0)).digest("hex"));
  } else {
    for (let offset = 0; offset < buf.length; offset += BLOCK_SIZE) {
      const slice = buf.subarray(offset, Math.min(buf.length, offset + BLOCK_SIZE));
      blocks.push(createHash("sha256").update(slice).digest("hex"));
    }
  }
  return {
    algorithm: "SHA256",
    hash,
    blockSize: BLOCK_SIZE,
    blocks,
  };
}

function rangeOf(node, minMax = { min: Infinity, max: 0 }) {
  if (node.files) {
    for (const k of Object.keys(node.files)) rangeOf(node.files[k], minMax);
  } else if (node.offset !== undefined) {
    const s = Number(node.offset);
    const e = s + node.size;
    if (s < minMax.min) minMax.min = s;
    if (e > minMax.max) minMax.max = e;
  }
  return minMax;
}

const origBuf = readFileSync(asarPath);
const origHeaderSize = origBuf.readUInt32LE(4);
const origHeaderJsonLen = origBuf.readUInt32LE(12);
const header = JSON.parse(origBuf.toString("utf8", 16, 16 + origHeaderJsonLen));
const payloadStart = 8 + origHeaderSize;

const outRange = rangeOf(header.files.out);
const pkgEntry = header.files["package.json"];
const pkgStart = Number(pkgEntry.offset);
let pkgBuf = origBuf.subarray(payloadStart + pkgStart, payloadStart + pkgStart + pkgEntry.size);
let repoPkg = null;
try {
  const repoPkgPath = resolve(outDir, "../package.json");
  if (existsSync(repoPkgPath)) {
    repoPkg = JSON.parse(readFileSync(repoPkgPath, "utf8"));
    const asarPkg = JSON.parse(pkgBuf.toString("utf8"));
    if (repoPkg.version && asarPkg.version !== repoPkg.version) {
      asarPkg.version = repoPkg.version;
      pkgBuf = Buffer.from(`${JSON.stringify(asarPkg, null, 2)}\n`, "utf8");
    }
  }
} catch {
  // Keep original package.json buffer if repo package.json is not available
}

// Prefix before `out` (`node_modules`, `LICENSE`, `NOTICE`) stays untouched at the exact same offsets
const prefixPayload = origBuf.subarray(payloadStart, payloadStart + outRange.min);
let currentOffset = outRange.min;
const outChunks = [];

function packPlainDirTree(dirPath) {
  const realDir = realpathSync(dirPath);
  const entries = readdirSync(realDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const files = {};
  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;
    const fullPath = join(realDir, entry.name);
    let st;
    try {
      st = statSync(fullPath);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      files[entry.name] = packPlainDirTree(fullPath);
    } else if (st.isFile()) {
      const fileBuf = readFileSync(fullPath);
      files[entry.name] = {
        size: fileBuf.length,
        offset: String(currentOffset),
        integrity: computeIntegrity(fileBuf),
      };
      outChunks.push(fileBuf);
      currentOffset += fileBuf.length;
    }
  }
  return { files };
}

function buildDirTree(dirPath, relFromOut = "") {
  const entries = readdirSync(dirPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const files = {};
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    const relPath = relFromOut ? `${relFromOut}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files[entry.name] = buildDirTree(fullPath, relPath);
    } else if (entry.isFile()) {
      const fileBuf = readFileSync(fullPath);
      const isUnpacked = relFromOut === "main" && UNPACKED_MAIN_FILES.has(entry.name);
      if (isUnpacked) {
        files[entry.name] = {
          size: fileBuf.length,
          unpacked: true,
          integrity: computeIntegrity(fileBuf),
        };
        if (unpackedDir) {
          const targetUnpacked = join(unpackedDir, "out", relPath);
          mkdirSync(dirname(targetUnpacked), { recursive: true });
          copyFileSync(fullPath, targetUnpacked);
        }
      } else {
        files[entry.name] = {
          size: fileBuf.length,
          offset: String(currentOffset),
          integrity: computeIntegrity(fileBuf),
        };
        outChunks.push(fileBuf);
        currentOffset += fileBuf.length;
      }
    }
  }
  return { files };
}

function hasAsarNodeModule(pkgName) {
  const nm = header.files.node_modules?.files;
  if (!nm) return false;
  if (pkgName.startsWith("@")) {
    const [scope, name] = pkgName.split("/");
    return Boolean(nm[scope]?.files?.[name]);
  }
  return Boolean(nm[pkgName]);
}

function addAsarNodeModule(pkgName, pkgDir) {
  if (!header.files.node_modules) header.files.node_modules = { files: {} };
  const nm = header.files.node_modules.files;
  if (pkgName.startsWith("@")) {
    const [scope, name] = pkgName.split("/");
    if (!nm[scope]) nm[scope] = { files: {} };
    nm[scope].files[name] = packPlainDirTree(pkgDir);
  } else {
    nm[pkgName] = packPlainDirTree(pkgDir);
  }
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
  if (nodeModulesDir) candidates.push(join(nodeModulesDir, pkgName));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function relocateTrailingNodes(node, keyName = "") {
  if (!node || typeof node !== "object") return;
  if (node.files) {
    for (const [childKey, childVal] of Object.entries(node.files)) {
      if (node === header && (childKey === "out" || childKey === "package.json")) continue;
      relocateTrailingNodes(childVal, childKey);
    }
  } else if (node.offset !== undefined && !node.unpacked) {
    const start = Number(node.offset);
    if (start >= outRange.min) {
      const slice = origBuf.subarray(payloadStart + start, payloadStart + start + node.size);
      node.offset = String(currentOffset);
      outChunks.push(slice);
      currentOffset += slice.length;
    }
  }
}

header.files.out = buildDirTree(outDir);
relocateTrailingNodes(header);

// Inject any runtime npm packages missing from the base app.asar (e.g. packages added in newer upstream releases)
if (nodeModulesDir) {
  const addedPackages = [];
  const visited = new Set();
  const enqueuePackage = (pkgName, fromDir) => {
    if (!pkgName || pkgName.startsWith("@openbot/") || visited.has(pkgName)) return;
    visited.add(pkgName);
    const pkgDir = resolvePackageDir(pkgName, fromDir);
    if (!pkgDir) return;
    if (!hasAsarNodeModule(pkgName)) {
      addAsarNodeModule(pkgName, pkgDir);
      addedPackages.push(pkgName);
    }
    try {
      const depPkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
      for (const sub of Object.keys(depPkg.dependencies || {})) {
        enqueuePackage(sub, pkgDir);
      }
    } catch {}
  };

  if (repoPkg) {
    for (const dep of Object.keys(repoPkg.dependencies || {})) {
      enqueuePackage(dep, resolve(outDir, ".."));
    }
  } else {
    // Staged directory mode (e.g. VPS deploy): inject every package present in nodeModulesDir that is missing in app.asar
    for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name.startsWith("@")) {
        const scopeDir = join(nodeModulesDir, entry.name);
        for (const sub of readdirSync(scopeDir, { withFileTypes: true })) {
          if (sub.name.startsWith(".")) continue;
          const pkgName = `${entry.name}/${sub.name}`;
          if (!hasAsarNodeModule(pkgName)) {
            addAsarNodeModule(pkgName, join(scopeDir, sub.name));
            addedPackages.push(pkgName);
          }
        }
      } else if (!hasAsarNodeModule(entry.name)) {
        addAsarNodeModule(entry.name, join(nodeModulesDir, entry.name));
        addedPackages.push(entry.name);
      }
    }
  }
  if (addedPackages.length > 0) {
    console.error("Added missing node_modules to app.asar:", addedPackages.join(", "));
  }
}

header.files["package.json"] = {
  ...pkgEntry,
  size: pkgBuf.length,
  offset: String(currentOffset),
  integrity: computeIntegrity(pkgBuf),
};

const newHeaderJsonBuf = Buffer.from(JSON.stringify(header), "utf8");
const newHeaderJsonLen = newHeaderJsonBuf.length;
const alignedJsonLen = Math.ceil(newHeaderJsonLen / 4) * 4;
const picklePayloadSize = 4 + alignedJsonLen;
const newHeaderSize = 4 + picklePayloadSize;

const headerBlock = Buffer.alloc(16 + alignedJsonLen, 0);
headerBlock.writeUInt32LE(4, 0);
headerBlock.writeUInt32LE(newHeaderSize, 4);
headerBlock.writeUInt32LE(picklePayloadSize, 8);
headerBlock.writeUInt32LE(newHeaderJsonLen, 12);
newHeaderJsonBuf.copy(headerBlock, 16);

const finalBuf = Buffer.concat([headerBlock, prefixPayload, ...outChunks, pkgBuf]);
writeFileSync(asarPath, finalBuf);

const headerSha256 = createHash("sha256").update(newHeaderJsonBuf).digest("hex");
console.log(JSON.stringify({ status: "ok", asarPath, size: finalBuf.length, headerSha256 }));
