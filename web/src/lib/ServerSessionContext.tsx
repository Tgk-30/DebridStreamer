// Holds the authenticated Server-Mode session (captured by ServerModeGate from
// /api/bootstrap and the login/setup/invite responses) so the app can read
// per-profile facts like `simpleMode` and `role` without re-fetching. In Local
// Mode the session is null and consumers fall back to local settings.

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

export interface ServerSession {
  profileId: string;
  username: string;
  displayName: string;
  role: "owner" | "admin" | "member" | "restricted";
  avatarColor?: string | null;
  simpleMode: boolean;
}

/** One viewer in the account's "who's watching" picker. */
export interface ServerProfileSummary {
  id: string;
  displayName: string;
  avatarColor: string | null;
  simpleMode: boolean;
  isDefault: boolean;
}

interface ServerSessionContextValue {
  session: ServerSession | null;
  setSession: (session: ServerSession | null) => void;
  /** The account's household profiles (drives the picker). */
  profiles: ServerProfileSummary[];
  setProfiles: (profiles: ServerProfileSummary[]) => void;
  /** Whether the server can transcode (operator flag on + ffmpeg present). A
   *  static server capability captured once at bootstrap. */
  transcodeAvailable: boolean;
}

const ServerSessionCtx = createContext<ServerSessionContextValue>({
  session: null,
  setSession: () => {},
  profiles: [],
  setProfiles: () => {},
  transcodeAvailable: false,
});

export function ServerSessionProvider({
  initial,
  initialProfiles = [],
  initialTranscodeAvailable = false,
  children,
}: {
  initial: ServerSession | null;
  initialProfiles?: ServerProfileSummary[];
  initialTranscodeAvailable?: boolean;
  children: ReactNode;
}) {
  const [session, setSession] = useState<ServerSession | null>(initial);
  const [profiles, setProfiles] = useState<ServerProfileSummary[]>(initialProfiles);
  const set = useCallback((next: ServerSession | null) => setSession(next), []);
  const setList = useCallback(
    (next: ServerProfileSummary[]) => setProfiles(next),
    [],
  );
  return (
    <ServerSessionCtx.Provider
      value={{
        session,
        setSession: set,
        profiles,
        setProfiles: setList,
        transcodeAvailable: initialTranscodeAvailable,
      }}
    >
      {children}
    </ServerSessionCtx.Provider>
  );
}

/** Whether the server advertises transcoding (Server Mode capability). */
export function useTranscodeAvailable(): boolean {
  return useContext(ServerSessionCtx).transcodeAvailable;
}

/** The current Server-Mode session, or null in Local Mode / before sign-in. */
export function useServerSession(): ServerSession | null {
  return useContext(ServerSessionCtx).session;
}

/** Update the in-memory session (e.g. optimistic simpleMode toggle, or a
 *  profile switch). */
export function useSetServerSession(): (session: ServerSession | null) => void {
  return useContext(ServerSessionCtx).setSession;
}

/** The account's household profiles for the "who's watching" picker. */
export function useServerProfiles(): ServerProfileSummary[] {
  return useContext(ServerSessionCtx).profiles;
}

/** Replace the in-memory household profile list (after create/rename/delete). */
export function useSetServerProfiles(): (profiles: ServerProfileSummary[]) => void {
  return useContext(ServerSessionCtx).setProfiles;
}
