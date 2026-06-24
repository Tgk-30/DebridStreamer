// "Who's watching?" picker (Server Mode only).
//
// A full-screen overlay listing the account's household sub-profiles. Selecting
// one calls POST /api/profiles/switch, then re-hydrates the app store so the new
// profile's watchlist / history / settings replace the previous profile's. An
// edit mode exposes add / rename / delete (the default profile can't be deleted,
// and an account always keeps at least one).
//
// Mirrors the store + serverApi patterns: all network calls go through the
// serverApi helpers (which attach credentials + the CSRF header), and the
// session/profile context holds the in-memory truth the rest of the app reads.

import { useEffect, useMemo, useState } from "react";
import {
  createAccountProfile,
  deleteAccountProfile,
  fetchAccountProfiles,
  switchAccountProfile,
  updateAccountProfile,
  type AccountProfile,
} from "../lib/serverApi";
import {
  useServerProfiles,
  useServerSession,
  useSetServerProfiles,
  useSetServerSession,
  type ServerProfileSummary,
} from "../lib/ServerSessionContext";
import { useAppStore } from "../store/AppStore";
import "./ProfilePicker.css";

// A small palette the "add profile" form offers; any saved hex/keyword renders.
const AVATAR_COLORS = [
  "#6366f1",
  "#ec4899",
  "#22c55e",
  "#f59e0b",
  "#06b6d4",
  "#ef4444",
  "#a855f7",
  "#14b8a6",
];

function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed[0]!.toUpperCase() : "?";
}

/** Avatar = the display-name initial on the profile's color tint. */
function Avatar({ profile, size = 96 }: { profile: ServerProfileSummary; size?: number }) {
  const bg = profile.avatarColor ?? "#475569";
  return (
    <span
      className="profile-avatar"
      style={{ background: bg, width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden
    >
      {initialOf(profile.displayName)}
    </span>
  );
}

export function ProfilePicker({ onClose }: { onClose: () => void }) {
  const session = useServerSession();
  const profiles = useServerProfiles();
  const setSession = useSetServerSession();
  const setProfiles = useSetServerProfiles();
  const { reloadProfileData } = useAppStore();

  const [editing, setEditing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<AccountProfile | null>(null);
  // When set, the parental-lock prompt is open for this target profile: leaving
  // a kid profile requires the account password before the switch is allowed.
  const [unlocking, setUnlocking] = useState<ServerProfileSummary | null>(null);

  const activeId = session?.profileId ?? null;
  // Is the CURRENTLY ACTIVE profile a kid? Leaving it (switching to a different
  // profile) needs the account password; entering one, or no-op re-selects, do not.
  const activeIsKid = useMemo(
    () => profiles.some((p) => p.id === activeId && p.isKid),
    [profiles, activeId],
  );

  // Refresh the list from the server on open so a profile added on another
  // device shows up. Best-effort; the in-memory list is the fallback.
  useEffect(() => {
    let cancelled = false;
    void fetchAccountProfiles()
      .then((state) => {
        if (!cancelled) setProfiles(state.profiles);
      })
      .catch(() => {
        /* keep the in-memory list */
      });
    return () => {
      cancelled = true;
    };
  }, [setProfiles]);

  function selectProfile(profile: ServerProfileSummary) {
    if (busyId != null) return;
    // Already active → just close (selecting your current profile is a no-op).
    if (profile.id === activeId) {
      onClose();
      return;
    }
    // Parental lock: leaving a kid profile for a DIFFERENT one needs the account
    // password. Prompt for it instead of switching straight away.
    if (activeIsKid) {
      setError(null);
      setUnlocking(profile);
      return;
    }
    void runSwitch(profile).catch((err) => {
      setError(err instanceof Error ? err.message : "Could not switch profile.");
    });
  }

  /** Perform the actual profile switch. `password` is passed through only for the
   *  parental-lock path (leaving a kid profile); a wrong/missing one 403s. The
   *  promise rejects on failure so callers can surface the error (inline, or as
   *  "Incorrect password" in the unlock prompt) and retry. */
  async function runSwitch(
    profile: ServerProfileSummary,
    password?: string,
  ): Promise<void> {
    setBusyId(profile.id);
    setError(null);
    try {
      const result = await switchAccountProfile(profile.id, password);
      // Load the new profile's data BEFORE flipping the UI session. If the
      // refetch fails we stay on the old profile (the catch re-throws), instead
      // of leaving the new — possibly kid — session over the old profile's
      // already-rendered (possibly over-cap) rails. The server has already
      // switched the session cookie, so these loaders return the new profile's data.
      await reloadProfileData();
      if (result.session != null) {
        setSession({
          profileId: result.session.profileId,
          username: result.session.username,
          displayName: result.session.displayName,
          role: result.session.role,
          avatarColor: result.session.avatarColor,
          simpleMode: result.session.simpleMode,
        });
      }
      if (result.profiles != null) setProfiles(result.profiles.profiles);
      onClose();
    } catch (err) {
      setBusyId(null);
      throw err;
    }
  }

  async function refreshAfterMutation(next: ServerProfileSummary[]): Promise<void> {
    setProfiles(next);
  }

  if (adding) {
    return (
      <ProfileForm
        title="Add profile"
        submitLabel="Create"
        onCancel={() => setAdding(false)}
        onSubmit={async (values) => {
          const res = await createAccountProfile(values);
          // Append the new one and re-fetch to stay canonical.
          await refreshAfterMutation([
            ...profiles,
            {
              id: res.profile.id,
              displayName: res.profile.displayName,
              avatarColor: res.profile.avatarColor,
              simpleMode: res.profile.simpleMode,
              isDefault: res.profile.isDefault,
              isKid: res.profile.isKid,
            },
          ]);
          setAdding(false);
        }}
      />
    );
  }

  if (renaming != null) {
    return (
      <ProfileForm
        title="Edit profile"
        submitLabel="Save"
        initial={{ displayName: renaming.displayName, avatarColor: renaming.avatarColor }}
        hidePassword
        onCancel={() => setRenaming(null)}
        onSubmit={async (values) => {
          const res = await updateAccountProfile(renaming.id, {
            displayName: values.displayName,
            avatarColor: values.avatarColor,
          });
          await refreshAfterMutation(res.profiles);
          setRenaming(null);
        }}
      />
    );
  }

  if (unlocking != null) {
    return (
      <UnlockPrompt
        target={unlocking}
        onCancel={() => setUnlocking(null)}
        onSubmit={(password) => runSwitch(unlocking, password)}
      />
    );
  }

  return (
    <div className="profile-picker" role="dialog" aria-modal="true" aria-label="Who's watching?">
      <div className="profile-picker-inner">
        <h1 className="profile-picker-title">Who&rsquo;s watching?</h1>

        <ul className="profile-grid">
          {profiles.map((profile) => (
            <li key={profile.id}>
              <button
                type="button"
                className={`profile-tile${profile.id === activeId ? " is-active" : ""}`}
                onClick={() => void selectProfile(profile)}
                disabled={busyId != null}
                aria-current={profile.id === activeId ? "true" : undefined}
              >
                <Avatar profile={profile} />
                <span className="profile-tile-name">{profile.displayName}</span>
                {profile.isKid && <span className="profile-kids-badge">Kids</span>}
                {busyId === profile.id && <span className="profile-tile-busy">Switching…</span>}
              </button>
              {editing && (
                <div className="profile-tile-actions">
                  <button
                    type="button"
                    className="profile-mini-btn"
                    onClick={() => setRenaming(profileToAccount(profile))}
                  >
                    Edit
                  </button>
                  {!profile.isDefault && (
                    <button
                      type="button"
                      className="profile-mini-btn is-danger"
                      onClick={() => {
                        setError(null);
                        setBusyId(profile.id);
                        const wasActive = profile.id === activeId;
                        void deleteAccountProfile(profile.id)
                          .then(async (res) => {
                            // The delete already succeeded server-side: refresh
                            // the list FIRST so the deleted tile is dropped even
                            // if the follow-up switch fails.
                            await refreshAfterMutation(res.profiles);
                            if (wasActive) {
                              // The server fell the session back to the default
                              // profile; converge the client onto it (re-hydrate
                              // data + session) so it isn't left pointed at a
                              // now-deleted profile showing its stale rails. Any
                              // failure here is isolated: the delete stands, the
                              // list is already refreshed, and the next load
                              // reconciles the session from the server default —
                              // so we must NOT surface "Could not delete.".
                              const fallback =
                                res.profiles.find((p) => p.isDefault) ??
                                res.profiles[0];
                              if (fallback != null) {
                                try {
                                  const sw = await switchAccountProfile(
                                    fallback.id,
                                  );
                                  await reloadProfileData();
                                  if (sw.session != null) {
                                    setSession({
                                      profileId: sw.session.profileId,
                                      username: sw.session.username,
                                      displayName: sw.session.displayName,
                                      role: sw.session.role,
                                      avatarColor: sw.session.avatarColor,
                                      simpleMode: sw.session.simpleMode,
                                    });
                                  }
                                } catch {
                                  // Convergence-only failure; delete still stands.
                                }
                              }
                            }
                          })
                          .catch((err) =>
                            setError(err instanceof Error ? err.message : "Could not delete."),
                          )
                          .finally(() => setBusyId(null));
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}

          {editing && (
            <li>
              <button
                type="button"
                className="profile-tile profile-tile-add"
                onClick={() => {
                  setError(null);
                  setAdding(true);
                }}
              >
                <span className="profile-avatar profile-avatar-add" aria-hidden>
                  +
                </span>
                <span className="profile-tile-name">Add profile</span>
              </button>
            </li>
          )}
        </ul>

        {error != null && <p className="profile-picker-error">{error}</p>}

        <div className="profile-picker-foot">
          <button
            type="button"
            className="profile-text-btn"
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? "Done" : "Manage profiles"}
          </button>
          <button type="button" className="profile-text-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function profileToAccount(p: ServerProfileSummary): AccountProfile {
  return {
    id: p.id,
    displayName: p.displayName,
    avatarColor: p.avatarColor,
    simpleMode: p.simpleMode,
    isDefault: p.isDefault,
    isKid: p.isKid,
    // The picker summary doesn't carry the cap (only the kid flag); the rename
    // form this feeds doesn't touch maturity, so null is a safe placeholder.
    maturityMax: null,
  };
}

/** Parental-lock prompt shown when leaving a kid profile: the account password
 *  is required before the switch. A 403 means a wrong/missing password — we show
 *  "Incorrect password" and let the user retry without closing. */
function UnlockPrompt({
  target,
  onCancel,
  onSubmit,
}: {
  target: ServerProfileSummary;
  onCancel: () => void;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = password.length > 0 && !busy;

  function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    void onSubmit(password)
      .catch((err) => {
        const status = (err as { status?: number }).status;
        setError(
          status === 403
            ? "Incorrect password."
            : err instanceof Error
              ? err.message
              : "Could not switch profile.",
        );
        setBusy(false);
      });
    // On success the picker closes, so no need to clear busy.
  }

  return (
    <div className="profile-picker" role="dialog" aria-modal="true" aria-label="Enter account password">
      <div className="profile-picker-inner profile-form">
        <h1 className="profile-picker-title">Enter account password</h1>
        <p className="profile-unlock-copy">
          The account password is required to leave a kids profile and switch to{" "}
          <strong>{target.displayName}</strong>.
        </p>

        <label className="profile-field">
          Account password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            autoComplete="current-password"
            autoFocus
          />
        </label>

        {error != null && <p className="profile-picker-error">{error}</p>}

        <div className="profile-picker-foot">
          <button type="button" className="profile-text-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="profile-solid-btn"
            onClick={submit}
            disabled={!canSubmit}
          >
            {busy ? "Please wait" : "Unlock"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ProfileFormValues {
  displayName: string;
  avatarColor: string | null;
  password?: string;
}

function ProfileForm({
  title,
  submitLabel,
  initial,
  hidePassword = false,
  onCancel,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  initial?: { displayName: string; avatarColor: string | null };
  hidePassword?: boolean;
  onCancel: () => void;
  onSubmit: (values: ProfileFormValues) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [avatarColor, setAvatarColor] = useState<string>(
    initial?.avatarColor ?? AVATAR_COLORS[0]!,
  );
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = useMemo(() => displayName.trim().length > 0, [displayName]);

  function submit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    void onSubmit({
      displayName: displayName.trim(),
      avatarColor,
      password: hidePassword || password.length === 0 ? undefined : password,
    })
      .catch((err) => setError(err instanceof Error ? err.message : "Request failed."))
      .finally(() => setBusy(false));
  }

  return (
    <div className="profile-picker" role="dialog" aria-modal="true" aria-label={title}>
      <div className="profile-picker-inner profile-form">
        <h1 className="profile-picker-title">{title}</h1>

        <label className="profile-field">
          Name
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={100}
            autoFocus
          />
        </label>

        <div className="profile-field">
          Color
          <div className="profile-color-row">
            {AVATAR_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`profile-color-dot${avatarColor === color ? " is-selected" : ""}`}
                style={{ background: color }}
                aria-label={`Use color ${color}`}
                onClick={() => setAvatarColor(color)}
              />
            ))}
          </div>
        </div>

        {!hidePassword && (
          <label className="profile-field">
            Password (optional)
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              placeholder="Leave blank for a quick-switch profile"
            />
          </label>
        )}

        {error != null && <p className="profile-picker-error">{error}</p>}

        <div className="profile-picker-foot">
          <button type="button" className="profile-text-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="profile-solid-btn"
            onClick={submit}
            disabled={!canSubmit || busy}
          >
            {busy ? "Please wait" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
