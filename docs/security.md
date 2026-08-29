# Security, privacy, and consent

## Local data

`.still2rig-psd/` is ignored and contains every source image, generated cell, token,
download, PSD, report, screenshot, and video. Do not move these artifacts into
tracked folders unless the rights holder explicitly intends to publish them.

The importer treats a Colab ZIP as untrusted input. It rejects absolute paths,
parent traversal, symbolic links, excessive file counts, excessive expanded
size, missing manifests, and mismatched hashes.

The built-in PSD preview binds to `127.0.0.1`. Its local API lists no absolute
paths and serves only regular `.psd` files discovered beneath ignored job
output directories. It does not follow output-directory symlinks or expose
arbitrary filesystem paths. PSDs selected with the file picker or drag-and-drop
remain in the browser.

## Colab connection

The MCP bridge binds to an automatically selected localhost port. The selected
port and a random token are persisted only so the project can print a URL that
the user opens in the desired Chrome profile. The wrapper uses `--no-browser`;
Still2Rig PSD never launches or controls Chrome.

The printed Colab URL contains that connection token. Treat the URL as a secret:
do not publish it, share it, or include it in screenshots. The source image and
generated notebook cells are sent to the user-approved Colab runtime for
processing; they are not confined to the local ignored directory.

The user controls Google sign-in, account choice, terms, runtime accelerator,
and runtime deletion. An approved MCP connection authorizes only the requested
notebook workflow. Still2Rig PSD leaves the runtime running after completion,
so the user must release it when it is no longer needed.

## External code and weights

The worker checks out an exact See-through commit and records it. Python and
model dependencies still come from third-party package and model registries;
users should review upstream licenses, model cards, and supply-chain risk before
commercial or sensitive use.

## Before public release

Run a full secret and privacy scan, inspect notebook/cell outputs, binary assets,
Git history, ignore rules, dependency manifests, and documentation. Do not place
the audit report inside the repository being audited.
