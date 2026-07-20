# Thelma

CLI-first video editing pipeline: scan → story → cut plate → Remotion polish.

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

System deps: `ffmpeg`, `ffprobe`.

## Workflow

```bash
npm run thelma -- init my-video
npm run thelma -- import --project my-video ./clip.MOV
npm run thelma -- scan --project my-video
npm run thelma -- story --project my-video
# edit projects/my-video/edits/<id>.json as needed
npm run thelma -- cut --project my-video --edit <id>
npm run thelma -- sync --project my-video
npm run thelma -- studio
npm run thelma -- render --project my-video --platform universal
# or: --platform all
```

Projects live in `projects/<slug>/` (gitignored).

## Packages

| Package | Role |
|---------|------|
| `@thelma/shared` | Zod schemas, platform safe-area presets |
| `@thelma/cli` | `thelma` commands |
| `@thelma/pipeline` | FFmpeg cut, remap, subtitles |
| `@thelma/scan` | Whisper + MediaPipe |
| `@thelma/graphics` | Remotion graphics + SafeFrame |
| `@thelma/video` | Remotion compositions |
| `@thelma/media-lib` | SFX / greenscreen catalog |

## Env

See `.env.example`. LLM calls go through an **OpenAI-compatible** endpoint (OpenRouter by default).
