import { TMDBService } from "../../web/src/services/metadata/TMDBService.ts";
import { decryptSecret } from "./crypto.js";

const serverFetch = (url, init) => fetch(url, init);

function tmdbIdOf(preview) {
  if (typeof preview.tmdbId === "number" && Number.isFinite(preview.tmdbId)) {
    return preview.tmdbId;
  }
  if (typeof preview.id === "string" && preview.id.startsWith("tmdb-")) {
    const parsed = Number.parseInt(preview.id.slice(5), 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof preview.id === "string" && /^[0-9]+$/.test(preview.id)) {
    const parsed = Number.parseInt(preview.id, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function todayISODate(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function effectiveCredentialValue(db, config, profileId, provider) {
  const row = db.sqlite
    .prepare(
      `SELECT encrypted_value
       FROM credential_secrets
       WHERE provider = ?
         AND is_active = 1
         AND (
           (scope = 'profile' AND profile_id = ?)
           OR scope = 'server'
         )
       ORDER BY
         CASE WHEN scope = 'profile' THEN 0 ELSE 1 END,
         priority ASC,
         updated_at DESC
       LIMIT 1`,
    )
    .get(provider, profileId);
  if (row == null) return null;
  try {
    return decryptSecret(row.encrypted_value, config.secretKey);
  } catch {
    return null;
  }
}

function tmdbService(db, config, profileId) {
  const token = effectiveCredentialValue(db, config, profileId, "tmdb");
  if (token == null || token.trim().length === 0) {
    throw Object.assign(new Error("Configure a TMDB API key to use live metadata."), {
      statusCode: 400,
    });
  }
  return new TMDBService(token, serverFetch);
}

function pickHero(trendingMovies, trendingTV) {
  return (
    trendingMovies.find((item) => item.backdropPath != null && item.backdropPath.length > 0) ??
    trendingTV.find((item) => item.backdropPath != null && item.backdropPath.length > 0) ??
    null
  );
}

export async function getServerDiscoverHome(db, config, profileId) {
  const service = tmdbService(db, config, profileId);
  const [
    trendingMovies,
    trendingTV,
    popularMovies,
    topRatedMovies,
    nowPlayingMovies,
    upcomingMovies,
  ] = await Promise.all([
    service.getTrending("movie", "week"),
    service.getTrending("series", "week"),
    service.getCategory("popular", "movie"),
    service.getCategory("top_rated", "movie"),
    service.getCategory("now_playing", "movie"),
    service.getCategory("upcoming", "movie"),
  ]);
  return {
    trendingMovies: trendingMovies.items,
    trendingTV: trendingTV.items,
    popularMovies: popularMovies.items,
    topRatedMovies: topRatedMovies.items,
    nowPlayingMovies: nowPlayingMovies.items,
    upcomingMovies: upcomingMovies.items,
    hero: pickHero(trendingMovies.items, trendingTV.items),
  };
}

export async function searchServerMedia(db, config, profileId, input) {
  const service = tmdbService(db, config, profileId);
  return service.search(input.query, input.type ?? null, input.page ?? 1);
}

export async function getServerCategory(db, config, profileId, input) {
  const service = tmdbService(db, config, profileId);
  if (input.category === "trending") {
    return service.getTrending(input.type, "week", input.page ?? 1);
  }
  return service.getCategory(input.category, input.type, input.page ?? 1);
}

export async function discoverServerMedia(db, config, profileId, input) {
  const service = tmdbService(db, config, profileId);
  return service.discoverWithParams(input.type, input.params);
}

export async function getServerGenres(db, config, profileId, input) {
  const service = tmdbService(db, config, profileId);
  return { genres: await service.getGenres(input.type) };
}

async function getUpcomingEpisodes(series, service, now = Date.now()) {
  if (series.type !== "series") return [];
  const tmdbId = tmdbIdOf(series);
  if (tmdbId == null) return [];
  const today = todayISODate(now);
  try {
    const seasons = await service.getSeasons(tmdbId);
    const candidates = seasons
      .filter((season) => season.seasonNumber > 0)
      .sort((a, b) => b.seasonNumber - a.seasonNumber)
      .slice(0, 2);
    const perSeason = await Promise.all(
      candidates.map(async (season) => {
        try {
          const episodes = await service.getEpisodes(tmdbId, season.seasonNumber);
          return episodes
            .filter((episode) => episode.airDate != null && episode.airDate >= today)
            .map((episode) => ({
              series,
              seasonNumber: episode.seasonNumber,
              episodeNumber: episode.episodeNumber,
              title: episode.title ?? null,
              airDate: episode.airDate,
            }));
        } catch {
          return [];
        }
      }),
    );
    return perSeason.flat().sort((a, b) => a.airDate.localeCompare(b.airDate));
  } catch {
    return [];
  }
}

export async function getServerUpcomingEpisodes(db, config, profileId, input) {
  const service = tmdbService(db, config, profileId);
  const seen = new Set();
  const series = input.series.filter((item) => {
    if (item.type !== "series") return false;
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  const all = await Promise.all(
    series.map((item) => getUpcomingEpisodes(item, service)),
  );
  return {
    episodes: all.flat().sort((a, b) => a.airDate.localeCompare(b.airDate)),
  };
}

export async function getServerDetail(db, config, profileId, input) {
  const service = tmdbService(db, config, profileId);
  const detail = await service.getDetail(input.id, input.type);
  const tmdbId = detail.tmdbId;
  let cast = [];
  let related = [];
  if (typeof tmdbId === "number" && Number.isFinite(tmdbId)) {
    [cast, related] = await Promise.all([
      service.getCast(tmdbId, input.type).catch(() => []),
      service.getRecommendations(tmdbId, input.type).catch(() => []),
    ]);
  }
  return {
    item: detail,
    cast,
    related,
    imdbId: detail.id.startsWith("tt") ? detail.id : null,
  };
}
