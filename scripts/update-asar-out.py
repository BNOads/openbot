#!/usr/bin/env python3
"""Update the `out/` bundle and missing `node_modules` inside an Electron `app.asar`."""

from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
import struct
import sys
from pathlib import Path

BLOCK_SIZE = 4 * 1024 * 1024
UNPACKED_MAIN_FILES = {
    "agent-database-host.js",
    "voice-speech-host.js",
    "voice-transcription-host.js",
}


def compute_integrity(buf: bytes) -> dict:
    digest = hashlib.sha256(buf).hexdigest()
    blocks: list[str] = []
    if not buf:
        blocks.append(hashlib.sha256(b"").hexdigest())
    else:
        for offset in range(0, len(buf), BLOCK_SIZE):
            blocks.append(hashlib.sha256(buf[offset : offset + BLOCK_SIZE]).hexdigest())
    return {
        "algorithm": "SHA256",
        "hash": digest,
        "blockSize": BLOCK_SIZE,
        "blocks": blocks,
    }


def range_of(node: dict, min_max: list[int] | None = None) -> tuple[int, int]:
    if min_max is None:
        min_max = [sys.maxsize, 0]
    if "files" in node:
        for child in node["files"].values():
            range_of(child, min_max)
    elif "offset" in node:
        start = int(node["offset"])
        end = start + int(node["size"])
        if start < min_max[0]:
            min_max[0] = start
        if end > min_max[1]:
            min_max[1] = end
    return min_max[0], min_max[1]


def main() -> int:
    if len(sys.argv) < 3:
        print(
            "Usage: python3 update-asar-out.py <asarPath> <outDir> [unpackedDir] [nodeModulesDir]",
            file=sys.stderr,
        )
        return 1

    asar_path = Path(sys.argv[1]).resolve()
    out_dir = Path(sys.argv[2]).resolve()
    unpacked_dir = Path(sys.argv[3]).resolve() if len(sys.argv) > 3 and sys.argv[3] else None
    node_modules_dir = (
        Path(sys.argv[4]).resolve()
        if len(sys.argv) > 4 and sys.argv[4] and Path(sys.argv[4]).exists()
        else None
    )

    orig_buf = asar_path.read_bytes()
    orig_header_size = struct.unpack_from("<I", orig_buf, 4)[0]
    orig_header_json_len = struct.unpack_from("<I", orig_buf, 12)[0]
    header = json.loads(orig_buf[16 : 16 + orig_header_json_len].decode("utf-8"))
    payload_start = 8 + orig_header_size

    out_min, _ = range_of(header["files"]["out"])
    pkg_entry = header["files"]["package.json"]
    pkg_start = int(pkg_entry["offset"])
    pkg_buf = orig_buf[payload_start + pkg_start : payload_start + pkg_start + int(pkg_entry["size"])]

    repo_pkg = None
    repo_pkg_path = (out_dir.parent / "package.json").resolve()
    if repo_pkg_path.is_file():
        try:
            repo_pkg = json.loads(repo_pkg_path.read_text("utf-8"))
            asar_pkg = json.loads(pkg_buf.decode("utf-8"))
            if repo_pkg.get("version") and asar_pkg.get("version") != repo_pkg["version"]:
                asar_pkg["version"] = repo_pkg["version"]
                pkg_buf = (json.dumps(asar_pkg, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
        except Exception:
            pass

    prefix_payload = orig_buf[payload_start : payload_start + out_min]
    current_offset = out_min
    out_chunks: list[bytes] = []

    def pack_plain_dir_tree(dir_path: Path) -> dict:
        nonlocal current_offset
        real_dir = dir_path.resolve()
        files: dict = {}
        for entry_name in sorted(os.listdir(real_dir)):
            if entry_name == ".DS_Store" or entry_name.startswith("._"):
                continue
            full_path = real_dir / entry_name
            try:
                if full_path.is_dir():
                    files[entry_name] = pack_plain_dir_tree(full_path)
                elif full_path.is_file():
                    file_buf = full_path.read_bytes()
                    files[entry_name] = {
                        "size": len(file_buf),
                        "offset": str(current_offset),
                        "integrity": compute_integrity(file_buf),
                    }
                    out_chunks.append(file_buf)
                    current_offset += len(file_buf)
            except OSError:
                continue
        return {"files": files}

    def build_dir_tree(dir_path: Path, rel_from_out: str = "") -> dict:
        nonlocal current_offset
        files: dict = {}
        for entry_name in sorted(os.listdir(dir_path)):
            if entry_name.startswith("._"):
                continue
            full_path = dir_path / entry_name
            rel_path = f"{rel_from_out}/{entry_name}" if rel_from_out else entry_name
            if full_path.is_dir():
                files[entry_name] = build_dir_tree(full_path, rel_path)
            elif full_path.is_file():
                file_buf = full_path.read_bytes()
                is_unpacked = rel_from_out == "main" and entry_name in UNPACKED_MAIN_FILES
                if is_unpacked:
                    files[entry_name] = {
                        "size": len(file_buf),
                        "unpacked": True,
                        "integrity": compute_integrity(file_buf),
                    }
                    if unpacked_dir is not None:
                        target_unpacked = unpacked_dir / "out" / rel_path
                        target_unpacked.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(full_path, target_unpacked)
                else:
                    files[entry_name] = {
                        "size": len(file_buf),
                        "offset": str(current_offset),
                        "integrity": compute_integrity(file_buf),
                    }
                    out_chunks.append(file_buf)
                    current_offset += len(file_buf)
        return {"files": files}

    def relocate_trailing_nodes(node: dict) -> None:
        nonlocal current_offset
        if "files" in node:
            for child_key, child_val in node["files"].items():
                if node is header and child_key in ("out", "package.json"):
                    continue
                relocate_trailing_nodes(child_val)
        elif "offset" in node and not node.get("unpacked"):
            start = int(node["offset"])
            if start >= out_min:
                size = int(node["size"])
                slice_buf = orig_buf[payload_start + start : payload_start + start + size]
                node["offset"] = str(current_offset)
                out_chunks.append(slice_buf)
                current_offset += len(slice_buf)

    def has_asar_node_module(pkg_name: str) -> bool:
        nm = header.get("files", {}).get("node_modules", {}).get("files")
        if not nm:
            return False
        if pkg_name.startswith("@"):
            scope, name = pkg_name.split("/", 1)
            return bool(nm.get(scope, {}).get("files", {}).get(name))
        return bool(nm.get(pkg_name))

    def add_asar_node_module(pkg_name: str, pkg_dir: Path) -> None:
        nm_root = header["files"].setdefault("node_modules", {"files": {}})["files"]
        if pkg_name.startswith("@"):
            scope, name = pkg_name.split("/", 1)
            scope_entry = nm_root.setdefault(scope, {"files": {}})
            scope_entry["files"][name] = pack_plain_dir_tree(pkg_dir)
        else:
            nm_root[pkg_name] = pack_plain_dir_tree(pkg_dir)

    header["files"]["out"] = build_dir_tree(out_dir)
    relocate_trailing_nodes(header)

    if node_modules_dir is not None:
        added_packages: list[str] = []
        for entry_name in sorted(os.listdir(node_modules_dir)):
            if entry_name.startswith("."):
                continue
            entry_path = node_modules_dir / entry_name
            if not entry_path.is_dir():
                continue
            if entry_name.startswith("@"):
                for sub_name in sorted(os.listdir(entry_path)):
                    if sub_name.startswith("."):
                        continue
                    sub_path = entry_path / sub_name
                    if not sub_path.is_dir():
                        continue
                    pkg_name = f"{entry_name}/{sub_name}"
                    if not has_asar_node_module(pkg_name):
                        add_asar_node_module(pkg_name, sub_path)
                        added_packages.append(pkg_name)
            elif not has_asar_node_module(entry_name):
                add_asar_node_module(entry_name, entry_path)
                added_packages.append(entry_name)
        if added_packages:
            print("Added missing node_modules to app.asar:", ", ".join(added_packages), file=sys.stderr)

    header["files"]["package.json"] = {
        **pkg_entry,
        "size": len(pkg_buf),
        "offset": str(current_offset),
        "integrity": compute_integrity(pkg_buf),
    }

    new_header_json_buf = json.dumps(header, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    new_header_json_len = len(new_header_json_buf)
    aligned_json_len = math.ceil(new_header_json_len / 4) * 4
    pickle_payload_size = 4 + aligned_json_len
    new_header_size = 4 + pickle_payload_size

    header_block = bytearray(16 + aligned_json_len)
    struct.pack_into("<IIII", header_block, 0, 4, new_header_size, pickle_payload_size, new_header_json_len)
    header_block[16 : 16 + new_header_json_len] = new_header_json_buf

    final_buf = b"".join([bytes(header_block), prefix_payload, *out_chunks, pkg_buf])
    asar_path.write_bytes(final_buf)

    header_sha256 = hashlib.sha256(new_header_json_buf).hexdigest()
    print(json.dumps({"status": "ok", "asarPath": str(asar_path), "size": len(final_buf), "headerSha256": header_sha256}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
