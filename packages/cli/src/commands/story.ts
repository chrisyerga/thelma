import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  AssetIndexSchema,
  EditSchema,
  MetaAnalysisSchema,
  ProjectSchema,
  StoryCandidatesSchema,
  TranscriptSchema,
  VisionAnalysisSchema,
  type Edit,
  type StoryCandidates,
} from "@thelma/shared";
import {
  editPath,
  projectPaths,
  transcriptPath,
  visionPath,
  metaPath,
} from "@thelma/pipeline";
import { chatCompletion, llmConfig } from "../llm.js";
import { projectRoot } from "../root.js";
import { loadProject, saveProject } from "../project.js";

async function readJsonSafe<T>(
  file: string,
  parse: (raw: unknown) => T,
): Promise<T | null> {
  if (!existsSync(file)) return null;
  try {
    return parse(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return null;
  }
}

export async function cmdStory(
  slug: string,
  opts: { materialize?: boolean },
): Promise<void> {
  const root = projectRoot(slug);
  const project = await loadProject(root);
  const paths = projectPaths(root);
  await mkdir(paths.story, { recursive: true });

  const index = AssetIndexSchema.parse(
    JSON.parse(await readFile(paths.analysisIndex, "utf8")),
  );

  if (index.assets.length === 0) {
    throw new Error("No assets. Import + scan first.");
  }

  type PackItem = {
    assetId: string;
    durationSec?: number;
    transcriptText: string;
    words: Array<{
      wordId: string;
      word: string;
      start: number;
      end: number;
    }>;
    visionSummary: ReturnType<typeof summarizeVision>;
    metaCues: unknown[];
  };
  const pack: PackItem[] = [];
  for (const asset of index.assets) {
    const transcript = await readJsonSafe(transcriptPath(root, asset.id), (r) =>
      TranscriptSchema.parse(r),
    );
    const vision = await readJsonSafe(visionPath(root, asset.id), (r) =>
      VisionAnalysisSchema.parse(r),
    );
    const meta = await readJsonSafe(metaPath(root, asset.id), (r) =>
      MetaAnalysisSchema.parse(r),
    );

    // Also classify verbal meta if transcript exists and meta is empty
    let metaCues = meta?.cues ?? [];
    if (transcript && metaCues.length === 0) {
      metaCues = await classifyMeta(transcript.text, transcript.words);
      await writeFile(
        metaPath(root, asset.id),
        JSON.stringify(
          MetaAnalysisSchema.parse({ assetId: asset.id, cues: metaCues }),
          null,
          2,
        ) + "\n",
      );
    }

    pack.push({
      assetId: asset.id,
      durationSec: asset.durationSec,
      transcriptText: transcript?.text ?? "",
      words: (transcript?.words ?? []).slice(0, 400).map((w) => ({
        wordId: w.wordId,
        word: w.word,
        start: w.start,
        end: w.end,
      })),
      visionSummary: summarizeVision(vision?.events ?? []),
      metaCues,
    });
  }

  const system = `You are Thelma, a sharp video editor assistant.
Given raw talking-head footage analysis, propose multiple video candidates.
Return STRICT JSON matching this shape:
{
  "candidates": [
    {
      "id": "string-slug",
      "title": "string",
      "pitch": "1-3 sentences",
      "targetId": "teaser|short|main|...",
      "maxSec": number,
      "completeness": "ready" | "needs_footage",
      "needsFootageNotes": ["..."],
      "beats": [{ "id": "b1", "summary": "...", "approxSec": 10 }],
      "suggestedTimeline": [
        { "id": "c1", "assetId": "...", "srcIn": 0, "srcOut": 5, "note": "..." }
      ],
      "suggestedCues": [
        {
          "id": "ov1",
          "kind": "overlay",
          "anchor": { "type": "srcTime", "assetId": "...", "t": 1.2 },
          "durationSec": 3,
          "generator": "TitleCard",
          "slot": "title",
          "params": {}
        }
      ],
      "graphicIdeas": ["..."],
      "sfxIdeas": ["..."]
    }
  ]
}
Respect project targets. Include side-quest ideas (idea_other_video / graphic_ask meta) as separate candidates when interesting.
Prefer source-time anchors. Do not invent assetIds.`;

  const user = JSON.stringify(
    {
      project: {
        title: project.title,
        targets: project.targets,
        platforms: project.platforms,
      },
      assets: pack,
    },
    null,
    2,
  );

  console.log(`Calling ${llmConfig().model} via OpenRouter…`);
  const raw = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { json: true },
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // try extract JSON block
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("LLM did not return JSON");
    parsed = JSON.parse(m[0]);
  }

  const body = parsed as { candidates?: unknown[] };
  const story: StoryCandidates = StoryCandidatesSchema.parse({
    version: 1,
    generatedAt: new Date().toISOString(),
    model: llmConfig().model,
    candidates: body.candidates ?? [],
  });

  await writeFile(
    path.join(paths.story, "candidates.json"),
    JSON.stringify(story, null, 2) + "\n",
  );

  const md = renderSummaryMd(project.title, story, pack);
  await writeFile(path.join(paths.story, "summary.md"), md);

  if (opts.materialize !== false) {
    for (const c of story.candidates) {
      if (c.completeness !== "ready" || c.suggestedTimeline.length === 0) {
        continue;
      }
      const assets = index.assets
        .filter((a) =>
          c.suggestedTimeline.some((t) => t.assetId === a.id),
        )
        .map((a) => ({
          id: a.id,
          path: a.path,
          durationSec: a.durationSec,
        }));

      const edit: Edit = EditSchema.parse({
        version: 1,
        id: c.id,
        title: c.title,
        fps: project.fps,
        width: project.width,
        height: project.height,
        platforms: project.platforms,
        layoutPreset: project.layoutPreset,
        assets,
        timeline: c.suggestedTimeline,
        cues: c.suggestedCues,
        subtitle: {},
        audio: {},
      });

      await writeFile(
        editPath(root, c.id),
        JSON.stringify(edit, null, 2) + "\n",
      );
      console.log(`Materialized edit ${c.id}`);
    }

    const firstReady = story.candidates.find(
      (c) => c.completeness === "ready" && c.suggestedTimeline.length > 0,
    );
    if (firstReady) {
      project.activeEditId = firstReady.id;
      await saveProject(root, ProjectSchema.parse(project));
    }
  }

  console.log(
    `Wrote ${story.candidates.length} candidates → story/candidates.json + story/summary.md`,
  );
}

async function classifyMeta(
  text: string,
  words: Array<{ wordId: string; word: string; start: number; end: number }>,
) {
  if (!text.trim()) return [];
  try {
    const raw = await chatCompletion(
      [
        {
          role: "system",
          content: `Classify transcript spans for a video editor. Return JSON:
{ "cues": [{ "kind": "content"|"guidance"|"idea_other_video"|"graphic_ask"|"needs_pickup", "start": number, "end": number, "text": string, "confidence": number, "note"?: string }] }
Use approximate times from the word list. Prefer guidance/graphic_ask/idea_other_video when the speaker is directing the edit or pitching another video.`,
        },
        {
          role: "user",
          content: JSON.stringify({ text, words: words.slice(0, 300) }),
        },
      ],
      { json: true, temperature: 0.2 },
    );
    const parsed = JSON.parse(raw) as { cues?: unknown[] };
    return MetaAnalysisSchema.parse({
      assetId: "tmp",
      cues: parsed.cues ?? [],
    }).cues;
  } catch (e) {
    console.warn("Meta classification failed:", e);
    return [];
  }
}

function summarizeVision(
  events: Array<{ type: string; start: number; end: number; confidence: number }>,
) {
  const byType: Record<string, number> = {};
  for (const e of events) {
    byType[e.type] = (byType[e.type] ?? 0) + 1;
  }
  return {
    counts: byType,
    sample: events.slice(0, 40).map((e) => ({
      type: e.type,
      start: e.start,
      end: e.end,
      confidence: e.confidence,
    })),
  };
}

function renderSummaryMd(
  title: string,
  story: StoryCandidates,
  pack: Array<{ assetId: string; transcriptText: string }>,
): string {
  const lines: string[] = [
    `# ${title} — story summary`,
    "",
    `_Generated ${story.generatedAt}${story.model ? ` · ${story.model}` : ""}_`,
    "",
  ];

  for (const c of story.candidates) {
    lines.push(`## ${c.title} (\`${c.id}\`)`);
    lines.push("");
    lines.push(`**Pitch:** ${c.pitch}`);
    lines.push("");
    lines.push(
      `- Target: ${c.targetId} (≤ ${c.maxSec}s) · Completeness: **${c.completeness}**`,
    );
    if (c.needsFootageNotes.length) {
      lines.push(`- Needs footage: ${c.needsFootageNotes.join("; ")}`);
    }
    lines.push("");
    lines.push("### Beats");
    for (const b of c.beats) {
      lines.push(`- **${b.id}**: ${b.summary}${b.approxSec ? ` (~${b.approxSec}s)` : ""}`);
    }
    if (c.graphicIdeas.length) {
      lines.push("");
      lines.push("### Graphic ideas");
      for (const g of c.graphicIdeas) lines.push(`- ${g}`);
    }
    if (c.sfxIdeas.length) {
      lines.push("");
      lines.push("### SFX ideas");
      for (const s of c.sfxIdeas) lines.push(`- ${s}`);
    }
    if (c.suggestedTimeline.length) {
      lines.push("");
      lines.push("### Suggested cut (source times)");
      for (const t of c.suggestedTimeline) {
        lines.push(
          `- \`${t.id}\` ${t.assetId} [${t.srcIn.toFixed(1)}–${t.srcOut.toFixed(1)}]${t.note ? ` — ${t.note}` : ""}`,
        );
      }
    }
    lines.push("");
  }

  lines.push("## Raw transcripts");
  lines.push("");
  for (const a of pack) {
    lines.push(`### ${a.assetId}`);
    lines.push("");
    lines.push(a.transcriptText || "_no transcript_");
    lines.push("");
  }

  return lines.join("\n");
}
