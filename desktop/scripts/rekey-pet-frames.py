#!/usr/bin/env python3
"""Remove the contact-sheet's white background from extracted pet frames.

Only near-background pixels connected to a frame edge are keyed out. This keeps
light fills and highlights inside the astronaut cat intact.
"""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image


WHITE_THRESHOLD = 245
BACKGROUND_DELTA = 12


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


def rekey(path: Path) -> float:
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

    image.save(path)
    return len(queued) / (width * height)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--frames-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "renderer" / "assets" / "pet" / "frames",
    )
    args = parser.parse_args()
    paths = sorted(args.frames_dir.glob("*.png"))
    if not paths:
        raise SystemExit(f"No PNG frames found in {args.frames_dir}")
    for path in paths:
        ratio = rekey(path)
        print(f"{path.name}\talpha0={ratio:.2%}")


if __name__ == "__main__":
    main()
