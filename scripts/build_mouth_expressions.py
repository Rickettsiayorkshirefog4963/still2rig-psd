#!/usr/bin/env python3
"""Build compact registered mouth layers from the original registered artwork."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
from pathlib import Path

from PIL import Image, ImageDraw


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def median_color(colors: list[tuple[int, int, int]]) -> tuple[int, int, int]:
    if not colors:
        raise RuntimeError("cannot sample a color from an empty set")
    return tuple(round(statistics.median(color[channel] for color in colors)) for channel in range(3))


def color_distance(left: tuple[int, int, int], right: tuple[int, int, int]) -> float:
    return math.sqrt(sum((left[channel] - right[channel]) ** 2 for channel in range(3)))


def mouth_roi(width: int, height: int) -> tuple[int, int, int, int]:
    # See-through registers the face at the canvas center. Keep this narrow so
    # blush, nose, and face-edge pixels cannot be mistaken for mouth artwork.
    return (
        round(width * 0.478),
        round(height * 0.367),
        round(width * 0.523),
        round(height * 0.388),
    )


def sample_skin(image: Image.Image, roi: tuple[int, int, int, int]) -> tuple[int, int, int]:
    left, top, right, _ = roi
    strip_top = max(0, top - max(8, image.height // 100))
    strip_bottom = top
    pixels = image.load()
    samples = [pixels[x, y] for y in range(strip_top, strip_bottom) for x in range(left, right)]
    return median_color(samples)


def extract_closed_mouth(
    source: Image.Image,
) -> tuple[Image.Image, tuple[int, int, int], dict]:
    width, height = source.size
    roi = mouth_roi(width, height)
    skin = sample_skin(source, roi)
    source_pixels = source.load()
    red_green_values = []
    for y in range(roi[1], roi[3]):
        for x in range(roi[0], roi[2]):
            red, green, _ = source_pixels[x, y]
            red_green_values.append(red - green)
    skin_redness = statistics.median(red_green_values)
    redness_threshold = skin_redness + 3

    selected = []
    for y in range(roi[1], roi[3]):
        for x in range(roi[0], roi[2]):
            red, green, blue = source_pixels[x, y]
            luminance = (red * 299 + green * 587 + blue * 114) / 1000
            if red - green >= redness_threshold and green - blue >= 6 and luminance < 248:
                selected.append((x, y, (red, green, blue)))
    if len(selected) < 20:
        raise RuntimeError("could not isolate the original mouth line")

    xs = [x for x, _, _ in selected]
    ys = [y for _, y, _ in selected]
    bbox = (min(xs), min(ys), max(xs) + 1, max(ys) + 1)
    if bbox[2] - bbox[0] > width * 0.06 or bbox[3] - bbox[1] > height * 0.025:
        raise RuntimeError(f"detected mouth line is implausibly large: {bbox}")

    distances = sorted(color_distance(color, skin) for _, _, color in selected)
    ink_distance = max(48.0, statistics.median(distances[: max(8, len(distances) // 12)]))
    close = Image.new("RGBA", source.size)
    close_pixels = close.load()
    for x, y, observed in selected:
        distance = color_distance(observed, skin)
        alpha = min(1.0, distance / ink_distance)
        if alpha <= 0:
            continue
        # Remove the skin matte from antialiased source pixels. The displayed
        # color remains close to the original, but the layer itself contains
        # mouth ink only rather than a rectangular face-colored patch.
        ink = tuple(
            max(0, min(255, round(skin[channel] + (observed[channel] - skin[channel]) / alpha)))
            for channel in range(3)
        )
        close_pixels[x, y] = (*ink, round(alpha * 255))

    return close, skin, {
        "roi": list(roi),
        "sourceBbox": list(bbox),
        "skinColor": list(skin),
        "skinRedness": round(skin_redness, 3),
        "rednessThreshold": round(redness_threshold, 3),
        "inkDistance": round(ink_distance, 3),
    }


def visible_geometry(image: Image.Image, threshold: int = 16) -> dict:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value > threshold else 0).getbbox()
    if bbox is None:
        return {"bbox": None, "centroid": None, "visiblePixels": 0}
    pixels = alpha.load()
    sx = sy = weight = 0.0
    visible = 0
    for y in range(bbox[1], bbox[3]):
        for x in range(bbox[0], bbox[2]):
            value = pixels[x, y]
            if value <= threshold:
                continue
            visible += 1
            sx += x * value
            sy += y * value
            weight += value
    return {
        "bbox": list(bbox),
        "centroid": {"x": round(sx / weight, 3), "y": round(sy / weight, 3)},
        "visiblePixels": visible,
    }


def skin_like_pixels(image: Image.Image, skin: tuple[int, int, int], threshold: int = 36) -> int:
    pixels = image.convert("RGBA").load()
    count = 0
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha > 16 and color_distance((red, green, blue), skin) < threshold:
                count += 1
    return count


def build_open_mouth(
    size: tuple[int, int],
    close_geometry: dict,
    close: Image.Image,
    skin: tuple[int, int, int],
) -> tuple[Image.Image, dict]:
    bbox = close_geometry["bbox"]
    center = close_geometry["centroid"]
    close_width = bbox[2] - bbox[0]
    target_width = max(24, min(round(size[0] * 0.03), round(close_width * 0.82)))
    target_height = max(9, round(target_width * 0.34))

    colors = []
    close_pixels = close.convert("RGBA").load()
    for y in range(bbox[1], bbox[3]):
        for x in range(bbox[0], bbox[2]):
            red, green, blue, alpha = close_pixels[x, y]
            if alpha > 96:
                colors.append((red, green, blue))
    colors.sort(key=sum)
    outline = median_color(colors[: max(4, min(12, len(colors)))])
    interior = (
        max(54, round(outline[0] * 0.72)),
        max(38, round(outline[1] * 0.62)),
        max(42, round(outline[2] * 0.64)),
    )
    tongue = (
        min(224, round(outline[0] * 1.38)),
        min(150, round(outline[1] * 1.18)),
        min(148, round(outline[2] * 1.24)),
    )

    scale = 6
    sprite = Image.new("RGBA", (target_width * scale, target_height * scale))
    draw = ImageDraw.Draw(sprite)
    outer = (0, 0, sprite.width - 1, sprite.height - 1)
    draw.ellipse(outer, fill=(*outline, 255))
    inset_x = max(scale, round(scale * 1.15))
    inset_y = max(scale, round(scale * 1.05))
    inner = (inset_x, inset_y, sprite.width - 1 - inset_x, sprite.height - 1 - inset_y)
    draw.ellipse(inner, fill=(*interior, 255))
    tongue_box = (
        round(sprite.width * 0.25),
        round(sprite.height * 0.55),
        round(sprite.width * 0.75),
        round(sprite.height * 0.91),
    )
    draw.ellipse(tongue_box, fill=(*tongue, 235))
    sprite = sprite.resize((target_width, target_height), Image.Resampling.LANCZOS)

    opened = Image.new("RGBA", size)
    paste_x = round(center["x"] - target_width / 2)
    paste_y = round(center["y"] - target_height / 2 + 1)
    opened.alpha_composite(sprite, (paste_x, paste_y))
    return opened, {
        "targetSize": [target_width, target_height],
        "colors": {"outline": list(outline), "interior": list(interior), "tongue": list(tongue)},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--registered-source", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()

    source = Image.open(args.registered_source).convert("RGB")
    close, skin, extraction = extract_closed_mouth(source)
    close_geometry = visible_geometry(close)
    opened, open_design = build_open_mouth(source.size, close_geometry, close, skin)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    close_path = args.output_dir / "mouth_close.png"
    open_path = args.output_dir / "mouth_open.png"
    close.save(close_path, optimize=True)
    opened.save(open_path, optimize=True)
    report = {
        "schemaVersion": 2,
        "source": {"registeredSource": args.registered_source.name, **extraction},
        "mouthClose": {
            **visible_geometry(close),
            "skinLikeRgbPixels": skin_like_pixels(close, skin),
            "sha256": sha256_file(close_path),
        },
        "mouthOpen": {
            **visible_geometry(opened),
            **open_design,
            "skinLikeRgbPixels": skin_like_pixels(opened, skin),
            "sha256": sha256_file(open_path),
        },
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
