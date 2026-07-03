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
import { testDebridToken, testOmdbKey, testTmdbKey } from "../lib/onboardingValidation";
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
    copy: "A quick two-step setup — a catalog key and your debrid service — and you're streaming. No account needed.",
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

/** The catalog step's validated result: exactly one key, or null when the
 *  (non-forced) built-in-catalog escape was taken. */
export interface CatalogKey {
  tmdbKey?: string;
  omdbKey?: string;
}

export function FirstRunWizard({
  onDone,
  forced = false,
}: {
  onDone: () => void;
  /** Mandatory mode: the launch found no catalog key or no debrid token, so
   *  skipping and the keyless escapes are hidden — the wizard only closes by
   *  actually configuring the app (or picking the server paths, which supply
   *  keys from a server). */
  forced?: boolean;
}) {
  const { settings, updateSettings, navigate } = useAppStore();
  const [step, setStep] = useState<
    "choose" | "connect" | "host" | "catalog" | "streaming" | "skip-confirm"
  >("choose");
  // Validated catalog key carried from the catalog step; null = the user chose
  // the built-in-catalog escape (an existing key is never clobbered).
  const [collectedCatalog, setCollectedCatalog] = useState<CatalogKey | null>(null);
  // Which persona the key steps will exit into. In forced mode the advanced and
  // host paths route THROUGH catalog+streaming first — otherwise they'd close
  // the mandatory wizard keyless and every next launch would re-trap the user.
  const [exitPersona, setExitPersona] = useState<"device" | "advanced" | "host">(
    "device",
  );

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
    const next: AppSettings = {
      ...settings,
      // Advanced keeps the full UI it asked for; device/host stay simple.
      simpleMode: exitPersona !== "advanced",
    };
    if (collectedCatalog?.tmdbKey != null && collectedCatalog.tmdbKey.trim().length > 0) {
      next.tmdbKey = collectedCatalog.tmdbKey.trim();
    }
    if (collectedCatalog?.omdbKey != null && collectedCatalog.omdbKey.trim().length > 0) {
      next.omdbKey = collectedCatalog.omdbKey.trim();
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
    // Advanced and host asked for Settings — land them there once keys are in.
    if (exitPersona !== "device") navigate("settings");
    onDone();
  }

  async function choose(id: Persona["id"]) {
    if (id === "device") {
      setExitPersona("device");
      return setStep("catalog");
    }
    if (id === "advanced") {
      // Forced: keys first, then the full settings they asked for — a keyless
      // finish would just re-trap them on the next launch.
      if (forced) {
        setExitPersona("advanced");
        return setStep("catalog");
      }
      return finish(false, () => navigate("settings"));
    }
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
        onContinue={() => {
          // Forced: collect this device's keys before the hosting hand-off —
          // hosting setup lives in Settings, but the local client must not
          // leave the mandatory wizard unusable.
          if (forced) {
            setExitPersona("host");
            setStep("catalog");
            return;
          }
          void finish(true, () => navigate("settings"));
        }}
      />
    );
  }
  if (step === "catalog") {
    return (
      <CatalogStep
        initialTmdb={collectedCatalog?.tmdbKey ?? settings.tmdbKey}
        initialOmdb={collectedCatalog?.omdbKey ?? settings.omdbKey}
        forced={forced}
        onBack={() => setStep("choose")}
        onNext={(key) => {
          setCollectedCatalog(key);
          setStep("streaming");
        }}
      />
    );
  }
  if (step === "streaming") {
    return (
      <StreamingStep
        existing={settings.debridTokens}
        forced={forced}
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
          {forced
            ? "The app needs its keys before it can search or stream — pick a path to set them up."
            : "Pick one to get started — you can change anything later in Settings."}
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
        {!forced && (
          <button
            type="button"
            className="first-run-skip"
            onClick={() => setStep("skip-confirm")}
          >
            Skip for now
          </button>
        )}
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

/** Device step 1 — the catalog key. Accepts a live-validated TMDB key or (per
 *  the "tmdb OR omdb" minimum) a live-validated OMDb key via the mode toggle.
 *  The keyless built-in-catalog escape exists only when NOT forced. */
function CatalogStep({
  initialTmdb,
  initialOmdb,
  forced,
  onBack,
  onNext,
}: {
  initialTmdb: string;
  initialOmdb: string;
  forced: boolean;
  onBack: () => void;
  onNext: (key: CatalogKey | null) => void;
}) {
  const [mode, setMode] = useState<"tmdb" | "omdb">("tmdb");
  const [tmdb, setTmdb] = useState(initialTmdb);
  const [omdb, setOmdb] = useState(initialOmdb);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signup = signupUrl(mode);

  function switchMode(next: "tmdb" | "omdb") {
    setMode(next);
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = (mode === "tmdb" ? tmdb : omdb).trim();
    if (trimmed.length === 0) {
      setError(
        mode === "tmdb"
          ? "Enter your TMDB API key — the app can't search without a catalog key."
          : "Enter your OMDb API key — the app can't look titles up without a catalog key.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    if (mode === "tmdb") {
      const result = await testTmdbKey(trimmed);
      if (result === "ok") {
        onNext({ tmdbKey: trimmed });
        return;
      }
      setError(
        result === "unauthorized"
          ? "TMDB rejected that key — double-check it (use the v3 API key)."
          : "Couldn't reach TMDB — check your connection and try again.",
      );
    } else {
      const result = await testOmdbKey(trimmed);
      if (result === "ok") {
        onNext({ omdbKey: trimmed });
        return;
      }
      setError(
        result === "unauthorized"
          ? "OMDb rejected that key — double-check it (free keys need the email activation link)."
          : "Couldn't reach OMDb — check your connection and try again.",
      );
    }
    setBusy(false);
  }

  return (
    <div className="first-run">
      <div className="first-run-card">
        <DeviceProgress active={1} />
        <h1 className="first-run-title">Power up search &amp; artwork</h1>
        <p className="first-run-sub">
          {mode === "tmdb" ? CONCEPTS.tmdb.blurb : CONCEPTS.omdb.blurb}
        </p>
        <form className="first-run-form" onSubmit={submit}>
          {mode === "tmdb" ? (
            <label className="first-run-field">
              TMDB API key
              <input
                value={tmdb}
                onChange={(e) => setTmdb(e.target.value)}
                placeholder="v3 API key"
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
            </label>
          ) : (
            <label className="first-run-field">
              OMDb API key
              <input
                value={omdb}
                onChange={(e) => setOmdb(e.target.value)}
                placeholder="OMDb key"
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
            </label>
          )}
          {signup != null && (
            <a
              className="server-setup-signup"
              href={signup}
              target="_blank"
              rel="noreferrer"
            >
              Get a free key ↗
            </a>
          )}
          {error != null && (
            <p className="first-run-error" role="alert">
              {error}
            </p>
          )}
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
          onClick={() => switchMode(mode === "tmdb" ? "omdb" : "tmdb")}
        >
          {mode === "tmdb"
            ? "Only have an OMDb key? Use that instead"
            : "Use a TMDB key instead (full search & artwork)"}
        </button>
        {!forced && (
          <button
            type="button"
            className="first-run-escape"
            onClick={() => onNext(null)}
          >
            Continue with the built-in catalog (limited — no search artwork, no
            episode guide)
          </button>
        )}
        <p className="first-run-footnote">
          {mode === "tmdb"
            ? "Optional: an OMDb key adds IMDb / Rotten Tomatoes ratings — add it any time in Settings → Keys."
            : "Heads up: OMDb covers lookups and ratings; a TMDB key gives the full search, artwork, and episode-guide experience. You can add one any time in Settings → Keys."}
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
  forced,
  onBack,
  onDone,
}: {
  existing: DebridTokenEntry[];
  forced: boolean;
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

  // A failed check only vouches for the exact service+token it ran against —
  // any edit hides the save-without-testing hatch until the user tests again.
  function changeService(next: DebridServiceType) {
    setService(next);
    setToken(existing.find((t) => t.service === next)?.apiToken ?? "");
    setUnverifiedOk(false);
    setError(null);
  }
  function changeToken(next: string) {
    setToken(next);
    setUnverifiedOk(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      setError(
        forced
          ? "Paste your API token — nothing can play without a debrid service."
          : "Paste your API token, or choose Add later.",
      );
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
    setError(
      "Couldn't verify that token — it may be mistyped, or your browser may be blocked from reaching the provider.",
    );
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
                onChange={(e) => changeService(e.target.value as DebridServiceType)}
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
                onChange={(e) => changeToken(e.target.value)}
                placeholder="API token"
                autoComplete="off"
                spellCheck={false}
                autoFocus
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
          {error != null && (
            <p className="first-run-error" role="alert">
              {error}
            </p>
          )}
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
        {!forced && (
          <button
            type="button"
            className="first-run-escape"
            onClick={() => onDone(null)}
          >
            Add later — nothing will play until you do.
          </button>
        )}
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
          {error != null && (
            <p className="first-run-error" role="alert">
              {error}
            </p>
          )}
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
