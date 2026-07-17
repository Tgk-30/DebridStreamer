import { useState } from "react";
import { useAppStore } from "../store/AppStore";
import { createProfileRecord } from "../storage/ProfileRegistry";
import { useModalA11y } from "./useModalA11y";
import { AvatarPicker } from "./AvatarPicker";
import {
  DEFAULT_PROFILE_AVATAR,
  isImageAvatar,
} from "../data/profileAvatars";
import "./ProfilePicker.css";

const COLORS = ["#6366f1", "#ec4899", "#22c55e", "#f59e0b", "#06b6d4", "#a855f7"];

function initialFor(profile: { name: string; avatar?: string }) {
  return profile.avatar || profile.name.trim().charAt(0).toUpperCase() || "?";
}

function profileId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** "switch" - the who's-watching picker opened from the nav (dismissable).
 *  "select" - the launch choice when several profiles exist (must choose).
 *  "lock"   - the active profile is password protected (must unlock). */
export type LocalProfilePickerMode = "switch" | "select" | "lock";

export function LocalProfilePicker({
  onClose,
  mode = "switch",
}: {
  onClose: () => void;
  mode?: LocalProfilePickerMode;
}) {
  const {
    activeProfile,
    profiles = [],
    refreshProfiles,
    switchLocalProfile,
  } = useAppStore();
  // Escape closes only the dismissable picker: the launch choice and the lock
  // are gates, and letting Escape dismiss them would walk straight past them.
  const pickerRef = useModalA11y<HTMLDivElement>(mode === "switch" ? onClose : () => {});
  const [passwordFor, setPasswordFor] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(DEFAULT_PROFILE_AVATAR);
  const [color, setColor] = useState(COLORS[0]!);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = activeProfile?.isAdmin ?? false;
  // Anyone standing at the launch chooser or the lock can create their own
  // profile: nobody is authenticated there, and a new profile is non-admin with
  // its own empty database, so it cannot reach a protected profile's data (the
  // chooser already admits anyone to an unprotected profile). In switch mode a
  // profile IS authenticated, so the existing admin rule keeps applying.
  const canAddProfile = mode === "switch" ? canManage : true;
  // Even in lock mode show ALL profiles: a member who does not know the owner's
  // password must still be able to pick their own (unprotected) profile instead
  // of being trapped on a single locked tile with no way out.
  const shownProfiles = profiles.length > 0 ? profiles : activeProfile != null ? [activeProfile] : [];
  // When the registry holds exactly one profile there is nothing to choose, so
  // an unlock goes straight to its password rather than through a one-tile grid.
  // With more than one, the grid comes first. Derived rather than seeded into
  // useState so it stays correct when the async profile list lands: seeding
  // would strand a multi-profile user on the password form for whichever
  // profile happened to be active on the first render.
  const soleLockedProfile =
    mode === "lock" && profiles.length === 1 && profiles[0]?.passwordHash != null
      ? profiles[0]
      : null;
  // The tile the user picked, or the sole profile we jumped straight to.
  const unlockTarget = passwordFor ?? soleLockedProfile?.id ?? null;

  async function choose(id: string) {
    const profile = profiles.find((item) => item.id === id) ?? (activeProfile?.id === id ? activeProfile : undefined);
    if (profile?.passwordHash != null) {
      setPasswordFor(id);
      setPassword("");
      setError(null);
      return;
    }
    setBusy(true);
    const result = await switchLocalProfile(id);
    setBusy(false);
    if (!result.ok) {
      setError(result.reason === "not-found" ? "That profile is no longer available." : "Incorrect password.");
      return;
    }
    onClose();
  }

  async function unlock() {
    if (unlockTarget == null) return;
    setBusy(true);
    const result = await switchLocalProfile(unlockTarget, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.reason === "bad-password" ? "Incorrect password." : "That profile is no longer available.");
      return;
    }
    onClose();
  }

  async function addProfile() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a profile name.");
      return;
    }
    setBusy(true);
    const id = profileId();
    await createProfileRecord({
      id,
      name: trimmed,
      avatar,
      color,
      isDefault: false,
      isAdmin: false,
      createdAt: Date.now(),
    });
    await refreshProfiles();
    setAdding(false);
    setName("");
    // Created from the launch/lock chooser, the point was to get IN - so enter
    // the new profile rather than dropping back to the grid to click it again.
    // A brand new profile never has a password, so nothing is bypassed.
    if (mode !== "switch") {
      const result = await switchLocalProfile(id);
      setBusy(false);
      if (result.ok) onClose();
      else setError("Could not open the new profile.");
      return;
    }
    setBusy(false);
  }

  const title = mode === "lock" ? "Unlock a profile" : "Who’s watching?";

  return (
    <div ref={pickerRef} className="profile-picker" role="dialog" aria-modal="true" aria-label={title}>
      <div className="profile-picker-inner">
        {adding ? (
          <div className="profile-form">
            <h2 className="profile-picker-title">Add profile</h2>
            <label className="profile-field">Name<input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} autoFocus /></label>
            <div className="profile-field"><span>Avatar</span><AvatarPicker value={avatar} onChange={setAvatar} idPrefix="new-profile" /></div>
            <label className="profile-field">Color<select value={color} onChange={(event) => setColor(event.target.value)}>{COLORS.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <div className="profile-picker-foot"><button className="profile-text-btn" type="button" onClick={() => setAdding(false)}>Cancel</button><button className="profile-solid-btn" type="button" onClick={() => void addProfile()} disabled={busy}>Add profile</button></div>
          </div>
        ) : unlockTarget != null ? (
          <div className="profile-form">
            <h2 className="profile-picker-title">Enter password</h2>
            <label className="profile-field">Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void unlock(); }} autoFocus /></label>
            <div className="profile-picker-foot">
              {/* Back only exists when a grid was actually behind us - jumping
                  straight to the sole profile's password has nowhere to go. */}
              {passwordFor != null && (
                <button className="profile-text-btn" type="button" onClick={() => { setPasswordFor(null); setError(null); }}>Back</button>
              )}
              <button className="profile-solid-btn" type="button" onClick={() => void unlock()} disabled={busy}>Unlock</button>
            </div>
          </div>
        ) : (
          <>
            <h1 className="profile-picker-title">{title}</h1>
            <ul className="profile-grid">
              {shownProfiles.map((profile) => (
                <li key={profile.id}>
                  <button className={`profile-tile${profile.id === activeProfile?.id ? " is-active" : ""}`} type="button" disabled={busy} onClick={() => void choose(profile.id)}>
                    <span className="profile-avatar" style={{ background: profile.color ?? "#475569" }}>
                      {isImageAvatar(profile.avatar)
                        ? <img src={profile.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} />
                        : initialFor(profile)}
                    </span>
                    <span className="profile-tile-name">{profile.name}{profile.passwordHash != null ? " \u{1F512}" : ""}</span>
                  </button>
                </li>
              ))}
              {canAddProfile && (
                <li><button className="profile-tile" type="button" onClick={() => setAdding(true)}><span className="profile-avatar profile-avatar-add">+</span><span className="profile-tile-name">{mode === "switch" ? "Add profile" : "Create your profile"}</span></button></li>
              )}
            </ul>
            {mode === "switch" && <div className="profile-picker-foot"><button className="profile-text-btn" type="button" onClick={onClose}>Cancel</button></div>}
          </>
        )}
        {error != null && <p className="profile-picker-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
