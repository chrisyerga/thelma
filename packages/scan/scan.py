#!/usr/bin/env python3
"""Thelma scan: Whisper transcription + MediaPipe Tasks vision events."""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


MODELS_DIR = Path(__file__).resolve().parent / "models"


def word_id(i: int) -> str:
    return f"w{i:04d}"


def _has_module(name: str) -> bool:
    try:
        __import__(name)
        return True
    except ImportError:
        return False


def run_whisper(media: Path, asset_id: str, out_path: Path, model: str) -> None:
    """Prefer mlx_whisper on macOS; fall back to writing empty transcript."""
    if shutil.which("mlx_whisper") is None and not _has_module("mlx_whisper"):
        print("WARN: mlx_whisper not available — writing empty transcript", file=sys.stderr)
        out_path.write_text(
            json.dumps(
                {
                    "assetId": asset_id,
                    "text": "",
                    "words": [],
                    "source": "none",
                },
                indent=2,
            )
            + "\n"
        )
        return

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        cmd = [
            sys.executable,
            "-m",
            "mlx_whisper",
            str(media),
            "--model",
            model,
            "--output-dir",
            str(tmp_dir),
            "--output-format",
            "json",
            "--word-timestamps",
            "True",
        ]
        try:
            subprocess.run(cmd, check=True)
        except (subprocess.CalledProcessError, FileNotFoundError):
            subprocess.run(
                [
                    "mlx_whisper",
                    str(media),
                    "--model",
                    model,
                    "--output-dir",
                    str(tmp_dir),
                    "--output-format",
                    "json",
                    "--word-timestamps",
                    "True",
                ],
                check=True,
            )

        jsons = list(tmp_dir.glob("*.json"))
        if not jsons:
            raise RuntimeError("Whisper produced no JSON")
        raw = json.loads(jsons[0].read_text())

    words: list[dict[str, Any]] = []
    text = raw.get("text") or ""
    idx = 0

    if raw.get("words"):
        for w in raw["words"]:
            token = (w.get("word") or "").strip()
            if not token:
                continue
            words.append(
                {
                    "wordId": word_id(idx),
                    "word": token,
                    "start": float(w["start"]),
                    "end": float(w["end"]),
                    "probability": w.get("probability"),
                }
            )
            idx += 1
    else:
        for seg in raw.get("segments") or []:
            for w in seg.get("words") or []:
                token = (w.get("word") or "").strip()
                if not token:
                    continue
                words.append(
                    {
                        "wordId": word_id(idx),
                        "word": token,
                        "start": float(w["start"]),
                        "end": float(w["end"]),
                        "probability": w.get("probability"),
                    }
                )
                idx += 1

    out_path.write_text(
        json.dumps(
            {
                "assetId": asset_id,
                "text": text.strip(),
                "language": raw.get("language"),
                "words": words,
                "source": "mlx_whisper",
            },
            indent=2,
        )
        + "\n"
    )
    print(f"  wrote transcript ({len(words)} words)")


def ear(landmarks: list[Any], idxs: list[int]) -> float:
    pts = [(landmarks[i].x, landmarks[i].y) for i in idxs]

    def dist(a: tuple[float, float], b: tuple[float, float]) -> float:
        return math.hypot(a[0] - b[0], a[1] - b[1])

    vertical1 = dist(pts[1], pts[5])
    vertical2 = dist(pts[2], pts[4])
    horizontal = dist(pts[0], pts[3])
    if horizontal < 1e-6:
        return 0.0
    return (vertical1 + vertical2) / (2.0 * horizontal)


def finger_extended(landmarks: list[Any], tip: int, pip: int) -> bool:
    wrist = landmarks[0]
    tip_d = math.hypot(landmarks[tip].x - wrist.x, landmarks[tip].y - wrist.y)
    pip_d = math.hypot(landmarks[pip].x - wrist.x, landmarks[pip].y - wrist.y)
    return tip_d > pip_d * 1.08


def is_open_palm(hand_landmarks: list[Any]) -> bool:
    tips = [8, 12, 16, 20]
    pips = [6, 10, 14, 18]
    return all(finger_extended(hand_landmarks, t, p) for t, p in zip(tips, pips))


def hand_raised(hand_landmarks: list[Any], face_y: float | None) -> bool:
    wrist = hand_landmarks[0]
    if face_y is None:
        return wrist.y < 0.45
    return wrist.y < face_y


def ensure_models() -> dict[str, Path]:
    from download_models import MODELS, main as download_main

    download_main()
    paths = {name: MODELS_DIR / name for name in MODELS}
    missing = [n for n, p in paths.items() if not p.exists()]
    if missing:
        raise RuntimeError(f"Missing MediaPipe models: {missing}")
    return paths


def run_vision(media: Path, asset_id: str, out_path: Path, sample_fps: float) -> None:
    if not _has_module("cv2") or not _has_module("mediapipe"):
        print("WARN: opencv/mediapipe missing — writing empty vision", file=sys.stderr)
        out_path.write_text(
            json.dumps(
                {"assetId": asset_id, "fpsSampled": sample_fps, "events": []},
                indent=2,
            )
            + "\n"
        )
        return

    import cv2
    import mediapipe as mp
    import numpy as np

    model_paths = ensure_models()
    BaseOptions = mp.tasks.BaseOptions
    VisionRunningMode = mp.tasks.vision.RunningMode
    FaceLandmarker = mp.tasks.vision.FaceLandmarker
    FaceLandmarkerOptions = mp.tasks.vision.FaceLandmarkerOptions
    HandLandmarker = mp.tasks.vision.HandLandmarker
    HandLandmarkerOptions = mp.tasks.vision.HandLandmarkerOptions
    PoseLandmarker = mp.tasks.vision.PoseLandmarker
    PoseLandmarkerOptions = mp.tasks.vision.PoseLandmarkerOptions

    face_opts = FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model_paths["face_landmarker.task"])),
        running_mode=VisionRunningMode.VIDEO,
        num_faces=1,
    )
    hand_opts = HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model_paths["hand_landmarker.task"])),
        running_mode=VisionRunningMode.VIDEO,
        num_hands=2,
    )
    pose_opts = PoseLandmarkerOptions(
        base_options=BaseOptions(
            model_asset_path=str(model_paths["pose_landmarker_lite.task"])
        ),
        running_mode=VisionRunningMode.VIDEO,
        num_poses=1,
    )

    cap = cv2.VideoCapture(str(media))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {media}")

    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, int(round(src_fps / sample_fps)))

    flags: dict[str, list[tuple[float, float, float]]] = {
        "hand_raised": [],
        "face_covered": [],
        "wink_hold": [],
        "no_face": [],
        "looking_away": [],
        "mouth_idle_with_audio": [],
        "pointing": [],
        "shrug": [],
        "face_bbox": [],
    }

    audio_rms: list[tuple[float, float]] = []
    try:
        audio_rms = _audio_rms_envelope(media, sample_fps)
    except Exception as e:
        print(f"  audio envelope skipped: {e}", file=sys.stderr)

    RIGHT_EYE = [33, 160, 158, 133, 153, 144]
    LEFT_EYE = [362, 385, 387, 263, 373, 380]
    EAR_THRESH = 0.18
    WINK_HOLD_FRAMES = max(2, int(sample_fps * 0.35))
    wink_run = 0
    frame_i = 0

    with (
        FaceLandmarker.create_from_options(face_opts) as face_lm,
        HandLandmarker.create_from_options(hand_opts) as hand_lm,
        PoseLandmarker.create_from_options(pose_opts) as pose_lm,
    ):
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if frame_i % step != 0:
                frame_i += 1
                continue

            t = frame_i / src_fps
            ts_ms = int(t * 1000)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))

            face_res = face_lm.detect_for_video(mp_image, ts_ms)
            hand_res = hand_lm.detect_for_video(mp_image, ts_ms)
            pose_res = pose_lm.detect_for_video(mp_image, ts_ms)

            face_y = None
            has_face = bool(face_res.face_landmarks)
            mouth_open = 0.0

            if has_face:
                lm = face_res.face_landmarks[0]
                face_y = lm[1].y
                flags["face_bbox"].append((t, t + (step / src_fps), 0.9))

                left_ear = ear(lm, LEFT_EYE)
                right_ear = ear(lm, RIGHT_EYE)
                if (left_ear < EAR_THRESH) != (right_ear < EAR_THRESH) and min(
                    left_ear, right_ear
                ) < EAR_THRESH:
                    wink_run += 1
                else:
                    wink_run = 0
                if wink_run >= WINK_HOLD_FRAMES:
                    flags["wink_hold"].append((t, t + (step / src_fps), 0.7))

                mouth_open = abs(lm[13].y - lm[14].y)
                if abs(lm[1].x - 0.5) > 0.18:
                    flags["looking_away"].append((t, t + (step / src_fps), 0.6))
            else:
                flags["no_face"].append((t, t + (step / src_fps), 0.9))
                wink_run = 0

            open_palm = False
            raised = False
            near_face = False
            if hand_res.hand_landmarks:
                for hand in hand_res.hand_landmarks:
                    if is_open_palm(hand):
                        open_palm = True
                    if hand_raised(hand, face_y):
                        raised = True
                    if face_y is not None:
                        for tip in (8, 12, 16, 20):
                            if abs(hand[tip].y - face_y) < 0.12 and abs(hand[tip].x - 0.5) < 0.25:
                                near_face = True

            if raised or open_palm:
                flags["hand_raised"].append(
                    (t, t + (step / src_fps), 0.75 if open_palm else 0.6)
                )
            if near_face and has_face:
                flags["face_covered"].append((t, t + (step / src_fps), 0.65))

            rms = _rms_at(audio_rms, t)
            if rms > 0.02 and mouth_open < 0.015 and has_face:
                flags["mouth_idle_with_audio"].append((t, t + (step / src_fps), 0.55))

            if pose_res.pose_landmarks:
                pl = pose_res.pose_landmarks[0]
                # MediaPipe pose: 15/16 wrists, 13/14 elbows, 11/12 shoulders
                lw, le = pl[15], pl[13]
                if abs(lw.x - le.x) > 0.15 and lw.y < 0.7:
                    flags["pointing"].append((t, t + (step / src_fps), 0.5))
                ls, rs = pl[11], pl[12]
                if ls.y < 0.35 and rs.y < 0.35:
                    flags["shrug"].append((t, t + (step / src_fps), 0.45))

            frame_i += 1

    cap.release()

    events: list[dict[str, Any]] = []
    for etype, hits in flags.items():
        events.extend(_merge_hits(etype, hits, gap=0.35))
    events.sort(key=lambda e: e["start"])

    out_path.write_text(
        json.dumps(
            {
                "assetId": asset_id,
                "fpsSampled": sample_fps,
                "events": events,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"  wrote vision ({len(events)} events)")


def _merge_hits(
    etype: str, hits: list[tuple[float, float, float]], gap: float
) -> list[dict[str, Any]]:
    if not hits:
        return []
    hits = sorted(hits, key=lambda h: h[0])
    out: list[dict[str, Any]] = []
    cur_s, cur_e, cur_c = hits[0]
    for s, e, c in hits[1:]:
        if s <= cur_e + gap:
            cur_e = max(cur_e, e)
            cur_c = max(cur_c, c)
        else:
            out.append(
                {
                    "type": etype,
                    "start": round(cur_s, 3),
                    "end": round(cur_e, 3),
                    "confidence": round(cur_c, 3),
                    "meta": {},
                }
            )
            cur_s, cur_e, cur_c = s, e, c
    out.append(
        {
            "type": etype,
            "start": round(cur_s, 3),
            "end": round(cur_e, 3),
            "confidence": round(cur_c, 3),
            "meta": {},
        }
    )
    return out


def _audio_rms_envelope(media: Path, sample_fps: float) -> list[tuple[float, float]]:
    import numpy as np

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        wav = Path(f.name)
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(media),
                "-ac",
                "1",
                "-ar",
                "16000",
                "-vn",
                str(wav),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        raw = subprocess.check_output(
            [
                "ffmpeg",
                "-i",
                str(wav),
                "-f",
                "s16le",
                "-acodec",
                "pcm_s16le",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-",
            ],
            stderr=subprocess.DEVNULL,
        )
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        sr = 16000
        win = max(1, int(sr / sample_fps))
        out: list[tuple[float, float]] = []
        for i in range(0, len(samples) - win, win):
            chunk = samples[i : i + win]
            rms = float(np.sqrt(np.mean(chunk * chunk) + 1e-12))
            out.append((i / sr, rms))
        return out
    finally:
        wav.unlink(missing_ok=True)


def _rms_at(envelope: list[tuple[float, float]], t: float) -> float:
    if not envelope:
        return 0.0
    best = envelope[0]
    for item in envelope:
        if item[0] <= t:
            best = item
        else:
            break
    return best[1]


def main() -> None:
    ap = argparse.ArgumentParser(description="Thelma asset scan")
    ap.add_argument("--asset-id", required=True)
    ap.add_argument("--media", required=True, type=Path)
    ap.add_argument("--out-dir", required=True, type=Path)
    ap.add_argument("--skip-whisper", action="store_true")
    ap.add_argument("--skip-vision", action="store_true")
    ap.add_argument("--sample-fps", type=float, default=5.0)
    args = ap.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    model = os.environ.get("WHISPER_MODEL", "mlx-community/whisper-large-v3-turbo")

    if not args.skip_whisper:
        run_whisper(
            args.media,
            args.asset_id,
            args.out_dir / f"{args.asset_id}.transcript.json",
            model,
        )
    if not args.skip_vision:
        run_vision(
            args.media,
            args.asset_id,
            args.out_dir / f"{args.asset_id}.vision.json",
            args.sample_fps,
        )

    meta_path = args.out_dir / f"{args.asset_id}.meta.json"
    if not meta_path.exists():
        meta_path.write_text(
            json.dumps({"assetId": args.asset_id, "cues": []}, indent=2) + "\n"
        )


if __name__ == "__main__":
    main()
