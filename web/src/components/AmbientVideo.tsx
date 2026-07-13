// Ambient looping background video (AI-generated, on-brand aurora-glass loops).
//
// Used behind onboarding / gate screens and empty states to add motion without
// distraction. Muted + looped + decorative (aria-hidden); fails gracefully - 
// if the file is missing or the browser blocks autoplay, the dark background
// underneath is unchanged, so nothing depends on it.

import "./AmbientVideo.css";

export type AmbientVideoName = "aurora" | "cinema" | "secure";

interface Props {
  name: AmbientVideoName;
  /** 0..1 - how visible the loop is over the background (default subtle). */
  opacity?: number;
  className?: string;
}

export function AmbientVideo({ name, opacity = 0.35, className }: Props) {
  return (
    <video
      className={`ambient-video${className ? ` ${className}` : ""}`}
      style={{ opacity }}
      src={`/videos/${name}.mp4`}
      autoPlay
      loop
      muted
      playsInline
      preload="metadata"
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
