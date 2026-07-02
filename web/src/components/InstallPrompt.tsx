// InstallPrompt — dismissible "add to home screen" card, shown ONLY in a
// mobile browser session (never Tauri, never once installed/standalone).
// Android/Chromium: a real one-tap Install via the captured
// beforeinstallprompt; where the event never fires (iOS always, Firefox,
// unmet PWA criteria, dev builds) the card still renders platform-specific
// manual steps — that copy is the only guidance those environments get.

import { useEffect, useState } from "react";
import { deviceKind, isMobileBrowser, isStandaloneDisplay } from "../lib/platform";
import { isTauri } from "../lib/tauri";
import {
  consumeInstallPrompt,
  getInstallPrompt,
  subscribeInstallPrompt,
} from "../lib/installPrompt";
import { Icon } from "./Icon";
import "./InstallPrompt.css";

/** Static platform gate: never in Tauri, never standalone, mobile UA only. */
export function isInstallPromptEligible(): boolean {
  return !isTauri() && !isStandaloneDisplay() && isMobileBrowser();
}

export function InstallPrompt({ onDismiss }: { onDismiss: () => void }) {
  const kind = deviceKind(); // "ios" | "android" behind the eligibility gate
  const [prompt, setPrompt] = useState(getInstallPrompt);
  useEffect(() => subscribeInstallPrompt(setPrompt), []);

  async function install() {
    if (prompt == null) return;
    await prompt.prompt();
    const choice = await prompt.userChoice.catch(() => null);
    consumeInstallPrompt();
    setPrompt(null);
    // Accepted → the appinstalled/standalone state takes over; retire the card.
    // Dismissed → keep the card; the user can still X it away themselves.
    if (choice?.outcome === "accepted") onDismiss();
  }

  return (
    <div
      className="install-prompt glass-hero glass-lit"
      role="status"
      aria-label="Install app suggestion"
    >
      <span className="install-prompt-icon" aria-hidden>
        <Icon name="upload" size={16} />
      </span>
      <div className="install-prompt-text">
        <strong>Install DebridStreamer</strong>
        {kind === "ios" ? (
          <ol className="install-prompt-steps">
            <li>
              Tap the Share button <Icon name="share" size={13} /> in
              Safari&rsquo;s toolbar.
            </li>
            <li>
              Scroll and tap <strong>Add to Home Screen</strong>.
            </li>
            <li>
              Tap <strong>Add</strong>.
            </li>
          </ol>
        ) : prompt != null ? (
          <span className="t-secondary">
            Add it to your home screen — full screen, no browser bars.
          </span>
        ) : (
          <span className="t-secondary">
            Open your browser menu and choose{" "}
            <strong>Add to Home screen</strong> (or <strong>Install app</strong>).
          </span>
        )}
      </div>
      {kind === "android" && prompt != null && (
        <div className="install-prompt-actions">
          <button
            type="button"
            className="btn btn-prominent"
            onClick={() => void install()}
          >
            Install
          </button>
        </div>
      )}
      <button
        type="button"
        className="install-prompt-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss install suggestion"
      >
        <Icon name="xmark" size={16} />
      </button>
    </div>
  );
}
