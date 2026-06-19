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
  simpleMode: boolean;
}

interface ServerSessionContextValue {
  session: ServerSession | null;
  setSession: (session: ServerSession | null) => void;
}

const ServerSessionCtx = createContext<ServerSessionContextValue>({
  session: null,
  setSession: () => {},
});

export function ServerSessionProvider({
  initial,
  children,
}: {
  initial: ServerSession | null;
  children: ReactNode;
}) {
  const [session, setSession] = useState<ServerSession | null>(initial);
  const set = useCallback((next: ServerSession | null) => setSession(next), []);
  return (
    <ServerSessionCtx.Provider value={{ session, setSession: set }}>
      {children}
    </ServerSessionCtx.Provider>
  );
}

/** The current Server-Mode session, or null in Local Mode / before sign-in. */
export function useServerSession(): ServerSession | null {
  return useContext(ServerSessionCtx).session;
}

/** Update the in-memory session (e.g. optimistic simpleMode toggle). */
export function useSetServerSession(): (session: ServerSession | null) => void {
  return useContext(ServerSessionCtx).setSession;
}
