import { writeFile } from "node:fs/promises";
import {
  MetaAnalysisSchema,
  MetaCueSchema,
  type MetaCue,
  type MetaCueKind,
  type TranscriptWord,
} from "@thelma/shared";
import { metaPath } from "@thelma/pipeline";
import { chatCompletion, parseJsonFromLlm } from "./llm.js";

const CLASSIFY_SYSTEM = `Classify transcript spans for a video editor. Return STRICT JSON only (no markdown fences):
{ "cues": [{ "kind": "content"|"guidance"|"idea_other_video"|"graphic_ask"|"needs_pickup"|"bad_take", "start": number, "end": number, "text": string, "confidence": number, "note"?: string, "keepFootage"?: boolean }] }

Rules:
- Use approximate times from the word list. Cover the spoken material with non-overlapping spans where practical.
- graphic_ask / idea_other_video are ANNOTATIONS: keepFootage MUST be true. The spoken words remain usable in the cut; note carries the callout (graphic to make, or standalone-video pitch).
- For idea_other_video: note MUST be a concrete standalone-video pitch (topic, angle, hook) — not vague ("references another video").
- For graphic_ask: note should say what on-screen graphic to make. Example: book title card for "Sikkimit".
- bad_take: aborted / superseded first attempt when the speaker stumbles, pauses, then restates the same idea with different wording. Mark the FIRST (incomplete) attempt as bad_take with keepFootage false; keep the successful restart as content.
  Example: incomplete "pharmacy companies…" then restart "pharmaceutical companies don't like, they can pull their advertising" → first span is bad_take.
  Signals: semantic paraphrase of the same beat after a pause; false starts / self-corrections; optional spoken markers DO-OVER / RETAKE / DO THAT AGAIN as hard hints.
  Do NOT mark bad_take from looking-away or pause alone.
  note on bad_take: brief why (e.g. "superseded by following take").
- guidance: director notes. keepFootage false only when clearly "skip/cut this"; otherwise true.
- needs_pickup: flag for re-shoot; keepFootage true (existing take still referenceable).
- Keep "text" as the spoken span; put actionable pitch/spec in "note".
- Do not invent cue ids (the pipeline assigns cue-N).`;

/** Normalize LLM cues: ids, keepFootage defaults, bad_take forced false. */
export function normalizeMetaCues(rawCues: unknown[]): MetaCue[] {
  const sorted = [...rawCues]
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({ ...c }))
    .sort((a, b) => Number(a.start ?? 0) - Number(b.start ?? 0));

  return sorted.map((c, i) => {
    const kind = String(c.kind ?? "content") as MetaCueKind;
    let keepFootage =
      typeof c.keepFootage === "boolean" ? c.keepFootage : defaultKeepFootage(kind);
    if (kind === "bad_take") keepFootage = false;

    return MetaCueSchema.parse({
      id: `cue-${i + 1}`,
      kind,
      start: Number(c.start),
      end: Number(c.end),
      text: String(c.text ?? ""),
      confidence: typeof c.confidence === "number" ? c.confidence : 0.5,
      note: typeof c.note === "string" ? c.note : undefined,
      keepFootage,
    });
  });
}

function defaultKeepFootage(kind: MetaCueKind): boolean {
  switch (kind) {
    case "bad_take":
      return false;
    case "guidance":
      return true; // classifier may set false for skip/cut
    default:
      return true;
  }
}

export async function classifyMeta(
  text: string,
  words: TranscriptWord[],
): Promise<MetaCue[]> {
  if (!text.trim()) return [];
  try {
    const raw = await chatCompletion(
      [
        { role: "system", content: CLASSIFY_SYSTEM },
        {
          role: "user",
          content: JSON.stringify({ text, words: words.slice(0, 300) }),
        },
      ],
      { json: true, temperature: 0.2 },
    );
    const parsed = parseJsonFromLlm(raw) as { cues?: unknown[] };
    return normalizeMetaCues(parsed.cues ?? []);
  } catch (e) {
    console.warn("Meta classification failed:", e);
    return [];
  }
}

export async function classifyAndWriteMeta(
  projectRootPath: string,
  assetId: string,
  text: string,
  words: TranscriptWord[],
): Promise<MetaCue[]> {
  const cues = await classifyMeta(text, words);
  await writeFile(
    metaPath(projectRootPath, assetId),
    JSON.stringify(
      MetaAnalysisSchema.parse({ assetId, cues }),
      null,
      2,
    ) + "\n",
  );
  return cues;
}

export function logInterestingMeta(cues: MetaCue[]): void {
  const interesting = cues.filter((c) => c.kind !== "content");
  if (interesting.length === 0) {
    console.log("  (no non-content meta cues)");
    return;
  }
  for (const c of interesting) {
    const span = `${c.start.toFixed(1)}–${c.end.toFixed(1)}`;
    const keep = c.keepFootage ? "" : " keepFootage=false";
    const detail = c.note?.trim() || c.text.trim();
    console.log(`  ${c.id} ${c.kind}${keep} [${span}] ${detail}`);
  }
}
