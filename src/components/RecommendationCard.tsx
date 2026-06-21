"use client";

import React, { useEffect, useRef, useState } from "react";
import { Recommendation, FeedbackVerdict } from "@/lib/types";
import {
  PlayIcon,
  ArrowIcon,
  MicIcon,
  NoteIcon,
  HeartIcon,
  TargetIcon,
  ObviousIcon,
  WeirdIcon,
  BoringIcon,
  NotForMeIcon
} from "./icons";

export type FeedbackPayload = { verdict?: FeedbackVerdict; note?: string };

function fmtDuration(ms?: number): string | null {
  if (!ms || ms <= 0) return null;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const FEEDBACK: { verdict: FeedbackVerdict; label: string; Icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { verdict: "loved", label: "Loved it", Icon: HeartIcon },
  { verdict: "nailed", label: "Nailed it", Icon: TargetIcon },
  { verdict: "too_obvious", label: "Too obvious", Icon: ObviousIcon },
  { verdict: "too_weird", label: "Too weird", Icon: WeirdIcon },
  { verdict: "boring", label: "Boring", Icon: BoringIcon },
  { verdict: "not_for_me", label: "Not for me", Icon: NotForMeIcon }
];

// Minimal typing for the Web Speech API (Chrome: webkitSpeechRecognition).
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

export default function RecommendationCard({
  rec,
  busy,
  onFeedback,
  onAnother
}: {
  rec: Recommendation;
  busy: boolean;
  onFeedback: (f: FeedbackPayload) => void;
  onAnother: () => void;
}) {
  const [selected, setSelected] = useState<FeedbackVerdict | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const [tab, setTab] = useState<"song" | "artist" | "listen" | "scene">("listen");
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [listening, setListening] = useState(false);
  const [speechOk, setSpeechOk] = useState(false);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);

  const sp = rec.spotify;
  const duration = fmtDuration(sp?.durationMs);
  const playUrl =
    sp?.spotifyUrl ||
    `https://open.spotify.com/search/${encodeURIComponent(`${rec.title} ${rec.artist}`)}`;

  const TABS = [
    { key: "listen" as const, label: "Listen for", body: rec.whatToListenFor },
    { key: "song" as const, label: "The song", body: rec.aboutSong },
    { key: "artist" as const, label: "The artist", body: rec.aboutArtist },
    { key: "scene" as const, label: "The scene", body: rec.context }
  ];
  const activeBody = TABS.find((t) => t.key === tab)?.body ?? "";

  const metaBits = [rec.artist, rec.year, rec.genres.slice(0, 2).join(", ")].filter(Boolean);

  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (Ctor) {
      setSpeechOk(true);
      const r = new Ctor();
      r.lang = "en-US";
      r.interimResults = true;
      r.continuous = false;
      r.onresult = (e) => {
        let text = "";
        for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
        setNote(text);
      };
      r.onend = () => setListening(false);
      r.onerror = () => setListening(false);
      recogRef.current = r;
    }
    return () => recogRef.current?.stop();
  }, []);

  const toggleMic = () => {
    const r = recogRef.current;
    if (!r) return;
    if (listening) {
      r.stop();
      setListening(false);
    } else {
      try {
        r.start();
        setListening(true);
      } catch {
        setListening(false);
      }
    }
  };

  const handleVerdict = (v: FeedbackVerdict) => {
    if (busy) return;
    setSelected(v);
    onFeedback({ verdict: v, note: note.trim() || undefined });
  };

  const submitNote = () => {
    if (busy || !note.trim()) return;
    recogRef.current?.stop();
    setListening(false);
    onFeedback({ note: note.trim() });
  };

  const handleSave = async () => {
    if (!sp?.uri || saving || saved) return;
    setSaving(true);
    setSaveError(false);
    try {
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackUri: sp.uri })
      });
      if (res.ok) setSaved(true);
      else setSaveError(true);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card fade-in" key={rec.id}>
      {/* Hero — the pick, and the one-line reason, in a single glance */}
      <div className="hero">
        <div className="cover">
          {sp?.albumImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sp.albumImage} alt={`${rec.album} cover`} />
          ) : (
            <div className="cover-fallback">
              <div className="cf-artist">{rec.artist}</div>
              <div className="cf-title">{rec.album || rec.title}</div>
            </div>
          )}
        </div>

        <div className="headline">
          <p className="eyebrow">Today&rsquo;s pick</p>
          <h1 className="song-title">{rec.title}</h1>
          <p className="hero-meta">{metaBits.join("  ·  ")}</p>

          <p className="thesis">{rec.thesis}</p>

          <div className="hero-actions">
            <a className="play-btn" href={playUrl} target="_blank" rel="noreferrer" aria-label="Play in Spotify">
              <PlayIcon />
            </a>
            <a className="play-link" href={playUrl} target="_blank" rel="noreferrer">
              {sp ? "Play in Spotify" : "Find on Spotify"}
              {duration && <span className="dot-sep">{duration}</span>}
              <ArrowIcon className="arrow" size={16} />
            </a>
            {sp?.uri && (
              <button className="save-link" onClick={handleSave} disabled={saving || saved}>
                {saved ? "Saved" : saving ? "Saving…" : saveError ? "Retry save" : "Save"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Reasoning — read side by side: why on the left, the depth on the right */}
      <div className="reasoning">
      <section className="why">
        <div className="col-head">
          <p className="why-label">Why it&rsquo;s for you</p>
        </div>
        <p className="why-text">{rec.whyForYou || rec.thesis}</p>
      </section>

      {/* Go deeper — one paragraph at a time, never a wall */}
      <section className="deeper">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`tab ${tab === t.key ? "active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="tab-body" key={tab}>
          {activeBody}
        </p>
        {rec.furtherExploration?.length > 0 && (
          <p className="further">
            <span className="further-label">If this resonates</span>
            {rec.furtherExploration.join(", ")}
          </p>
        )}
      </section>
      </div>

      {/* Feedback — quiet, at the end */}
      <section className="feedback">
        <div className="feedback-bar">
          <div className="fb-options">
            {FEEDBACK.map(({ verdict, label, Icon }) => (
              <button
                key={verdict}
                className={`fb-btn ${selected === verdict ? "selected" : ""}`}
                onClick={() => handleVerdict(verdict)}
                disabled={busy}
                title={label}
              >
                <Icon className="fb-icon" size={18} />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <button
            className={`note-toggle ${noteOpen ? "active" : ""}`}
            onClick={() => setNoteOpen((v) => !v)}
            disabled={busy}
            aria-expanded={noteOpen}
            aria-label="Say it in your own words"
            title="Say it in your own words"
          >
            <NoteIcon size={17} />
            <span>In your own words</span>
          </button>
          <button className="skip-btn" onClick={onAnother} disabled={busy} title="Move on to the next song">
            Next <ArrowIcon size={14} />
          </button>
        </div>

        {noteOpen && (
          <div className={`note-row ${listening ? "listening" : ""}`}>
            {speechOk && (
              <button
                className={`mic-btn ${listening ? "active" : ""}`}
                onClick={toggleMic}
                disabled={busy}
                aria-label={listening ? "Stop dictating" : "Dictate your feedback"}
                title={listening ? "Stop dictating" : "Dictate your feedback"}
              >
                <MicIcon size={17} />
              </button>
            )}
            <input
              className="note-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitNote()}
              placeholder={listening ? "Listening…" : "What did you think? A mood, a lyric, anything…"}
              disabled={busy}
              autoFocus
            />
            <button className="note-send" onClick={submitNote} disabled={busy || !note.trim()} aria-label="Send feedback">
              <ArrowIcon size={17} />
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
