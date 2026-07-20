import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  AssetIndexSchema,
  MetaAnalysisSchema,
} from "@thelma/shared";
import {
  projectPaths,
  transcriptPath,
  visionPath,
  metaPath,
} from "@thelma/pipeline";
import { projectRoot, repoRoot } from "../root.js";
import { loadProject } from "../project.js";

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

export async function cmdScan(
  slug: string,
  opts: { skipVision?: boolean; skipWhisper?: boolean; asset?: string },
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

    // Ensure stub meta if missing
    const mp = metaPath(root, asset.id);
    if (!existsSync(mp)) {
      await writeFile(
        mp,
        JSON.stringify(
          MetaAnalysisSchema.parse({ assetId: asset.id, cues: [] }),
          null,
          2,
        ) + "\n",
      );
    }

    console.log(
      `  transcript: ${existsSync(transcriptPath(root, asset.id)) ? "ok" : "missing"}`,
    );
    console.log(
      `  vision: ${existsSync(visionPath(root, asset.id)) ? "ok" : "missing"}`,
    );
  }

  console.log("\nScan complete.");
}
