import { useEffect, useState } from "react";
import type { PixelSize, PlaybackEngine } from "../../lib/playbackEngine";
import { PLAYBACK_ENGINE_LABEL } from "../../lib/playbackEngine";
import { getAppVersion } from "../../lib/appVersion";
import { Icon } from "../Icon";
import "./PlayerInfoPopover.css";

interface Props {
  engine: PlaybackEngine;
  sourceSize: PixelSize | null;
  displaySize: PixelSize | null;
  onClose: () => void;
  onShowShortcuts?: () => void;
}

function dimensions(size: PixelSize | null): string {
  return size == null ? "Waiting for media" : `${size.width} × ${size.height} px`;
}

/** Permanent, renderer-independent playback diagnostics. */
export function PlayerInfoPopover({
  engine,
  sourceSize,
  displaySize,
  onClose,
  onShowShortcuts,
}: Props) {
  const [appVersion, setAppVersion] = useState<string | null>(null);

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
      className="player-info-popover"
      role="dialog"
      aria-label="Playback information"
    >
      <div className="player-info-head">
        <strong>Playback information</strong>
        <button
          type="button"
          className="player-info-close"
          onClick={onClose}
          aria-label="Close playback information"
        >
          <Icon name="xmark" size={15} />
        </button>
      </div>
      <dl className="player-info-grid">
        <dt>Engine</dt>
        <dd>{PLAYBACK_ENGINE_LABEL[engine]}</dd>
        <dt>Version</dt>
        <dd className="player-info-version">v{appVersion ?? "…"}</dd>
        <dt>Source</dt>
        <dd>{dimensions(sourceSize)}</dd>
        <dt>Display</dt>
        <dd>{dimensions(displaySize)}</dd>
      </dl>
      {onShowShortcuts != null && (
        <button
          type="button"
          className="player-info-shortcuts"
          onClick={onShowShortcuts}
        >
          Keyboard shortcuts
        </button>
      )}
    </section>
  );
}
