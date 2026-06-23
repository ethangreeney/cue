import { generateRecommendationDraft, generateRecommendationDrafts } from "./gemini";
import { findTrack } from "./spotify";
import { Session } from "./session";
import { buildTasteProfile } from "./taste";
import {
  FeedbackRecord,
  Lane,
  LANE_ORDER,
  Recommendation,
  RecommendationDraft,
  TasteProfile
} from "./types";

function dateLabel(d: Date): string {
  const day = d.getDate();
  const month = d.toLocaleString("en-US", { month: "short" });
  return `${day} ${month}`;
}

// Session memory the client sends with each request. Nothing is persisted
// server-side — when the tab is closed, this is gone.
export interface SessionMemory {
  history?: { title: string; artist: string }[]; // songs already shown this session
  feedback?: FeedbackRecord[]; // reactions given this session
}

// Builds taste, asks Gemini for one song, grounds it against real Spotify
// metadata, and returns the assembled recommendation. Stateless: any memory of
// what's been shown or how the listener reacted is passed in, never stored.
export async function createRecommendation(
  session: Session,
  memory: SessionMemory = {}
): Promise<Recommendation> {
  const taste = await buildTasteProfile(session.accessToken, session.displayName);

  // Everything ever recommended is the permanent exclusion set — a song shown
  // once never comes back. We hard-filter against the full list, but only feed
  // a recent slice into the prompt so token cost stays bounded as it grows.
  const history = memory.history ?? [];
  const promptHistory = history.slice(-60);
  const feedback = (memory.feedback ?? []).slice(-8);

  const seen = new Set(history.map((h) => `${h.title}|${h.artist}`.toLowerCase()));
  // Also exclude what the listener already knows — discovery is the point.
  for (const fp of knownTrackFingerprints(taste)) seen.add(fp);
  const isRepeat = (d: { title: string; artist: string }) =>
    seen.has(`${d.title}|${d.artist}`.toLowerCase());

  // Generate, then verify the song actually exists on Spotify. A pick that
  // can't be grounded is treated as a miss and we ask for another — we never
  // show the wrong track. We keep the first non-repeat draft as an honest
  // fallback in case nothing grounds.
  let draft = await generateRecommendationDraft(taste, promptHistory, feedback);
  let match = await findTrack(session.accessToken, {
    title: draft.title,
    artist: draft.artist,
    rawQuery: draft.spotifySearchQuery
  });
  let fallbackDraft = isRepeat(draft) ? null : draft;

  let attempts = 0;
  while (attempts < 4 && (!match || isRepeat(draft))) {
    draft = await generateRecommendationDraft(taste, promptHistory, feedback);
    match = await findTrack(session.accessToken, {
      title: draft.title,
      artist: draft.artist,
      rawQuery: draft.spotifySearchQuery
    });
    if (!fallbackDraft && !isRepeat(draft)) fallbackDraft = draft;
    if (match && !isRepeat(draft)) break;
    attempts++;
  }

  // If we never grounded a non-repeat pick, fall back to an honest ungrounded
  // draft (UI shows a tasteful cover + a Spotify search link, no fake data).
  if (!match || isRepeat(draft)) {
    draft = fallbackDraft ?? draft;
    match = await findTrack(session.accessToken, {
      title: draft.title,
      artist: draft.artist,
      rawQuery: draft.spotifySearchQuery
    });
  }

  const now = new Date();
  const rec: Recommendation = {
    ...draft,
    // Prefer real Spotify metadata where we have it.
    album: match?.album || draft.album,
    year: originalYear(draft.year, match?.year),
    // The on-demand single pick is, by definition, a dead-center "Very you" pick.
    lane: "core",
    id: `${now.getTime()}`,
    createdAt: now.toISOString(),
    dateLabel: dateLabel(now),
    spotify: match
  };

  return rec;
}

const fingerprint = (d: { title: string; artist: string }) =>
  `${d.title}|${d.artist}`.toLowerCase();

const artistKey = (d: { artist: string }) => d.artist.trim().toLowerCase();

// The year we show is the song's ORIGINAL release. Grounding often matches a
// later reissue or compilation (e.g. a mid-80s single landing on a 2013 "best
// of"), whose year would contradict the era the story describes. The model's
// year tracks that era, so we take the EARLIER of the two valid years — the
// original always predates the reissue — and fall back to whichever we have.
const originalYear = (modelYear?: string, groundedYear?: string): string => {
  const valid = [modelYear, groundedYear]
    .map((y) => (y || "").trim())
    .filter((y) => /^\d{4}$/.test(y))
    .map((y) => parseInt(y, 10));
  if (valid.length) return String(Math.min(...valid));
  return (modelYear || groundedYear || "").trim();
};

// The listener's own library — top tracks, saved songs, current rotation, and
// playlist picks. These are songs they ALREADY KNOW, so we hard-exclude them:
// any pick that matches one is treated as a repeat and re-rolled. The prompt is
// told the same thing; this is the safety net for when the model reaches for a
// known song anyway.
const knownTrackFingerprints = (taste: TasteProfile): string[] =>
  [
    ...taste.topTracks,
    ...taste.recentSaves,
    ...taste.recentlyPlayed,
    ...taste.playlistPicks
  ].map((t) => `${t.name}|${t.artist}`.toLowerCase());

const normalizeLane = (l?: string): Lane | null => {
  const v = (l ?? "").toLowerCase();
  return v === "core" || v === "stretch" || v === "outer" ? (v as Lane) : null;
};

// Generates the day's picks as a SPECTRUM: one song per lane — "core" (Very
// you), "stretch" (A bit further), "outer" (Left field) — in that fixed order.
// ONE Gemini call returns all three at once, each tagged with its lane so the
// order survives grounding. We dedupe against permanent history and each other,
// ground every pick against a real Spotify track in parallel, and do AT MOST
// one top-up batch for any lane that didn't ground. `groundingToken` may be the
// listener's token (on-demand) or an app-level token (the cron).
export async function createDailyPicks(opts: {
  taste: TasteProfile;
  history: { title: string; artist: string }[];
  feedback: FeedbackRecord[];
  groundingToken: string;
  count: number;
}): Promise<Recommendation[]> {
  const { taste, groundingToken, count } = opts;
  const lanes = LANE_ORDER.slice(0, count);
  const history = opts.history ?? [];
  // Feed a wide exclusion window into the prompt so the model actually avoids
  // what we'd otherwise reject — the mismatch between a short prompt list and a
  // long hard-exclusion set is what used to starve the picks down to one.
  const promptHistory = history.slice(-200);
  const feedback = (opts.feedback ?? []).slice(-8);

  const seen = new Set(history.map(fingerprint));
  // Also exclude the listener's own library — a pick they already know is a
  // failed discovery, so it's filtered out and the lane is re-rolled.
  for (const fp of knownTrackFingerprints(taste)) seen.add(fp);
  const usedArtists = new Set<string>();
  type Pick = { lane: Lane; draft: RecommendationDraft; match: Awaited<ReturnType<typeof findTrack>> };
  // A lane is "solid" once it has a grounded pick; ungrounded picks are kept
  // only as honest fallbacks (UI shows a tasteful cover + Spotify search link).
  const solid = new Map<Lane, Pick>();
  const fallback = new Map<Lane, Pick>();

  const ground = (d: RecommendationDraft) =>
    findTrack(groundingToken, { title: d.title, artist: d.artist, rawQuery: d.spotifySearchQuery }).catch(
      () => null
    );

  // Ask for one pick per still-open lane, ground them all in parallel, and slot
  // each into its lane. We trust the model's lane tag but fall back to the
  // requested order if it mislabels, so positions never collapse.
  const harvest = async (want: Lane[]): Promise<void> => {
    if (!want.length) return;
    const drafts = await generateRecommendationDrafts(taste, promptHistory, feedback, want);
    const matches = await Promise.all(drafts.map((d) => (d && d.title && d.artist ? ground(d) : null)));
    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i];
      if (!d || !d.title || !d.artist) continue;
      let lane = normalizeLane(d.lane);
      if (!lane || !want.includes(lane)) lane = want[Math.min(i, want.length - 1)];
      if (solid.has(lane)) continue; // lane already locked in
      const fp = fingerprint(d);
      if (seen.has(fp) || usedArtists.has(artistKey(d))) continue; // keep the set distinct
      const match = matches[i];
      if (match) {
        solid.set(lane, { lane, draft: d, match });
        seen.add(fp);
        usedArtists.add(artistKey(d));
      } else if (!fallback.has(lane)) {
        fallback.set(lane, { lane, draft: d, match: null });
      }
    }
  };

  await harvest(lanes);
  const missing = lanes.filter((l) => !solid.has(l));
  if (missing.length) await harvest(missing);

  const now = new Date();
  const base = now.getTime();
  return lanes
    .map((lane) => solid.get(lane) ?? fallback.get(lane))
    .filter((p): p is Pick => Boolean(p))
    .map(({ lane, draft, match }, i) => ({
      ...draft,
      album: match?.album || draft.album,
      year: originalYear(draft.year, match?.year),
      lane,
      id: `${base}-${i}`,
      createdAt: now.toISOString(),
      dateLabel: dateLabel(now),
      spotify: match
    }));
}
