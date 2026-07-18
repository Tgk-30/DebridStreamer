import { useEffect, useState } from "react";
import type { PixelSize, PlaybackEngine } from "../../lib/playbackEngine";
import { PLAYBACK_ENGINE_LABEL } from "../../lib/playbackEngine";
import { getAppVersion } from "../../lib/appVersion";
import { Icon } from "../Icon";
import { useModalA11y } from "../useModalA11y";
import "./PlayerInfoPopover.css";

interface Props {
  engine: PlaybackEngine;
  sourceSize: PixelSize | null;
  displaySize: PixelSize | null;
  /** Technical source name stays out of the playback chrome but remains
   * available in diagnostics for support and source selection checks. */
  sourceFileName?: string | null;
  /** The panel opens to Info from the control and to Shortcuts from "?". */
  section: "info" | "shortcuts";
  onSectionChange: (section: "info" | "shortcuts") => void;
  shortcuts: ReadonlyArray<readonly [string, string]>;
  onClose: () => void;
}

function dimensions(size: PixelSize | null): string {
  return size == null ? "Waiting for media" : `${size.width} × ${size.height} px`;
}

/** Permanent, renderer-independent playback diagnostics. */
export function PlayerInfoPopover({
  engine,
  sourceSize,
  displaySize,
  sourceFileName,
  section,
  onSectionChange,
  shortcuts,
  onClose,
}: Props) {
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const dialogRef = useModalA11y<HTMLElement>(onClose);

  useEffect(() => {
    let mounted = true;
    void getAppVersion().then((version) => {
      if (mounted) setAppVersion(version);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <section
      ref={dialogRef}
      className="player-info-popover"
      role="dialog"
      aria-modal="true"
      aria-label="Player details and shortcuts"
      tabIndex={-1}
    >
      <div className="player-info-head">
        <strong>Player details</strong>
        <button
          type="button"
          className="player-info-close"
          onClick={onClose}
          aria-label="Close playback information"
        >
          <Icon name="xmark" size={15} />
        </button>
      </div>
      <div className="player-info-tabs" role="tablist" aria-label="Player details">
        <button
          type="button"
          role="tab"
          aria-selected={section === "info"}
          className={section === "info" ? "is-active" : ""}
          onClick={() => onSectionChange("info")}
        >
          Info
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "shortcuts"}
          className={section === "shortcuts" ? "is-active" : ""}
          onClick={() => onSectionChange("shortcuts")}
        >
          Shortcuts
        </button>
      </div>
      {section === "info" ? (
        <dl className="player-info-grid" role="tabpanel" aria-label="Info">
          <dt>Engine</dt>
          <dd>{PLAYBACK_ENGINE_LABEL[engine]}</dd>
          <dt>Version</dt>
          <dd className="player-info-version">v{appVersion ?? "…"}</dd>
          <dt>Source</dt>
          <dd>{dimensions(sourceSize)}</dd>
          <dt>Display</dt>
          <dd>{dimensions(displaySize)}</dd>
          {sourceFileName != null && sourceFileName.length > 0 && (
            <>
              <dt>File</dt>
              <dd className="player-info-file" title={sourceFileName}>
                {sourceFileName}
              </dd>
            </>
          )}
        </dl>
      ) : (
        <ul className="player-info-shortcuts" role="tabpanel" aria-label="Shortcuts">
          {shortcuts.map(([keys, label]) => (
            <li key={keys}>
              <kbd>{keys}</kbd>
              <span>{label}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
