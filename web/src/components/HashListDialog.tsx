// HashListDialog — import / export / AI-emit of a shareable hash list.
//
// Three tabs:
//  • Import — paste a hash-list string (dshl1:… or raw hashes), bulk-add each
//    magnet to the user's debrid (so they get cached), with progress + summary.
//  • Export — produce a shareable string from the user's debrid library (the
//    torrents passed in), copyable to the clipboard.
//  • Generate (AI) — ask the assistant for N titles for a prompt, resolve them
//    to infoHashes, and produce a one-click-hydratable hash list.
//
// Everything debrid/indexer/AI is Tauri-gated upstream (this dialog is only
// opened from the Tauri-only Debrid Library screen) and gates gracefully on
// missing services with clear copy. Imports services READ-ONLY via the store.

import { useState } from "react";
import { useAppStore } from "../store/AppStore";
import { useModalA11y } from "./useModalA11y";
import { Icon } from "../components/Icon";
import type { DebridTorrent } from "../services/debrid/models";
import { parseHashListInput, type HashListEntry } from "../lib/hashlist";
import {
  importHashList,
  exportHashList,
  aiEmitHashList,
  type ImportSummary,
} from "../data/hashlistActions";
import "./HashListDialog.css";

type Tab = "import" | "export" | "generate";

interface HashListDialogProps {
  /** The user's debrid torrents (the export source). */
  torrents: DebridTorrent[];
  onClose: () => void;
  /** Called after a successful import so the caller can refresh its list. */
  onImported?: () => void;
}

export function HashListDialog({
  torrents,
  onClose,
  onImported,
}: HashListDialogProps) {
  const { services } = useAppStore();
  const [tab, setTab] = useState<Tab>("import");
  const dialogRef = useModalA11y<HTMLDivElement>(onClose);

  return (
    <div className="hl-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="hl-dialog glass-hero glass-lit"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Hash list"
        tabIndex={-1}
      >
        <div className="hl-head">
          <h2 className="hl-title">Hash list</h2>
          <button
            type="button"
            className="hl-close"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="xmark" size={18} />
          </button>
        </div>

        <div className="hl-tabs">
          {(["import", "export", "generate"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`chip${tab === t ? " is-active hl-tab-active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t === "import" ? "Import" : t === "export" ? "Export" : "Generate"}
            </button>
          ))}
        </div>

        <div className="hl-body">
          {tab === "import" && (
            <ImportTab
              hasDebrid={services.debrid != null && services.debrid.hasServices}
              onImported={onImported}
            />
          )}
          {tab === "export" && <ExportTab torrents={torrents} />}
          {tab === "generate" && <GenerateTab />}
        </div>
      </div>
    </div>
  );
}

// ---- Import tab -------------------------------------------------------------

function ImportTab({
  hasDebrid,
  onImported,
}: {
  hasDebrid: boolean;
  onImported?: () => void;
}) {
  const { services } = useAppStore();
  const [text, setText] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed: HashListEntry[] = parseHashListInput(text);

  async function run() {
    if (services.debrid == null || parsed.length === 0) return;
    setError(null);
    setSummary(null);
    setProgress({ done: 0, total: parsed.length });
    try {
      const result = await importHashList(parsed, services.debrid, (done, total) =>
        setProgress({ done, total }),
      );
      setSummary(result);
      if (result.succeeded > 0) onImported?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  }

  if (!hasDebrid) {
    return (
      <p className="hl-note t-secondary">
        Configure a debrid service in Settings to import a hash list onto your
        account.
      </p>
    );
  }

  return (
    <div className="hl-pane">
      <p className="hl-note t-secondary">
        Paste a hash list (a <code>dshl1:…</code> string, or raw infoHashes one
        per line). Each torrent is added to your debrid so it gets cached.
      </p>
      <textarea
        className="hl-textarea"
        placeholder="dshl1:… or 40-character infoHashes"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        // Bound the input so the parse (run on every keystroke) can't be fed a
        // huge paste; decodeHashList also caps the compressed/inflated payload.
        maxLength={300 * 1024}
      />
      <div className="hl-row">
        <span className="t-secondary hl-count">
          {parsed.length > 0
            ? `${parsed.length} hash${parsed.length === 1 ? "" : "es"} detected`
            : "No valid hashes detected"}
        </span>
        <button
          type="button"
          className="btn btn-prominent"
          disabled={parsed.length === 0 || progress != null}
          onClick={() => void run()}
        >
          {progress != null
            ? `Adding ${progress.done}/${progress.total}…`
            : "Add to debrid"}
        </button>
      </div>

      {error && <p className="hl-error">{error}</p>}

      {summary && (
        <div className="hl-summary glass-rest">
          <p>
            <Icon name="check" size={15} className="t-accent" /> Added{" "}
            {summary.succeeded} of {summary.total}.
            {summary.failed > 0 && ` ${summary.failed} failed.`}
          </p>
        </div>
      )}
    </div>
  );
}

// ---- Export tab -------------------------------------------------------------

function ExportTab({ torrents }: { torrents: DebridTorrent[] }) {
  const shareable = torrents.length > 0;
  const [encoded, setEncoded] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const withHash = torrents.filter((t) => t.infoHash != null);

  function generate() {
    setEncoded(exportHashList(torrents));
    setCopied(false);
  }

  async function copy() {
    if (encoded == null) return;
    try {
      await navigator.clipboard.writeText(encoded);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (!shareable) {
    return (
      <p className="hl-note t-secondary">
        Your debrid library is empty — add some torrents first, then export them
        as a shareable hash list.
      </p>
    );
  }

  return (
    <div className="hl-pane">
      <p className="hl-note t-secondary">
        Share the {withHash.length} torrent
        {withHash.length === 1 ? "" : "s"} on your account as a compact string
        anyone can import to cache the same set.
      </p>
      {encoded == null ? (
        <button type="button" className="btn btn-prominent" onClick={generate}>
          <Icon name="share" size={15} />
          Generate shareable string
        </button>
      ) : (
        <>
          <textarea
            className="hl-textarea hl-readonly"
            value={encoded}
            readOnly
            rows={4}
          />
          <div className="hl-row">
            <span className="t-secondary hl-count">
              {encoded.length} characters
            </span>
            <button type="button" className="btn btn-prominent" onClick={() => void copy()}>
              <Icon name={copied ? "check" : "share"} size={15} />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---- Generate (AI) tab ------------------------------------------------------

function GenerateTab() {
  const { services } = useAppStore();
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(8);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [encoded, setEncoded] = useState<string | null>(null);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const hasAI = services.ai != null;

  async function run() {
    if (prompt.trim().length === 0) return;
    setLoading(true);
    setError(null);
    setEncoded(null);
    setUnresolved([]);
    setCopied(false);
    try {
      const result = await aiEmitHashList(prompt.trim(), count, {
        ai: services.ai,
        tmdb: services.tmdb,
        indexers: services.indexers,
        debrid: services.debrid,
      });
      setEncoded(result.encoded);
      setUnresolved(result.unresolved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (encoded == null) return;
    try {
      await navigator.clipboard.writeText(encoded);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (!hasAI) {
    return (
      <p className="hl-note t-secondary">
        Configure an AI provider in Settings to generate a curated hash list from
        a prompt.
      </p>
    );
  }

  return (
    <div className="hl-pane">
      <p className="hl-note t-secondary">
        Describe a vibe and the assistant will pick titles, resolve them to the
        best cached/seeded torrents, and produce a one-click hash list.
      </p>
      <div className="field glass-rest hl-prompt">
        <Icon name="wand-search" size={16} className="t-accent" />
        <input
          type="text"
          placeholder="e.g. essential 90s sci-fi"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
          }}
          aria-label="Describe the list to generate"
        />
      </div>
      <div className="hl-row">
        <label className="hl-count-input t-secondary">
          Count
          <input
            type="number"
            min={1}
            max={20}
            value={count}
            onChange={(e) =>
              setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
            }
          />
        </label>
        <button
          type="button"
          className="btn btn-prominent"
          disabled={prompt.trim().length === 0 || loading}
          onClick={() => void run()}
        >
          {loading ? (
            <>
              <span className="hl-spinner" aria-hidden="true" />
              Working…
            </>
          ) : (
            "Generate"
          )}
        </button>
      </div>

      {error && <p className="hl-error">{error}</p>}

      {encoded != null && (
        <>
          <textarea
            className="hl-textarea hl-readonly"
            value={encoded}
            readOnly
            rows={4}
          />
          {unresolved.length > 0 && (
            <p className="hl-note t-secondary">
              Could not resolve: {unresolved.join(", ")}
            </p>
          )}
          <div className="hl-row">
            <span className="t-secondary hl-count">{encoded.length} characters</span>
            <button type="button" className="btn btn-prominent" onClick={() => void copy()}>
              <Icon name={copied ? "check" : "share"} size={15} />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
