# Architecture and provenance

Still2Rig PSD separates trust and compute into four boundaries.

1. **Local project**: stores the original image copy, job manifest, generated
   cells, imported bundle, PSD, and QA under the ignored `.still2rig-psd/`
   directory. During processing, the source image and generated cells are sent
   to the user-approved Colab runtime.
2. **Local MCP bridge**: Colab MCP Go listens only on localhost and proxies the
   user-approved Colab tab. Its connection token is ignored and never recorded
   in job reports.
3. **User-managed Colab runtime**: downloads a pinned See-through checkout and
   model dependencies, performs GPU inference, then packages a hash manifest.
   It remains assigned until the user disconnects or deletes it.
4. **Local PSD preview**: binds to `127.0.0.1`, lists only generated PSD files
   from ignored job output directories, and renders a selected PSD in WebGL.

The repository does not vendor See-through, weights, or Colab MCP Go. The
default revision and inference parameters live in `configs/default.json`.
The trusted project configuration starts a dedicated Colab MCP Go process on an
OS-selected free port. It does not reuse or stop an already-running global MCP
process; the processes can coexist.

## Provenance chain

The local job records the source image SHA-256. The upload cell verifies the
same hash after decoding. The Colab run manifest repeats it and hashes each
result artifact. The result importer verifies those hashes. Finally, the PSD
builder records the output SHA-256 and reads the written PSD back to verify
canvas size and layer order.

Paths stored in committed templates are relative. Per-machine absolute paths
may appear only in ignored runtime state or terminal output.

## Extension points

- Alternate decomposition engines can implement the same result-bundle
  manifest.
- Expression generators can provide full-canvas `mouth_open.png`,
  `mouth_close.png`, and `eye_close.png` without changing PSD assembly.
- Renderer adapters can implement `configs/motion-qa-contract.json` and append
  their evidence to a job report.
- The built-in `webui/` can add renderer-specific capture adapters without
  changing PSD assembly or exposing the rest of the job workspace.
