import { useCallback, useEffect, useState } from "react";
import {
  createTVRemoteSession,
  revokeTVRemoteSession,
} from "../lib/serverApi";
import { isServerMode } from "../lib/serverMode";
import {
  setTVRemoteSession,
  useTVRemoteSession,
} from "../lib/tvRemoteSession";
import "./TVRemote.css";

export function TVPairingDock() {
  const session = useTVRemoteSession();
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const create = useCallback(async () => {
    if (!isServerMode()) return;
    setError(null);
    try {
      const next = await createTVRemoteSession();
      setTVRemoteSession(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  useEffect(() => {
    if (session == null) void create();
  }, [create, session]);

  const refresh = async () => {
    const previous = session;
    setTVRemoteSession(null);
    if (previous != null) {
      await revokeTVRemoteSession(previous.id).catch(() => {});
    }
    await create();
  };

  if (!isServerMode()) {
    return (
      <aside className="tv-pairing-dock glass-raised">
        TV mode needs Server Mode. Open this screen from your YAWF Stream server.
      </aside>
    );
  }

  return (
    <aside
      className={`tv-pairing-dock glass-raised${collapsed ? " is-collapsed" : ""}`}
      aria-label="Phone remote pairing"
    >
      <button
        type="button"
        className="tv-pairing-toggle"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
      >
        {collapsed ? "Show phone remote code" : "Hide phone remote code"}
      </button>
      {!collapsed && (
        <>
          <span className="tv-pairing-eyebrow">Phone remote</span>
          {session != null ? (
            <>
              <strong className="tv-pairing-code">{session.pairingCode}</strong>
              <p>
                Open <b>/remote</b> on your phone and enter this one-time code.
              </p>
              <button type="button" className="btn" onClick={() => void refresh()}>
                New code
              </button>
            </>
          ) : error == null ? (
            <p>Creating a private pairing code…</p>
          ) : (
            <>
              <p role="alert">{error}</p>
              <button type="button" className="btn" onClick={() => void create()}>
                Retry
              </button>
            </>
          )}
        </>
      )}
    </aside>
  );
}
