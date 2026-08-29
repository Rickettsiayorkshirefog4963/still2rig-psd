#!/usr/bin/env python3
"""Package synthetic layers using the same result-bundle contract as Colab."""

from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from pathlib import Path


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--layers", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--input-sha256", required=True)
    parser.add_argument("--job", required=True)
    args = parser.parse_args()
    artifacts = []
    for file in sorted(args.layers.glob("*.png")):
        artifacts.append({
            "file": f"fixture/{file.name}",
            "bytes": file.stat().st_size,
            "sha256": sha256(file),
        })
    manifest = {
        "schemaVersion": 1,
        "producer": "Still2Rig PSD test fixture",
        "jobId": args.job,
        "input": {"file": "source.png", "sha256": args.input_sha256},
        "seeThrough": {"revision": "7f139bb25c46a0c8ac720d95ddab185fcda5451c"},
        "artifacts": artifacts,
    }
    args.archive.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        bundle.writestr("run-manifest.json", json.dumps(manifest, indent=2) + "\n")
        for file in sorted(args.layers.glob("*.png")):
            bundle.write(file, f"layerdiff_output/fixture/{file.name}")


if __name__ == "__main__":
    main()
