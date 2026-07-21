# Thelma

CLI-first video editing pipeline: scan → review → story → guide → cut plate → Remotion polish.

One edit JSON is the source of truth. Overlays/SFX/flair use **source-time or word anchors** so timeline trims don’t send your graphics into the cornfield. Subtitles and motion graphics lay out via **SafeFrame** slots for TikTok / Instagram Reels / Facebook Reels.

## Setup

```bash
npm install
npm run -w @thelma/shared build
npm run -w @thelma/pipeline build

# Python scan deps (vision)
python3 -m venv packages/scan/.venv
source packages/scan/.venv/bin/activate
pip install -r packages/scan/requirements.txt
python packages/scan/download_models.py
# macOS transcription:
pip install mlx-whisper

cp .env.example .env   # OPENROUTER_API_KEY, optional ELEVENLABS_*
```

System deps: `ffmpeg` / `ffprobe` with **libass** (e.g. Homebrew `ffmpeg-full`) for `thelma review` burn-in.

## Workflow

```bash
npm run thelma -- init my-video
npm run thelma -- import --project my-video ./clip.MOV
npm run thelma -- scan --project my-video
npm run thelma -- review --project my-video
# watch projects/my-video/analysis/review.mp4 — top: assetId | cue-N | kind | src time
npm run thelma -- story --project my-video
# optional: steer the active edit with cue/asset references
npm run thelma -- guide --project my-video --edit <id> --notes "drop bad_take on img-8066 before advertising; keep Sikkimit speech"
npm run thelma -- cut --project my-video --edit <id>
npm run thelma -- sync --project my-video
npm run thelma -- studio
npm run thelma -- render --project my-video --platform universal
# or: --platform all
```

Projects live in `projects/<slug>/` (gitignored).

### Scan (incremental)

- Skips assets whose transcript + vision are newer than the raw media.
- Classifies **meta cues** (with `cue-N` ids) after analysis when meta is empty.
- `--force` rescans everything; `--asset <id>` limits to one clip.
- Re-import of the same filename updates mtime → next scan only reprocesses that clip.

### Review plate

`review` concatenates all assets into `analysis/review.mp4` with burned-in labels:

- **Top:** `assetId | cue-N | kind | t=M:SS.ss` (`BAD_TAKE` highlighted for discarded restarts)
- **Bottom:** active vision events (informational)

Use this file to refer to footage when guiding: *“use cue-2 from img-8066 starting at ‘For a typical’”*.

### Meta cues

| kind | keepFootage | role |
|------|-------------|------|
| `content` | true | usable speech |
| `graphic_ask` | true | annotation (e.g. book title card); speech still usable |
| `idea_other_video` | true | side-quest pitch; speech still usable |
| `needs_pickup` | true | flag for re-shoot |
| `guidance` | usually true | director notes; false only when “skip this” |
| `bad_take` | **false** | aborted / superseded take (stumble then restart) |

Optional spoken markers `DO-OVER` / `RETAKE` help classification; looking-away alone does not mark a bad take.

### Guide

```bash
npm run thelma -- guide --project my-video --edit pharma-control-short \
  --notes "Remove the bad_take before the advertising line on img-8066"
# or: --notes-file story/guide-notes.md
```

Patches the edit JSON from notes + cue ids. Then re-run `cut` + `sync`.

## Packages

| Package | Role |
|---------|------|
| `@thelma/shared` | Zod schemas, platform safe-area presets |
| `@thelma/cli` | `thelma` commands |
| `@thelma/pipeline` | FFmpeg cut, review plate, remap, subtitles |
| `@thelma/scan` | Whisper + MediaPipe |
| `@thelma/graphics` | Remotion graphics + SafeFrame |
| `@thelma/video` | Remotion compositions |
| `@thelma/media-lib` | SFX / greenscreen catalog |

## Env

See `.env.example`. LLM calls go through an **OpenAI-compatible** endpoint (OpenRouter by default).
