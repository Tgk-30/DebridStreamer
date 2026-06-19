// Server-Mode subtitle source. Structurally a SubtitleClient, but every call
// goes to the self-hosted server, which holds the OpenSubtitles key and does the
// search + download + SRT->VTT decode. The player (useSubtitleTracks) treats this
// exactly like the local OpenSubtitlesClient — it gets back search rows and raw
// (VTT) subtitle text, and builds its <track> blob as usual.

import { searchServerSubtitles, fetchServerSubtitle } from "../../lib/serverApi";
import type {
  SubtitleClient,
  SubtitleSearchParams,
  SubtitleSearchResult,
} from "./OpenSubtitlesClient";

export class ServerSubtitlesClient implements SubtitleClient {
  /** The server holds the key; gating happens server-side. A missing key surfaces
   *  as a 400 (turned into a searchError by the hook), not an empty UI. */
  get hasKey(): boolean {
    return true;
  }

  async search(params: SubtitleSearchParams): Promise<SubtitleSearchResult[]> {
    return (await searchServerSubtitles(params)).results;
  }

  async download(fileId: string): Promise<string> {
    // The server returns a decoded WebVTT string; parseSubtitles auto-detects it.
    return (await fetchServerSubtitle(fileId)).vtt;
  }
}
