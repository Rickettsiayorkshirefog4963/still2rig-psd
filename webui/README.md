# Still2Rig PSD built-in preview

This local WebUI is the standard preview surface for PSD files produced by
Still2Rig PSD. It is a first-class project feature rather than a bundled
character demo.

On startup, the local server lists finalized files under the ignored
`.still2rig-psd/jobs/*/output/*.psd` directories and automatically opens the
newest result. The selector can switch between earlier results or refresh the
list while the server remains open.

## Run from the repository root

```bash
npm run preview
```

Open the printed local URL. A production build and automated browser QA are
also available:

```bash
npm run preview:build
npm run preview:qa
```

Node.js 20.19 or newer is required by the WebUI toolchain.

The preview is desktop-first and listens on `127.0.0.1` by default. Its narrow
layout remains readable and keeps PSD selection before the canvas, but phone
access, touch interaction, and large-PSD memory use are not officially
supported. Do not expose the generated-PSD API to a LAN without reviewing the
privacy implications.

## PSD sources

- Generated PSDs: served only from `.still2rig-psd/jobs/*/output/`
- Local file picker: read in the browser with `File.arrayBuffer()`
- Drag-and-drop: read in the browser without uploading the file

The local server returns a generated-file list without absolute paths and maps
opaque IDs back to known PSD files. It does not provide arbitrary filesystem
browsing. Symlinks in output directories are not served.

## Controls

- Generated-PSD selector and list refresh
- Eye and mouth open/close sliders
- Automatic blinking toggle, independent of the selected motion mode
- Static, hair-motion, and full-body-plus-hair motion modes
- One-click automatic motion check near the top of the controls
- Calm, standard, and active motion presets
- Detailed intensity, idle, breathing, wind, hair amplitude, softness, and
  drag-inertia multipliers
- Expandable advanced parameters for 32 internal baseline values, grouped into
  pose/body, eyes/brows, mouth, and hair/physics controls; each value has a
  slider, exact numeric input, displayed default, and one-click reset
- Canvas drag, wheel zoom, zoom slider, and view reset
- PSD drag-and-drop and file-picker input

Motion settings remain active when another PSD is loaded in the same page.
Reloading the page restores the standard preset.

## Expected PSD structure

The renderer follows Anime2.5DRig layer naming, including `face`, `back hair`,
`front hair`, `eyewhite`, `irides`, `eye_close`, `mouth_open`, and
`mouth_close`. A missing `face` layer is a blocking error. Missing optional
parts reduce available animation states.

This preview does not replace Still2Rig PSD structural QA. Publication-quality
motion claims still require the capture contract in
`../configs/motion-qa-contract.json`.

## Privacy and licensing

No character artwork or sample PSD is included. Browser QA generates synthetic
geometry at runtime and stores all fixtures and captures under the ignored
`.still2rig-psd/webui-qa/` directory.

The automatic rigger and WebGL motion implementation are based on
[Anime2.5DRig](https://github.com/852wa/Anime2.5DRig), Copyright (c) 2026
hakoniwa, MIT License. See `third-party/Anime2.5DRig-LICENSE.txt` and the root
`NOTICE.md`.

---

## 日本語

このWebUIは、Still2Rig PSDで生成したPSDをすぐに確認するための正式なローカル
プレビュー機能です。キャラクターを同梱するデモではありません。

リポジトリ直下で次を実行します。

```bash
npm run preview
```

起動するとGit管理外の`.still2rig-psd/jobs/*/output/*.psd`を検索し、最新のPSDを
自動表示します。セレクトボックスで過去の生成結果へ切り替えられ、サーバーを
起動したまま一覧を更新できます。手元PSDの選択とドラッグ＆ドロップにも対応します。
初期表示はアバターの周囲に余白を取った90%倍率です。自動まばたきは、静止・髪揺れ・
全身＋髪の各モーションとは独立してON/OFFできます。

「動きの強さを細かく調整」では、7項目の強さを変更できます。さらに「細かい設定」を
開くと、顔や体の向き、目・眉、口、髪・物理の計32項目を、スライダーと数値入力で
調整できます。各項目には最初の値を表示し、「最初の値に戻す」でまとめて元に戻せます。

このプレビューはデスクトップブラウザ向けで、既定では`127.0.0.1`だけで待ち受けます。
狭い画面でも読み込み導線は表示されますが、スマートフォンからの接続、タッチ操作、
大容量PSDのメモリ使用量は正式対応・実機検証の対象外です。

PSD、合成QA素材、スクリーンショットはすべてGit管理外に保存されます。
