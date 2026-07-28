#!/usr/bin/env python3
"""Remove the contact-sheet's white background from extracted pet frames.

Only near-background pixels connected to a frame edge are keyed out. This keeps
light fills and highlights inside the astronaut cat intact.
"""

from __future__ import annotations

import argparse
from collections import deque
from math import ceil
from pathlib import Path

from PIL import Image, ImageDraw


WHITE_THRESHOLD = 235
BACKGROUND_DELTA = 20
FLOATING_SPECK_MAX_AREA = 400
FLOATING_SPECK_MAX_HEIGHT = 20
TOP_BAND_UPWARD_PADDING = 10
TOP_BAND_BODY_FRACTION = 0.25
TOP_BAND_OPENING_RADIUS = 1


def median(values: list[int]) -> int:
    values.sort()
    return values[len(values) // 2]


def background_from_corners(image: Image.Image) -> tuple[int, int, int]:
    width, height = image.size
    samples = [
        image.getpixel((0, 0)),
        image.getpixel((width - 1, 0)),
        image.getpixel((0, height - 1)),
        image.getpixel((width - 1, height - 1)),
    ]
    return tuple(median([pixel[channel] for pixel in samples]) for channel in range(3))


def is_background(pixel: tuple[int, int, int, int], background: tuple[int, int, int]) -> bool:
    red, green, blue, alpha = pixel
    if alpha == 0:
        return True
    near_white = red >= WHITE_THRESHOLD and green >= WHITE_THRESHOLD and blue >= WHITE_THRESHOLD
    near_corner = max(abs(red - background[0]), abs(green - background[1]), abs(blue - background[2])) <= BACKGROUND_DELTA
    return near_white or near_corner


def opaque_components(image: Image.Image) -> list[tuple[list[tuple[int, int]], tuple[int, int, int, int]]]:
    width, height = image.size
    pixels = image.load()
    seen: set[tuple[int, int]] = set()
    components: list[tuple[list[tuple[int, int]], tuple[int, int, int, int]]] = []
    for y in range(height):
        for x in range(width):
            if (x, y) in seen or pixels[x, y][3] == 0:
                continue
            queue: deque[tuple[int, int]] = deque([(x, y)])
            seen.add((x, y))
            points: list[tuple[int, int]] = []
            while queue:
                point_x, point_y = queue.popleft()
                points.append((point_x, point_y))
                for next_x, next_y in ((point_x - 1, point_y), (point_x + 1, point_y), (point_x, point_y - 1), (point_x, point_y + 1)):
                    if not (0 <= next_x < width and 0 <= next_y < height):
                        continue
                    if (next_x, next_y) in seen or pixels[next_x, next_y][3] == 0:
                        continue
                    seen.add((next_x, next_y))
                    queue.append((next_x, next_y))
            xs, ys = zip(*points)
            components.append((points, (min(xs), min(ys), max(xs), max(ys))))
    return sorted(components, key=lambda component: len(component[0]), reverse=True)


def floating_specks(image: Image.Image) -> tuple[tuple[int, int, int, int], list[tuple[list[tuple[int, int]], tuple[int, int, int, int]]]]:
    components = opaque_components(image)
    if not components:
        return (0, 0, 0, 0), []
    body_box = components[0][1]
    specks = []
    for points, box in components[1:]:
        _, top, _, bottom = box
        height = bottom - top + 1
        if top < body_box[1] and len(points) < FLOATING_SPECK_MAX_AREA and height < FLOATING_SPECK_MAX_HEIGHT:
            specks.append((points, box))
    return body_box, specks


def top_band(body_box: tuple[int, int, int, int], height: int) -> tuple[int, int]:
    _, top, _, bottom = body_box
    body_height = bottom - top + 1
    return max(0, top - TOP_BAND_UPWARD_PADDING), min(height - 1, top + ceil(body_height * TOP_BAND_BODY_FRACTION) - 1)


def alpha_mask(image: Image.Image) -> list[bool]:
    return [alpha > 0 for alpha in image.getchannel("A").tobytes()]


def opening(mask: list[bool], width: int, height: int, radius: int) -> list[bool]:
    """Square-kernel morphological opening of an alpha mask."""
    eroded = [False] * len(mask)
    for y in range(height):
        for x in range(width):
            pixel = y * width + x
            if not mask[pixel]:
                continue
            survives = True
            for offset_y in range(-radius, radius + 1):
                for offset_x in range(-radius, radius + 1):
                    next_x = x + offset_x
                    next_y = y + offset_y
                    if not (0 <= next_x < width and 0 <= next_y < height) or not mask[next_y * width + next_x]:
                        survives = False
                        break
                if not survives:
                    break
            eroded[pixel] = survives

    opened = [False] * len(mask)
    for y in range(height):
        for x in range(width):
            pixel = y * width + x
            if not eroded[pixel]:
                continue
            for offset_y in range(-radius, radius + 1):
                for offset_x in range(-radius, radius + 1):
                    next_x = x + offset_x
                    next_y = y + offset_y
                    if 0 <= next_x < width and 0 <= next_y < height:
                        opened[next_y * width + next_x] = True
    return opened


def glyph_components(mask: list[bool], width: int, height: int, band: tuple[int, int]) -> list[tuple[int, tuple[int, int, int, int]]]:
    """Report thin remnants in the band after opening, without changing pixels."""
    top, bottom = band
    seen: set[int] = set()
    found = []
    for y in range(top, bottom + 1):
        for x in range(width):
            start = y * width + x
            if start in seen or not mask[start]:
                continue
            queue: deque[int] = deque([start])
            seen.add(start)
            points = []
            while queue:
                pixel = queue.popleft()
                point_x = pixel % width
                point_y = pixel // width
                points.append(pixel)
                for offset_x, offset_y in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    next_x, next_y = point_x + offset_x, point_y + offset_y
                    if not (0 <= next_x < width and top <= next_y <= bottom):
                        continue
                    next_pixel = next_y * width + next_x
                    if next_pixel not in seen and mask[next_pixel]:
                        seen.add(next_pixel)
                        queue.append(next_pixel)
            xs = [pixel % width for pixel in points]
            ys = [pixel // width for pixel in points]
            box = (min(xs), min(ys), max(xs), max(ys))
            component_width = box[2] - box[0] + 1
            component_height = box[3] - box[1] + 1
            if (component_width <= 2 and component_height >= 4) or (component_height <= 2 and component_width >= 4):
                found.append((len(points), box))
    return found


def strip_glyph_band(image: Image.Image) -> tuple[tuple[int, int], int, float, list[tuple[int, tuple[int, int, int, int]]]]:
    """Open only the body-top band and retain original alpha outside the band."""
    width, height = image.size
    components = opaque_components(image)
    if not components:
        return (0, 0), 0, 0.0, []
    body_box = components[0][1]
    band = top_band(body_box, height)
    mask = alpha_mask(image)
    opened = opening(mask, width, height, TOP_BAND_OPENING_RADIUS)
    pixels = image.load()
    removed = 0
    original_body_area = len(components[0][0])
    for y in range(band[0], band[1] + 1):
        for x in range(width):
            pixel = y * width + x
            if mask[pixel] and not opened[pixel]:
                pixels[x, y] = (0, 0, 0, 0)
                removed += 1
    post_components = opaque_components(image)
    post_body_area = len(post_components[0][0]) if post_components else 0
    body_delta = (original_body_area - post_body_area) / max(1, original_body_area)
    remaining = glyph_components(alpha_mask(image), width, height, band)
    return band, removed, body_delta, remaining


def is_cat_frame(path: Path) -> bool:
    return not path.name.startswith("plane_")


def save_contact_sheet(entries: list[tuple[str, Image.Image, tuple[int, int]]], output: Path) -> None:
    """Write four-times top-band crops for direct before/after comparison."""
    scale = 4
    cell_width = 192 * scale
    cell_height = 64 * scale
    columns = 4
    rows = ceil(len(entries) / columns)
    sheet = Image.new("RGBA", (columns * cell_width, rows * cell_height), (240, 240, 240, 255))
    draw = ImageDraw.Draw(sheet)
    for index, (name, image, band) in enumerate(entries):
        crop_top = band[0]
        crop_bottom = min(image.height, crop_top + 64)
        crop = image.crop((0, crop_top, image.width, crop_bottom)).resize((cell_width, (crop_bottom - crop_top) * scale), Image.Resampling.NEAREST)
        cell_x = (index % columns) * cell_width
        cell_y = (index // columns) * cell_height
        sheet.alpha_composite(crop, (cell_x, cell_y))
        draw.rectangle((cell_x, cell_y, cell_x + cell_width - 1, cell_y + cell_height - 1), outline=(220, 38, 38, 255), width=1)
        draw.text((cell_x + 4, cell_y + 4), f"{name} y={band[0]}..{band[1]}", fill=(20, 24, 32, 255))
    sheet.convert("RGB").save(output)


def rekey(path: Path) -> tuple[float, tuple[int, int, int, int], list[tuple[int, tuple[int, int, int, int]]], tuple[int, int], int, float, list[tuple[int, tuple[int, int, int, int]]]]:
    image = Image.open(path).convert("RGBA")
    width, height = image.size
    if (width, height) != (192, 192):
        raise ValueError(f"{path} is {width}x{height}; expected 192x192")

    pixels = image.load()
    background = background_from_corners(image)
    queued = set()
    queue: deque[tuple[int, int]] = deque()

    def add_if_background(x: int, y: int) -> None:
        if (x, y) not in queued and is_background(pixels[x, y], background):
            queued.add((x, y))
            queue.append((x, y))

    for x in range(width):
        add_if_background(x, 0)
        add_if_background(x, height - 1)
    for y in range(1, height - 1):
        add_if_background(0, y)
        add_if_background(width - 1, y)

    while queue:
        x, y = queue.popleft()
        for next_x, next_y in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= next_x < width and 0 <= next_y < height:
                add_if_background(next_x, next_y)

    for x, y in queued:
        pixels[x, y] = (0, 0, 0, 0)

    body_box, specks = floating_specks(image)
    stripped = [(len(points), box) for points, box in specks]
    for points, _ in specks:
        for x, y in points:
            pixels[x, y] = (0, 0, 0, 0)

    body_box_after, specks_after = floating_specks(image)
    if specks_after:
        raise ValueError(f"{path} retains floating specks: {[(len(points), box) for points, box in specks_after]}")
    if body_box != (0, 0, 0, 0) and body_box_after == (0, 0, 0, 0):
        raise ValueError(f"{path} lost its opaque body")

    if is_cat_frame(path):
        band, glyph_pixels, body_delta, remaining = strip_glyph_band(image)
        if body_delta >= 0.02:
            raise ValueError(f"{path} top-band opening changed body area by {body_delta:.2%}")
        if remaining:
            raise ValueError(f"{path} retains thin top-band glyph shapes: {remaining}")
    else:
        band, glyph_pixels, body_delta, remaining = (0, 0), 0, 0.0, []

    image.save(path)
    return len(queued) / (width * height), body_box_after, stripped, band, glyph_pixels, body_delta, remaining


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--frames-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "renderer" / "assets" / "pet" / "frames",
    )
    parser.add_argument("--before-sheet", type=Path, default=Path("/tmp/t018d-before-contact-sheet.png"))
    parser.add_argument("--after-sheet", type=Path, default=Path("/tmp/t018d-after-contact-sheet.png"))
    args = parser.parse_args()
    paths = sorted(args.frames_dir.glob("*.png"))
    if not paths:
        raise SystemExit(f"No PNG frames found in {args.frames_dir}")
    before_entries = []
    for path in paths:
        image = Image.open(path).convert("RGBA")
        components = opaque_components(image)
        body_box = components[0][1] if components else (0, 0, 0, 0)
        before_entries.append((path.name, image.copy(), top_band(body_box, image.height)))
    save_contact_sheet(before_entries, args.before_sheet)

    after_entries = []
    for path in paths:
        ratio, body_box, stripped, band, glyph_pixels, body_delta, remaining = rekey(path)
        image = Image.open(path).convert("RGBA")
        after_entries.append((path.name, image, band))
        print(
            f"{path.name}\talpha0={ratio:.2%}\tbody={body_box}\tstripped={stripped}"
            f"\tband={band}\tglyphBandPx={glyph_pixels}\tbodyDelta={body_delta:.2%}\tremaining={remaining}"
        )
    save_contact_sheet(after_entries, args.after_sheet)


if __name__ == "__main__":
    main()
