// Persona-based first-run wizard (Local Mode only). Routes a brand-new user down
// one of four paths, or lets them skip past an honest warning. The "device"
// path is a FORCED key-collection flow: the app can't search properly without
// a TMDB key and can't play anything without a debrid token, so both are
// collected (with live validation) before the wizard completes — each with an
// explicit, honest escape rather than a silent skip. Mounted by FirstRunHost
// (see App.tsx) when isFirstRun() is true.

import { useState, type FormEvent } from "react";
import { useAppStore } from "../store/AppStore";
import { markOnboardingComplete } from "../lib/firstRun";
import { saveServerURL } from "../lib/serverMode";
import { isTauri } from "../lib/tauri";
import { DebridServiceType } from "../services/debrid/models";
import type { AppSettings, DebridTokenEntry } from "../data/settings";
import { CONCEPTS, DEBRID_SIGNUP_ID, signupUrl } from "../data/onboardingHelp";
import { testDebridToken, testTmdbKey } from "../lib/onboardingValidation";
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
  const [step, setStep] = useState<
    "choose" | "connect" | "host" | "catalog" | "streaming" | "skip-confirm"
  >("choose");
  // Validated TMDB key carried from the catalog step; null = the user chose
  // the built-in-catalog escape (an existing key is never clobbered).
  const [collectedTmdb, setCollectedTmdb] = useState<string | null>(null);

  async function finish(simple: boolean, andThen?: () => void) {
    updateSettings({ ...settings, simpleMode: simple });
    await markOnboardingComplete();
    andThen?.();
    onDone();
  }

  /** The device path's SINGLE settings write: both collected keys land in one
   *  updateSettings so services rebuild once and nothing races. Escapes pass
   *  null and never write empty values over a re-running user's existing keys. */
  async function finishDevice(debrid: DebridTokenEntry | null) {
    const next: AppSettings = { ...settings, simpleMode: true };
    if (collectedTmdb != null && collectedTmdb.trim().length > 0) {
      next.tmdbKey = collectedTmdb.trim();
    }
    if (debrid != null) {
      // Replace an existing entry for the same provider, else prepend.
      next.debridTokens = [
        debrid,
        ...settings.debridTokens.filter((t) => t.service !== debrid.service),
      ];
    }
    updateSettings(next);
    await markOnboardingComplete();
    onDone();
  }

  async function choose(id: Persona["id"]) {
    if (id === "device") return setStep("catalog");
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
  if (step === "catalog") {
    return (
      <CatalogStep
        initialKey={settings.tmdbKey}
        onBack={() => setStep("choose")}
        onNext={(key) => {
          setCollectedTmdb(key);
          setStep("streaming");
        }}
      />
    );
  }
  if (step === "streaming") {
    return (
      <StreamingStep
        existing={settings.debridTokens}
        onBack={() => setStep("catalog")}
        onDone={(entry) => void finishDevice(entry)}
      />
    );
  }
  if (step === "skip-confirm") {
    return (
      <SkipConfirmStep onBack={() => setStep("choose")} onSkip={() => void skip()} />
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
        <button
          type="button"
          className="first-run-skip"
          onClick={() => setStep("skip-confirm")}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}

/** Two-dot progress rail for the device path (reuses the server-setup CSS). */
function DeviceProgress({ active }: { active: 1 | 2 }) {
  return (
    <ol className="server-setup-progress">
      <li
        className={
          "server-setup-progress-dot " + (active === 1 ? "is-active" : "is-done")
        }
      >
        <span className="server-setup-progress-num">1</span>
        <span className="server-setup-progress-label">Catalog</span>
      </li>
      <li
        className={
          "server-setup-progress-dot" + (active === 2 ? " is-active" : "")
        }
      >
        <span className="server-setup-progress-num">2</span>
        <span className="server-setup-progress-label">Streaming</span>
      </li>
    </ol>
  );
}

/** Device step 1 — the catalog key. Passes only with a live-validated TMDB key
 *  or the explicit (honest) built-in-catalog escape. */
function CatalogStep({
  initialKey,
  onBack,
  onNext,
}: {
  initialKey: string;
  onBack: () => void;
  onNext: (key: string | null) => void;
}) {
  const [key, setKey] = useState(initialKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = key.trim();
    if (trimmed.length === 0) {
      setError("Enter your TMDB API key, or continue with the built-in catalog.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await testTmdbKey(trimmed);
    if (result === "ok") {
      onNext(trimmed);
      return;
    }
    setError(
      result === "unauthorized"
        ? "TMDB rejected that key — double-check it (use the v3 API key)."
        : "Couldn't reach TMDB — check your connection and try again.",
    );
    setBusy(false);
  }

  return (
    <div className="first-run">
      <div className="first-run-card">
        <DeviceProgress active={1} />
        <h1 className="first-run-title">Power up search &amp; artwork</h1>
        <p className="first-run-sub">{CONCEPTS.tmdb.blurb}</p>
        <form className="first-run-form" onSubmit={submit}>
          <label className="first-run-field">
            TMDB API key
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="v3 API key"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </label>
          <a
            className="server-setup-signup"
            href={signupUrl("tmdb")!}
            target="_blank"
            rel="noreferrer"
          >
            Get a free key ↗
          </a>
          {error != null && <p className="first-run-error">{error}</p>}
          <div className="first-run-actions">
            <button type="button" className="first-run-secondary" onClick={onBack}>
              Back
            </button>
            <button type="submit" className="first-run-primary" disabled={busy}>
              {busy ? "Testing…" : "Test key & continue"}
            </button>
          </div>
        </form>
        <button
          type="button"
          className="first-run-escape"
          onClick={() => onNext(null)}
        >
          Continue with the built-in catalog (limited — no search artwork, no
          episode guide)
        </button>
        <p className="first-run-footnote">
          Optional: an OMDb key adds IMDb / Rotten Tomatoes ratings — add it any
          time in Settings → Keys.
        </p>
      </div>
    </div>
  );
}

/** Device step 2 — the streaming token. Passes with a verified debrid token,
 *  an explicit save-without-testing (debrid hosts are CORS-blocked in plain
 *  browsers, so a valid token can fail the live check), or the honest
 *  add-later escape. */
function StreamingStep({
  existing,
  onBack,
  onDone,
}: {
  existing: DebridTokenEntry[];
  onBack: () => void;
  onDone: (entry: DebridTokenEntry | null) => void;
}) {
  const seed = existing.length > 0 ? existing[0] : null;
  const [service, setService] = useState<DebridServiceType>(
    seed?.service ?? "real_debrid",
  );
  const [token, setToken] = useState(seed?.apiToken ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverifiedOk, setUnverifiedOk] = useState(false);

  const signup = signupUrl(DEBRID_SIGNUP_ID[service] ?? "");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      setError("Paste your API token, or choose Add later.");
      return;
    }
    setBusy(true);
    setError(null);
    const ok = await testDebridToken({ service, apiToken: trimmed });
    if (ok) {
      onDone({ service, apiToken: trimmed });
      return;
    }
    // Hedged on purpose: validateToken() can't distinguish a bad token from
    // an offline/CORS-blocked check.
    setError("Couldn't verify that token — check it and your connection.");
    setUnverifiedOk(true);
    setBusy(false);
  }

  return (
    <div className="first-run">
      <div className="first-run-card">
        <DeviceProgress active={2} />
        <h1 className="first-run-title">Connect your debrid service</h1>
        <p className="first-run-sub">{CONCEPTS.debrid.blurb}</p>
        <form className="first-run-form" onSubmit={submit}>
          <div className="server-setup-fields">
            <label className="first-run-field">
              Provider
              <select
                value={service}
                onChange={(e) => setService(e.target.value as DebridServiceType)}
              >
                {DebridServiceType.allCases().map((s) => (
                  <option key={s} value={s}>
                    {DebridServiceType.displayName(s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="first-run-field">
              API token
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="API token"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            {signup != null && (
              <a
                className="server-setup-signup"
                href={signup}
                target="_blank"
                rel="noreferrer"
              >
                Get a {DebridServiceType.displayName(service)} token ↗
              </a>
            )}
          </div>
          {error != null && <p className="first-run-error">{error}</p>}
          <div className="first-run-actions">
            <button type="button" className="first-run-secondary" onClick={onBack}>
              Back
            </button>
            <button type="submit" className="first-run-primary" disabled={busy}>
              {busy ? "Testing…" : "Test token & finish"}
            </button>
          </div>
          {unverifiedOk && (
            <button
              type="button"
              className="first-run-escape"
              onClick={() => onDone({ service, apiToken: token.trim() })}
            >
              Save without testing (the desktop app can reach providers a
              browser can't)
            </button>
          )}
        </form>
        <button
          type="button"
          className="first-run-escape"
          onClick={() => onDone(null)}
        >
          Add later — nothing will play until you do.
        </button>
      </div>
    </div>
  );
}

/** Honest confirmation before skipping the whole wizard. */
function SkipConfirmStep({
  onBack,
  onSkip,
}: {
  onBack: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="first-run">
      <div className="first-run-card">
        <h1 className="first-run-title">Skip setup?</h1>
        <div className="first-run-warn">
          Without a TMDB key, search and artwork are limited. Without a debrid
          token, nothing will play. You can add both any time in Settings →
          Keys.
        </div>
        <div className="first-run-actions">
          <button type="button" className="first-run-primary" onClick={onBack}>
            Go back
          </button>
          <button type="button" className="first-run-danger" onClick={onSkip}>
            Skip anyway
          </button>
        </div>
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
