"use client";

import React, { useState } from "react";
import { Recommendation } from "@/lib/types";
import Player, { PlaybackVolume } from "./Player";
import Lyrics from "./Lyrics";

// The song's detail view: the prose lives on the left as a set of swipeable
// write-ups; the cover, in-page player, and synced lyrics sit on the right.
export default function SongStory({ rec }: { rec: Recommendation }) {
  const [posSec, setPosSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState(0);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const sp = rec.spotify;
  const fallbackUrl =
    sp?.spotifyUrl ||
    `https://open.spotify.com/search/${encodeURIComponent(`${rec.title} ${rec.artist}`)}`;

  const TABS = [
    { label: "Why you", body: rec.whyForYou || rec.thesis },
    { label: "Listen for", body: rec.whatToListenFor },
    { label: "The song", body: rec.aboutSong },
    { label: "The artist", body: rec.aboutArtist },
    { label: "The scene", body: rec.context }
  ].filter((t) => t.body);

  const meta = [rec.artist, rec.year, rec.genres.slice(0, 2).join(", ")]
    .filter(Boolean)
    .join("  ·  ");

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

  const active = TABS[Math.min(tab, TABS.length - 1)];

  return (
    <div className="story fade-in">
      <div className="story-text">
        <p className="eyebrow">Today&rsquo;s pick</p>
        <h1 className="story-title">{rec.title}</h1>
        <p className="story-meta">{meta}</p>
        <p className="story-thesis">{rec.thesis}</p>

        <div className="story-tabs" role="tablist">
          {TABS.map((t, i) => (
            <button
              key={t.label}
              role="tab"
              aria-selected={i === tab}
              className={`story-tab ${i === tab ? "active" : ""}`}
              onClick={() => setTab(i)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <p className="story-body" key={active?.label}>
          {active?.body}
        </p>

        {rec.furtherExploration?.length > 0 && (
          <p className="story-further">
            <span className="further-label">If this resonates</span>
            {rec.furtherExploration.map((name, i) => (
              <React.Fragment key={name}>
                <span className="further-item">{name}</span>
                {i < rec.furtherExploration.length - 1 ? ", " : ""}
              </React.Fragment>
            ))}
          </p>
        )}
      </div>

      <aside className="story-stage">
        <PlaybackVolume />
        <div className="story-cover">
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

        <div className="story-controls">
          <Player
            uri={sp?.uri ?? null}
            fallbackUrl={fallbackUrl}
            durationMs={sp?.durationMs}
            onProgress={(s, p) => {
              setPosSec(s);
              setPlaying(p);
            }}
          />
          {sp?.uri && (
            <button className="save-link" onClick={handleSave} disabled={saving || saved}>
              {saved ? "Saved" : saving ? "Saving…" : saveError ? "Retry save" : "Save"}
            </button>
          )}
        </div>
      </aside>

      <div className="story-lyrics-col">
        <Lyrics
          uri={sp?.uri ?? null}
          title={rec.title}
          artist={rec.artist}
          album={rec.album}
          durationMs={sp?.durationMs}
          positionSec={posSec}
          playing={playing}
        />
      </div>
    </div>
  );
}
