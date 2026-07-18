/** Invented titles for the fictional posters (poster-01…08). No real IP. */
export interface PosterInfo {
  /** 1-based poster index → /poster-0{n}.jpg */
  n: number;
  title: string;
  genre: string;
  /** maturity rating: 0 = ALL, else 7 / 13 / 16 / 18 */
  rating: number;
}

export const POSTERS: PosterInfo[] = [
  { n: 1, title: 'Night Signal', genre: 'noir thriller', rating: 16 },
  { n: 2, title: 'Ember Road', genre: 'road-trip drama', rating: 7 },
  { n: 3, title: 'Glass Harbor', genre: 'cozy mystery', rating: 0 },
  { n: 4, title: 'Sundown Parade', genre: 'animated family', rating: 0 },
  { n: 5, title: 'The Last Relay', genre: 'space opera', rating: 16 },
  { n: 6, title: 'Paper Comet', genre: 'nature doc', rating: 7 },
  { n: 7, title: 'Orbital', genre: 'sci-fi puzzle', rating: 13 },
  { n: 8, title: 'The Quiet Array', genre: 'heist', rating: 18 },
];

export const posterSrc = (n: number) => `/poster-0${n}.jpg`;

export const ratingLabel = (rating: number) => (rating === 0 ? 'ALL' : `${rating}+`);
