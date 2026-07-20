import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import {
  EditSchema,
  type Cue,
} from "@thelma/shared";
import {
  editPath,
  projectPaths,
} from "@thelma/pipeline";
import { projectRoot, repoRoot } from "../root.js";
import {
  loadEditFile,
  loadProject,
  resolveEditId,
} from "../project.js";

config({ path: path.join(repoRoot(), ".env") });
config({ path: path.join(repoRoot(), ".env.local") });

/**
 * Generate narration audio via ElevenLabs and attach a narration cue to the edit.
 */
export async function cmdNarrate(
  slug: string,
  opts: {
    edit?: string;
    text: string;
    voiceId?: string;
    assetId?: string;
    t?: number;
    durationSec?: number;
  },
): Promise<void> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY not set");
  }
  const voiceId =
    opts.voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";

  const root = projectRoot(slug);
  await loadProject(root);
  const editId = await resolveEditId(root, opts.edit);
  const edit = await loadEditFile(root, editId);

  const derived = projectPaths(root).assetsDerived;
  await mkdir(derived, { recursive: true });

  const narrationId = `narration-${Date.now().toString(36)}`;
  const outFile = path.join(derived, `${narrationId}.mp3`);

  console.log(`ElevenLabs TTS → ${outFile}`);
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: opts.text,
        model_id: "eleven_multilingual_v2",
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`ElevenLabs error ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(outFile, buf);

  const relativeMedia = path.relative(root, outFile);
  const mediaRef = narrationId;

  // Register in a simple narrations sidecar for Remotion staticFile mapping
  const mediaMapPath = path.join(derived, "narrations.json");
  let map: Record<string, string> = {};
  try {
    map = JSON.parse(await readFile(mediaMapPath, "utf8")) as Record<
      string,
      string
    >;
  } catch {
    map = {};
  }
  map[mediaRef] = relativeMedia;
  await writeFile(mediaMapPath, JSON.stringify(map, null, 2) + "\n");

  const assetId =
    opts.assetId ?? edit.timeline[0]?.assetId ?? edit.assets[0]?.id;
  if (!assetId) {
    throw new Error("No asset to anchor narration. Add timeline clips first.");
  }

  const cue: Cue = {
    id: narrationId,
    kind: "narration",
    anchor: {
      type: "srcTime",
      assetId,
      t: opts.t ?? 0,
    },
    durationSec: opts.durationSec ?? 5,
    mediaRef,
    params: { text: opts.text, path: relativeMedia },
  };

  edit.cues = [...edit.cues, cue];
  const next = EditSchema.parse(edit);
  await writeFile(editPath(root, editId), JSON.stringify(next, null, 2) + "\n");

  console.log(`Added narration cue ${narrationId} to edit ${editId}`);
  console.log(`Re-run cut + sync so Remotion picks up the audio.`);
}
