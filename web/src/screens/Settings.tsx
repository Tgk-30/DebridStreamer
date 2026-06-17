// Settings screen — on-brand tabbed config, persisted to localStorage.
//
// Three tabs:
//   • API keys — TMDB / OMDB metadata keys + the AI provider (kind, key, model).
//   • Debrid — per-service tokens (Real-Debrid / AllDebrid / Premiumize / TorBox),
//     in priority order.
//   • Sources — the built-in scrapers toggle + a list of external indexers
//     (Torznab / Jackett / Prowlarr).
//
// Saving writes through the store (updateSettings → saveSettings), which rebuilds
// the shared service instances, so a TMDB key entered here immediately lights up
// live data elsewhere. NOTE: real persistence + keychain storage of secrets
// arrives with the storage port; localStorage is the stopgap.

import { useState } from "react";
import { useAppStore } from "../store/AppStore";
import type { AppSettings, SourceEntry } from "../data/settings";
import { DebridServiceType } from "../services/debrid/models";
import { AIProviderKind } from "../services/ai/models";
import { IndexerType } from "../services/indexers/types";
import { Icon } from "../components/Icon";
import "./Settings.css";

type Tab = "keys" | "debrid" | "sources";

const TABS: { id: Tab; label: string }[] = [
  { id: "keys", label: "API keys" },
  { id: "debrid", label: "Debrid" },
  { id: "sources", label: "Sources" },
];

export function Settings() {
  const { settings, updateSettings } = useAppStore();
  const [tab, setTab] = useState<Tab>("keys");
  // Edit a local draft; "Save" commits it through the store.
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saved, setSaved] = useState(false);

  function patch(next: Partial<AppSettings>) {
    setDraft((d) => ({ ...d, ...next }));
    setSaved(false);
  }

  function save() {
    updateSettings(draft);
    setSaved(true);
  }

  return (
    <div className="settings-screen">
      <h1 className="settings-h1">Settings</h1>

      <div className="settings-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`chip${tab === t.id ? " is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="settings-panel glass-raised glass-lit">
        {tab === "keys" && <KeysTab draft={draft} patch={patch} />}
        {tab === "debrid" && <DebridTab draft={draft} patch={patch} />}
        {tab === "sources" && <SourcesTab draft={draft} patch={patch} />}
      </div>

      <div className="settings-footer">
        <span className="settings-note t-secondary">
          Stored locally this phase · keychain + sync arrive with the storage port
        </span>
        <button type="button" className="btn btn-prominent" onClick={save}>
          {saved ? "Saved" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

interface TabProps {
  draft: AppSettings;
  patch: (next: Partial<AppSettings>) => void;
}

function KeysTab({ draft, patch }: TabProps) {
  return (
    <div className="settings-fields">
      <Field label="TMDB API key" hint="Powers Discover, Search, and Detail metadata.">
        <input
          type="password"
          value={draft.tmdbKey}
          onChange={(e) => patch({ tmdbKey: e.target.value })}
          placeholder="v3 API key"
        />
      </Field>

      <Field label="OMDB API key" hint="Optional — enriches IMDb / Rotten Tomatoes ratings.">
        <input
          type="password"
          value={draft.omdbKey}
          onChange={(e) => patch({ omdbKey: e.target.value })}
          placeholder="OMDB key"
        />
      </Field>

      <div className="settings-divider" />

      <Field label="AI provider" hint="Backs the Assistant + mood discovery.">
        <select
          value={draft.aiProvider}
          onChange={(e) =>
            patch({ aiProvider: e.target.value as AppSettings["aiProvider"] })
          }
        >
          {AIProviderKind.allCases().map((k) => (
            <option key={k} value={k}>
              {AIProviderKind.displayName(k)}
            </option>
          ))}
        </select>
      </Field>

      {draft.aiProvider === "ollama" ? (
        <Field label="Ollama endpoint" hint="A local Ollama server URL.">
          <input
            type="text"
            value={draft.ollamaEndpoint}
            onChange={(e) => patch({ ollamaEndpoint: e.target.value })}
            placeholder="http://localhost:11434"
          />
        </Field>
      ) : (
        <Field label={`${AIProviderKind.displayName(draft.aiProvider)} API key`}>
          <input
            type="password"
            value={draft.aiApiKey}
            onChange={(e) => patch({ aiApiKey: e.target.value })}
            placeholder="API key"
          />
        </Field>
      )}

      <Field label="Model" hint="Leave blank for the provider default.">
        <input
          type="text"
          value={draft.aiModel}
          onChange={(e) => patch({ aiModel: e.target.value })}
          placeholder="e.g. gpt-4o-mini / claude-haiku-4-5"
        />
      </Field>
    </div>
  );
}

function DebridTab({ draft, patch }: TabProps) {
  function tokenFor(service: AppSettings["debridTokens"][number]["service"]) {
    return draft.debridTokens.find((t) => t.service === service)?.apiToken ?? "";
  }
  function setToken(
    service: AppSettings["debridTokens"][number]["service"],
    token: string,
  ) {
    const others = draft.debridTokens.filter((t) => t.service !== service);
    const next =
      token.trim().length > 0
        ? [...others, { service, apiToken: token }]
        : others;
    patch({ debridTokens: next });
  }

  return (
    <div className="settings-fields">
      <p className="settings-hint t-secondary">
        Tokens are tried in this order; the first that has a torrent cached wins.
      </p>
      {DebridServiceType.allCases().map((service) => (
        <Field
          key={service}
          label={`${DebridServiceType.displayName(service)} token`}
          hint={`Short code ${DebridServiceType.shortCode(service)}`}
        >
          <input
            type="password"
            value={tokenFor(service)}
            onChange={(e) => setToken(service, e.target.value)}
            placeholder="API token"
          />
        </Field>
      ))}
    </div>
  );
}

function SourcesTab({ draft, patch }: TabProps) {
  function addSource() {
    const entry: SourceEntry = {
      id: `src-${Date.now()}`,
      type: IndexerType.torznab,
      baseURL: "",
      apiKey: "",
      isActive: true,
      displayName: "",
    };
    patch({ sources: [...draft.sources, entry] });
  }
  function updateSource(id: string, next: Partial<SourceEntry>) {
    patch({
      sources: draft.sources.map((s) => (s.id === id ? { ...s, ...next } : s)),
    });
  }
  function removeSource(id: string) {
    patch({ sources: draft.sources.filter((s) => s.id !== id) });
  }

  return (
    <div className="settings-fields">
      <label className="settings-toggle-row">
        <input
          type="checkbox"
          checked={draft.builtInIndexersEnabled}
          onChange={(e) => patch({ builtInIndexersEnabled: e.target.checked })}
        />
        <span>
          <strong>Built-in scrapers</strong>
          <span className="t-secondary"> — APIBay, YTS, EZTV (no setup)</span>
        </span>
      </label>

      <div className="settings-divider" />

      <div className="settings-sources-head">
        <span className="settings-sources-title">External indexers</span>
        <button type="button" className="chip" onClick={addSource}>
          <Icon name="sparkles" size={13} /> Add source
        </button>
      </div>

      {draft.sources.length === 0 ? (
        <p className="settings-hint t-secondary">
          No external indexers. The built-in scrapers cover most titles.
        </p>
      ) : (
        draft.sources.map((s) => (
          <div key={s.id} className="settings-source glass-rest">
            <div className="settings-source-row">
              <select
                value={s.type}
                onChange={(e) =>
                  updateSource(s.id, {
                    type: e.target.value as SourceEntry["type"],
                  })
                }
              >
                {(["torznab", "jackett", "prowlarr"] as IndexerType[]).map(
                  (t) => (
                    <option key={t} value={t}>
                      {IndexerType.displayName(t)}
                    </option>
                  ),
                )}
              </select>
              <input
                type="text"
                className="settings-source-name"
                value={s.displayName ?? ""}
                onChange={(e) =>
                  updateSource(s.id, { displayName: e.target.value })
                }
                placeholder="Name (optional)"
              />
              <label className="settings-source-active">
                <input
                  type="checkbox"
                  checked={s.isActive}
                  onChange={(e) =>
                    updateSource(s.id, { isActive: e.target.checked })
                  }
                />
                Active
              </label>
              <button
                type="button"
                className="settings-source-remove"
                onClick={() => removeSource(s.id)}
                aria-label="Remove source"
              >
                <Icon name="xmark" size={15} />
              </button>
            </div>
            <input
              type="text"
              value={s.baseURL}
              onChange={(e) => updateSource(s.id, { baseURL: e.target.value })}
              placeholder="Base URL (e.g. http://localhost:9117)"
            />
            <input
              type="password"
              value={s.apiKey ?? ""}
              onChange={(e) => updateSource(s.id, { apiKey: e.target.value })}
              placeholder="API key (if required)"
            />
          </div>
        ))
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="settings-field">
      <span className="settings-label">{label}</span>
      {hint && <span className="settings-field-hint t-secondary">{hint}</span>}
      {children}
    </label>
  );
}
