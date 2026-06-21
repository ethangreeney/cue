import { FeedbackRecord, RecommendationDraft, TasteProfile } from "./types";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

function model(): string {
  return process.env.GEMINI_MODEL || "gemini-3.5-flash";
}
function apiKey(): string {
  const v = process.env.GEMINI_API_KEY;
  if (!v) throw new Error("GEMINI_API_KEY is not set");
  return v;
}

// Gemini structured-output schema for one recommendation.
const RECOMMENDATION_PROPERTIES = {
    title: { type: "STRING", description: "Exact song title." },
    artist: { type: "STRING", description: "Primary artist name." },
    album: { type: "STRING", description: "Album the song appears on." },
    year: { type: "STRING", description: "Release year, 4 digits." },
    genres: { type: "ARRAY", items: { type: "STRING" }, description: "2-3 genre tags." },
    thesis: {
      type: "STRING",
      description: "One vivid sentence: why this song, for this person, today."
    },
    whyForYou: {
      type: "STRING",
      description:
        "2-3 sentences connecting the song to THIS listener's specific taste, naming patterns in their artists/genres."
    },
    whatToListenFor: {
      type: "STRING",
      description: "2-3 sentences pointing to specific moments or details to notice."
    },
    aboutSong: { type: "STRING", description: "2-3 sentences on the song itself." },
    aboutArtist: { type: "STRING", description: "2-3 sentences on the artist." },
    context: {
      type: "STRING",
      description: "2-3 sentences of album/scene/cultural context."
    },
    furtherExploration: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "3-5 adjacent artist names if this resonates."
    },
    spotifySearchQuery: {
      type: "STRING",
      description: "A clean search string to find the exact track on Spotify."
    }
};

const RECOMMENDATION_FIELDS = [
  "title",
  "artist",
  "album",
  "year",
  "genres",
  "thesis",
  "whyForYou",
  "whatToListenFor",
  "aboutSong",
  "aboutArtist",
  "context",
  "furtherExploration",
  "spotifySearchQuery"
];

const RECOMMENDATION_ITEM = {
  type: "OBJECT",
  properties: RECOMMENDATION_PROPERTIES,
  required: RECOMMENDATION_FIELDS,
  propertyOrdering: RECOMMENDATION_FIELDS
};

// Single pick — used by the on-demand /api/recommend path.
const RESPONSE_SCHEMA = RECOMMENDATION_ITEM;

// A whole day's worth at once — one round-trip that returns several DISTINCT
// picks. Far cheaper and more diverse than firing N near-identical prompts in
// parallel (which collapse onto the same canonical songs).
const BATCH_SCHEMA = {
  type: "OBJECT",
  properties: {
    recommendations: { type: "ARRAY", items: RECOMMENDATION_ITEM }
  },
  required: ["recommendations"]
};

function steeringFromFeedback(feedback: FeedbackRecord[]): string {
  if (!feedback.length) return "No feedback yet — make a confident, well-judged first pick.";
  const lines = feedback.slice(-8).map((f) => {
    const who = `"${f.title}" by ${f.artist}`;
    const parts: string[] = [];
    switch (f.verdict) {
      case "loved":
        parts.push(`They LOVED ${who}. Stay close to that spirit — an adjacent artist or a deeper cut with the same emotional texture.`);
        break;
      case "nailed":
        parts.push(`${who} nailed their taste. Keep that accuracy but push one honest step further into discovery.`);
        break;
      case "too_obvious":
        parts.push(`${who} was TOO OBVIOUS / already known. Go meaningfully more obscure; avoid canonical, charting, or famous choices.`);
        break;
      case "too_weird":
        parts.push(`${who} was TOO WEIRD / inaccessible. Pull back toward something more melodic and immediate while keeping the taste.`);
        break;
      case "boring":
        parts.push(`${who} was BORING. Take a sharper, more surprising swing — more energy, edge, or emotional stakes.`);
        break;
      case "not_for_me":
        parts.push(`${who} was NOT FOR THEM. Pivot to a different corner of their taste; do not repeat that lane.`);
        break;
    }
    if (f.note && f.note.trim()) {
      // Free-text is the strongest, most specific signal — honor it directly.
      parts.push(`On ${who}, the listener said in their own words: "${f.note.trim()}". Treat this as the most important instruction and act on it concretely.`);
    }
    return parts.join(" ");
  });
  return lines.filter(Boolean).join("\n");
}

function buildPrompt(
  taste: TasteProfile,
  history: { title: string; artist: string }[],
  feedback: FeedbackRecord[]
): string {
  const already = history
    .map((h) => `- ${h.title} — ${h.artist}`)
    .join("\n");

  const nonce = Math.random().toString(36).slice(2, 8);

  return `You are the music curator behind "Cue" — a service that picks ONE deeply chosen song for a listener and explains why it matters. You write like a sharp, literate liner-note essayist: specific, calm, never hype, never generic.

# THE LISTENER
Name: ${taste.displayName}
Taste summary: ${taste.summary}
Top genres: ${taste.topGenres.join(", ") || "unknown"}
Top artists: ${taste.topArtists.join(", ") || "unknown"}
Top tracks: ${taste.topTracks.map((t) => `${t.name} (${t.artist})`).join("; ") || "unknown"}
Recently saved: ${taste.recentSaves.map((t) => `${t.name} (${t.artist})`).join("; ") || "unknown"}
Currently in rotation (recently played): ${taste.recentlyPlayed.map((t) => `${t.name} (${t.artist})`).join("; ") || "unknown"}
From their own playlists: ${taste.playlistPicks.map((t) => `${t.name} (${t.artist})`).join("; ") || "unknown"}

# FEEDBACK ON PAST PICKS (most recent last) — let this steer this pick
${steeringFromFeedback(feedback)}

# ALREADY RECOMMENDED — never pick any of these again
${already || "(none yet)"}

# YOUR TASK
Choose exactly ONE real, existing song to recommend right now.

Rules:
- It MUST be a real song that is actually available to stream on Spotify right now. Use the exact artist and title as they appear on Spotify. Do not invent songs, and avoid tracks likely to be missing from Spotify (out-of-print, unofficial, region-locked, or obscure-label rarities that never made it to streaming).
- Choose something genuinely good and well-matched — not the most obvious mainstream hit, but not willfully obscure either, unless feedback tells you to adjust.
- The "whyForYou" must reference SPECIFIC things about this listener's taste (their actual artists/genres), not vague flattery.
- Do not invent biographical or factual claims you are unsure of. If unsure about a backstory detail, keep it general rather than fabricating specifics.
- No numeric scores. No "as an AI" language. No emoji. No exclamation-mark hype.
- Keep every field tight and editorial. Prose, not bullet points.
- Vary your choice; selection token ${nonce}.

Return ONLY the structured JSON object.`;
}

function buildBatchPrompt(
  taste: TasteProfile,
  history: { title: string; artist: string }[],
  feedback: FeedbackRecord[],
  count: number
): string {
  const single = buildPrompt(taste, history, feedback);
  // Reuse the whole single-pick brief (listener, feedback, exclusions, rules)
  // and just swap the task for "give me several DISTINCT picks at once".
  const task = `# YOUR TASK
Choose exactly ${count} real, existing songs to recommend right now — a set, not one.

The set MUST be internally diverse:
- Every pick a DIFFERENT artist. Never the same artist twice.
- Span different corners of this listener's taste (different moods, eras, or genres they actually like) — not ${count} variations on one sound.
- None of them may appear in the ALREADY RECOMMENDED list above.`;

  const body = single.slice(0, single.indexOf("# YOUR TASK")) + task;
  return `${body}

Rules:
- Each MUST be a real song actually streamable on Spotify right now. Use the exact artist and title as they appear on Spotify. Do not invent songs, and avoid tracks likely to be missing from Spotify (out-of-print, unofficial, region-locked, obscure-label rarities).
- Genuinely good, well-matched picks — not the most obvious mainstream hits, but not willfully obscure either, unless feedback says otherwise.
- Each "whyForYou" must reference SPECIFIC things about this listener's taste, not vague flattery.
- Do not invent biographical or factual claims you are unsure of.
- No numeric scores. No "as an AI" language. No emoji. No exclamation-mark hype.
- Keep every field tight and editorial. Prose, not bullet points.

Return ONLY the structured JSON object with a "recommendations" array of exactly ${count} items.`;
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: unknown;
}

// One Gemini round-trip with a hard wall-clock timeout, so a hung call fails
// fast instead of stalling the whole generation (and blowing the route limit).
async function callGemini(prompt: string, schema: object, timeoutMs = 60_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}/${model()}:generateContent?key=${encodeURIComponent(apiKey())}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 1.0,
          responseMimeType: "application/json",
          responseSchema: schema
        }
      }),
      cache: "no-store",
      signal: controller.signal
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Gemini timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`Gemini request failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  if (!text) throw new Error("Gemini returned an empty response.");
  return text;
}

export async function generateRecommendationDraft(
  taste: TasteProfile,
  history: { title: string; artist: string }[],
  feedback: FeedbackRecord[]
): Promise<RecommendationDraft> {
  const text = await callGemini(buildPrompt(taste, history, feedback), RESPONSE_SCHEMA);
  try {
    return JSON.parse(text) as RecommendationDraft;
  } catch {
    throw new Error(`Gemini returned non-JSON: ${text.slice(0, 300)}`);
  }
}

// Several distinct picks in a single call — the workhorse for the daily podium.
export async function generateRecommendationDrafts(
  taste: TasteProfile,
  history: { title: string; artist: string }[],
  feedback: FeedbackRecord[],
  count: number
): Promise<RecommendationDraft[]> {
  const text = await callGemini(buildBatchPrompt(taste, history, feedback, count), BATCH_SCHEMA, 90_000);
  let parsed: { recommendations?: RecommendationDraft[] };
  try {
    parsed = JSON.parse(text) as { recommendations?: RecommendationDraft[] };
  } catch {
    throw new Error(`Gemini returned non-JSON: ${text.slice(0, 300)}`);
  }
  return Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
}
