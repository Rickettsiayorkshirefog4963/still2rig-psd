# Codex workflow

This runbook describes the decisions Codex must preserve. The repository skill
contains the concise version used during normal work.

## 1. Preflight

Run `npm run doctor`. A failed Colab MCP check means the project cannot open a
connection; it does not authorize installing Go or editing global Codex files.
The user or an approved install command must resolve that prerequisite.

Colab MCP Go is an external prerequisite, not a vendored repository component.
The trusted project configuration starts its own bridge process through
`scripts/start-colab-mcp.sh`. That process uses an OS-selected free port and may
run alongside a global or another project-scoped bridge. The wrapper does not
search for or attach to an existing MCP process, and it must not stop one.

## 2. Prepare an immutable job

`still2rig-psd prepare` validates the image signature and size, copies it to the
ignored job directory, hashes it, records the pinned inference configuration,
and generates four exact Python cells. Generated cells embed the image and
worker as base64 so the small input does not depend on a browser upload widget.

## 3. Connect without browser control

The project MCP wrapper asks the operating system for an available localhost
port, stores the selected port and random token under `.still2rig-psd/secrets/`,
and passes `--no-browser`. This avoids collisions with another Colab MCP process
and avoids opening an unintended Chrome profile.

Codex runs `still2rig-psd colab-url`, shows the resulting URL, announces the MCP
connection call, and then calls `open_colab_browser_connection`. The user opens
the URL in the intended signed-in profile and selects an L4 runtime. Connection
approval is not permission to sign in, change accounts, select hardware, or
delete a runtime.

The URL contains the bridge connection token and must not be shared, published,
or included in screenshots. The source image and generated cells are sent to the
user-approved Colab runtime for processing. The runtime remains assigned until
the user releases it.

## 4. Execute cells

Call `list_colab_tools` because the browser-side notebook tool names are
dynamic. Add and run each generated cell in order, checking its output before
continuing. Setup is cached only when the exact See-through revision is still
checked out. Inference refuses a non-matching GPU and refuses to overwrite an
existing remote job result.

## 5. Download and import

The final cell checks the archive hash and invokes `google.colab.files.download`.
It produces a normal download in the user's browser. Do not print a large ZIP
as base64 through MCP. `still2rig-psd import` rejects traversal, symlinks, oversized
archives, input-hash mismatches, and artifact-hash mismatches.

## 6. Finalize

`still2rig-psd finalize` locates the semantic See-through layer directory, removes
small disconnected alpha noise, drops tiny optional false positives, merges
provided full-canvas expression assets, assembles a back-to-front PSD, reads it
back, and writes QA reports. Finalizing twice is refused so an existing result
and its provenance are not silently overwritten.

For a finalized job that needs corrected expressions or replacement images for
existing layers, use `still2rig-psd repair`. Repair reuses the verified import,
backs up the current PSD and reports under `.still2rig-psd/jobs/<job>/repairs/`,
builds and validates replacement artifacts in isolation, and updates the current
PSD only after the repaired build passes structural QA.

The default layer order is documented in `docs/quality-gates.md`. An override
can replace an existing layer image, but it cannot split one arm into separate
back and front depth pieces. A pose that crosses a hand over the torso requires
new source pieces and an extended layer contract instead of an order-only fix.

## 7. Preview

Run `npm run preview` from the project root. The local WebUI binds to
`127.0.0.1`, lists finalized PSD files from ignored job output directories, and
opens the newest result. It does not launch or control a browser. The user can
open the printed URL, switch generated results, or load a separate local PSD.

## Stop conditions

Stop and report instead of improvising when:

- the input SHA-256 changes;
- Colab connection fails three times;
- the user has not selected the intended runtime;
- GPU, See-through revision, or returned artifact hashes do not match;
- required base layers are missing;
- expression registration fails; or
- the user requests a production-ready motion claim without renderer captures.
