"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { PlayIcon, PauseIcon, SpotifyIcon, ArrowIcon } from "./icons";

// The Spotify Web Playback SDK turns this browser tab into a Spotify "device"
// that can stream full tracks — but ONLY for Premium accounts, and ONLY with the
// user's own access token client-side (there is no server-proxy alternative).
// So this component is best-effort: if anything about that contract fails (free
// account, expired token, SDK won't load, ad-blocker), we fall back silently to
// a "Play in Spotify" link instead of showing a broken control.

const SDK_SRC = "https://sdk.scdn.co/spotify-player.js";

// The SDK is a single global script + one ready callback. Load it once per page
// and share the promise across any Player instances that mount.
let sdkPromise: Promise<void> | null = null;
function loadSdk(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no_window"));
  const w = window as unknown as { Spotify?: unknown; onSpotifyWebPlaybackSDKReady?: () => void };
  if (w.Spotify) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<void>((resolve, reject) => {
    w.onSpotifyWebPlaybackSDKReady = () => resolve();
    const s = document.createElement("script");
    s.src = SDK_SRC;
    s.async = true;
    s.onerror = () => {
      sdkPromise = null;
      reject(new Error("sdk_load_failed"));
    };
    document.body.appendChild(s);
  });
  return sdkPromise;
}

interface TokenInfo {
  accessToken: string;
  expiresAt: number;
  isPremium: boolean;
}

async function fetchToken(): Promise<TokenInfo | null> {
  try {
    const res = await fetch("/api/token");
    if (!res.ok) return null;
    const d = (await res.json()) as {
      authenticated?: boolean;
      accessToken?: string;
      expiresAt?: number;
      isPremium?: boolean;
    };
    if (!d.authenticated || !d.accessToken) return null;
    return { accessToken: d.accessToken, expiresAt: d.expiresAt ?? 0, isPremium: !!d.isPremium };
  } catch {
    return null;
  }
}

function fmt(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// "connecting" is the brief window between the first play click and the device
// being ready; "fallback" means in-page playback isn't possible — link out.
type Status = "idle" | "connecting" | "playing" | "paused" | "fallback";

// Minimal shape of the bits of the SDK we touch.
interface SdkPlayer {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  addListener: (event: string, cb: (payload: unknown) => void) => void;
}

export default function Player({
  uri,
  fallbackUrl,
  durationMs,
  onProgress
}: {
  uri: string | null;
  fallbackUrl: string;
  durationMs?: number;
  onProgress?: (sec: number, playing: boolean) => void;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [posMs, setPosMs] = useState(0);

  const playerRef = useRef<SdkPlayer | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const tokenRef = useRef<TokenInfo | null>(null);
  // Base sample for local position interpolation between SDK state events, so
  // the progress bar and lyric sync advance smoothly rather than in 1s jumps.
  const baseRef = useRef<{ pos: number; t: number; paused: boolean }>({ pos: 0, t: 0, paused: true });

  // Keep the latest onProgress in a ref so the ticking interval never goes stale
  // and we don't re-create it on every parent render.
  const reportRef = useRef(onProgress);
  reportRef.current = onProgress;

  // Build + connect the SDK player on first play. Resolves to whether a device
  // is ready to receive playback.
  const ensurePlayer = useCallback(async (): Promise<boolean> => {
    if (playerRef.current && deviceIdRef.current) return true;

    const token = await fetchToken();
    if (!token || !token.isPremium) {
      setStatus("fallback");
      return false;
    }
    tokenRef.current = token;

    try {
      await loadSdk();
    } catch {
      setStatus("fallback");
      return false;
    }

    const w = window as unknown as {
      Spotify: { Player: new (opts: unknown) => SdkPlayer };
    };
    const player = new w.Spotify.Player({
      name: "Cue",
      getOAuthToken: async (cb: (t: string) => void) => {
        let t = tokenRef.current;
        // Refresh slightly ahead of expiry so the SDK never streams with a
        // dead token mid-song.
        if (!t || Date.now() > t.expiresAt - 30_000) {
          const fresh = await fetchToken();
          if (fresh) {
            tokenRef.current = fresh;
            t = fresh;
          }
        }
        cb(t?.accessToken ?? token.accessToken);
      },
      volume: 0.85
    });

    player.addListener("ready", (payload) => {
      deviceIdRef.current = (payload as { device_id: string }).device_id;
    });
    player.addListener("not_ready", () => {
      deviceIdRef.current = null;
    });
    player.addListener("player_state_changed", (payload) => {
      const state = payload as { position: number; paused: boolean } | null;
      if (!state) return;
      baseRef.current = { pos: state.position, t: performance.now(), paused: state.paused };
      setPosMs(state.position);
      setStatus(state.paused ? "paused" : "playing");
    });
    const fail = () => setStatus("fallback");
    player.addListener("initialization_error", fail);
    player.addListener("authentication_error", fail);
    player.addListener("account_error", fail);

    playerRef.current = player;
    const connected = await player.connect();
    if (!connected) {
      setStatus("fallback");
      return false;
    }

    // Wait briefly for the "ready" event to hand us a device id.
    const deadline = Date.now() + 8000;
    while (!deviceIdRef.current && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return !!deviceIdRef.current;
  }, []);

  const handleToggle = useCallback(async () => {
    if (!uri) {
      window.open(fallbackUrl, "_blank", "noreferrer");
      return;
    }
    if (status === "playing") {
      await playerRef.current?.pause();
      return;
    }
    if (status === "paused") {
      await playerRef.current?.resume();
      return;
    }
    // First play: connect, then start this track on our device.
    setStatus("connecting");
    const ready = await ensurePlayer();
    if (!ready) return; // ensurePlayer already flipped us to "fallback"
    try {
      const res = await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${deviceIdRef.current}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${tokenRef.current!.accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ uris: [uri] })
        }
      );
      if (!res.ok && res.status !== 204) setStatus("fallback");
    } catch {
      setStatus("fallback");
    }
  }, [uri, status, fallbackUrl, ensurePlayer]);

  // Smoothly advance position between SDK state events and report upward.
  useEffect(() => {
    if (status !== "playing" && status !== "paused") return;
    const id = window.setInterval(() => {
      const b = baseRef.current;
      let pos = b.paused ? b.pos : b.pos + (performance.now() - b.t);
      if (durationMs) pos = Math.min(pos, durationMs);
      setPosMs(pos);
      reportRef.current?.(pos / 1000, !b.paused);
    }, 250);
    return () => window.clearInterval(id);
  }, [status, durationMs]);

  // Release the device when the song view closes.
  useEffect(() => {
    return () => {
      try {
        playerRef.current?.disconnect();
      } catch {
        /* noop */
      }
    };
  }, []);

  if (status === "fallback") {
    return (
      <a className="player player-fallback" href={fallbackUrl} target="_blank" rel="noreferrer">
        <span className="player-toggle" aria-hidden="true">
          <SpotifyIcon size={18} />
        </span>
        <span className="player-fallback-label">
          Play in Spotify
          <ArrowIcon size={14} className="arrow" />
        </span>
      </a>
    );
  }

  const playing = status === "playing";
  const connecting = status === "connecting";
  const pct = durationMs ? Math.min(100, (posMs / durationMs) * 100) : 0;

  return (
    <div className="player">
      <button
        className="player-toggle"
        onClick={handleToggle}
        disabled={connecting}
        aria-label={playing ? "Pause" : "Play"}
      >
        {connecting ? (
          <span className="player-spin" aria-hidden="true" />
        ) : playing ? (
          <PauseIcon size={18} />
        ) : (
          <PlayIcon size={18} />
        )}
      </button>
      <div className="player-track">
        <div className="player-bar">
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="player-time">
          <span>{fmt(posMs)}</span>
          <span>{durationMs ? fmt(durationMs) : "--:--"}</span>
        </div>
      </div>
    </div>
  );
}
