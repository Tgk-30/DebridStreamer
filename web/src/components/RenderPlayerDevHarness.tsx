// DEV-ONLY harness (remove before ship): mounts the real EmbeddedPlayer against
// an arbitrary URL so the in-window render player + its premium controls can be
// exercised end-to-end — including different containers/codecs (mp4, mkv, HEVC,
// AV1, HLS). Wired in main.tsx behind import.meta.env.DEV.
import { useEffect, useState } from "react";
import { EmbeddedPlayer } from "./EmbeddedPlayer";

// Only reachable URLs (verified 200). For real HEVC/AV1/MKV testing, paste a
// debrid direct link into the input — those codecs decode fine; public direct
// HEVC/VP9 links are unreliable.
const SAMPLES: Array<{ label: string; url: string }> = [
  {
    label: "Sintel 1080p (H.264)",
    url: "https://download.blender.org/durian/trailer/sintel_trailer-1080p.mp4",
  },
  {
    label: "Sintel small (H.264)",
    url: "https://media.w3.org/2010/05/sintel/trailer.mp4",
  },
  {
    label: "HLS · Apple bipbop",
    url: "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8",
  },
  {
    label: "HLS · Mux",
    url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
  },
];

export function RenderPlayerDevHarness() {
  const [url, setUrl] = useState(SAMPLES[0].url);
  // DEV: auto-open the first sample so playback can be verified without a click.
  const [playing, setPlaying] = useState<string | null>(SAMPLES[0].url);

  // While the harness player is open, hide the main app root (#root) — it holds
  // the normal UI AND the first-run onboarding, both of which would otherwise
  // paint OVER the video (the harness player lives in its own root outside #root).
  useEffect(() => {
    const root = document.getElementById("root");
    if (!playing || !root) return;
    const prev = root.style.display;
    root.style.display = "none";
    return () => {
      root.style.display = prev;
    };
  }, [playing]);

  if (playing) {
    return (
      <EmbeddedPlayer
        url={playing}
        title="Test clip"
        subtitle={playing.length > 60 ? playing.slice(0, 60) + "…" : playing}
        onClose={() => setPlaying(null)}
      />
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 10,
        left: 10,
        zIndex: 2147483647,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        background: "#151827ee",
        padding: 10,
        borderRadius: 12,
        boxShadow: "0 8px 30px rgba(0,0,0,.5)",
        font: "12px system-ui, sans-serif",
        color: "#fff",
        maxWidth: 440,
      }}
    >
      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="paste a video URL (mp4 / mkv / hevc / m3u8 / debrid link)"
          style={{
            flex: 1,
            minWidth: 300,
            background: "#0b0d16",
            color: "#fff",
            border: "1px solid #2a2e44",
            borderRadius: 8,
            padding: "6px 8px",
          }}
        />
        <button
          type="button"
          onClick={() => url && setPlaying(url)}
          style={{
            background: "#7c5cff",
            color: "#fff",
            border: 0,
            borderRadius: 8,
            padding: "6px 12px",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          ▶ Play
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {SAMPLES.map((s) => (
          <button
            key={s.url}
            type="button"
            onClick={() => setUrl(s.url)}
            style={{
              background: url === s.url ? "#39406b" : "#20243a",
              color: "#cfd3e6",
              border: 0,
              borderRadius: 6,
              padding: "3px 7px",
              cursor: "pointer",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
