import type {
  Edit,
  SubtitleChunk,
  SubtitleWord,
  TranscriptWord,
} from "@thelma/shared";
import { remapAllWords } from "./remap";

export function chunkWords(
  words: TranscriptWord[],
  censorList: string[],
  maxWords = 4,
  gapThreshold = 0.35,
): SubtitleChunk[] {
  if (words.length === 0) return [];

  const censorSet = new Set(censorList.map((w) => w.toLowerCase()));
  const chunks: SubtitleChunk[] = [];
  let current: TranscriptWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({
      start: current[0]!.start,
      end: current[current.length - 1]!.end,
      words: current.map((w): SubtitleWord => {
        const text = w.word.replace(/^[^\w']+|[^\w']+$/g, "") || w.word;
        return {
          text,
          start: w.start,
          end: w.end,
          wordId: w.wordId,
          ...(censorSet.has(text.toLowerCase()) ? { censor: true } : {}),
        };
      }),
    });
    current = [];
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const prev = current[current.length - 1];

    if (prev && w.start - prev.end > gapThreshold) {
      flush();
    }

    current.push(w);

    if (current.length >= maxWords) {
      flush();
    }
  }
  flush();

  return chunks.filter((c) => c.words.some((w) => w.text.length > 0));
}

export function buildSubtitles(
  edit: Edit,
  wordsByAsset: Record<string, TranscriptWord[]>,
): SubtitleChunk[] {
  const remapped = remapAllWords(wordsByAsset, edit);
  return chunkWords(
    remapped,
    edit.subtitle.censorList,
    edit.subtitle.maxWordsPerChunk,
  );
}

/** Attach flair tags from flair cues (word-anchored) onto subtitle words. */
export function applyFlairToSubtitles(
  chunks: SubtitleChunk[],
  flairByWordId: Record<string, string>,
): SubtitleChunk[] {
  return chunks.map((chunk) => ({
    ...chunk,
    words: chunk.words.map((w) => {
      if (!w.wordId) return w;
      const flair = flairByWordId[w.wordId];
      return flair ? { ...w, flair } : w;
    }),
  }));
}
