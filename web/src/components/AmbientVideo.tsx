// Ambient looping background video (AI-generated, on-brand aurora-glass loops).
//
// Used behind onboarding / gate screens and empty states to add motion without
// distraction. Muted + looped + decorative (aria-hidden); fails gracefully - 
// if the file is missing or the browser blocks autoplay, the dark background
// underneath is unchanged, so nothing depends on it.

import { useEffect, useRef } from "react";
import "./AmbientVideo.css";

export type AmbientVideoName = "aurora" | "cinema" | "secure";

interface Props {
  name: AmbientVideoName;
  /** 0..1 - how visible the loop is over the background (default subtle). */
  opacity?: number;
  className?: string;
}

export function AmbientVideo({ name, opacity = 0.35, className }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let suspended = false;
    const syncPlayback = () => {
      const video = videoRef.current;
      if (video == null) return;
      if (document.hidden || suspended) {
        video.pause();
      } else {
        // Browsers return a promise; the optional chain also keeps lightweight
        // embedded/test media shims that return void from crashing the effect.
        void video.play()?.catch(() => {});
      }
    };
    const onVisibilityChange = () => syncPlayback();
    document.addEventListener("visibilitychange", onVisibilityChange);

    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            if (entry == null) return;
            suspended = entry.intersectionRatio === 0;
            syncPlayback();
          });
    if (observer != null && videoRef.current != null) observer.observe(videoRef.current);
    syncPlayback();

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      observer?.disconnect();
    };
  }, []);

  return (
    <video
      ref={videoRef}
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
