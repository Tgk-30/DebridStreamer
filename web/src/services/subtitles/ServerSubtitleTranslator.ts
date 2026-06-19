// Server-Mode subtitle translator. Structurally a Translator, but the cue
// translation runs on the self-hosted server, which holds the AI provider key
// and reuses the same SubtitleTranslator batching logic. The player gets back
// translated cues with identical timing, exactly as in Local Mode.

import { translateServerSubtitles } from "../../lib/serverApi";
import type { SubtitleCue } from "./cues";
import type { Translator, TranslationProgress } from "./SubtitleTranslator";

export class ServerSubtitleTranslator implements Translator {
  /** The server holds the AI key; gating happens server-side. A missing key
   *  surfaces as a 400 when translate() is invoked, not by hiding the action. */
  get available(): boolean {
    return true;
  }

  async translate(
    cues: SubtitleCue[],
    targetLanguage: string,
    onProgress?: TranslationProgress,
  ): Promise<SubtitleCue[]> {
    // The server translates in one round-trip (its own batching/concurrency), so
    // progress is coarse: 0/1 -> 1/1. Keeps the player's progress UI working.
    onProgress?.(0, 1);
    const { cues: translated } = await translateServerSubtitles({ cues, targetLanguage });
    onProgress?.(1, 1);
    return translated;
  }
}
