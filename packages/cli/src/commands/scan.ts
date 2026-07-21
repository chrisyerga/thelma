import { spawn } from "node:child_process";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  AssetIndexSchema,
  MetaAnalysisSchema,
  parseMetaAnalysis,
  TranscriptSchema,
} from "@thelma/shared";
import {
  projectPaths,
  transcriptPath,
  visionPath,
  metaPath,
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

  for (const asset of assets) {
    const mediaPath = path.resolve(root, asset.path);
    const tPath = transcriptPath(root, asset.id);
    const vPath = visionPath(root, asset.id);
    const mPath = metaPath(root, asset.id);

    const skipWhisperVision =
      !opts.force &&
      !opts.skipWhisper &&
      !opts.skipVision &&
      analysisUpToDate(mediaPath, [tPath, vPath]);

    if (skipWhisperVision) {
      console.log(`\nSkipping ${asset.id} (analysis up to date)`);
    } else {
      // Media changed or force: drop stale meta so we reclassify after rescan
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

      console.log(`\nScanning ${asset.id}…`);

      const args = [
        "--asset-id",
        asset.id,
        "--media",
        mediaPath,
        "--out-dir",
        paths.analysis,
      ];
      if (opts.skipVision) args.push("--skip-vision");
      if (opts.skipWhisper) args.push("--skip-whisper");

      await runPython(scanScript, args, scanPkg);
    }

    console.log(
      `  transcript: ${existsSync(tPath) ? "ok" : "missing"}`,
    );
    console.log(`  vision: ${existsSync(vPath) ? "ok" : "missing"}`);

    // Classify meta when missing/empty and transcript exists
    let cues: ReturnType<typeof parseMetaAnalysis>["cues"] = [];
    if (existsSync(mPath)) {
      try {
        cues = parseMetaAnalysis(JSON.parse(await readFile(mPath, "utf8"))).cues;
      } catch {
        cues = [];
      }
    }

    if (existsSync(tPath) && cues.length === 0) {
      const transcript = TranscriptSchema.parse(
        JSON.parse(await readFile(tPath, "utf8")),
      );
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
    } else if (!existsSync(mPath)) {
      await writeFile(
        mPath,
        JSON.stringify(
          MetaAnalysisSchema.parse({ assetId: asset.id, cues: [] }),
          null,
          2,
        ) + "\n",
      );
    } else {
      console.log(`  meta: ${cues.length} cues`);
    }
  }

  console.log("\nScan complete.");
}
