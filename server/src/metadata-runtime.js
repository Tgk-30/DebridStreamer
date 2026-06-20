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

export function effectiveCredentialValue(db, config, profileId, provider) {
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

// Base /discover/movie params for a maturity-capped (kid) profile: US cert
// ceiling + adult off. TMDB only supports server-side certification filtering on
// /discover/movie (NOT trending/category/tv), so every kid-facing catalog call
// routes through discover-movie with these params — that's why kid browse is
// movie-only. `extra` adds sort_by / genres / page.
function capMovieParams(maturityMax, extra = {}) {
  const params = {
    language: "en-US",
    include_adult: "false",
    ...extra,
  };
  // Only emit the certification filter when there is an actual cap. A kid with no
  // cap (defended against at the schema layer, but handled here too) still gets
  // movie-only/adult-off curation, just without a cert ceiling — never the full
  // adult catalog.
  if (typeof maturityMax === "string" && maturityMax.length > 0) {
    params.certification_country = "US";
    params["certification.lte"] = maturityMax;
  }
  return params;
}

// True when this audience must see only curated (movie-only, cert-capped)
// content. Triggers for ANY kid profile OR any profile carrying a cap — so an
// is_kid profile is never served the full adult/TV catalog even if its cap is
// somehow null. The cert filter itself is applied only when a cap exists.
function isCapped(audience) {
  if (audience == null) return false;
  if (audience.isKid === true) return true;
  return typeof audience.maturityMax === "string" && audience.maturityMax.length > 0;
}

function pickHero(trendingMovies, trendingTV) {
  return (
    trendingMovies.find((item) => item.backdropPath != null && item.backdropPath.length > 0) ??
    trendingTV.find((item) => item.backdropPath != null && item.backdropPath.length > 0) ??
    null
  );
}

export async function getServerDiscoverHome(db, config, profileId, audience) {
  const service = tmdbService(db, config, profileId);
  if (isCapped(audience)) {
    // Curated, movie-only, cert-capped home. Same payload shape as the adult
    // home (the client renders the same rails); TV + upcoming are emptied and
    // every rail is a cert-filtered discover-movie query.
    const cap = audience.maturityMax;
    const [popular, family, animation, topRated] = await Promise.all([
      service.discoverWithParams("movie", capMovieParams(cap, { sort_by: "popularity.desc", page: "1" })),
      service.discoverWithParams("movie", capMovieParams(cap, { sort_by: "popularity.desc", with_genres: "10751", page: "1" })),
      service.discoverWithParams("movie", capMovieParams(cap, { sort_by: "popularity.desc", with_genres: "16", page: "1" })),
      service.discoverWithParams("movie", capMovieParams(cap, { sort_by: "vote_average.desc", "vote_count.gte": "200", page: "1" })),
    ]);
    return {
      trendingMovies: popular.items,
      trendingTV: [],
      popularMovies: family.items,
      topRatedMovies: topRated.items,
      nowPlayingMovies: animation.items,
      upcomingMovies: [],
      hero: pickHero(popular.items, []),
    };
  }
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

// Maps a (cert-uncontrolled) catalog category onto an equivalent cert-capped
// discover-movie sort, so kid category rails stay within the maturity cap.
const KID_CATEGORY_SORT = {
  trending: "popularity.desc",
  popular: "popularity.desc",
  top_rated: "vote_average.desc",
  now_playing: "primary_release_date.desc",
  upcoming: "primary_release_date.asc",
  airing_today: "popularity.desc",
  on_the_air: "popularity.desc",
};

export async function getServerCategory(db, config, profileId, input, audience) {
  const service = tmdbService(db, config, profileId);
  if (isCapped(audience)) {
    const extra = {
      sort_by: KID_CATEGORY_SORT[input.category] ?? "popularity.desc",
      page: String(input.page ?? 1),
    };
    if (input.category === "top_rated") extra["vote_count.gte"] = "200";
    return service.discoverWithParams("movie", capMovieParams(audience.maturityMax, extra));
  }
  if (input.category === "trending") {
    return service.getTrending(input.type, "week", input.page ?? 1);
  }
  return service.getCategory(input.category, input.type, input.page ?? 1);
}

export async function discoverServerMedia(db, config, profileId, input, audience) {
  const service = tmdbService(db, config, profileId);
  if (isCapped(audience)) {
    // Force movie + overwrite (not default) the cert params: a hand-crafted
    // certification.lte / type=series must not slip a kid past the cap. A kid
    // without a cap (schema-guarded, defended here too) still gets movie-only.
    const params = { ...input.params, include_adult: "false" };
    if (typeof audience.maturityMax === "string" && audience.maturityMax.length > 0) {
      params.certification_country = "US";
      params["certification.lte"] = audience.maturityMax;
    }
    return service.discoverWithParams("movie", params);
  }
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

// The US maturity certification for a title, used by the kid play-block + the
// detail/source-search cert gates. mediaId may be a TMDB id ("tmdb-NNN"/numeric)
// OR an IMDB id ("tt…", the form /api/streams/:imdbId carries) — the latter is
// resolved to a TMDB id via /find first. Returns null when no TMDB id can be
// derived (caller fail-closes → blocks); the call is wrapped in a catch upstream
// so a missing TMDB key / TMDB error also degrades to a block rather than a leak.
export async function titleCertification(db, config, profileId, mediaId, type) {
  const service = tmdbService(db, config, profileId);
  let tmdbId = tmdbIdOf({ id: mediaId });
  if (tmdbId == null && typeof mediaId === "string" && mediaId.startsWith("tt")) {
    tmdbId = await service.findByImdbId(mediaId, type);
  }
  if (tmdbId == null) return null;
  return service.getCertification(tmdbId, type);
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
