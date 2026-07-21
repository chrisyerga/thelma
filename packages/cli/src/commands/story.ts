import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  AssetIndexSchema,
  EditSchema,
  MetaAnalysisSchema,
  ProjectSchema,
  SlotNameSchema,
  StoryCandidatesSchema,
  TranscriptSchema,
  VisionAnalysisSchema,
  type Edit,
  type SlotName,
  type StoryCandidates,
} from "@thelma/shared";
import {
  editPath,
  projectPaths,
  transcriptPath,
  visionPath,
  metaPath,
} from "@thelma/pipeline";
import { ZodError } from "zod";
import { chatCompletion, llmConfig, parseJsonFromLlm } from "../llm.js";
import { projectRoot } from "../root.js";
import { loadProject, saveProject } from "../project.js";

const VALID_SLOTS = new Set<string>(SlotNameSchema.options);
const DEFAULT_CUE_SLOT: SlotName = "title";


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
      const dur =
        asset.durationSec != null ? `${asset.durationSec.toFixed(1)}s` : "unknown";
      console.log(`Classifying meta for ${asset.id} (${dur})…`);
      metaCues = await classifyMeta(transcript.text, transcript.words);
      await writeFile(
        metaPath(root, asset.id),
        JSON.stringify(
          MetaAnalysisSchema.parse({ assetId: asset.id, cues: metaCues }),
          null,
          2,
        ) + "\n",
      );
      const interesting = metaCues.filter((c) => c.kind !== "content");
      if (interesting.length === 0) {
        console.log("  (no non-content meta cues)");
      } else {
        for (const c of interesting) {
          const span = `${c.start.toFixed(1)}–${c.end.toFixed(1)}`;
          const detail = c.note?.trim() || c.text.trim();
          console.log(`  ${c.kind} [${span}] ${detail}`);
        }
      }
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
Rules:
- Respect project targets. Include side-quest ideas (idea_other_video / graphic_ask meta) as separate candidates when interesting.
- Prefer source-time anchors. Do not invent assetIds.
- cue.slot MUST be one of: ${SlotNameSchema.options.join(" | ")}. Never invent slots (no "statistic", "book", "drug", etc). Put semantic labels in params instead.`;

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

  let story: StoryCandidates;
  let rawResponse: string | undefined;
  let parsedBody: unknown;
  try {
    rawResponse = await chatCompletion(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { json: true },
    );

    parsedBody = parseJsonFromLlm(rawResponse);
    const body = parsedBody as { candidates?: unknown[] };
    const candidates = sanitizeSuggestedCues(body.candidates ?? []);

    story = StoryCandidatesSchema.parse({
      version: 1,
      generatedAt: new Date().toISOString(),
      model: llmConfig().model,
      candidates,
    });
  } catch (e) {
    const dumpPath = path.join(paths.story, "candidates.raw.json");
    try {
      await writeFile(
        dumpPath,
        JSON.stringify(
          {
            error: formatStoryError(e).message,
            parsed: parsedBody ?? null,
            raw: rawResponse ?? null,
          },
          null,
          2,
        ) + "\n",
      );
      console.error(`Wrote raw LLM output → ${dumpPath}`);
    } catch {
      // ignore dump failures
    }
    throw formatStoryError(e);
  }

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
      try {
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
      } catch (e) {
        console.warn(`Failed to materialize edit ${c.id}:`, formatStoryError(e).message);
      }
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
          content: `Classify transcript spans for a video editor. Return STRICT JSON only (no markdown fences):
{ "cues": [{ "kind": "content"|"guidance"|"idea_other_video"|"graphic_ask"|"needs_pickup", "start": number, "end": number, "text": string, "confidence": number, "note"?: string }] }

Rules:
- Use approximate times from the word list.
- Prefer guidance / graphic_ask / idea_other_video when the speaker is directing the edit or pitching another video.
- For idea_other_video: note MUST be a concrete standalone-video pitch (topic, angle, hook) inferred from surrounding transcript context — not vague ("references another video"). Example: "Spinoff: how little medical training covers drug efficacy vs pharma sales influence."
- For graphic_ask: note should say what on-screen graphic to make.
- Keep "text" as the spoken span; put the actionable pitch/spec in "note".`,
        },
        {
          role: "user",
          content: JSON.stringify({ text, words: words.slice(0, 300) }),
        },
      ],
      { json: true, temperature: 0.2 },
    );
    const parsed = parseJsonFromLlm(raw) as { cues?: unknown[] };
    return MetaAnalysisSchema.parse({
      assetId: "tmp",
      cues: parsed.cues ?? [],
    }).cues;
  } catch (e) {
    console.warn("Meta classification failed:", e);
    return [];
  }
}

/** Coerce LLM-invented SafeFrame slots to a valid default. */
function sanitizeSuggestedCues(candidates: unknown[]): unknown[] {
  return candidates.map((candidate) => {
    if (!candidate || typeof candidate !== "object") return candidate;
    const c = candidate as Record<string, unknown>;
    if (!Array.isArray(c.suggestedCues)) return candidate;
    return {
      ...c,
      suggestedCues: c.suggestedCues.map((cue) => {
        if (!cue || typeof cue !== "object") return cue;
        const q = cue as Record<string, unknown>;
        if (q.slot == null || VALID_SLOTS.has(String(q.slot))) return q;
        console.warn(
          `  Coerced invalid cue slot ${JSON.stringify(q.slot)} → "${DEFAULT_CUE_SLOT}" (${String(q.id ?? "?")})`,
        );
        return { ...q, slot: DEFAULT_CUE_SLOT };
      }),
    };
  });
}

function formatStoryError(e: unknown): Error {
  if (e instanceof ZodError) {
    const lines = e.issues.map(
      (issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    return new Error(
      `Story candidates failed schema validation:\n${lines.join("\n")}`,
    );
  }
  if (e instanceof Error) return e;
  return new Error(String(e));
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
