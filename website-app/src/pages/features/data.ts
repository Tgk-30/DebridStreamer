/** Invented poster metadata - all titles are fictional, no real IP. */

export interface PosterMeta {
  src: string;
  title: string;
  year: number;
  rating: number;
  genre: string;
  synopsis: string;
}

export const POSTER_META: PosterMeta[] = [
  {
    src: '/debridstreamer/poster-01.jpg',
    title: 'Night Signal',
    year: 2024,
    rating: 8.1,
    genre: 'noir thriller · 1h 58m',
    synopsis: "A late-night radio host traces a broadcast that shouldn't exist - and answers it.",
  },
  {
    src: '/debridstreamer/poster-02.jpg',
    title: 'Paper Harvest',
    year: 2023,
    rating: 7.6,
    genre: 'cozy autumn mystery · 1h 44m',
    synopsis: "A small town's harvest festival hides a forty-year-old secret in the raffle drum.",
  },
  {
    src: '/debridstreamer/poster-03.jpg',
    title: 'Orbital',
    year: 2025,
    rating: 8.4,
    genre: 'space opera · 2h 21m',
    synopsis: 'Two rival salvage crews chase the same dying station - and its last awake passenger.',
  },
  {
    src: '/debridstreamer/poster-04.jpg',
    title: 'The Clockwork Sea',
    year: 2022,
    rating: 7.9,
    genre: 'animated family · 1h 37m',
    synopsis: 'A tide-locked inventor builds a boat that sails time instead of water.',
  },
  {
    src: '/debridstreamer/poster-05.jpg',
    title: 'Ember Road',
    year: 2023,
    rating: 7.7,
    genre: 'road-trip drama · 2h 04m',
    synopsis: 'Four estranged siblings, one borrowed van, three thousand miles of unfinished business.',
  },
  {
    src: '/debridstreamer/poster-06.jpg',
    title: 'The Last Relay',
    year: 2024,
    rating: 8.2,
    genre: 'heist · 1h 51m',
    synopsis: 'Retired con artists reunite for one final job: stealing back their own legend.',
  },
  {
    src: '/debridstreamer/poster-07.jpg',
    title: 'Deep Field',
    year: 2025,
    rating: 8.8,
    genre: 'nature documentary · 1h 29m',
    synopsis: 'One valley, filmed across every season for eleven years. Worth every minute.',
  },
  {
    src: '/debridstreamer/poster-08.jpg',
    title: 'Copper Noir',
    year: 2024,
    rating: 7.5,
    genre: 'sci-fi puzzle · 1h 56m',
    synopsis: "A detective wakes up inside the case she's solving - and she's the suspect.",
  },
];
