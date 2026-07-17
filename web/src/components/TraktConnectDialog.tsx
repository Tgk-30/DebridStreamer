// Trakt device-code connection dialog. Tokens only pass through the dedicated
// traktConnection module after Trakt approves the device code.

import { useEffect, useRef, useState } from "react";
import { saveTraktTokens } from "../data/traktConnection";
import { TraktSyncService } from "../services/sync/TraktSyncService";
import type {
  TraktDeviceCodeResponse,
  TraktTokenResponse,
} from "../services/sync/models";
import { TraktSyncError } from "../services/sync/types";
import { Icon } from "./Icon";
import { useModalA11y } from "./useModalA11y";
import "./TraktConnectDialog.css";

export interface TraktDeviceAuthService {
  startDeviceAuth(clientId: string): Promise<TraktDeviceCodeResponse>;
  exchangeDeviceCode(
    clientId: string,
    clientSecret: string,
    deviceCode: string,
  ): Promise<TraktTokenResponse>;
}

type DialogState = "loading" | "waiting" | "expired" | "failed";

function isPendingAuthorization(error: unknown): boolean {
  return (
    error instanceof TraktSyncError &&
    error.kind === "httpStatus" &&
    error.statusCode === 400
  );
}

export function TraktConnectDialog({
  clientId,
  clientSecret,
  onClose,
  onConnected,
  service,
}: {
  clientId: string;
  clientSecret: string;
  onClose: () => void;
  onConnected: () => void;
  service?: TraktDeviceAuthService;
}) {
  const dialogRef = useModalA11y<HTMLDivElement>(onClose);
  const defaultService = useRef<TraktDeviceAuthService | null>(null);
  if (defaultService.current == null) {
    defaultService.current = new TraktSyncService();
  }
  const syncService = service ?? defaultService.current;
  const [state, setState] = useState<DialogState>("loading");
  const [deviceAuth, setDeviceAuth] = useState<TraktDeviceCodeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unmounted = false;
    let finished = false;
    let pollTimer: number | null = null;
    let expiryTimer: number | null = null;

    function clearTimers() {
      if (pollTimer != null) window.clearTimeout(pollTimer);
      if (expiryTimer != null) window.clearTimeout(expiryTimer);
      pollTimer = null;
      expiryTimer = null;
    }

    function showFailure(reason: unknown) {
      if (unmounted || finished) return;
      finished = true;
      clearTimers();
      setState("failed");
      setError(reason instanceof Error ? reason.message : String(reason));
    }

    async function begin() {
      try {
        const code = await syncService.startDeviceAuth(clientId);
        if (unmounted || finished) return;
        setDeviceAuth(code);
        setState("waiting");

        const intervalMs = Math.max(1, code.interval) * 1000;
        const expiresMs = Math.max(1, code.expiresIn) * 1000;

        const poll = async () => {
          if (unmounted || finished) return;
          try {
            const token = await syncService.exchangeDeviceCode(
              clientId,
              clientSecret,
              code.deviceCode,
            );
            if (unmounted || finished) return;
            clearTimers();
            await saveTraktTokens(token);
            if (unmounted || finished) return;
            finished = true;
            onConnected();
            onClose();
          } catch (pollError) {
            if (unmounted || finished) return;
            if (isPendingAuthorization(pollError)) {
              pollTimer = window.setTimeout(() => void poll(), intervalMs);
              return;
            }
            showFailure(pollError);
          }
        };

        pollTimer = window.setTimeout(() => void poll(), intervalMs);
        expiryTimer = window.setTimeout(() => {
          if (unmounted || finished) return;
          finished = true;
          clearTimers();
          setState("expired");
        }, expiresMs);
      } catch (startError) {
        showFailure(startError);
      }
    }

    void begin();
    return () => {
      unmounted = true;
      finished = true;
      clearTimers();
    };
  }, [clientId, clientSecret, onClose, onConnected, syncService]);

  return (
    <div className="trakt-connect-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="trakt-connect-dialog glass-hero glass-lit"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Connect Trakt"
        tabIndex={-1}
      >
        <div className="trakt-connect-head">
          <h2>Connect Trakt</h2>
          <button type="button" className="trakt-connect-close" onClick={onClose} aria-label="Close">
            <Icon name="xmark" size={18} />
          </button>
        </div>

        {state === "loading" && (
          <p className="trakt-connect-note t-secondary">Requesting a Trakt device code…</p>
        )}

        {deviceAuth != null && state === "waiting" && (
          <div className="trakt-connect-body">
            <p className="trakt-connect-note t-secondary">
              Enter this code at{" "}
              <a href={deviceAuth.verificationURL} target="_blank" rel="noopener noreferrer">
                {deviceAuth.verificationURL}
              </a>
              . Keep this window open while Trakt confirms the connection.
            </p>
            <output className="trakt-connect-code" aria-label="Trakt device code">
              {deviceAuth.userCode}
            </output>
            <p className="trakt-connect-note t-secondary" aria-live="polite">
              Waiting for approval…
            </p>
          </div>
        )}

        {state === "expired" && (
          <p className="trakt-connect-error" role="alert">
            This code expired. Close this dialog and try again.
          </p>
        )}

        {state === "failed" && (
          <p className="trakt-connect-error" role="alert">
            {error ?? "Could not start the Trakt connection."}
          </p>
        )}
      </div>
    </div>
  );
}
