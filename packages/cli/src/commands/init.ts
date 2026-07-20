import { mkdir, writeFile, copyFile, readdir } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import {
  ProjectSchema,
  type Project,
} from "@thelma/shared";
import {
  projectPaths,
  slugify,
} from "@thelma/pipeline";
import { projectRoot, templatesDir } from "../root.js";

export async function cmdInit(slugInput: string, title?: string): Promise<void> {
  const slug = slugify(slugInput);
  if (!slug) throw new Error("Invalid project slug");

  const root = projectRoot(slug);
  if (existsSync(root)) {
    throw new Error(`Project already exists: ${root}`);
  }

  const paths = projectPaths(root);
  await mkdir(paths.assetsRaw, { recursive: true });
  await mkdir(paths.assetsDerived, { recursive: true });
  await mkdir(paths.analysis, { recursive: true });
  await mkdir(paths.story, { recursive: true });
  await mkdir(paths.edits, { recursive: true });
  await mkdir(paths.build, { recursive: true });
  await mkdir(paths.studio, { recursive: true });

  const project: Project = ProjectSchema.parse({
    version: 1,
    slug,
    title: title ?? slug,
    createdAt: new Date().toISOString(),
    activeEditId: null,
  });

  await writeFile(paths.projectJson, JSON.stringify(project, null, 2) + "\n");
  await writeFile(
    paths.analysisIndex,
    JSON.stringify({ version: 1, assets: [] }, null, 2) + "\n",
  );
  await writeFile(
    path.join(paths.story, "summary.md"),
    `# ${project.title}\n\n_Run \`thelma story --project ${slug}\` after scanning._\n`,
  );
  await writeFile(
    path.join(paths.root, "README.md"),
    `# ${project.title}\n\n## Workflow\n\n\`\`\`bash\nnpm run import -- --project ${slug} ./clip.MOV\nnpm run scan -- --project ${slug}\nnpm run story -- --project ${slug}\nnpm run cut -- --project ${slug} --edit <editId>\nnpm run sync -- --project ${slug}\nnpm run studio\nnpm run render -- --project ${slug}\n\`\`\`\n`,
  );

  // Copy edit template
  const tmpl = path.join(templatesDir(), "edit.template.json");
  if (existsSync(tmpl)) {
    await copyFile(tmpl, path.join(paths.edits, "draft.json"));
  } else {
    await writeFile(
      path.join(paths.edits, "draft.json"),
      JSON.stringify(
        {
          version: 1,
          id: "draft",
          title: project.title,
          fps: 30,
          width: 1080,
          height: 1920,
          platforms: ["universal"],
          layoutPreset: "universal",
          assets: [],
          timeline: [],
          cues: [],
          subtitle: {},
          audio: {},
        },
        null,
        2,
      ) + "\n",
    );
  }

  // Optional template extras
  const tmplDir = templatesDir();
  if (existsSync(tmplDir)) {
    for (const name of await readdir(tmplDir)) {
      if (name.endsWith(".md") || name.endsWith(".json")) {
        // already handled edit template
      }
    }
  }

  console.log(`Created project ${slug} at ${root}`);
}
