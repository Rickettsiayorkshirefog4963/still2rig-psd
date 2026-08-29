#!/usr/bin/env python3
"""Safely extract a Colab result bundle and verify its declared hashes."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import stat
import zipfile
from pathlib import Path, PurePosixPath


MAX_UNCOMPRESSED_BYTES = 3 * 1024 * 1024 * 1024
MAX_FILES = 10000


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def validate_member(info: zipfile.ZipInfo) -> PurePosixPath:
    name = PurePosixPath(info.filename)
    if name.is_absolute() or ".." in name.parts or not name.parts:
        raise ValueError(f"unsafe archive member: {info.filename}")
    mode = info.external_attr >> 16
    if stat.S_ISLNK(mode):
        raise ValueError(f"symbolic links are not allowed: {info.filename}")
    return name


def validate_relative_name(value: str) -> PurePosixPath:
    name = PurePosixPath(value)
    if name.is_absolute() or ".." in name.parts or not name.parts:
        raise ValueError(f"unsafe manifest artifact path: {value}")
    return name


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--expected-input-sha256", required=True)
    args = parser.parse_args()
    if not args.archive.is_file():
        raise FileNotFoundError(args.archive)
    if args.destination.exists() and any(args.destination.iterdir()):
        raise FileExistsError(f"destination is not empty: {args.destination}")
    args.destination.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(args.archive) as bundle:
        infos = bundle.infolist()
        if len(infos) > MAX_FILES:
            raise ValueError("archive contains too many files")
        if sum(info.file_size for info in infos) > MAX_UNCOMPRESSED_BYTES:
            raise ValueError("archive is too large when uncompressed")
        members = [(info, validate_member(info)) for info in infos]
        for info, relative in members:
            target = args.destination.joinpath(*relative.parts)
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(info) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)

    manifest_path = args.destination / "run-manifest.json"
    if not manifest_path.is_file():
        raise ValueError("bundle does not contain run-manifest.json")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("input", {}).get("sha256") != args.expected_input_sha256:
        raise ValueError("bundle input hash does not match the local job")
    failures = []
    artifact_root = args.destination / "layerdiff_output"
    for artifact in manifest.get("artifacts", []):
        artifact_name = validate_relative_name(artifact["file"])
        file = artifact_root.joinpath(*artifact_name.parts)
        if not file.is_file():
            failures.append({"file": artifact["file"], "error": "missing"})
        elif file.stat().st_size != artifact["bytes"]:
            failures.append({"file": artifact["file"], "error": "size"})
        elif sha256_file(file) != artifact["sha256"]:
            failures.append({"file": artifact["file"], "error": "sha256"})
    if failures:
        raise ValueError(f"artifact verification failed: {failures[:5]}")
    print(json.dumps({
        "archive": args.archive.name,
        "archiveSha256": sha256_file(args.archive),
        "files": len(manifest.get("artifacts", [])),
        "inputSha256": args.expected_input_sha256,
        "verified": True,
    }))


if __name__ == "__main__":
    main()
