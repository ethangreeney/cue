"use client";

import React from "react";
import { Recommendation } from "@/lib/types";
import { ArrowIcon } from "./icons";

const COVER_CLASS = ["cover-dawn", "cover-signal", "cover-night"];

// Today's three picks, side by side. A calm, passive read: nothing is asked of
// the listener — each card is simply an invitation to fall into the song's
// story or play it. Tapping a card opens its full write-up.
export default function Podium({
  recommendations,
  onOpen
}: {
  recommendations: Recommendation[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="podium">
      <div className="podium-shelf">
        <span className="shelf-divider" aria-hidden="true" style={{ left: "33.333%" }} />
        <span className="shelf-divider" aria-hidden="true" style={{ left: "66.666%" }} />
        {recommendations.map((rec, i) => (
          <article
            key={rec.id}
            className="pick podium-pick"
            role="button"
            tabIndex={0}
            aria-label={`${rec.title} by ${rec.artist}. Read its story.`}
            onClick={() => onOpen(rec.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(rec.id);
              }
            }}
          >
            <div
              className={`pick-cover ${rec.spotify?.albumImage ? "" : COVER_CLASS[i % COVER_CLASS.length]}`}
            >
              {rec.spotify?.albumImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={rec.spotify.albumImage} alt={`${rec.album} cover`} draggable={false} />
              ) : null}
            </div>
            <div className="pick-copy">
              <h2>{rec.title}</h2>
              <p className="pick-artist">{rec.artist}</p>
              <p className="pick-note">{rec.thesis}</p>
              <span className="pick-cue">
                Read the story <ArrowIcon size={14} />
              </span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
