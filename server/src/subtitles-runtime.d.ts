import type { AppDatabase } from "./db.js";
import type { ServerConfig } from "./types.js";

interface SubtitleSearchInput {
  imdbId?: string | null;
  query?: string | null;
  season?: number | null;
  episode?: number | null;
  languages?: string[];
}

interface SubtitleCueInput {
  start: number;
  end: number;
  text: string;
}

export function searchServerSubtitles(
  db: AppDatabase,
  config: ServerConfig,
  profileId: string,
  params: SubtitleSearchInput,
): Promise<unknown[]>;

/** Resolves a file id to a decoded WebVTT string. */
export function fetchServerSubtitle(
  db: AppDatabase,
  config: ServerConfig,
  profileId: string,
  fileId: string,
): Promise<string>;

export function translateServerSubtitle(
  db: AppDatabase,
  config: ServerConfig,
  profileId: string,
  body: { cues: SubtitleCueInput[]; targetLanguage: string },
): Promise<{ providerKind: string; cues: SubtitleCueInput[] }>;
