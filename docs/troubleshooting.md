# Troubleshooting

## Colab MCP is missing in Codex

Run `npm run doctor`. Confirm `colab-mcp-go` is on `PATH`, trust the project,
then restart Codex so `.codex/config.toml` is loaded. Do not copy the config into
the global Codex file unless you intentionally want a global server.

The restart loads MCP configuration into the current Codex session. It is not a
required step before every conversion. Colab MCP Go is installed separately and
is not bundled in this repository.

## Another Colab MCP process is already running

The project bridge selects an available localhost port automatically, so a
global or another project-scoped Colab MCP process can remain running. Do not
stop the other process. If `STILL2RIG_COLAB_PORT` was set explicitly, remove the
override or choose a free port, then restart Codex.

## The wrong Chrome profile opened

Still2Rig PSD should not open Chrome. Its wrapper always passes `--no-browser`.
Run `npm run still2rig-psd -- colab-url`, copy the URL, and paste it into the desired
already-signed-in profile. If a browser opened automatically, another Colab MCP
configuration is probably active.

## The MCP tool waits for an hour

The 3600-second value is a connection window, not a promise that inference takes
an hour. Open the printed tokenized URL. If connection cannot be established,
cancel the tool rather than opening another profile through automation.

## Wrong GPU

The default job requires an L4. Select L4 in the Colab UI before running the
generated cells. The worker fails before inference if the detected GPU name does
not match.

## Final cell finished but no local ZIP is visible

Check the download shelf and normal download directory of the same Chrome
profile. The ZIP is named `still2rig-psd-<job>.zip`. Move it to a known local path
and run `still2rig-psd import`.

## The report says more expression work is needed

The JSON field is `productionReady`, but it means that the mouth and closed-eye
files passed the available automated presence, registration, and numeric mouth
checks. It does not prove that the drawings are natural, and it does not mean
that a finished rig has passed motion review.
See `docs/quality-gates.md` for the three user-facing result levels.

The most common reason for a false value is missing real `mouth_open.png` or
`eye_close.png`. Supply aligned full-canvas expression layers and run
`still2rig-psd repair <job> --expressions <dir>`. Do not relabel a placeholder as
real expression art. The previous PSD and reports remain under the ignored
repair history for recovery.

If a mouth appears as a pale capsule or a floating face-colored patch, do not
mask and fill the existing mouth component. Extract only the original registered
mouth ink, remove its skin matte, and render the closed/open states separately.
The QA report must pass the compact-mouth, closed-line, and bright-fill checks.
