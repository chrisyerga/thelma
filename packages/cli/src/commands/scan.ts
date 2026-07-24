import { spawn } from "node:child_process";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  AssetIndexSchema,
  MetaAnalysisSchema,
  parseMetaAnalysis,
  TranscriptSchema,
  type AssetIndexEntry,
  type MediaKind,
} from "@thelma/shared";
import {
  projectPaths,
  transcriptPath,
  visionPath,
  metaPath,
  probeMedia,
  classifyMediaKind,
  durationForImport,
} from "@thelma/pipeline";
import { projectRoot, repoRoot } from "../root.js";
import { loadProject } from "../project.js";
import { classifyAndWriteMeta, logInterestingMeta } from "../meta.js";

function resolvePython(scanPkg: string): string {
  if (process.env.THELMA_PYTHON) return process.env.THELMA_PYTHON;
  const venvPy = path.join(scanPkg, ".venv", "bin", "python");
  if (existsSync(venvPy)) return venvPy;
  return "python3";
}

function runPython(
  script: string,
  args: string[],
  cwd: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const python = resolvePython(cwd);
    const child = spawn(python, [script, ...args], {
      cwd,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`scan exited with code ${code}`));
    });
  });
}

function analysisUpToDate(mediaPath: string, analysisFiles: string[]): boolean {
  if (!existsSync(mediaPath)) return false;
  if (analysisFiles.some((f) => !existsSync(f))) return false;
  const mediaMtime = statSync(mediaPath).mtimeMs;
  return analysisFiles.every((f) => statSync(f).mtimeMs >= mediaMtime);
}

async function writeEmptyTranscript(
  outPath: string,
  assetId: string,
  source: string,
): Promise<void> {
  await writeFile(
    outPath,
    JSON.stringify(
      {
        assetId,
        text: "",
        words: [],
        source,
      },
      null,
      2,
    ) + "\n",
  );
}

async function writeEmptyVision(
  outPath: string,
  assetId: string,
): Promise<void> {
  await writeFile(
    outPath,
    JSON.stringify(
      {
        assetId,
        fpsSampled: 0,
        events: [],
      },
      null,
      2,
    ) + "\n",
  );
}

async function ensureEmptyMeta(outPath: string, assetId: string): Promise<void> {
  if (existsSync(outPath)) return;
  await writeFile(
    outPath,
    JSON.stringify(
      MetaAnalysisSchema.parse({ assetId, cues: [] }),
      null,
      2,
    ) + "\n",
  );
}

async function resolveMediaKind(
  asset: AssetIndexEntry,
  mediaPath: string,
): Promise<{ kind: MediaKind; durationSec?: number }> {
  if (asset.mediaKind) {
    return { kind: asset.mediaKind, durationSec: asset.durationSec };
  }
  const probe = await probeMedia(mediaPath);
  const kind = classifyMediaKind(probe, mediaPath);
  const durationSec = durationForImport(kind, probe.durationSec, asset.durationSec);
  return { kind, durationSec };
}

export async function cmdScan(
  slug: string,
  opts: {
    skipVision?: boolean;
    skipWhisper?: boolean;
    asset?: string;
    force?: boolean;
  },
): Promise<void> {
  const root = projectRoot(slug);
  await loadProject(root);
  const paths = projectPaths(root);
  await mkdir(paths.analysis, { recursive: true });

  const index = AssetIndexSchema.parse(
    JSON.parse(await readFile(paths.analysisIndex, "utf8")),
  );

  const assets = opts.asset
    ? index.assets.filter((a) => a.id === opts.asset)
    : index.assets;

  if (assets.length === 0) {
    throw new Error("No assets to scan. Run `thelma import` first.");
  }

  const scanPkg = path.join(repoRoot(), "packages", "scan");
  const scanScript = path.join(scanPkg, "scan.py");

  if (!existsSync(scanScript)) {
    throw new Error(`Scan script not found: ${scanScript}`);
  }

  let indexDirty = false;
  const failures: Array<{ id: string; error: string }> = [];

  for (const asset of assets) {
    const mediaPath = path.resolve(root, asset.path);
    const tPath = transcriptPath(root, asset.id);
    const vPath = visionPath(root, asset.id);
    const mPath = metaPath(root, asset.id);

    try {
      if (!existsSync(mediaPath)) {
        throw new Error(`Missing media: ${mediaPath}`);
      }

      const { kind, durationSec } = await resolveMediaKind(asset, mediaPath);
      if (asset.mediaKind !== kind) {
        asset.mediaKind = kind;
        indexDirty = true;
      }
      if (
        durationSec != null &&
        (asset.durationSec == null ||
          (kind === "image" && (asset.durationSec ?? 0) < 0.5))
      ) {
        asset.durationSec = durationSec;
        indexDirty = true;
      }

      const requiredAnalysis =
        kind === "image"
          ? [tPath, vPath] // stubs count as up to date
          : kind === "audio"
            ? [tPath, vPath]
            : [tPath, vPath];

      const skipWhisperVision =
        !opts.force && analysisUpToDate(mediaPath, requiredAnalysis);

      if (skipWhisperVision) {
        console.log(`\nSkipping ${asset.id} [${kind}] (analysis up to date)`);
      } else if (kind === "image") {
        console.log(`\nScanning ${asset.id} [image] — stub analysis (no whisper/vision)`);
        if (opts.force || !existsSync(tPath)) {
          await writeEmptyTranscript(tPath, asset.id, "still-image");
        }
        if (opts.force || !existsSync(vPath)) {
          await writeEmptyVision(vPath, asset.id);
        }
        if (existsSync(mPath) && opts.force) {
          try {
            unlinkSync(mPath);
          } catch {
            // ignore
          }
        }
        await ensureEmptyMeta(mPath, asset.id);
      } else {
        if (
          opts.force ||
          (existsSync(mediaPath) &&
            existsSync(mPath) &&
            existsSync(tPath) &&
            statSync(mediaPath).mtimeMs > statSync(tPath).mtimeMs)
        ) {
          if (existsSync(mPath)) {
            try {
              unlinkSync(mPath);
            } catch {
              // ignore
            }
          }
        }

        console.log(`\nScanning ${asset.id} [${kind}]…`);

        const args = [
          "--asset-id",
          asset.id,
          "--media",
          mediaPath,
          "--out-dir",
          paths.analysis,
        ];
        const skipVision = opts.skipVision || kind === "audio";
        if (skipVision) args.push("--skip-vision");
        if (opts.skipWhisper) args.push("--skip-whisper");

        if (kind === "audio" && !opts.skipVision) {
          console.log("  (audio-only: skipping vision)");
        }

        await runPython(scanScript, args, scanPkg);

        // Audio skips vision in Python — ensure stub exists for up-to-date checks
        if (skipVision && !existsSync(vPath)) {
          await writeEmptyVision(vPath, asset.id);
        }
      }

      console.log(
        `  transcript: ${existsSync(tPath) ? "ok" : "missing"}`,
      );
      console.log(`  vision: ${existsSync(vPath) ? "ok" : "missing"}`);

      if (kind === "image") {
        console.log("  meta: skipped (still image)");
        continue;
      }

      // Classify meta when missing/empty and transcript exists
      let cues: ReturnType<typeof parseMetaAnalysis>["cues"] = [];
      if (existsSync(mPath)) {
        try {
          cues = parseMetaAnalysis(
            JSON.parse(await readFile(mPath, "utf8")),
          ).cues;
        } catch {
          cues = [];
        }
      }

      if (existsSync(tPath) && cues.length === 0) {
        const transcript = TranscriptSchema.parse(
          JSON.parse(await readFile(tPath, "utf8")),
        );
        if (transcript.text.trim()) {
          const dur =
            asset.durationSec != null
              ? `${asset.durationSec.toFixed(1)}s`
              : "unknown";
          console.log(`  Classifying meta for ${asset.id} (${dur})…`);
          const newCues = await classifyAndWriteMeta(
            root,
            asset.id,
            transcript.text,
            transcript.words,
          );
          logInterestingMeta(newCues);
        } else {
          await ensureEmptyMeta(mPath, asset.id);
          console.log("  meta: empty (no transcript text)");
        }
      } else if (!existsSync(mPath)) {
        await ensureEmptyMeta(mPath, asset.id);
      } else {
        console.log(`  meta: ${cues.length} cues`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nERROR scanning ${asset.id}: ${message}`);
      console.error("  Continuing with remaining assets…");
      failures.push({ id: asset.id, error: message });
    }
  }

  if (indexDirty) {
    await writeFile(
      paths.analysisIndex,
      JSON.stringify(index, null, 2) + "\n",
    );
  }

  if (failures.length > 0) {
    console.error(
      `\nScan finished with ${failures.length} failure(s): ${failures.map((f) => f.id).join(", ")}`,
    );
    throw new Error(
      `Scan failed for ${failures.length} asset(s): ${failures.map((f) => f.id).join(", ")}`,
    );
  }

  console.log("\nScan complete.");
}
