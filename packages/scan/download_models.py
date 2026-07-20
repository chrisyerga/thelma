#!/usr/bin/env python3
"""Download MediaPipe Tasks model bundles into packages/scan/models/."""

from __future__ import annotations

import urllib.request
from pathlib import Path

MODELS = {
    "face_landmarker.task": "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    "hand_landmarker.task": "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    "pose_landmarker_lite.task": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
}


def main() -> None:
    out = Path(__file__).resolve().parent / "models"
    out.mkdir(parents=True, exist_ok=True)
    for name, url in MODELS.items():
        dest = out / name
        if dest.exists() and dest.stat().st_size > 1000:
            print(f"ok {name}")
            continue
        print(f"downloading {name}…")
        urllib.request.urlretrieve(url, dest)
        print(f"  → {dest}")


if __name__ == "__main__":
    main()
