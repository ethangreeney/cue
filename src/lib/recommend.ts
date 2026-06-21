import { generateRecommendationDraft } from "./gemini";
import { findTrack } from "./spotify";
import { Session } from "./session";
import { buildTasteProfile } from "./taste";
import { FeedbackRecord, Recommendation } from "./types";

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

  const history = (memory.history ?? []).slice(-14);
  const feedback = (memory.feedback ?? []).slice(-8);

  const seen = new Set(history.map((h) => `${h.title}|${h.artist}`.toLowerCase()));
  const isRepeat = (d: { title: string; artist: string }) =>
    seen.has(`${d.title}|${d.artist}`.toLowerCase());

  // Generate, then verify the song actually exists on Spotify. A pick that
  // can't be grounded is treated as a miss and we ask for another — we never
  // show the wrong track. We keep the first non-repeat draft as an honest
  // fallback in case nothing grounds.
  let draft = await generateRecommendationDraft(taste, history, feedback);
  let match = await findTrack(session.accessToken, {
    title: draft.title,
    artist: draft.artist,
    rawQuery: draft.spotifySearchQuery
  });
  let fallbackDraft = isRepeat(draft) ? null : draft;

  let attempts = 0;
  while (attempts < 4 && (!match || isRepeat(draft))) {
    draft = await generateRecommendationDraft(taste, history, feedback);
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
