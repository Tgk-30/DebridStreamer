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

  const activeId = session?.profileId ?? null;

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

  async function selectProfile(profile: ServerProfileSummary) {
    if (busyId != null) return;
    // Already active → just close (selecting your current profile is a no-op).
    if (profile.id === activeId) {
      onClose();
      return;
    }
    setBusyId(profile.id);
    setError(null);
    try {
      const result = await switchAccountProfile(profile.id);
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
      // Swap in the new profile's data, then close.
      await reloadProfileData();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not switch profile.");
      setBusyId(null);
    }
  }

  async function refreshAfterMutation(next: AccountProfile[]): Promise<void> {
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
                        void deleteAccountProfile(profile.id)
                          .then((res) => refreshAfterMutation(res.profiles))
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
  };
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
