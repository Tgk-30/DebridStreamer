import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  init,
  destroy,
  command,
  setProperty,
  observeProperties,
  setVideoMarginRatio,
  type MpvConfig,
  type MpvObservableProperty,
} from "tauri-plugin-libmpv-api";
import "./App.css";

// Phase-3 de-risk: play a stream with EMBEDDED libmpv rendering INSIDE the Tauri
// window (behind the transparent webview), controlled from JS — the "built-in
// player" path that replaces the VLC hand-off. mpv decodes everything the
// webview can't (MKV / HEVC / 10-bit), so this is the one player for all sources.
const PRESETS = [
  {
    kind: "HLS",
    label: "Mux test",
    url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
  },
  {
    kind: "HLS",
    label: "Apple BipBop",
    url: "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8",
  },
  {
    kind: "MP4",
    label: "Sintel (MP4)",
    url: "https://media.w3.org/2010/05/sintel/trailer.mp4",
  },
] as const;

const OBSERVED = [
  ["pause", "flag"],
  ["time-pos", "double", "none"],
  ["duration", "double", "none"],
  ["filename", "string", "none"],
] as const satisfies MpvObservableProperty[];

function fmt(s: number | null): string {
  if (s == null || !Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [url, setUrl] = useState<string>(PRESETS[0].url);
  const [paused, setPaused] = useState(true);
  const [pos, setPos] = useState<number | null>(null);
  const [dur, setDur] = useState<number | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const unlisten = useRef<null | (() => void)>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const config: MpvConfig = {
          initialOptions: {
            vo: "gpu-next",
            hwdec: "auto-safe",
            "keep-open": "yes",
            "force-window": "yes",
            // Route mpv's own status/VO logs to stderr so the video-output init
            // (proof that decode + render actually started) is observable.
            terminal: "yes",
            "msg-level": "all=status,vo=v,cplayer=v",
          },
          observedProperties: OBSERVED,
        };
        await init(config);
        if (cancelled) return;
        // Inset the video so the bottom control bar never covers it.
        await setVideoMarginRatio({ bottom: 0.18 });
        unlisten.current = await observeProperties(OBSERVED, ({ name, data }) => {
          if (name === "pause") setPaused(Boolean(data));
          else if (name === "time-pos") setPos(data as number | null);
          else if (name === "duration") setDur(data as number | null);
          else if (name === "filename") setFile(data as string | null);
        });
        setReady(true);
      } catch (e) {
        setErr(String(e));
      }
    })();
    return () => {
      cancelled = true;
      unlisten.current?.();
      void destroy().catch(() => {});
    };
  }, []);

  // Auto-play the first preset once libmpv is ready, so the embedded render is
  // visible immediately without a click.
  useEffect(() => {
    if (ready) void play(PRESETS[0].url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function play(target: string) {
    setErr(null);
    try {
      await command("loadfile", [target]);
      await setProperty("pause", false);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function togglePause() {
    try {
      await setProperty("pause", !paused);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function seek(to: number) {
    try {
      await command("seek", [to, "absolute"]);
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <main className="shell">
      <header className="bar top">
        <span className="brand">
          <span className="logo">▶</span> Embedded mpv · POC
        </span>
        <span className={"pill " + (ready ? "ok" : err ? "bad" : "wait")}>
          {ready ? "libmpv ready" : err ? "libmpv error" : "starting libmpv…"}
        </span>
      </header>

      {/* mpv renders in this transparent region, behind the webview. */}
      <div className="stage">
        {!file && !err && (
          <div className="hint">
            Pick a source below — it plays with native <b>mpv</b>, inside this window.
          </div>
        )}
      </div>

      <section className="bar bottom">
        <div className="transport">
          <button
            className="pp"
            disabled={!ready || !file}
            onClick={togglePause}
            aria-label={paused ? "Play" : "Pause"}
          >
            {paused ? "►" : "❚❚"}
          </button>
          <span className="t">{fmt(pos)}</span>
          <input
            className="scrub"
            type="range"
            min={0}
            max={dur ?? 0}
            value={pos ?? 0}
            step={1}
            disabled={!dur}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Seek"
          />
          <span className="t">{fmt(dur)}</span>
        </div>

        <div className="row">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
            placeholder="Direct stream URL (MKV / HEVC / MP4 / HLS)…"
          />
          <button className="primary" disabled={!ready} onClick={() => play(url)}>
            Play in mpv
          </button>
          <button
            onClick={() => void invoke("open_in_external_player", { url }).catch(() => {})}
          >
            VLC ↗
          </button>
        </div>

        <div className="presets">
          {PRESETS.map((p) => (
            <button
              key={p.url}
              className="chip"
              disabled={!ready}
              onClick={() => {
                setUrl(p.url);
                void play(p.url);
              }}
            >
              <span className="kind">{p.kind}</span> {p.label}
            </button>
          ))}
        </div>

        <div className="status">
          {err ? (
            <span className="err">⚠ {err}</span>
          ) : file ? (
            <>
              Playing in embedded mpv: <b>{file}</b>
            </>
          ) : (
            "libmpv is loaded into the Tauri window — the Phase-3 embedded player path."
          )}
        </div>
      </section>
    </main>
  );
}
