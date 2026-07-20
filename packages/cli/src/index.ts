#!/usr/bin/env node
import { Command } from "commander";
import { cmdInit } from "./commands/init.js";
import { cmdImport } from "./commands/import.js";
import { cmdScan } from "./commands/scan.js";
import { cmdStory } from "./commands/story.js";
import { cmdCut } from "./commands/cut.js";
import { cmdSync } from "./commands/sync.js";
import { cmdStudio } from "./commands/studio.js";
import { cmdRender } from "./commands/render.js";
import { cmdNarrate } from "./commands/narrate.js";
import { requireProjectFlag } from "./project.js";

const program = new Command();

program
  .name("thelma")
  .description("CLI video editing pipeline")
  .version("0.1.0");

program
  .command("init")
  .argument("<slug>", "project slug")
  .option("-t, --title <title>", "display title")
  .description("Create a new project under projects/<slug>")
  .action(async (slug: string, opts: { title?: string }) => {
    await cmdInit(slug, opts.title);
  });

program
  .command("import")
  .description("Copy media into a project and register assets")
  .requiredOption("-p, --project <slug>", "project slug")
  .argument("<files...>", "media files to import")
  .action(async (files: string[], opts: { project: string }) => {
    await cmdImport(requireProjectFlag(opts.project), files);
  });

program
  .command("scan")
  .description("Transcribe + vision analysis for project assets")
  .requiredOption("-p, --project <slug>", "project slug")
  .option("--asset <id>", "scan a single asset")
  .option("--skip-vision", "skip MediaPipe vision pass")
  .option("--skip-whisper", "skip transcription")
  .action(
    async (opts: {
      project: string;
      asset?: string;
      skipVision?: boolean;
      skipWhisper?: boolean;
    }) => {
      await cmdScan(requireProjectFlag(opts.project), {
        asset: opts.asset,
        skipVision: opts.skipVision,
        skipWhisper: opts.skipWhisper,
      });
    },
  );

program
  .command("story")
  .description("OpenRouter: candidates + summary.md + draft edits")
  .requiredOption("-p, --project <slug>", "project slug")
  .option("--no-materialize", "do not write edit JSON drafts")
  .action(async (opts: { project: string; materialize?: boolean }) => {
    await cmdStory(requireProjectFlag(opts.project), {
      materialize: opts.materialize,
    });
  });

program
  .command("cut")
  .description("FFmpeg plate + remapped subs + resolved cues")
  .requiredOption("-p, --project <slug>", "project slug")
  .option("-e, --edit <id>", "edit id (default: activeEditId)")
  .action(async (opts: { project: string; edit?: string }) => {
    await cmdCut(requireProjectFlag(opts.project), opts.edit);
  });

program
  .command("sync")
  .description("Sync build artifacts into Remotion public/")
  .requiredOption("-p, --project <slug>", "project slug")
  .option("-e, --edit <id>", "edit id")
  .action(async (opts: { project: string; edit?: string }) => {
    await cmdSync(requireProjectFlag(opts.project), opts.edit);
  });

program
  .command("studio")
  .description("Open Remotion Studio")
  .action(async () => {
    await cmdStudio();
  });

program
  .command("render")
  .description("Render final video(s) with platform SafeFrame")
  .requiredOption("-p, --project <slug>", "project slug")
  .option("-e, --edit <id>", "edit id")
  .option(
    "--platform <list>",
    "universal|tiktok|instagram|facebook|all|comma-list",
    "universal",
  )
  .action(
    async (opts: { project: string; edit?: string; platform?: string }) => {
      await cmdRender(requireProjectFlag(opts.project), {
        edit: opts.edit,
        platform: opts.platform,
      });
    },
  );

program
  .command("narrate")
  .description("ElevenLabs narration → derived audio + edit cue")
  .requiredOption("-p, --project <slug>", "project slug")
  .requiredOption("--text <text>", "narration text")
  .option("-e, --edit <id>", "edit id")
  .option("--voice <id>", "ElevenLabs voice id")
  .option("--asset <id>", "asset to anchor")
  .option("--t <sec>", "source-time anchor seconds", parseFloat)
  .option("--duration <sec>", "cue duration", parseFloat)
  .action(
    async (opts: {
      project: string;
      text: string;
      edit?: string;
      voice?: string;
      asset?: string;
      t?: number;
      duration?: number;
    }) => {
      await cmdNarrate(requireProjectFlag(opts.project), {
        edit: opts.edit,
        text: opts.text,
        voiceId: opts.voice,
        assetId: opts.asset,
        t: opts.t,
        durationSec: opts.duration,
      });
    },
  );

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
