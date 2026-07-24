import type { StreamRow } from "./streams";
import {
  AudioFormat,
  SourceType,
  VideoCodec,
  VideoQuality,
} from "../services/indexers/models";

export type PlaybackCapabilityProfile =
  | "native"
  | "browser-direct"
  | "browser-transcode";

export type SourceCompatibility =
  | "direct"
  | "native"
  | "transcode"
  | "risky";

export interface SourceSignals {
  hdr: "Dolby Vision" | "HDR10+" | "HDR10" | "HLG" | null;
  remux: boolean;
  container: "MP4" | "MKV" | "WebM" | null;
  estimatedMbps: number | null;
}

export interface SourceAssessment {
  score: number;
  compatibility: SourceCompatibility;
  signals: SourceSignals;
  reasons: string[];
  warnings: string[];
}

export interface RankedSource {
  row: StreamRow;
  assessment: SourceAssessment;
  recommended: boolean;
}

export interface SourceAssessmentContext {
  profile: PlaybackCapabilityProfile;
  runtimeMinutes?: number | null;
}

function titleToken(title: string, pattern: RegExp): boolean {
  return pattern.test(title.toLowerCase());
}

export function sourceSignals(
  row: StreamRow,
  runtimeMinutes?: number | null,
): SourceSignals {
  const title = row.result.title;
  const lower = title.toLowerCase();
  const hdr = titleToken(title, /(?:^|[^a-z0-9])(?:dv|dovi|dolby[ ._-]?vision)(?:[^a-z0-9]|$)/)
    ? "Dolby Vision"
    : titleToken(title, /hdr10\+/)
      ? "HDR10+"
      : titleToken(title, /(?:^|[^a-z0-9])hdr10(?:[^a-z0-9]|$)|(?:^|[^a-z0-9])hdr(?:[^a-z0-9]|$)/)
        ? "HDR10"
        : titleToken(title, /(?:^|[^a-z0-9])hlg(?:[^a-z0-9]|$)/)
          ? "HLG"
          : null;
  const container = /\.mp4(?:$|[\s?])|\bmp4\b/i.test(title)
    ? "MP4"
    : /\.mkv(?:$|[\s?])|\bmkv\b/i.test(title)
      ? "MKV"
      : /\.webm(?:$|[\s?])|\bwebm\b/i.test(title)
        ? "WebM"
        : null;
  const seconds =
    runtimeMinutes != null && runtimeMinutes > 0 ? runtimeMinutes * 60 : null;
  const estimatedMbps =
    seconds != null && row.result.sizeBytes > 0
      ? (row.result.sizeBytes * 8) / seconds / 1_000_000
      : null;

  return {
    hdr,
    remux: lower.includes("remux"),
    container,
    estimatedMbps,
  };
}

function compatibilityFor(
  row: StreamRow,
  profile: PlaybackCapabilityProfile,
  signals: SourceSignals,
): SourceCompatibility {
  if (profile === "native") return "native";
  // Recommendations must stay conservative. An unknown codec is not evidence
  // that a browser can decode it, and an unknown container is not evidence of
  // an MP4 byte stream.
  const browserCodec = row.result.codec === VideoCodec.h264;
  const browserContainer = signals.container === "MP4";
  const browserAudio =
    row.result.audio === AudioFormat.aac ||
    row.result.audio === AudioFormat.unknown;
  const hasDolbyVision = signals.hdr === "Dolby Vision";
  if (browserCodec && browserContainer && browserAudio && !hasDolbyVision) {
    return "direct";
  }
  if (profile === "browser-transcode" && !hasDolbyVision) return "transcode";
  return "risky";
}

export function assessSource(
  row: StreamRow,
  context: SourceAssessmentContext,
): SourceAssessment {
  const signals = sourceSignals(row, context.runtimeMinutes);
  const compatibility = compatibilityFor(row, context.profile, signals);
  const reasons: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  if (row.cachedOn != null) {
    score += 120;
    reasons.push("instant on your provider");
  } else if (row.cacheStatus === "unavailable") {
    score -= 20;
    warnings.push("cache status is unknown");
  } else {
    score -= 10;
    warnings.push("must be cached first");
  }

  if (compatibility === "native") {
    score += 65;
    reasons.push("native player compatible");
  } else if (compatibility === "direct") {
    score += 70;
    reasons.push("broad browser support");
  } else if (compatibility === "transcode") {
    score += 25;
    reasons.push("server can adapt it");
  } else {
    score -= 120;
    warnings.push("may not play on this device");
  }

  const qualityWeight: Record<string, number> = {
    [VideoQuality.uhd4k]: context.profile === "native" ? 55 : 30,
    [VideoQuality.hd1080p]: 50,
    [VideoQuality.hd720p]: 30,
    [VideoQuality.sd480p]: 10,
    [VideoQuality.sdOther]: 0,
    [VideoQuality.unknown]: -10,
  };
  score += qualityWeight[row.result.quality] ?? 0;
  if (row.result.quality !== VideoQuality.unknown) {
    reasons.push(row.result.quality);
  }

  if (row.result.source === SourceType.cam) {
    score -= 180;
    warnings.push("camera source");
  } else if (row.result.source === SourceType.webDL) {
    score += 28;
    reasons.push("WEB-DL source");
  } else if (row.result.source === SourceType.bluray) {
    score += signals.remux ? 20 : 24;
    reasons.push(signals.remux ? "lossless REMUX" : "Blu-ray source");
  } else if (row.result.source === SourceType.webRip) {
    score += 12;
  }

  if (context.profile === "native" && row.result.codec === VideoCodec.h265) score += 18;
  if (context.profile !== "native" && row.result.codec === VideoCodec.h264) score += 25;
  if (row.result.audio === AudioFormat.atmos || row.result.audio === AudioFormat.trueHD) {
    if (context.profile === "native") score += 8;
    else warnings.push("advanced audio may be converted");
  }
  if (signals.hdr === "Dolby Vision" && context.profile !== "native") {
    warnings.push("Dolby Vision needs a compatible native display path");
  } else if (signals.hdr != null) {
    reasons.push(signals.hdr);
  }
  if (signals.estimatedMbps != null) {
    if (signals.estimatedMbps > 80) {
      score -= 35;
      warnings.push("very high bitrate");
    } else if (signals.estimatedMbps > 45) {
      score -= 12;
      warnings.push("high bitrate");
    }
  }
  score += Math.min(25, Math.log2(Math.max(1, row.result.seeders + 1)) * 3);

  return {
    score,
    compatibility,
    signals,
    reasons: reasons.slice(0, 5),
    warnings: [...new Set(warnings)],
  };
}

export function rankSources(
  rows: StreamRow[],
  context: SourceAssessmentContext,
): RankedSource[] {
  const ranked = rows
    .map((row, index) => ({
      row,
      index,
      assessment: assessSource(row, context),
    }))
    .sort((left, right) =>
      right.assessment.score - left.assessment.score || left.index - right.index,
    );
  const best = ranked[0];
  const canRecommend =
    best != null &&
    best.row.cachedOn != null &&
    best.assessment.compatibility !== "risky" &&
    best.row.result.source !== SourceType.cam &&
    best.assessment.score >= 150;
  return ranked.map(({ row, assessment }, index) => ({
    row,
    assessment,
    recommended: canRecommend && index === 0,
  }));
}

export function actionableProviderError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();
  if (/\b(?:401|403)\b|invalid token|unauthori[sz]ed|expired/.test(lower)) {
    return "Your provider sign-in is no longer accepted. Reconnect it in Settings, then retry.";
  }
  if (/\b429\b|rate.?limit|too many requests/.test(lower)) {
    return "The provider rate limit was reached. Wait a minute, then retry this source.";
  }
  if (/\b(?:502|503|504)\b|busy|temporar|timed? out|timeout/.test(lower)) {
    return "The provider is temporarily busy or unreachable. Retry, or choose the next recommended source.";
  }
  if (/no files|no playable|unsupported file/.test(lower)) {
    return "This release has no playable video file for the selected title. Choose another source.";
  }
  if (/cache|downloading|queued|preparing/.test(lower)) {
    return "The provider is still preparing this release. Wait for it to finish or choose an instant source.";
  }
  return raw || "The provider could not resolve this source. Try the next recommended source.";
}
