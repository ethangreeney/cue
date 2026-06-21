// Shared types for the Cue app.

export type FeedbackVerdict =
  | "loved"
  | "nailed"
  | "too_obvious"
  | "too_weird"
  | "boring"
  | "not_for_me";

export interface SpotifyArtistLite {
  id: string;
  name: string;
  genres: string[];
}

export interface SpotifyTrackLite {
  id: string;
  name: string;
  artists: string[];
}

// A compact, human-readable distillation of the user's listening taste.
export interface TasteProfile {
  displayName: string;
  topArtists: string[]; // ordered, most listened first
  topGenres: string[]; // de-duplicated, weighted
  topTracks: { name: string; artist: string }[];
  recentSaves: { name: string; artist: string }[];
  recentlyPlayed: { name: string; artist: string }[]; // current rotation
  playlistPicks: { name: string; artist: string }[]; // sampled from their own playlists
  eraHint: string; // e.g. "mostly 2018-2024, some 90s"
  summary: string; // one short paragraph describing the taste
}

// What Gemini returns (before grounding against real Spotify metadata).
export interface RecommendationDraft {
  title: string;
  artist: string;
  album: string;
  year: string;
  genres: string[];
  thesis: string;
  whyForYou: string;
  whatToListenFor: string;
  aboutSong: string;
  aboutArtist: string;
  context: string;
  furtherExploration: string[];
  spotifySearchQuery: string;
}

// Real Spotify metadata used to ground a draft.
export interface SpotifyTrackMatch {
  id: string;
  uri: string;
  name: string;
  artist: string;
  album: string;
  year: string;
  durationMs: number;
  albumImage: string | null;
  spotifyUrl: string;
  previewUrl: string | null;
}

// The fully-assembled recommendation shown in the UI and persisted.
export interface Recommendation extends RecommendationDraft {
  id: string; // internal id (timestamp-based)
  createdAt: string; // ISO
  dateLabel: string; // "27 May"
  spotify: SpotifyTrackMatch | null; // null if we couldn't ground it
}

export interface FeedbackRecord {
  recommendationId: string;
  title: string;
  artist: string;
  verdict?: FeedbackVerdict; // a one-tap reaction
  note?: string; // free-text / dictated note from the listener
  at: string; // ISO
}
