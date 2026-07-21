import { cutProject } from "@thelma/pipeline";
import { projectRoot } from "../root.js";
import {
  listEditIds,
  loadEditFile,
  loadProject,
  resolveEditId,
  saveProject,
} from "../project.js";

export async function cmdCut(
  slug: string,
  editIdFlag?: string,
): Promise<void> {
  const root = projectRoot(slug);
  const project = await loadProject(root);

  if (!editIdFlag) {
    const available = await listEditIds(root);
    if (available.length === 0) {
      console.log("No edits found under edits/.");
    } else {
      console.log("Available edits:");
      for (const id of available) {
        const marker = id === project.activeEditId ? " (active)" : "";
        console.log(`  - ${id}${marker}`);
      }
    }
  }

  const editId = await resolveEditId(root, editIdFlag);
  const edit = await loadEditFile(root, editId);

  if (edit.timeline.length === 0) {
    throw new Error(
      `Edit ${editId} has an empty timeline. Add clips before cutting.`,
    );
  }

  if (!editIdFlag && project.activeEditId) {
    console.log(`Using active edit: ${editId}`);
  }

  console.log(`Cutting ${editId}…`);
  const result = await cutProject(root, edit);

  project.activeEditId = editId;
  await saveProject(root, project);

  console.log(`base: ${result.basePath}`);
  console.log(
    `duration theoretical=${result.cutMeta.durationSec.toFixed(2)}s probed=${result.cutMeta.probedDurationSec.toFixed(2)}s`,
  );
  console.log(`subs: ${result.subtitlesPath}`);
  console.log(`cues: ${result.resolvedCuesPath}`);
}
