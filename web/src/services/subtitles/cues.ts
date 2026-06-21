// Subtitle cue parsing / conversion — PURE, no network, no DOM.
//
// Wraps `subsrt-ts` (parse/build/detect/resync) behind a small, typed surface so
// the player can: parse a downloaded SRT/SSA/VTT blob into cues, render those
// cues to a WebVTT string (for a Blob-URL `<track>`), shift timing (per-track
// delay), and batch cue text for AI translation while preserving the original
// timing. Everything here is deterministic and unit-tested — the player wires
// these into the DOM, but the logic lives here so it can be exercised without a
// browser.

import subsrt from "subsrt-ts";

/** A single parsed subtitle cue. Mirrors the subset of `subsrt-ts`'s caption
 * node we rely on: ms-based timing plus the (possibly multi-line) text. */
export interface SubtitleCue {
  /** Start time in milliseconds. */
  start: number;
  /** End time in milliseconds. */
  end: number;
  /** Cue text (may contain newlines / basic markup). */
  text: string;
}

/** The raw node shape `subsrt-ts` parse returns (caption + meta nodes). */
interface RawNode {
  type?: string;
  start?: number;
  end?: number;
  text?: string;
  content?: string;
}

/** Parse an SRT / SSA / ASS / VTT subtitle blob into normalized cues.
 *
 * Auto-detects the format. Non-caption nodes (style/meta) are dropped, as are
 * cues with non-finite or inverted timing. Returns `[]` for empty/garbage input
 * rather than throwing, so a bad download degrades gracefully. */
export function parseSubtitles(raw: string): SubtitleCue[] {
  const trimmed = raw?.trim();
  if (!trimmed) return [];
  let nodes: RawNode[];
  try {
    nodes = subsrt.parse(trimmed) as RawNode[];
  } catch {
    return [];
  }
  const cues: SubtitleCue[] = [];
  for (const n of nodes) {
    if (n.type !== "caption") continue;
    const start = typeof n.start === "number" ? n.start : NaN;
    const end = typeof n.end === "number" ? n.end : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (end < start) continue;
    const text = normalizeText(n.text ?? n.content ?? "");
    cues.push({ start, end, text });
  }
  return cues;
}

/** Collapse CR/LF to `\n` and trim trailing whitespace on each line. */
function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .trim();
}

/** Render cues to a WebVTT string suitable for a `<track>` Blob URL.
 *
 * Always emits a `WEBVTT` header. Cues are emitted in start-time order; empty
 * cues are skipped. Built via `subsrt-ts` so timestamp formatting matches the
 * spec (HH:MM:SS.mmm). */
export function cuesToVTT(cues: SubtitleCue[]): string {
  const usable = cues
    .filter((c) => c.text.trim().length > 0)
    .map((c, i) => {
      const start = Math.max(0, Math.round(c.start));
      const end = Math.max(start, Math.round(c.end));
      return {
        type: "caption" as const,
        index: i + 1,
        start,
        end,
        duration: end - start,
        text: c.text,
        content: c.text,
      };
    });
  if (usable.length === 0) return "WEBVTT\n\n";
  return subsrt.build(usable, { format: "vtt" });
}

/** Shift every cue by `deltaMs` (positive = later, negative = earlier), clamping
 * at zero so a large negative delay never produces negative timestamps. Returns
 * a new array; the input is not mutated. Used by the per-track delay control. */
export function shiftCues(cues: SubtitleCue[], deltaMs: number): SubtitleCue[] {
  if (deltaMs === 0) return cues.map((c) => ({ ...c }));
  return cues.map((c) => {
    const start = Math.max(0, c.start + deltaMs);
    const end = Math.max(start, c.end + deltaMs);
    return { start, end, text: c.text };
  });
}

/** A batch of cues handed to the translator: the cue indices (into the source
 * array) and the joined, numbered text payload. Keeping the indices lets the
 * caller stitch the translated lines back onto the original timing. */
export interface CueBatch {
  /** Indices into the source cue array, in order. */
  indices: number[];
  /** The numbered payload to translate: `[[0]] line0\n[[1]] line1 …`. */
  payload: string;
}

/** Split cues into translation batches.
 *
 * Each batch holds at most `maxLines` cues AND at most ~`maxChars` characters of
 * payload, whichever limit is hit first, so a single AI request stays within a
 * sane token budget. The payload tags each cue with a `[[i]]` marker (its index
 * within the batch) so the translated reply can be re-aligned even if the model
 * reorders or merges lines. Pure + deterministic. */
export function batchCuesForTranslation(
  cues: SubtitleCue[],
  maxLines = 40,
  maxChars = 2400,
): CueBatch[] {
  const batches: CueBatch[] = [];
  let indices: number[] = [];
  let parts: string[] = [];
  let chars = 0;

  const flush = () => {
    if (indices.length === 0) return;
    batches.push({ indices, payload: parts.join("\n") });
    indices = [];
    parts = [];
    chars = 0;
  };

  cues.forEach((cue, i) => {
    const local = indices.length;
    const line = `[[${local}]] ${cue.text.replace(/\n/g, " ⏎ ")}`;
    if (
      indices.length > 0 &&
      (indices.length >= maxLines || chars + line.length > maxChars)
    ) {
      flush();
    }
    indices.push(i);
    // Recompute the marker now that `local` reflects the (possibly reset) batch.
    parts.push(`[[${indices.length - 1}]] ${cue.text.replace(/\n/g, " ⏎ ")}`);
    chars += line.length;
  });
  flush();
  return batches;
}

/** Parse a translator reply back into per-marker lines.
 *
 * The reply is expected to echo the `[[i]]` markers; we map each marker to its
 * text. Lines without a marker are appended to the previous marker (models
 * sometimes wrap). Returns a sparse map keyed by the batch-local index. The
 * `⏎` line-break sentinel is converted back to a real newline. */
export function parseTranslationReply(reply: string): Map<number, string> {
  const out = new Map<number, string>();
  let current: number | null = null;
  for (const rawLine of reply.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const m = line.match(/^\s*\[\[(\d+)\]\]\s?(.*)$/);
    if (m) {
      current = Number.parseInt(m[1], 10);
      out.set(current, restoreBreaks(m[2]));
    } else if (current != null && line.trim().length > 0) {
      const prev = out.get(current) ?? "";
      out.set(current, (prev + "\n" + restoreBreaks(line.trim())).trim());
    }
  }
  return out;
}

function restoreBreaks(text: string): string {
  return text.replace(/\s*⏎\s*/g, "\n").trim();
}

/** Apply a translated-text map (keyed by source-cue index) onto the source
 * cues, producing a new cue array with the same timing and the translated text
 * where available (falling back to the original where a translation is missing).
 * Pure; used after all batches resolve. */
export function applyTranslations(
  cues: SubtitleCue[],
  translations: Map<number, string>,
): SubtitleCue[] {
  return cues.map((c, i) => {
    const t = translations.get(i);
    return t != null && t.trim().length > 0
      ? { start: c.start, end: c.end, text: t }
      : { ...c };
  });
}
