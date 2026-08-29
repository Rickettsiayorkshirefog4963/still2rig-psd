# Understanding the generated PSD

[日本語版](quality-gates.ja.md)

The current CLI automatically reports the first two cumulative levels below.
The third level is reserved for a separately implemented renderer adapter; no
motion-capture adapter is bundled yet. These levels answer different questions
and must not be shortened to a single “complete” claim.

| Reported level | What was verified | What was not verified |
| --- | --- | --- |
| **Structure checked** | The builder wrote the configured order and read it back, and structural QA passed required layers, visible pixels, and critical front/back relationships. This corresponds to `structuralPass=true`. Hashes are verified separately by the workflow. | Real blinking, alternate mouth artwork, deformation, and motion quality. |
| **Mouth/closed-eye files checked** | `mouth_open` and `eye_close` are present, are not built-in placeholders, and passed registration and numeric mouth checks. This corresponds to `productionReady=true` in the JSON report. | Whether the drawings are natural, whether the closed-eye lines are good, and whether colors and cutout edges match the face. Despite the field name, this is not a claim that a finished rig is ready for production. |
| **Motion checked by an adapter** | A renderer adapter recorded and evaluated the required states in `configs/motion-qa-contract.json`. | Behavior in renderers, model formats, or poses that were not tested. |

A PSD created with `--preview-placeholders` can be **structure checked**, but it
cannot have its **mouth/closed-eye files checked**. A structurally valid PSD is also not
automatically a Live2D model or a finished rig.

## Standard layer order

The default contract uses back-to-front compositing. A later group in this
table is drawn over an earlier group.

| Back to front | Layer names | Reason |
| --- | --- | --- |
| 1 | `back hair` | Remains behind the head and body. |
| 2 | `bottomwear` | Sits behind the upper body layers. |
| 3 | `handwear` | Keeps arms at the sides behind the shirt and shoulder openings. |
| 4 | `topwear` | Covers the inner edge of side-positioned arms. |
| 5 | `neck` | Appears over the body and clothing but under the face. |
| 6 | `ears` | Uses the default Anime2.5-compatible head order. |
| 7 | `face` | Provides the base for all facial features. |
| 8 | `eyewhite`, `irides`, `eyelash`, `eyebrow`, `nose`, `facedetail` | Facial features remain over the face base. |
| 9 | `mouth_close`, `mouth_open`, `eye_close` | Expression states remain over the face base. |
| 10 | `front hair` | Covers the forehead and facial parts that pass behind it. |
| 11 | `headwear` | Remains at the front of the default stack. |

The exact machine-readable order is in `configs/layer-map.json`. Structural QA
also enforces these important relationships:

- `handwear` behind `topwear`;
- `handwear` and `topwear` behind `neck`;
- `neck` behind `face`;
- `eyewhite`, `irides`, `eyelash`, `eyebrow`, `mouth_close`, `mouth_open`, and
  `eye_close` over `face`; and
- `face`, `eyewhite`, `irides`, `mouth_close`, and `eye_close` behind
  `front hair`.

This is a safe default for a front-facing character with arms beside the torso.
It is not a universal order for every pose. If a hand crosses in front of the
shirt, one `handwear` layer cannot be both behind the shoulder opening and in
front of the shirt. That artwork must be split into back and front pieces, or
the PSD contract must be extended. A layer override can replace an existing
layer image, but it cannot add that missing depth split.

## Images needed for real mouth and eye movement

A neutral source image usually contains open eyes and only one mouth shape. It
does not reveal trustworthy artwork for closed eyes or a different mouth
interior. To verify those states, provide transparent PNG files on the same
canvas and at the same registration as the source:

| File | When it is needed | Content |
| --- | --- | --- |
| `mouth_open.png` | Required for real mouth switching | Only the aligned open-mouth artwork; transparent elsewhere. |
| `eye_close.png` | Required for real blinking | Both aligned closed-eye shapes; transparent elsewhere. |
| `mouth_close.png` | Optional replacement | A corrected closed-mouth drawing when the extracted source mouth is unsuitable. |

Do not include an opaque white or skin-colored rectangle around the mouth. The
mouth files should contain the mouth drawing itself, not a patch copied from the
face. All supplied expression files must match the PSD canvas dimensions.

`--preview-placeholders` may copy the closed mouth into the open-mouth slot so
the WebUI controls can be exercised. It does not generate a real open mouth, so
the two states may look identical and the report remains below expression
file checked.

## Checks performed

The builder follows the complete order in `configs/layer-map.json` and verifies
that the written PSD preserves it. Structural QA verifies required and unique
layers, visible pixels, PSD round-trip integrity, and the critical ordering
relationships listed above. Input, bundle, artifact, and output hashes are
verified by separate workflow stages. Expression QA verifies presence, canvas
registration, compact mouth artwork,
and rejects an overly filled closed mouth or a dominant bright fill. These
numeric checks do not replace visual review of edge color and face-patch seams.

Motion quality requires captured evidence from a renderer. The contract covers
blink and mouth states, continuous lip sync, hair-only movement, full-body idle,
drag inertia, feature stability, and unexpected seam exposure.
