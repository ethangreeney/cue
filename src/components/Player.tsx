"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { PlayIcon, PauseIcon, SpotifyIcon, ArrowIcon, VolumeIcon } from "./icons";
import { reportClientIssue } from "@/lib/clientLog";

// The Spotify Web Playback SDK turns this browser tab into a Spotify "device"
// that can stream full tracks — but ONLY for Premium accounts, and ONLY with the
// user's own access token client-side (there is no server-proxy alternative).
//
// A token may have only ONE active SDK device at a time. So we build that device
// exactly ONCE per page and share it across every song view; mounting a new
// Player no longer spins up (and races) a second device. A genuine "can't play
// here" condition (free account, SDK blocked) falls back to a "Play in Spotify"
// link; a transient hiccup is recoverable — the play button simply retries.

const SDK_SRC = "https://sdk.scdn.co/spotify-player.js";

// The SDK is a single global script + one ready callback. Load it once per page.
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

// One cached token, refreshed a little ahead of expiry so the SDK and the play
// call never run with a dead token.
let token: TokenInfo | null = null;
async function freshToken(): Promise<TokenInfo | null> {
  if (token && Date.now() < token.expiresAt - 30_000) return token;
  try {
    const res = await fetch("/api/token");
    if (!res.ok) return token;
    const d = (await res.json()) as {
      authenticated?: boolean;
      accessToken?: string;
      expiresAt?: number;
      isPremium?: boolean;
    };
    token =
      d.authenticated && d.accessToken
        ? { accessToken: d.accessToken, expiresAt: d.expiresAt ?? 0, isPremium: !!d.isPremium }
        : null;
  } catch {
    // Network blip — keep whatever we had rather than dropping to fallback.
  }
  return token;
}

// Surface a playback problem to the server log (so we can diagnose a tester's
// failure directly without them copying anything), tagged with a human-readable
// hint about the likely cause. Best-effort; never carries the access token.
function reportPlaybackIssue(kind: string, message: string) {
  const hint =
    kind === "account_error"
      ? "Token missing the 'streaming' scope (authorized before it was added) or account can't stream — reconnect Spotify."
      : kind === "not_premium"
        ? "Spotify Premium is required for in-page playback."
        : kind === "authentication_error"
          ? "Access token rejected — reconnect Spotify."
          : kind === "initialization_error"
            ? "Browser couldn't initialize playback (DRM/EME unavailable or blocked)."
            : kind === "sdk_load_failed"
              ? "Web Playback SDK script failed to load (network or ad-blocker)."
              : "";
  reportClientIssue("player", kind, message, hint ? { hint } : undefined);
}

// Minimal shape of the bits of the SDK we touch.
interface SdkPlayer {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  addListener: (event: string, cb: (payload: unknown) => void) => void;
}

// ── Shared playback state, broadcast to every mounted Player ────────────────
interface SharedState {
  uri: string | null; // the track currently loaded on the device
  positionMs: number;
  paused: boolean;
  ts: number; // performance.now() at the moment this sample was taken
}
let lastState: SharedState = { uri: null, positionMs: 0, paused: true, ts: 0 };

const subscribers = new Set<() => void>();
function notify() {
  subscribers.forEach((fn) => fn());
}

interface Shared {
  player: SdkPlayer;
  deviceId: string | null;
}
let shared: Shared | null = null;
let sharedPromise: Promise<Shared | null> | null = null;
let desiredVolume = 0.85;
let volumeLoaded = false;

function loadVolume(): number {
  if (volumeLoaded || typeof window === "undefined") return desiredVolume;
  volumeLoaded = true;
  const raw = window.localStorage.getItem("cue-volume");
  const stored = raw === null ? NaN : Number(raw);
  if (Number.isFinite(stored) && stored >= 0 && stored <= 1) desiredVolume = stored;
  return desiredVolume;
}

function applyVolume(volume: number) {
  desiredVolume = Math.min(1, Math.max(0, volume));
  if (typeof window !== "undefined") window.localStorage.setItem("cue-volume", String(desiredVolume));
  shared?.player.setVolume(desiredVolume).catch(() => {});
}
// Latched when the SDK reports a non-recoverable condition for this token — a
// missing "streaming" scope (the user authorized before it was added), a non-
// streamable account, or a DRM/init failure. Retrying can't fix any of these;
// in-page playback stays off until the user reconnects (which reloads the page),
// so we degrade straight to the "Play in Spotify" link.
let playbackBlocked = false;
// A subset of the blocked conditions that a fresh login actually fixes: a token
// missing the "streaming" scope or one Spotify rejected. For these we offer a
// one-click "Reconnect Spotify" instead of a dead-end link-out (a free account
// or a DRM failure, by contrast, can't be fixed by reconnecting).
let needsReconnect = false;

async function connectAndWait(player: SdkPlayer): Promise<boolean> {
  let connected = false;
  try {
    connected = await player.connect();
  } catch {
    connected = false;
  }
  if (!connected) return false;
  const deadline = Date.now() + 8000;
  while (!shared?.deviceId && !playbackBlocked && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return !!shared?.deviceId;
}

async function buildPlayer(): Promise<Shared | null> {
  try {
    await loadSdk();
  } catch {
    reportPlaybackIssue("sdk_load_failed", "");
    return null;
  }
  const w = window as unknown as { Spotify: { Player: new (opts: unknown) => SdkPlayer } };
  const player = new w.Spotify.Player({
    name: "Cue",
    getOAuthToken: async (cb: (t: string) => void) => {
      const t = await freshToken();
      cb(t?.accessToken ?? "");
    },
    volume: loadVolume()
  });
  const s: Shared = { player, deviceId: null };
  shared = s;

  player.addListener("ready", (payload) => {
    s.deviceId = (payload as { device_id: string }).device_id;
  });
  player.addListener("not_ready", () => {
    // The device went offline (e.g. playback transferred to a phone). Drop the
    // id; the next play attempt reconnects THIS player rather than building a
    // second one (two devices on one token is the collision we're avoiding).
    s.deviceId = null;
  });
  player.addListener("player_state_changed", (payload) => {
    const st = payload as
      | { position: number; paused: boolean; track_window?: { current_track?: { uri?: string } } }
      | null;
    if (!st) return;
    lastState = {
      uri: st.track_window?.current_track?.uri ?? lastState.uri,
      positionMs: st.position,
      paused: st.paused,
      ts: performance.now()
    };
    notify();
  });
  const fail = (kind: string) => (payload: unknown) => {
    // initialization / authentication / account errors are non-recoverable for
    // this token — latch the blocked flag so we degrade to the link-out, and
    // log it so a tester's failure is diagnosable from the logs, not guesswork.
    playbackBlocked = true;
    if (kind === "account_error" || kind === "authentication_error") needsReconnect = true;
    shared = null;
    sharedPromise = null;
    const message = (payload as { message?: string } | null)?.message ?? "";
    reportPlaybackIssue(kind, message);
  };
  player.addListener("initialization_error", fail("initialization_error"));
  player.addListener("authentication_error", fail("authentication_error"));
  player.addListener("account_error", fail("account_error"));

  const ready = await connectAndWait(player);
  if (!ready) {
    shared = null;
    return null;
  }
  return s;
}

export function PlaybackVolume() {
  const [volume, setVolume] = useState(0.85);

  useEffect(() => {
    setVolume(loadVolume());
  }, []);

  const update = (next: number) => {
    setVolume(next);
    applyVolume(next);
  };

  return (
    <div className="playback-volume">
      <VolumeIcon size={16} className="playback-volume-icon" />
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={volume}
        onChange={(event) => update(Number(event.target.value))}
        aria-label="Playback volume"
        style={{ "--volume": `${volume * 100}%` } as React.CSSProperties}
      />
      <span>{Math.round(volume * 100)}</span>
    </div>
  );
}

// "fallback" → in-page play can't work for this user/token (link out);
// "retry" → a transient miss the user can simply click again.
type EnsureResult = { ok: true; deviceId: string } | { ok: false; reason: "fallback" | "retry" };

// Resolve a ready device, reusing the shared one whenever possible.
async function ensureDevice(): Promise<EnsureResult> {
  if (shared?.deviceId) return { ok: true, deviceId: shared.deviceId };
  if (playbackBlocked) return { ok: false, reason: "fallback" };

  const t = await freshToken();
  if (!t) return { ok: false, reason: "retry" };
  if (!t.isPremium) {
    reportPlaybackIssue("not_premium", "account product is not premium");
    return { ok: false, reason: "fallback" };
  }

  // Player exists but its device dropped — reconnect the same instance.
  if (shared?.player) {
    const ready = await connectAndWait(shared.player);
    if (ready && shared?.deviceId) return { ok: true, deviceId: shared.deviceId };
    return { ok: false, reason: playbackBlocked ? "fallback" : "retry" };
  }

  if (!sharedPromise) sharedPromise = buildPlayer();
  const result = await sharedPromise;
  if (!result || !result.deviceId) {
    sharedPromise = null; // let a future click rebuild
    return { ok: false, reason: playbackBlocked ? "fallback" : "retry" };
  }
  return { ok: true, deviceId: result.deviceId };
}

async function startPlayback(uri: string, deviceId: string): Promise<boolean> {
  const t = await freshToken();
  if (!t) return false;
  try {
    const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${t.accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ uris: [uri] })
    });
    if (res.ok || res.status === 204) return true;
    reportPlaybackIssue("play_request_failed", `HTTP ${res.status}`);
    return false;
  } catch (e) {
    reportPlaybackIssue("play_request_error", e instanceof Error ? e.message : "");
    return false;
  }
}

function pausePlayback() {
  shared?.player.pause().catch(() => {});
}
function resumePlayback() {
  shared?.player.resume().catch(() => {});
}
function seekTo(ms: number) {
  shared?.player.seek(Math.max(0, Math.round(ms))).catch(() => {});
}

// Seek only when `uri` is the track currently loaded on the shared device — used
// by the lyrics view to jump to a line. Returns whether the seek was issued, so
// the caller can ignore clicks when this song isn't the active in-page stream.
export function seekActive(uri: string | null, ms: number): boolean {
  if (!uri || lastState.uri !== uri || !shared?.deviceId) return false;
  seekTo(ms);
  return true;
}

function fmt(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// "connecting" is the brief window between the play click and the device being
// ready; "fallback" means in-page playback is genuinely impossible — link out.
type Status = "idle" | "connecting" | "playing" | "paused" | "fallback";

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
  const [softError, setSoftError] = useState(false);

  const reportRef = useRef(onProgress);
  reportRef.current = onProgress;

  // Seek/scrub state. While dragging we drive the bar visually and only commit
  // the seek on release, so we don't spam the SDK on every pointer move.
  const barRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  // Reflect the shared device's state, but only when THIS track is the one
  // loaded on it. Other song views stay idle.
  useEffect(() => {
    const update = () => {
      setStatus((prev) => {
        const mine = !!lastState.uri && lastState.uri === uri;
        if (mine) return lastState.paused ? "paused" : "playing";
        if (prev === "connecting" || prev === "fallback") return prev; // don't clobber
        if (prev === "playing" || prev === "paused") return "idle"; // we were evicted
        return prev;
      });
      if (lastState.uri === uri) setPosMs(lastState.positionMs);
    };
    subscribers.add(update);
    update();
    return () => {
      subscribers.delete(update);
    };
  }, [uri]);

  const handleToggle = useCallback(async () => {
    if (!uri) {
      window.open(fallbackUrl, "_blank", "noreferrer");
      return;
    }
    if (status === "playing") {
      pausePlayback();
      return;
    }
    if (status === "paused" && lastState.uri === uri) {
      resumePlayback();
      return;
    }
    // First play, or a retry after a failure.
    setSoftError(false);
    setStatus("connecting");
    const device = await ensureDevice();
    if (!device.ok) {
      if (device.reason === "fallback") setStatus("fallback");
      else {
        setStatus("idle");
        setSoftError(true);
      }
      return;
    }
    const ok = await startPlayback(uri, device.deviceId);
    if (!ok) {
      setStatus(playbackBlocked ? "fallback" : "idle");
      if (!playbackBlocked) setSoftError(true);
    }
    // success → player_state_changed flips us to "playing"
  }, [uri, status, fallbackUrl]);

  // Smoothly advance position between SDK state events and report upward. While
  // the user is dragging the scrubber, leave posMs alone so the thumb tracks the
  // finger rather than fighting it.
  useEffect(() => {
    if (status !== "playing" && status !== "paused") return;
    const id = window.setInterval(() => {
      if (lastState.uri !== uri || draggingRef.current) return;
      let pos = lastState.paused ? lastState.positionMs : lastState.positionMs + (performance.now() - lastState.ts);
      if (durationMs) pos = Math.min(pos, durationMs);
      setPosMs(pos);
      reportRef.current?.(pos / 1000, !lastState.paused);
    }, 250);
    return () => window.clearInterval(id);
  }, [status, uri, durationMs]);

  // ── Scrubbing ─────────────────────────────────────────────────────────────
  // Only seekable once a track is actually loaded on the device and we know its
  // length. Computes the target from the pointer's x within the bar.
  const seekable = (status === "playing" || status === "paused") && !!durationMs;

  const msFromClientX = useCallback(
    (clientX: number): number | null => {
      const el = barRef.current;
      if (!el || !durationMs) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return null;
      const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return frac * durationMs;
    },
    [durationMs]
  );

  const onScrubDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!seekable) return;
      const ms = msFromClientX(e.clientX);
      if (ms == null) return;
      draggingRef.current = true;
      setDragging(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setPosMs(ms);
    },
    [seekable, msFromClientX]
  );

  const onScrubMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const ms = msFromClientX(e.clientX);
      if (ms != null) setPosMs(ms);
    },
    [msFromClientX]
  );

  const onScrubUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      const ms = msFromClientX(e.clientX);
      if (ms != null) {
        setPosMs(ms);
        seekTo(ms);
      }
    },
    [msFromClientX]
  );

  // Arrow keys nudge ±5s for keyboard/a11y users.
  const onScrubKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!seekable || !durationMs) return;
      const delta = e.key === "ArrowRight" ? 5000 : e.key === "ArrowLeft" ? -5000 : 0;
      if (!delta) return;
      e.preventDefault();
      const next = Math.min(durationMs, Math.max(0, posMs + delta));
      setPosMs(next);
      seekTo(next);
    },
    [seekable, durationMs, posMs]
  );

  // Leaving this song stops its audio, but keeps the shared device alive so the
  // next song reuses it instead of reconnecting.
  useEffect(() => {
    return () => {
      if (lastState.uri === uri && !lastState.paused) pausePlayback();
    };
  }, [uri]);

  if (status === "fallback") {
    // A stale token (missing the streaming scope, or rejected) is fixed by a
    // fresh login — offer that directly. /api/login forces re-consent and
    // returns here, so one click re-enables in-page playback.
    if (needsReconnect) {
      return (
        <a className="player player-fallback" href="/api/login">
          <span className="player-toggle" aria-hidden="true">
            <SpotifyIcon size={18} />
          </span>
          <span className="player-fallback-label">
            Reconnect Spotify to play here
            <ArrowIcon size={14} className="arrow" />
          </span>
        </a>
      );
    }
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
        aria-label={softError ? "Retry" : playing ? "Pause" : "Play"}
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
        <div
          ref={barRef}
          className={`player-bar ${seekable ? "seekable" : ""} ${dragging ? "dragging" : ""}`}
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
          onKeyDown={onScrubKey}
          role={seekable ? "slider" : undefined}
          tabIndex={seekable ? 0 : undefined}
          aria-label={seekable ? "Seek" : undefined}
          aria-valuemin={seekable ? 0 : undefined}
          aria-valuemax={seekable && durationMs ? Math.round(durationMs / 1000) : undefined}
          aria-valuenow={seekable ? Math.round(posMs / 1000) : undefined}
        >
          <span style={{ width: `${pct}%` }} />
          {seekable && <i className="player-thumb" style={{ left: `${pct}%` }} aria-hidden="true" />}
        </div>
        <div className="player-time">
          {softError ? (
            <span className="player-hint" role="status">
              Couldn’t start — tap to retry
            </span>
          ) : (
            <span>{fmt(posMs)}</span>
          )}
          <span>{durationMs ? fmt(durationMs) : "--:--"}</span>
        </div>
      </div>
    </div>
  );
}
