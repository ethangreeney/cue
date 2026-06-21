import { generateRecommendationDraft, generateRecommendationDrafts } from "./gemini";
import { findTrack } from "./spotify";
import { Session } from "./session";
import { buildTasteProfile } from "./taste";
import { FeedbackRecord, Recommendation, RecommendationDraft, TasteProfile } from "./types";

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
    year: match?.year || draft.year,
    id: `${now.getTime()}`,
    createdAt: now.toISOString(),
    dateLabel: dateLabel(now),
    spotify: match
  };

  return rec;
}

const fingerprint = (d: { title: string; artist: string }) =>
  `${d.title}|${d.artist}`.toLowerCase();

// Generates a full day's worth of picks. ONE Gemini call returns several
// DISTINCT songs at once (far cheaper and more varied than firing N near-
// identical prompts, which collapse onto the same canonical tracks). We dedupe
// against the permanent history and each other, ground each against a real
// Spotify track in parallel, and do AT MOST one top-up batch if the first came
// up short. `groundingToken` may be the listener's token (on-demand) or an
// app-level token (the cron).
export async function createDailyPicks(opts: {
  taste: TasteProfile;
  history: { title: string; artist: string }[];
  feedback: FeedbackRecord[];
  groundingToken: string;
  count: number;
}): Promise<Recommendation[]> {
  const { taste, groundingToken, count } = opts;
  const history = opts.history ?? [];
  // Feed a wide exclusion window into the prompt so the model actually avoids
  // what we'd otherwise reject — the mismatch between a short prompt list and a
  // long hard-exclusion set is what used to starve the picks down to one.
  const promptHistory = history.slice(-200);
  const feedback = (opts.feedback ?? []).slice(-8);

  const seen = new Set(history.map(fingerprint));
  const chosen: { draft: RecommendationDraft; match: Awaited<ReturnType<typeof findTrack>> }[] = [];

  const ground = (d: RecommendationDraft) =>
    findTrack(groundingToken, { title: d.title, artist: d.artist, rawQuery: d.spotifySearchQuery }).catch(
      () => null
    );

  // Pull a batch, ground it all in parallel, and keep the distinct ones —
  // grounded first, ungrounded only to fill. Returns how many we added.
  const harvest = async (want: number): Promise<number> => {
    const drafts = (await generateRecommendationDrafts(taste, promptHistory, feedback, want)).filter(
      (d) => d && d.title && d.artist && !seen.has(fingerprint(d))
    );
    // De-dupe within the batch itself before we spend grounding calls on it.
    const distinct: RecommendationDraft[] = [];
    const batchSeen = new Set<string>();
    for (const d of drafts) {
      const fp = fingerprint(d);
      if (batchSeen.has(fp)) continue;
      batchSeen.add(fp);
      distinct.push(d);
    }
    const grounded = await Promise.all(distinct.map(ground));
    const before = chosen.length;
    for (let i = 0; i < distinct.length && chosen.length < count; i++) {
      if (grounded[i]) {
        seen.add(fingerprint(distinct[i]));
        chosen.push({ draft: distinct[i], match: grounded[i] });
      }
    }
    for (let i = 0; i < distinct.length && chosen.length < count; i++) {
      if (!grounded[i] && !seen.has(fingerprint(distinct[i]))) {
        seen.add(fingerprint(distinct[i]));
        chosen.push({ draft: distinct[i], match: null });
      }
    }
    return chosen.length - before;
  };

  // First batch asks for a couple extra so dedup/grounding losses still leave
  // enough; one top-up batch covers the rare short day. Bounded to 2 calls.
  await harvest(count + 2);
  if (chosen.length < count) await harvest(count + 2);

  const now = new Date();
  const base = now.getTime();
  return chosen.slice(0, count).map(({ draft, match }, i) => ({
    ...draft,
    album: match?.album || draft.album,
    year: match?.year || draft.year,
    id: `${base}-${i}`,
    createdAt: now.toISOString(),
    dateLabel: dateLabel(now),
    spotify: match
  }));
}
