// Persona-based first-run wizard (Local Mode only). Routes a brand-new user down
// one of four paths and configures the right defaults + experience tier, or lets
// them skip. Mounted by FirstRunHost (see App.tsx) when isFirstRun() is true.

import { useState, type FormEvent } from "react";
import { useAppStore } from "../store/AppStore";
import { markOnboardingComplete } from "../lib/firstRun";
import { saveServerURL } from "../lib/serverMode";
import { isTauri } from "../lib/tauri";
import { Icon, type IconName } from "./Icon";
import "./FirstRunWizard.css";

interface Persona {
  id: "device" | "connect" | "host" | "advanced";
  title: string;
  copy: string;
  icon: IconName;
  /** Optional highlight chip; also marks the card as the recommended path. */
  badge?: string;
}

const PERSONAS: Persona[] = [
  {
    id: "device",
    title: "Just watch on this device",
    copy: "A quick one-time setup — a debrid service and a source — and you're streaming. No account needed.",
    icon: "play",
    badge: "Most popular",
  },
  {
    id: "connect",
    title: "Connect to a server",
    copy: "Already have a server or an invite link? Paste the address and sign in.",
    icon: "share",
  },
  {
    id: "host",
    title: "Host for my family",
    copy: "Run the server on this computer; your household signs in from their own devices.",
    icon: "debrid",
  },
  {
    id: "advanced",
    title: "Advanced setup",
    copy: "Skip the wizard and open full settings — every provider, source, and dial.",
    icon: "sliders",
  },
];

/** Add a scheme if the user typed a bare host, and drop a trailing slash. */
function normalizeURL(raw: string): string {
  let value = raw.trim();
  if (value.length === 0) return "";
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  return value.replace(/\/+$/, "");
}

export function FirstRunWizard({ onDone }: { onDone: () => void }) {
  const { settings, updateSettings, navigate } = useAppStore();
  const [step, setStep] = useState<"choose" | "connect" | "host">("choose");

  async function finish(simple: boolean, andThen?: () => void) {
    updateSettings({ ...settings, simpleMode: simple });
    await markOnboardingComplete();
    andThen?.();
    onDone();
  }

  async function choose(id: Persona["id"]) {
    if (id === "device") return finish(true);
    if (id === "advanced") return finish(false, () => navigate("settings"));
    if (id === "connect") return setStep("connect");
    if (id === "host") return setStep("host");
  }

  async function skip() {
    await markOnboardingComplete();
    onDone();
  }

  if (step === "connect") {
    return <ConnectStep onBack={() => setStep("choose")} />;
  }
  if (step === "host") {
    return (
      <HostStep
        onBack={() => setStep("choose")}
        onContinue={() => void finish(true, () => navigate("settings"))}
      />
    );
  }

  return (
    <div className="first-run">
      <div className="first-run-card">
        <p className="first-run-eyebrow">
          <Icon name="sparkles" size={13} />
          Welcome to DebridStreamer
        </p>
        <h1 className="first-run-title">How do you want to use DebridStreamer?</h1>
        <p className="first-run-sub">
          Pick one to get started — you can change anything later in Settings.
        </p>
        <div className="first-run-choices">
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={
                "first-run-choice" + (p.badge != null ? " is-recommended" : "")
              }
              onClick={() => void choose(p.id)}
            >
              <span className="first-run-choice-icon" aria-hidden>
                <Icon name={p.icon} size={17} />
              </span>
              <span className="first-run-choice-body">
                <span className="first-run-choice-head">
                  <span className="first-run-choice-title">{p.title}</span>
                  {p.badge != null && (
                    <span className="first-run-choice-badge">{p.badge}</span>
                  )}
                </span>
                <span className="first-run-choice-copy">{p.copy}</span>
              </span>
            </button>
          ))}
        </div>
        <button type="button" className="first-run-skip" onClick={() => void skip()}>
          Skip for now
        </button>
      </div>
    </div>
  );
}

function ConnectStep({ onBack }: { onBack: () => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeURL(url);
    if (normalized.length === 0) {
      setError("Enter your server address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${normalized}/api/health`, { credentials: "include" });
      if (!res.ok) throw new Error(`Server responded ${res.status}.`);
      // Mark complete BEFORE reloading so disconnecting back to Local Mode later
      // doesn't re-trigger the wizard.
      await markOnboardingComplete();
      saveServerURL(normalized);
      window.location.reload();
    } catch (err) {
      setError(
        err instanceof Error
          ? `Couldn't reach that server (${err.message})`
          : "Couldn't reach that server.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="first-run">
      <div className="first-run-card">
        <h1 className="first-run-title">Connect to a server</h1>
        <p className="first-run-sub">
          Paste the address your server admin gave you (or from your invite link).
        </p>
        <form className="first-run-form" onSubmit={submit}>
          <label className="first-run-field">
            Server address
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://stream.example.com"
              autoComplete="url"
              inputMode="url"
              autoFocus
            />
          </label>
          {error != null && <p className="first-run-error">{error}</p>}
          <div className="first-run-actions">
            <button type="button" className="first-run-secondary" onClick={onBack}>
              Back
            </button>
            <button type="submit" className="first-run-primary" disabled={busy}>
              {busy ? "Connecting…" : "Connect"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function HostStep({ onBack, onContinue }: { onBack: () => void; onContinue: () => void }) {
  const desktop = isTauri();
  return (
    <div className="first-run">
      <div className="first-run-card">
        <h1 className="first-run-title">Host for your household</h1>
        <p className="first-run-sub">
          {desktop
            ? "This computer can serve DebridStreamer to your other devices. Open Settings → Install & setup to start hosting and get a link + QR code to share."
            : "Hosting runs in the desktop app (Mac/Windows/Linux) or via Docker on a server. Download the desktop app, or self-host with Docker, then share the link with your household."}
        </p>
        <div className="first-run-actions">
          <button type="button" className="first-run-secondary" onClick={onBack}>
            Back
          </button>
          <button type="button" className="first-run-primary" onClick={onContinue}>
            Open Settings
          </button>
        </div>
      </div>
    </div>
  );
}
