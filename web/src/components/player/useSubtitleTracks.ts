// Subtitle-track state for the in-webview player.
//
// Owns the list of loaded subtitle tracks (each = parsed cues + a WebVTT Blob
// URL + a delay), plus the OpenSubtitles search/download flow and AI
// translation. The player renders `<track>` elements from `tracks` and a
// captions menu driven by these actions. Everything network/AI is gated: if no
// OpenSubtitles client / AI provider is passed, the corresponding actions are
// unavailable and the UI shows a "configure key" state.
//
// Blob URLs are created lazily and revoked when a track's cues change (delay /
// translation) or the player unmounts, so we don't leak object URLs.

import { useCallback, useEffect, useRef, useState } from "react";
import type { SubtitleClient, SubtitleSearchParams, SubtitleSearchResult } from "../../services/subtitles/OpenSubtitlesClient";
import type { Translator } from "../../services/subtitles/SubtitleTranslator";
import {
  cuesToVTT,
  parseSubtitles,
  shiftCues,
  type SubtitleCue,
} from "../../services/subtitles/cues";

/** A loaded subtitle track the player can attach as a `<track>`. */
export interface SubtitleTrack {
  id: string;
  label: string;
  language: string;
  /** The ORIGINAL (delay-zero) parsed cues. The active VTT is derived from
   * these + the current delay. */
  cues: SubtitleCue[];
  /** Delay applied to the cues, in milliseconds (can be negative). */
  delayMs: number;
  /** A `blob:` URL of the current (delay-applied) WebVTT for the `<track>`. */
  vttUrl: string;
  /** True for AI-translated tracks (badge in the menu). */
  translated: boolean;
}

export interface UseSubtitleTracks {
  tracks: SubtitleTrack[];
  /** The id of the currently-shown track, or null (off). */
  activeTrackId: string | null;
  setActiveTrack: (id: string | null) => void;

  // Search
  results: SubtitleSearchResult[];
  searching: boolean;
  searchError: string | null;
  canSearch: boolean;
  search: (params: SubtitleSearchParams) => Promise<void>;

  // Loading a chosen result
  loadingFileId: string | null;
  loadResult: (result: SubtitleSearchResult) => Promise<void>;

  // Delay
  setDelay: (trackId: string, delayMs: number) => void;

  // AI translation
  canTranslate: boolean;
  translatingTrackId: string | null;
  translateProgress: { done: number; total: number } | null;
  translateTrack: (trackId: string, targetLanguage: string) => Promise<void>;
}

/** Make a Blob URL of the WebVTT for cues (delay applied). */
function makeVttUrl(cues: SubtitleCue[], delayMs: number): string {
  const vtt = cuesToVTT(delayMs === 0 ? cues : shiftCues(cues, delayMs));
  const blob = new Blob([vtt], { type: "text/vtt" });
  return URL.createObjectURL(blob);
}

export function useSubtitleTracks(
  client: SubtitleClient | null,
  translator: Translator | null,
): UseSubtitleTracks {
  const [tracks, setTracks] = useState<SubtitleTrack[]>([]);
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [results, setResults] = useState<SubtitleSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [loadingFileId, setLoadingFileId] = useState<string | null>(null);
  const [translatingTrackId, setTranslatingTrackId] = useState<string | null>(null);
  const [translateProgress, setTranslateProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  // The imdb id of the last search - forwarded to download() so a Server-Mode
  // client can enforce a kid's maturity cap on the fetched dialogue.
  const lastSearchImdbIdRef = useRef<string | null>(null);

  // Track all created object URLs so we can revoke on unmount.
  const urlsRef = useRef<Set<string>>(new Set());
  const register = useCallback((url: string) => {
    urlsRef.current.add(url);
    return url;
  }, []);
  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const u of urls) URL.revokeObjectURL(u);
      urls.clear();
    };
  }, []);

  const canSearch = client != null && client.hasKey;
  const canTranslate = translator != null && translator.available;

  const search = useCallback(
    async (params: SubtitleSearchParams) => {
      lastSearchImdbIdRef.current = params.imdbId ?? null;
      if (client == null || !client.hasKey) {
        setSearchError("Add an OpenSubtitles API key in Settings.");
        return;
      }
      setSearching(true);
      setSearchError(null);
      try {
        const rows = await client.search(params);
        setResults(rows);
        if (rows.length === 0) setSearchError("No subtitles found.");
      } catch (err) {
        setSearchError(err instanceof Error ? err.message : "Search failed.");
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [client],
  );

  const addTrack = useCallback(
    (
      partial: Omit<SubtitleTrack, "vttUrl" | "delayMs"> &
        Partial<Pick<SubtitleTrack, "delayMs">>,
    ): SubtitleTrack => {
      const delayMs = partial.delayMs ?? 0;
      const vttUrl = register(makeVttUrl(partial.cues, delayMs));
      const track: SubtitleTrack = { ...partial, delayMs, vttUrl };
      setTracks((t) => [...t, track]);
      setActiveTrackId(track.id);
      return track;
    },
    [register],
  );

  const loadResult = useCallback(
    async (result: SubtitleSearchResult) => {
      if (client == null) return;
      setLoadingFileId(result.fileId);
      try {
        const raw = await client.download(result.fileId, lastSearchImdbIdRef.current);
        const cues = parseSubtitles(raw);
        if (cues.length === 0) {
          setSearchError("Subtitle file was empty or unreadable.");
          return;
        }
        addTrack({
          id: `os-${result.fileId}`,
          label: `${result.language.toUpperCase()} · ${result.release}`.slice(0, 60),
          language: result.language,
          cues,
          translated: false,
        });
      } catch (err) {
        setSearchError(err instanceof Error ? err.message : "Download failed.");
      } finally {
        setLoadingFileId(null);
      }
    },
    [client, addTrack],
  );

  const setDelay = useCallback(
    (trackId: string, delayMs: number) => {
      setTracks((prev) =>
        prev.map((t) => {
          if (t.id !== trackId) return t;
          URL.revokeObjectURL(t.vttUrl);
          urlsRef.current.delete(t.vttUrl);
          const vttUrl = register(makeVttUrl(t.cues, delayMs));
          return { ...t, delayMs, vttUrl };
        }),
      );
    },
    [register],
  );

  const translateTrack = useCallback(
    async (trackId: string, targetLanguage: string) => {
      if (translator == null || !translator.available) return;
      const source = tracks.find((t) => t.id === trackId);
      if (source == null) return;
      setTranslatingTrackId(trackId);
      setTranslateProgress({ done: 0, total: 1 });
      try {
        const translatedCues = await translator.translate(
          source.cues,
          targetLanguage,
          (done, total) => setTranslateProgress({ done, total }),
        );
        addTrack({
          id: `${trackId}-${targetLanguage}-${Date.now()}`,
          label: `${targetLanguage} (AI) · from ${source.language.toUpperCase()}`,
          language: targetLanguage,
          cues: translatedCues,
          translated: true,
        });
      } finally {
        setTranslatingTrackId(null);
        setTranslateProgress(null);
      }
    },
    [translator, tracks, addTrack],
  );

  return {
    tracks,
    activeTrackId,
    setActiveTrack: setActiveTrackId,
    results,
    searching,
    searchError,
    canSearch,
    search,
    loadingFileId,
    loadResult,
    setDelay,
    canTranslate,
    translatingTrackId,
    translateProgress,
    translateTrack,
  };
}
