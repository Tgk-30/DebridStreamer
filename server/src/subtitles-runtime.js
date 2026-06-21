// Server-side subtitles so OpenSubtitles search/download + AI translate work in
// Server Mode (the OpenSubtitles + AI keys live on the server; the browser can't
// read them back). Reuses the browser subtitle client, the pure cue parser
// (subsrt-ts), and the AI translator verbatim through the esbuild/tsx shim — so
// behavior matches the local app exactly.
//
// The /fetch route normalizes the downloaded subtitle to a WebVTT STRING
// server-side; the client treats it as "raw subtitle text" exactly as today
// (parseSubtitles auto-detects VTT), so the player's <track>/blob path is
// unchanged.

import {
  OpenSubtitlesClient,
  OpenSubtitlesError,
} from "../../web/src/services/subtitles/OpenSubtitlesClient.ts";
import { parseSubtitles, cuesToVTT } from "../../web/src/services/subtitles/cues.ts";
import { SubtitleTranslator } from "../../web/src/services/subtitles/SubtitleTranslator.ts";
import { effectiveCredentialValue } from "./metadata-runtime.js";
import { selectAICredential, makeAIFetch } from "./ai-runtime.js";
import { fetchUpstreamSafely } from "./ssrf.js";

const SUBTITLE_TIMEOUT_MS = 20_000;

/** A FetchImpl (per web/src/lib/http.ts) backed by global fetch with a hard
 *  timeout so a hung CDN can't pin a worker. The body is buffered so the timeout
 *  covers the full read; undici transparently decompresses gzip before text().
 *
 *  SSRF: the file-download GET targets a CDN URL the OpenSubtitles API returns in
 *  its response body (not a fixed constant), so — like the debrid stream proxy —
 *  it's routed through fetchUpstreamSafely, which refuses private/reserved
 *  addresses and re-validates every redirect hop. `allowPrivate` mirrors the
 *  operator's raw-URLs switch so loopback/LAN dev setups still work. The POST to
 *  /download only ever hits the fixed, pinned api.opensubtitles.com host, so it
 *  stays a plain fetch (and fetchUpstreamSafely can't carry a POST body). */
function makeSubtitleFetch(allowPrivate) {
  return async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUBTITLE_TIMEOUT_MS);
    try {
      const response =
        method === "GET"
          ? await fetchUpstreamSafely(
              url,
              { method, headers: init?.headers ?? {}, signal: controller.signal },
              allowPrivate,
            )
          : await fetch(url, { ...init, signal: controller.signal });
      const bodyText = await response.text();
      return { status: response.status, text: async () => bodyText };
    } finally {
      clearTimeout(timer);
    }
  };
}

function osClient(db, config, profileId) {
  const key = effectiveCredentialValue(db, config, profileId, "opensubtitles");
  if (key == null || key.trim().length === 0) {
    throw Object.assign(
      new Error("Configure an OpenSubtitles API key in Settings to search and download subtitles."),
      { statusCode: 400 },
    );
  }
  return new OpenSubtitlesClient(key.trim(), makeSubtitleFetch(config.allowRawStreamUrls));
}

/** Map an OpenSubtitles failure to a clean HTTP error. A rejected key surfaces
 *  as 400 (actionable); anything else is a generic 502 (no upstream-detail leak,
 *  and never the client's raw status — which can be 0 for "missing key"). */
function mapOsError(err, fallbackMessage) {
  if (err instanceof OpenSubtitlesError && err.status === 401) {
    return Object.assign(new Error("The OpenSubtitles API key was rejected."), { statusCode: 400 });
  }
  return Object.assign(new Error(fallbackMessage), { statusCode: 502 });
}

export async function searchServerSubtitles(db, config, profileId, params) {
  const client = osClient(db, config, profileId);
  try {
    return await client.search({
      imdbId: params.imdbId ?? null,
      query: params.query ?? null,
      season: params.season ?? null,
      episode: params.episode ?? null,
      languages: params.languages,
    });
  } catch (err) {
    throw mapOsError(err, "The subtitle search request failed.");
  }
}

export async function fetchServerSubtitle(db, config, profileId, fileId) {
  const client = osClient(db, config, profileId);
  let raw;
  try {
    raw = await client.download(fileId);
  } catch (err) {
    throw mapOsError(err, "The subtitle download failed.");
  }
  const cues = parseSubtitles(raw);
  if (cues.length === 0) {
    throw Object.assign(new Error("The subtitle file was empty or unreadable."), { statusCode: 422 });
  }
  return cuesToVTT(cues);
}

/** Build a TranslatorConfig from the resolved AI credential. For ollama the
 *  value is the endpoint; for cloud providers it's the API key. Empty model →
 *  the translator's per-provider default. */
function translatorConfigFor(sel) {
  if (sel.kind === "ollama") {
    return { provider: "ollama", apiKey: "", model: "", ollamaEndpoint: sel.value };
  }
  return { provider: sel.kind, apiKey: sel.value, model: "", ollamaEndpoint: "" };
}

export async function translateServerSubtitle(db, config, profileId, body) {
  const sel = selectAICredential(db, config, profileId);
  if (sel == null) {
    throw Object.assign(
      new Error("Configure an AI provider key in Settings to translate subtitles."),
      { statusCode: 400 },
    );
  }
  // Reuse the same SSRF stance as the AI routes: cloud providers unguarded
  // (fixed hosts), the user-supplied Ollama endpoint guarded.
  const fetchImpl =
    sel.kind === "ollama" ? makeAIFetch({ allowPrivate: config.allowRawStreamUrls }) : makeAIFetch(null);
  const translator = new SubtitleTranslator(translatorConfigFor(sel), fetchImpl);
  // translate() is best-effort: failed batches keep their original text rather
  // than throwing, so a flaky provider degrades instead of 500-ing.
  const cues = await translator.translate(body.cues, body.targetLanguage);
  return { providerKind: sel.kind, cues };
}
