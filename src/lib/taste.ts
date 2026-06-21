import {
  getCuratedPlaylistTracks,
  getRecentlyPlayed,
  getSavedTracks,
  getTopArtists,
  getTopTracks
} from "./spotify";
import { TasteProfile } from "./types";

type Track = { name: string; artist: string };

// Collapses tracks into a unique, order-preserving list keyed by title+artist.
function dedupeTracks(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const t of tracks) {
    const key = `${t.name.toLowerCase().trim()}|${t.artist.toLowerCase().trim()}`;
    if (!t.name.trim() || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function dedupeWeighted(lists: string[][]): string[] {
  // Earlier lists and earlier positions weigh more.
  const score = new Map<string, number>();
  lists.forEach((list, li) => {
    const listWeight = lists.length - li;
    list.forEach((item, i) => {
      const key = item.trim();
      if (!key) return;
      score.set(key, (score.get(key) ?? 0) + listWeight * (list.length - i));
    });
  });
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

function eraHint(years: string[]): string {
  const nums = years.map((y) => parseInt(y, 10)).filter((n) => !Number.isNaN(n));
  if (nums.length === 0) return "across several eras";
  nums.sort((a, b) => a - b);
  const min = nums[0];
  const max = nums[nums.length - 1];
  const recent = nums.filter((n) => n >= 2018).length;
  const fraction = recent / nums.length;
  if (fraction > 0.7) return `mostly recent (${Math.max(min, 2015)}–${max})`;
  if (fraction < 0.3) return `leans older (${min}–${max})`;
  return `a spread from ${min} to ${max}`;
}

export async function buildTasteProfile(
  token: string,
  displayName: string
): Promise<TasteProfile> {
  const [shortA, medA, longA, shortT, medT, longT, savedT, recentT, playlistT] =
    await Promise.all([
      getTopArtists(token, "short_term", 30).catch(() => []),
      getTopArtists(token, "medium_term", 30).catch(() => []),
      getTopArtists(token, "long_term", 30).catch(() => []),
      getTopTracks(token, "short_term", 30).catch(() => []),
      getTopTracks(token, "medium_term", 30).catch(() => []),
      getTopTracks(token, "long_term", 30).catch(() => []),
      getSavedTracks(token, 50).catch(() => []),
      getRecentlyPlayed(token, 50).catch(() => []),
      getCuratedPlaylistTracks(token, { maxPlaylists: 6, perPlaylist: 12 }).catch(() => [])
    ]);

  const topArtists = dedupeWeighted([
    shortA.map((a) => a.name),
    medA.map((a) => a.name),
    longA.map((a) => a.name)
  ]).slice(0, 20);

  const topGenres = dedupeWeighted([
    shortA.flatMap((a) => a.genres),
    medA.flatMap((a) => a.genres),
    longA.flatMap((a) => a.genres)
  ]).slice(0, 15);

  const asTrack = (t: { name: string; artists: string[] }): Track => ({
    name: t.name,
    artist: t.artists[0] ?? "Unknown"
  });

  // Top tracks weighted across all three windows: recent first, then dedup.
  const topTracks = dedupeTracks([
    ...shortT.map(asTrack),
    ...medT.map(asTrack),
    ...longT.map(asTrack)
  ]).slice(0, 20);

  const recentSaves = dedupeTracks(savedT.map(asTrack)).slice(0, 18);
  const recentlyPlayed = dedupeTracks(recentT.map(asTrack)).slice(0, 18);
  const playlistPicks = dedupeTracks(playlistT.map(asTrack)).slice(0, 20);

  const era = eraHint(savedT.map((t) => t.year));

  const summaryParts: string[] = [];
  if (topGenres.length) {
    summaryParts.push(`Gravitates toward ${topGenres.slice(0, 5).join(", ")}.`);
  }
  if (topArtists.length) {
    summaryParts.push(`Most-played artists include ${topArtists.slice(0, 6).join(", ")}.`);
  }
  summaryParts.push(`Listening era ${era}.`);
  const summary = summaryParts.join(" ");

  return {
    displayName,
    topArtists,
    topGenres,
    topTracks,
    recentSaves,
    recentlyPlayed,
    playlistPicks,
    eraHint: era,
    summary
  };
}
