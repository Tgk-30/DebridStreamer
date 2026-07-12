import type { DownloadRecord } from "../../storage/models";

/** Replace characters that are invalid in common filesystem path segments. */
export function sanitizePathSegment(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return cleaned.length > 0 ? cleaned : "Untitled";
}

function pathSeparator(dir: string): "/" | "\\" {
  return dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
}

function join(dir: string, ...parts: string[]): string {
  const separator = pathSeparator(dir);
  return `${dir.replace(/[\\/]+$/, "")}${separator}${parts.join(separator)}`;
}

/** Extract a safe source extension. Unknown extensions intentionally fall back
 * to mkv, the most portable container for the releases this feature targets. */
export function sourceExtension(filename: string | null | undefined): string {
  const match = /\.([a-z0-9]{2,8})(?:[?#].*)?$/i.exec(filename ?? "");
  return match?.[1]?.toLowerCase() ?? "mkv";
}

function mediaTitleAndYear(title: string): { title: string; year: string | null } {
  const match = /^(.*?)(?:\s*\((\d{4})\))\s*$/.exec(title.trim());
  return match == null
    ? { title: sanitizePathSegment(title), year: null }
    : { title: sanitizePathSegment(match[1]), year: match[2] };
}

function showTitle(record: DownloadRecord): string {
  const marker = /\s+S\d{1,2}E\d{1,2}(?:\s*(?:\u2014|-).*)?$/i;
  return sanitizePathSegment(record.title.replace(marker, ""));
}

function extensionFor(record: DownloadRecord, sourceFilename: string | null): string {
  if (record.mode === "full") return sourceExtension(sourceFilename);
  return record.optimizeProfile === "h265" ? "mp4" : "mkv";
}

/** The final organized path promised to the user. */
export function downloadDestinationPath(
  downloadsDir: string,
  record: DownloadRecord,
  sourceFilename: string | null,
): string {
  const extension = extensionFor(record, sourceFilename);
  if (record.season != null && record.episode != null) {
    const show = showTitle(record);
    const season = String(record.season).padStart(2, "0");
    const episode = String(record.episode).padStart(2, "0");
    return join(
      downloadsDir,
      show,
      `Season ${season}`,
      `${show} S${season}E${episode}.${extension}`,
    );
  }
  const parsed = mediaTitleAndYear(record.title);
  const display = parsed.year == null ? parsed.title : `${parsed.title} (${parsed.year})`;
  return join(downloadsDir, display, `${display}.${extension}`);
}

/** Optimized jobs first download a clearly-marked sibling source file. This
 * avoids asking ffmpeg to overwrite its own input, while the final destination
 * still follows the documented optimized extension convention. */
export function rawDownloadPath(
  downloadsDir: string,
  record: DownloadRecord,
  sourceFilename: string | null,
): string {
  const finalPath = downloadDestinationPath(downloadsDir, record, sourceFilename);
  if (record.mode === "full") return finalPath;
  const ext = sourceExtension(sourceFilename);
  return finalPath.replace(/\.[^.]+$/, `.source.${ext}`);
}

/** Infer the completed optimized sibling from its temporary source path. */
export function optimizedOutputPath(
  rawPath: string,
  profile: "remux" | "h265",
): string {
  const outputExtension = profile === "h265" ? "mp4" : "mkv";
  return rawPath.replace(/\.source\.[^.]+$/i, `.${outputExtension}`);
}
