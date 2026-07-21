import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  AssetIndexSchema,
  EditSchema,
  parseMetaAnalysis,
  TranscriptSchema,
  VisionAnalysisSchema,
  type Edit,
  type MetaCue,
  type TimelineClip,
} from "@thelma/shared";
import {
  editPath,
  metaPath,
  projectPaths,
  transcriptPath,
  visionPath,
} from "@thelma/pipeline";
import { ZodError } from "zod";
import { chatCompletion, llmConfig, parseJsonFromLlm } from "../llm.js";
import { projectRoot } from "../root.js";
import { loadEditFile, loadProject, resolveEditId, saveProject } from "../project.js";

export async function cmdGuide(
  slug: string,
  opts: { edit?: string; notes?: string; notesFile?: string },
): Promise<void> {
  const root = projectRoot(slug);
  const project = await loadProject(root);
  const paths = projectPaths(root);

  let notes = opts.notes?.trim() ?? "";
  if (opts.notesFile) {
    const p = path.isAbsolute(opts.notesFile)
      ? opts.notesFile
      : path.resolve(process.cwd(), opts.notesFile);
    if (!existsSync(p)) throw new Error(`Notes file not found: ${p}`);
    notes = (await readFile(p, "utf8")).trim();
  }
  if (!notes) {
    throw new Error("Provide --notes or --notes-file with guidance text.");
  }

  const editId = await resolveEditId(root, opts.edit);
  const edit = await loadEditFile(root, editId);

  const index = AssetIndexSchema.parse(
    JSON.parse(await readFile(paths.analysisIndex, "utf8")),
  );

  const pack = [];
  for (const asset of index.assets) {
    let metaCues: MetaCue[] = [];
    const mp = metaPath(root, asset.id);
    if (existsSync(mp)) {
      try {
        metaCues = parseMetaAnalysis(
          JSON.parse(await readFile(mp, "utf8")),
        ).cues;
      } catch {
        metaCues = [];
      }
    }

    let transcriptText = "";
    let words: Array<{ word: string; start: number; end: number }> = [];
    const tp = transcriptPath(root, asset.id);
    if (existsSync(tp)) {
      try {
        const t = TranscriptSchema.parse(JSON.parse(await readFile(tp, "utf8")));
        transcriptText = t.text;
        words = t.words.slice(0, 200).map((w) => ({
          word: w.word,
          start: w.start,
          end: w.end,
        }));
      } catch {
        // ignore
      }
    }

    let visionCounts: Record<string, number> = {};
    const vp = visionPath(root, asset.id);
    if (existsSync(vp)) {
      try {
        const v = VisionAnalysisSchema.parse(
          JSON.parse(await readFile(vp, "utf8")),
        );
        for (const e of v.events) {
          if (e.type === "face_bbox") continue;
          visionCounts[e.type] = (visionCounts[e.type] ?? 0) + 1;
        }
      } catch {
        visionCounts = {};
      }
    }

    pack.push({
      assetId: asset.id,
      durationSec: asset.durationSec,
      transcriptText,
      words,
      metaCues,
      visionCounts,
    });
  }

  const system = `You are Thelma, a video editor. Patch an existing edit JSON based on the user's notes.
Return STRICT JSON only:
{ "edit": { ...full Edit object... }, "summary": ["short bullet of each change"] }

Rules:
- Preserve edit.id, fps, width, height, platforms, layoutPreset unless notes say otherwise.
- Prefer source-time anchors. Do not invent assetIds — only use assets from the pack.
- Meta cues with keepFootage=false (including all bad_take) MUST NOT appear in timeline spans.
- graphic_ask / idea_other_video are annotations; spoken words remain usable.
- Notes may reference cue ids (cue-N), asset ids (img-8066), and phrases — honor them.
- Timeline clips need id, assetId, srcIn, srcOut; optional note.
- Keep cue.slot as one of captionBand|title|lowerThird|center|fullBleed|cornerTR|cornerTL when present.`;

  const user = JSON.stringify(
    {
      notes,
      currentEdit: edit,
      assets: pack,
    },
    null,
    2,
  );

  console.log(`Guiding edit ${editId} via ${llmConfig().model}…`);
  const raw = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { json: true, temperature: 0.3 },
  );

  let next: Edit;
  let summary: string[] = [];
  try {
    const parsed = parseJsonFromLlm(raw) as {
      edit?: unknown;
      summary?: unknown;
    };
    const editRaw = parsed.edit ?? parsed;
    next = EditSchema.parse(editRaw);
    // Keep stable id from the file we were editing
    next = { ...next, id: editId };
    if (Array.isArray(parsed.summary)) {
      summary = parsed.summary.map(String);
    }
  } catch (e) {
    const dump = path.join(paths.story, `guide-${editId}.raw.json`);
    await writeFile(
      dump,
      JSON.stringify({ error: String(e), raw }, null, 2) + "\n",
    );
    if (e instanceof ZodError) {
      throw new Error(
        `Guide produced invalid edit:\n${e.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}\nRaw → ${dump}`,
      );
    }
    throw e;
  }

  const diff = summarizeTimelineDiff(edit.timeline, next.timeline);
  await writeFile(editPath(root, editId), JSON.stringify(next, null, 2) + "\n");

  project.activeEditId = editId;
  await saveProject(root, project);

  console.log(`Updated edit ${editId}`);
  if (summary.length) {
    for (const line of summary) console.log(`  • ${line}`);
  }
  for (const line of diff) console.log(`  ${line}`);
  console.log("Run cut + sync to rebuild the plate.");
}

function summarizeTimelineDiff(
  before: TimelineClip[],
  after: TimelineClip[],
): string[] {
  const lines: string[] = [];
  const beforeIds = new Set(before.map((c) => c.id));
  const afterIds = new Set(after.map((c) => c.id));

  for (const c of after) {
    if (!beforeIds.has(c.id)) {
      lines.push(
        `+ ${c.id} ${c.assetId} [${c.srcIn.toFixed(2)}–${c.srcOut.toFixed(2)}]`,
      );
    }
  }
  for (const c of before) {
    if (!afterIds.has(c.id)) {
      lines.push(
        `- ${c.id} ${c.assetId} [${c.srcIn.toFixed(2)}–${c.srcOut.toFixed(2)}]`,
      );
    }
  }
  for (const c of after) {
    const prev = before.find((b) => b.id === c.id);
    if (
      prev &&
      (prev.assetId !== c.assetId ||
        prev.srcIn !== c.srcIn ||
        prev.srcOut !== c.srcOut)
    ) {
      lines.push(
        `~ ${c.id} ${prev.assetId} [${prev.srcIn.toFixed(2)}–${prev.srcOut.toFixed(2)}] → ${c.assetId} [${c.srcIn.toFixed(2)}–${c.srcOut.toFixed(2)}]`,
      );
    }
  }
  if (lines.length === 0) {
    lines.push("(timeline unchanged or only cue/style tweaks)");
  }
  return lines;
}
