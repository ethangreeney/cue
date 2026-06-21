# needle

**A daily song recommendation with a personal thesis** — chosen from your taste history and explained with enough context to make the song matter.

Not a playlist. Not a feed. Needle picks **one** song, grounds it against your real Spotify listening, and writes the liner notes: a one-sentence thesis, why it fits *you*, what to listen for, the story of the song and artist, and the scene around it. Your reaction shapes the next pick.

![one song, chosen for you](https://i.scdn.co)

---

## How it works

1. **Connect Spotify** — Needle reads your top artists, top tracks, saved songs, and genres to build a compact taste profile.
2. **Gemini chooses one song** — `gemini-3.5-flash` is prompted with your taste, your past picks (to never repeat), and your feedback (to steer). It returns a single structured recommendation.
3. **The pick is grounded in reality** — Needle searches Spotify for the exact track, then uses the *real* album art, release year, duration, and link. If a track can't be verified on Spotify, it shows the editorial card with a Spotify search link rather than pretending.
4. **You react** — Loved it · Nailed it · Too obvious · Too weird · Boring · Not for me. Each verdict is stored and fed into the next prompt, so the recommendations adapt.

The discovery and context layer is the product. Spotify is only the playback/save destination.

---

## Run it locally

### Prerequisites
- Node.js 20+ (built and tested on Node 26)
- A Spotify account (the one whose taste you want to use)

### 1. Install
```bash
npm install
```

### 2. Configure environment
A working `.env.local` is already present for this machine. To set up fresh, copy the example and fill in values:
```bash
cp .env.example .env.local
```

| Variable | What it is | Where to get it |
| --- | --- | --- |
| `GEMINI_API_KEY` | Google AI Studio API key | https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | Model id (default `gemini-3.5-flash`) | — |
| `SPOTIFY_CLIENT_ID` | Spotify app client id | https://developer.spotify.com/dashboard |
| `SPOTIFY_CLIENT_SECRET` | Spotify app client secret | same app, "View client secret" |
| `SPOTIFY_REDIRECT_URI` | OAuth redirect (must match the app) | `http://127.0.0.1:8888/callback` |
| `APP_BASE_URL` | Base URL the app runs on | `http://127.0.0.1:8888` |

> **Spotify redirect URI:** the loopback address must be `127.0.0.1`, **not** `localhost` — Spotify rejects `localhost` for new redirect URIs. The registered URI and the running port (8888) must match exactly.

### 3. Run
```bash
npm run dev
```
Open **http://127.0.0.1:8888** (use `127.0.0.1`, not `localhost`, so the OAuth redirect matches).

Click **Connect Spotify**, approve access, and Needle generates your first pick.

---

## APIs used

- **Google Gemini** (`generativelanguage.googleapis.com`, model `gemini-3.5-flash`) — generates the one-song recommendation as structured JSON (thesis, reasoning, context, further exploration). Uses Gemini's `responseSchema` for reliable structured output.
- **Spotify Web API** — Authorization Code flow. Scopes: `user-read-private user-read-email user-top-read user-library-read user-library-modify playlist-read-private playlist-modify-private`. Used to:
  - read top artists / tracks / saved songs (taste profile),
  - search for and verify the recommended track (real metadata + art + link),
  - save a track to your library.

### Model note
The target model `gemini-3.5-flash` **is available** on this account and is used as-is — no substitution was needed. If your account lacks it, set `GEMINI_MODEL=gemini-2.5-flash` (the closest Flash model) in `.env.local`.

---

## Architecture

```
src/
  app/
    page.tsx                 # client experience: connect → analyzing → card
    layout.tsx, globals.css  # editorial type + design system
    callback/route.ts        # Spotify OAuth callback
    api/
      login/    route.ts     # redirect to Spotify authorize
      me/       route.ts     # session + current pick
      recommend/route.ts     # generate a new pick
      feedback/ route.ts     # record reaction → generate next pick
      save/     route.ts     # save track to Spotify library
      logout/   route.ts
  lib/
    spotify.ts    # OAuth, token refresh, taste fetch, search-grounding, save
    taste.ts      # builds the taste profile from Spotify data
    gemini.ts     # structured one-song recommendation + feedback steering
    recommend.ts  # taste → Gemini → Spotify grounding → persist
    store.ts      # per-user JSON store (history + feedback)
    session.ts    # httpOnly cookie session + OAuth state
  components/
    RecommendationCard.tsx, icons.tsx
```

- **Auth/session:** Spotify tokens live in an httpOnly cookie; access tokens auto-refresh.
- **Persistence:** recommendation history and feedback are stored per user in `data/<spotify_id>.json` (gitignored). This is what lets feedback shape future picks and prevents repeats.

---

## What's real vs. mocked

- **Real:** Spotify OAuth, taste analysis from your actual listening, Gemini recommendations, Spotify track grounding (art/links/duration), save-to-library, the feedback loop, and persistence.
- **Honest limits:**
  - The Spotify app is in **development mode**, so only accounts added to the app (the owner is included automatically) can connect — fine for personal/local use.
  - **In-app playback** is intentionally not built; "Play in Spotify" opens the track in Spotify (reliable for free and Premium, no extra device setup).
  - Spotify deprecated audio-features/recommendations endpoints for new apps, so taste analysis is built from artists/tracks/genres/eras rather than acoustic features.
  - Spotify retired the legacy `PUT /me/tracks` save endpoint (it now returns 403); Needle saves via the current `PUT /me/library?uris=…` endpoint instead.
  - Recommendation text comes from an LLM. Needle prompts Gemini to avoid fabricating specific facts, and it grounds the song itself against Spotify — but treat backstory prose as editorial, not citation.

---

## Design

Calm, editorial, typographic. Newsreader (serif display) + Inter (labels), warm paper background, hairline rules, generous whitespace. No scores, no infinite feed, no gamification — a single song presented like a private liner note.
