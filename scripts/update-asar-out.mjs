#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const [, , asarPathArg, outDirArg, unpackedDirArg] = process.argv;
if (!asarPathArg || !outDirArg) {
  console.error("Usage: node update-asar-out.mjs <asarPath> <outDir> [unpackedDir]");
  process.exit(1);
}

const asarPath = resolve(asarPathArg);
const outDir = resolve(outDirArg);
const unpackedDir = unpackedDirArg ? resolve(unpackedDirArg) : null;

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
const pkgBuf = origBuf.subarray(payloadStart + pkgStart, payloadStart + pkgStart + pkgEntry.size);

// Prefix before `out` (`node_modules`, `LICENSE`, `NOTICE`) stays untouched at the exact same offsets
const prefixPayload = origBuf.subarray(payloadStart, payloadStart + outRange.min);
let currentOffset = outRange.min;
const outChunks = [];

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

header.files.out = buildDirTree(outDir);
header.files["package.json"] = {
  ...pkgEntry,
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
