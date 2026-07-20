import { spawn } from "node:child_process";
import path from "node:path";
import { repoRoot } from "../root.js";

export async function cmdStudio(): Promise<void> {
  const videoDir = path.join(repoRoot(), "packages", "video");
  const remotionBin = path.join(repoRoot(), "node_modules", ".bin", "remotion");
  console.log("Launching Remotion Studio…");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(remotionBin, ["studio"], {
      cwd: videoDir,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`remotion studio exited ${code}`));
    });
  });
}
