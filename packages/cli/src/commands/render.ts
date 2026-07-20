import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PlatformIdSchema,
  type PlatformId,
} from "@thelma/shared";
import {
  buildDir,
} from "@thelma/pipeline";
import { projectRoot, repoRoot } from "../root.js";
import { loadEditFile, loadProject, resolveEditId } from "../project.js";
import { cmdSync } from "./sync.js";

function parsePlatforms(flag?: string, fromEdit?: PlatformId[]): PlatformId[] {
  if (!flag || flag === "default") {
    return fromEdit?.length ? fromEdit : ["universal"];
  }
  if (flag === "all") {
    return ["universal", "tiktok", "instagram", "facebook"];
  }
  return flag.split(",").map((p) => PlatformIdSchema.parse(p.trim()));
}

export async function cmdRender(
  slug: string,
  opts: { edit?: string; platform?: string },
): Promise<void> {
  const root = projectRoot(slug);
  await loadProject(root);
  const editId = await resolveEditId(root, opts.edit);
  const edit = await loadEditFile(root, editId);

  await cmdSync(slug, editId);

  const platforms = parsePlatforms(opts.platform, edit.platforms);
  const outDir = buildDir(root, editId);
  await mkdir(outDir, { recursive: true });

  const videoDir = path.join(repoRoot(), "packages", "video");
  const remotionBin = path.join(
    repoRoot(),
    "node_modules",
    ".bin",
    "remotion",
  );

  for (const platform of platforms) {
    const outPath = path.join(outDir, `final.${platform}.mp4`);
    const propsPath = path.join(outDir, `render-props.${platform}.json`);
    await writeFile(
      propsPath,
      JSON.stringify({ platform, showGuides: false }),
    );
    console.log(`Rendering Final (${platform}) → ${outPath}`);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        remotionBin,
        ["render", "Final", outPath, `--props=${propsPath}`],
        {
          cwd: videoDir,
          stdio: "inherit",
          env: process.env,
        },
      );
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`render exited ${code}`));
      });
    });
    console.log(`Done: ${outPath}`);
  }
}
