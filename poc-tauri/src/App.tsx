import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

// Public test streams that stand in for a Real-Debrid direct/HLS link.
// (RD returns CORS-friendly HTTPS - MP4 plays natively; its /streaming/transcode
//  endpoint returns HLS, which hls.js plays in any webview.)
const PRESETS: { label: string; url: string; kind: string }[] = [
  { label: "HLS stream (Mux test)", kind: "HLS", url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8" },
  { label: "HLS adaptive (Apple BipBop)", kind: "HLS", url: "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8" },
  { label: "MP4 (Big Buck Bunny)", kind: "MP4", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" },
];

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [url, setUrl] = useState(PRESETS[0].url);
  const [status, setStatus] = useState("Idle - load a stream to prove in-webview playback.");
  const [handoff, setHandoff] = useState<string | null>(null);

  function loadInApp(target: string) {
    const video = videoRef.current;
    if (!video) return;
    setHandoff(null);
    hlsRef.current?.destroy();
    hlsRef.current = null;

    const isHls = target.includes(".m3u8");
    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.loadSource(target);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setStatus("HLS manifest parsed via hls.js - playing in the webview. ✅");
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) setStatus(`hls.js error: ${data.type} / ${data.details}`);
      });
    } else {
      // Native playback path (WKWebView plays HLS natively; MP4 everywhere).
      video.src = target;
      video.play().catch(() => {});
      setStatus("Playing via native <video> in the webview. ✅");
    }
  }

  async function openExternal(target: string) {
    try {
      const result = await invoke<string>("open_in_external_player", { url: target });
      setHandoff(`Desktop hand-off → ${result} (this is the MKV/HEVC path).`);
    } catch (e) {
      setHandoff(`Hand-off failed: ${String(e)}`);
    }
  }

  // Auto-load the first stream on mount (muted → autoplay allowed) so the POC
  // demonstrates in-webview playback immediately.
  useEffect(() => {
    const t = setTimeout(() => loadInApp(PRESETS[0].url), 400);
    return () => { clearTimeout(t); hlsRef.current?.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="shell">
      <div className="aurora" />
      <header>
        <h1><span className="logo">▶</span> DebridStreamer · Tauri player POC</h1>
        <p className="sub">Two-backend player: hls.js / native <code>&lt;video&gt;</code> in the webview (browser path) + native-player hand-off for MKV/HEVC (desktop path).</p>
      </header>

      <section className="panel">
        <div className="row">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a Real-Debrid direct / HLS link"
            spellCheck={false}
          />
          <button className="primary" onClick={() => loadInApp(url)}>Play in app</button>
          <button onClick={() => openExternal(url)}>Open in VLC ↗</button>
        </div>
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p.url} className="chip" onClick={() => { setUrl(p.url); loadInApp(p.url); }}>
              <span className="kind">{p.kind}</span> {p.label}
            </button>
          ))}
        </div>
      </section>

      <section className="player">
        <video ref={videoRef} controls playsInline muted autoPlay />
      </section>

      <footer>
        <div className="status">{status}</div>
        {handoff && <div className="handoff">{handoff}</div>}
      </footer>
    </main>
  );
}
