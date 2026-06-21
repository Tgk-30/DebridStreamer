// DEV FALLBACK FIXTURES — used only when no VITE_TMDB_KEY is set, so the
// Discover screen renders fully (for a screenshot / design review) without an
// API key.
//
// These are real, well-known titles with REAL TMDB `poster_path` /
// `backdrop_path` values. The poster/backdrop IMAGES are served by
// image.tmdb.org, which needs NO API key — so they load even offline-from-the-
// API. Only the JSON catalog (which would need a key) is faked here.
//
// Shape matches `MediaPreview` (models/media.ts) exactly, including the
// `tmdb-{id}` id convention and the optional `backdropPath` for hero items.
// NOT for production — the live path (TMDBService) replaces all of this.

import type { MediaPreview } from "../models/media";

interface FixtureSeed {
  tmdbId: number;
  title: string;
  year: number;
  rating: number;
  poster: string;
  backdrop?: string;
}

function toPreview(
  seed: FixtureSeed,
  type: MediaPreview["type"],
): MediaPreview {
  return {
    id: `tmdb-${seed.tmdbId}`,
    type,
    title: seed.title,
    year: seed.year,
    posterPath: seed.poster,
    imdbRating: seed.rating,
    tmdbId: seed.tmdbId,
    backdropPath: seed.backdrop ?? null,
  };
}

// ---- Movies ----------------------------------------------------------------

const TRENDING_MOVIES: FixtureSeed[] = [
  { tmdbId: 27205, title: "Inception", year: 2010, rating: 8.4, poster: "/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg", backdrop: "/8ZTVqvKDQ8emSGUEMjsS4yHAwrp.jpg" },
  { tmdbId: 157336, title: "Interstellar", year: 2014, rating: 8.4, poster: "/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg", backdrop: "/xJHokMbljvjADYdit5fK5VQsXEG.jpg" },
  { tmdbId: 155, title: "The Dark Knight", year: 2008, rating: 8.5, poster: "/qJ2tW6WMUDux911r6m7haRef0WH.jpg", backdrop: "/dqK9Hag1054tghRQSqLSfrkvQnA.jpg" },
  { tmdbId: 603, title: "The Matrix", year: 1999, rating: 8.2, poster: "/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg", backdrop: "/icmmSD4vTTDKOq2vvdulafOGw93.jpg" },
  { tmdbId: 680, title: "Pulp Fiction", year: 1994, rating: 8.5, poster: "/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg", backdrop: "/suaEOtk1N1sgg2MTM7oZd2cfVp3.jpg" },
  { tmdbId: 550, title: "Fight Club", year: 1999, rating: 8.4, poster: "/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg", backdrop: "/hZkgoQYus5vegHoetLkCJzb17zJ.jpg" },
  { tmdbId: 13, title: "Forrest Gump", year: 1994, rating: 8.5, poster: "/arw2vcBveWOVZr6pxd9XTd1TdQa.jpg", backdrop: "/3h1JZGDhZ8nzxdgvkxha0qBqi05.jpg" },
  { tmdbId: 49026, title: "The Dark Knight Rises", year: 2012, rating: 7.8, poster: "/85cWkCVftiVs0BVey6pxX8uNmLt.jpg", backdrop: "/aSgDPmHi6sQZ5kS3FXkahnVwbZv.jpg" },
];

const POPULAR_MOVIES: FixtureSeed[] = [
  { tmdbId: 299536, title: "Avengers: Infinity War", year: 2018, rating: 8.2, poster: "/7WsyChQLEftFiDOVTGkv3hFpyyt.jpg" },
  { tmdbId: 24428, title: "The Avengers", year: 2012, rating: 7.7, poster: "/RYMX2wcKCBAr24UyPD7xwmjaTn.jpg" },
  { tmdbId: 76341, title: "Mad Max: Fury Road", year: 2015, rating: 7.6, poster: "/8tZYtuWezp8JbcsvHYO0O46tFbo.jpg" },
  { tmdbId: 335984, title: "Blade Runner 2049", year: 2017, rating: 7.5, poster: "/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg" },
  { tmdbId: 12445, title: "Harry Potter and the Deathly Hallows: Part 2", year: 2011, rating: 8.1, poster: "/c54HpQmuwXjHq2C9wmoACjxoom3.jpg" },
  { tmdbId: 286217, title: "The Martian", year: 2015, rating: 7.7, poster: "/5BHuvQ6p9kfc091Z8RiFNhCwL4b.jpg" },
  { tmdbId: 118340, title: "Guardians of the Galaxy", year: 2014, rating: 7.9, poster: "/r7vmZjiyZw9rpJMQJdXpjgiCOk9.jpg" },
  { tmdbId: 1726, title: "Iron Man", year: 2008, rating: 7.6, poster: "/78lPtwv72eTNqFW9COBYI0dWDJa.jpg" },
];

const TOP_RATED_MOVIES: FixtureSeed[] = [
  { tmdbId: 278, title: "The Shawshank Redemption", year: 1994, rating: 8.7, poster: "/9cqNxx0GxF0bflZmeSMuL5tnGzr.jpg" },
  { tmdbId: 238, title: "The Godfather", year: 1972, rating: 8.7, poster: "/3bhkrj58Vtu7enYsRolD1fZdja1.jpg" },
  { tmdbId: 240, title: "The Godfather Part II", year: 1974, rating: 8.6, poster: "/hek3koDUyRQk7FIhPXsa6mT2Zc3.jpg" },
  { tmdbId: 424, title: "Schindler's List", year: 1993, rating: 8.6, poster: "/sF1U4EUQS8YHUYjNl3pMGNIQyr0.jpg" },
  { tmdbId: 389, title: "12 Angry Men", year: 1957, rating: 8.5, poster: "/ow3wq89wM8qd5X7hWKxiRfsFf9C.jpg" },
  { tmdbId: 129, title: "Spirited Away", year: 2001, rating: 8.5, poster: "/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg" },
  { tmdbId: 19404, title: "Dilwale Dulhania Le Jayenge", year: 1995, rating: 8.5, poster: "/2CAL2433ZeIihfX1Hb2139CX0pW.jpg" },
  { tmdbId: 372058, title: "Your Name.", year: 2016, rating: 8.5, poster: "/q719jXXEzOoYaps6babgKnONONX.jpg" },
];

const NOW_PLAYING_MOVIES: FixtureSeed[] = [
  { tmdbId: 693134, title: "Dune: Part Two", year: 2024, rating: 8.2, poster: "/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg" },
  { tmdbId: 533535, title: "Deadpool & Wolverine", year: 2024, rating: 7.6, poster: "/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg" },
  { tmdbId: 1022789, title: "Inside Out 2", year: 2024, rating: 7.6, poster: "/vpnVM9B6NMmQpWeZvzLvDESb2QY.jpg" },
  { tmdbId: 940551, title: "Migration", year: 2023, rating: 7.5, poster: "/ldfCF9RhR40mppkzmftxapaHeTo.jpg" },
  { tmdbId: 787699, title: "Wonka", year: 2023, rating: 7.1, poster: "/qhb1qOilapbapxWQn9jtRCMwXJF.jpg" },
  { tmdbId: 792307, title: "Poor Things", year: 2023, rating: 7.9, poster: "/kCGlIMHnOm8JPXq3rXM6c5wMxcT.jpg" },
];

const UPCOMING_MOVIES: FixtureSeed[] = [
  { tmdbId: 519182, title: "Despicable Me 4", year: 2024, rating: 7.1, poster: "/wWba3TaojhK7NdycRhoQpsG0FaH.jpg" },
  { tmdbId: 573435, title: "Bad Boys: Ride or Die", year: 2024, rating: 7.6, poster: "/oGythE98MYleE6mZlGs5oBGkux1.jpg" },
  { tmdbId: 718821, title: "Twisters", year: 2024, rating: 7.0, poster: "/pjnD08FlAvDpBFP4iZUdNUbvanZ.jpg" },
  { tmdbId: 974576, title: "Conclave", year: 2024, rating: 7.3, poster: "/m1JzVHj8jCSttO1FmJoNTM39M5z.jpg" },
  { tmdbId: 1184918, title: "The Wild Robot", year: 2024, rating: 8.4, poster: "/wTnV3PCVW5O92JMrFvvrRcV39RU.jpg" },
  { tmdbId: 558449, title: "Gladiator II", year: 2024, rating: 6.8, poster: "/2cxhvwyEwRlysAmRH4iodkvo0z5.jpg" },
];

// ---- TV --------------------------------------------------------------------

const TRENDING_TV: FixtureSeed[] = [
  { tmdbId: 1396, title: "Breaking Bad", year: 2008, rating: 8.9, poster: "/ggFHVNu6YYI5L9pCfOacjizRGt.jpg", backdrop: "/9faGSphHrZYQz5MtBT5l4Yqfa6P.jpg" },
  { tmdbId: 1399, title: "Game of Thrones", year: 2011, rating: 8.4, poster: "/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg", backdrop: "/suopoADq0k8YZr4dQXcU6pToj6s.jpg" },
  { tmdbId: 66732, title: "Stranger Things", year: 2016, rating: 8.6, poster: "/49WJfeN0moxb9IPfGn8AIqMGskD.jpg", backdrop: "/56v2KjBlU4XaOv9rVYEQypROD7P.jpg" },
  { tmdbId: 94605, title: "Arcane", year: 2021, rating: 8.7, poster: "/fqldf2t8ztc9aiwn3k6mlX3tvRT.jpg", backdrop: "/rkB4LyZHo1NHXFEDHl9vSD9r1lI.jpg" },
  { tmdbId: 60625, title: "Rick and Morty", year: 2013, rating: 8.7, poster: "/gdIrmf2DdY5mgN6ycVP0XlzKzbE.jpg", backdrop: "/8GJsy7w7frGquw1cMAvHTGNUZ7p.jpg" },
  { tmdbId: 1668, title: "Friends", year: 1994, rating: 8.5, poster: "/2koX1xLkpTQM4IZebYvKysFW1Nh.jpg", backdrop: "/l0qVZIpXtIo7km9u5Yqh0nKPOr5.jpg" },
  { tmdbId: 82856, title: "The Mandalorian", year: 2019, rating: 8.5, poster: "/eU1i6eHXlzMOlEq0ku1Rzq7Y4wA.jpg", backdrop: "/9ijMGlJKqcslswWUzTEwScm82Gs.jpg" },
  { tmdbId: 1402, title: "The Walking Dead", year: 2010, rating: 8.1, poster: "/n8AebOJDqGucwheJh9XtkBVbtcv.jpg", backdrop: "/uro2Khv7JxlzXLNHmpkpcOLUTbT.jpg" },
];

// ---- Public fixture catalog ------------------------------------------------

export interface DiscoverFixtures {
  trendingMovies: MediaPreview[];
  trendingTV: MediaPreview[];
  popularMovies: MediaPreview[];
  topRatedMovies: MediaPreview[];
  nowPlayingMovies: MediaPreview[];
  upcomingMovies: MediaPreview[];
}

export function loadDiscoverFixtures(): DiscoverFixtures {
  return {
    trendingMovies: TRENDING_MOVIES.map((s) => toPreview(s, "movie")),
    trendingTV: TRENDING_TV.map((s) => toPreview(s, "series")),
    popularMovies: POPULAR_MOVIES.map((s) => toPreview(s, "movie")),
    topRatedMovies: TOP_RATED_MOVIES.map((s) => toPreview(s, "movie")),
    nowPlayingMovies: NOW_PLAYING_MOVIES.map((s) => toPreview(s, "movie")),
    upcomingMovies: UPCOMING_MOVIES.map((s) => toPreview(s, "movie")),
  };
}
