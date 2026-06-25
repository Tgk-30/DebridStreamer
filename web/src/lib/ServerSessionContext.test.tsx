// @vitest-environment jsdom
//
// Tests for the ServerSession context provider + its consumer hooks. The hooks
// are thin context reads, so we mount the real <ServerSessionProvider> and read
// each one via renderHook, then exercise the setSession / setProfiles callbacks
// to cover the useState/useCallback wiring. A second block reads the hooks with
// NO provider to assert the createContext default value.

import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import {
  ServerSessionProvider,
  useServerSession,
  useSetServerSession,
  useServerProfiles,
  useSetServerProfiles,
  useTranscodeAvailable,
  useOmdbProxy,
  useBuildProfile,
  type ServerSession,
  type ServerProfileSummary,
} from "./ServerSessionContext";

const SESSION: ServerSession = {
  profileId: "p1",
  username: "owner",
  displayName: "Owner",
  role: "owner",
  avatarColor: "#abc",
  simpleMode: false,
};

const PROFILE: ServerProfileSummary = {
  id: "p1",
  displayName: "Owner",
  avatarColor: "#abc",
  simpleMode: false,
  isDefault: true,
  isKid: false,
};

function wrapper(props: Partial<ComponentProps<typeof ServerSessionProvider>> = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ServerSessionProvider initial={props.initial ?? null} {...props}>
        {children}
      </ServerSessionProvider>
    );
  };
}

describe("ServerSessionProvider — initial values surfaced by hooks", () => {
  it("surfaces the initial session, transcode, omdb and build-profile flags", () => {
    const { result } = renderHook(
      () => ({
        session: useServerSession(),
        transcode: useTranscodeAvailable(),
        omdb: useOmdbProxy(),
        build: useBuildProfile(),
        profiles: useServerProfiles(),
      }),
      {
        wrapper: wrapper({
          initial: SESSION,
          initialTranscodeAvailable: true,
          initialOmdbProxy: true,
          initialBuildProfile: "friends",
          initialProfiles: [PROFILE],
        }),
      },
    );
    expect(result.current.session).toEqual(SESSION);
    expect(result.current.transcode).toBe(true);
    expect(result.current.omdb).toBe(true);
    expect(result.current.build).toBe("friends");
    expect(result.current.profiles).toEqual([PROFILE]);
  });

  it("defaults transcode/omdb to false, build to public, profiles to [] when omitted", () => {
    const { result } = renderHook(
      () => ({
        session: useServerSession(),
        transcode: useTranscodeAvailable(),
        omdb: useOmdbProxy(),
        build: useBuildProfile(),
        profiles: useServerProfiles(),
      }),
      { wrapper: wrapper({ initial: null }) },
    );
    expect(result.current.session).toBeNull();
    expect(result.current.transcode).toBe(false);
    expect(result.current.omdb).toBe(false);
    expect(result.current.build).toBe("public");
    expect(result.current.profiles).toEqual([]);
  });
});

describe("ServerSessionProvider — setters update in-memory state", () => {
  it("setSession replaces the session (and can clear it back to null)", () => {
    const { result } = renderHook(
      () => ({ session: useServerSession(), set: useSetServerSession() }),
      { wrapper: wrapper({ initial: null }) },
    );
    expect(result.current.session).toBeNull();
    act(() => result.current.set(SESSION));
    expect(result.current.session).toEqual(SESSION);
    act(() => result.current.set(null));
    expect(result.current.session).toBeNull();
  });

  it("setProfiles replaces the household profile list", () => {
    const { result } = renderHook(
      () => ({ profiles: useServerProfiles(), set: useSetServerProfiles() }),
      { wrapper: wrapper({ initial: null }) },
    );
    expect(result.current.profiles).toEqual([]);
    act(() => result.current.set([PROFILE]));
    expect(result.current.profiles).toEqual([PROFILE]);
  });
});

describe("ServerSession hooks — context defaults without a provider", () => {
  it("read the createContext default value (null session, false flags, public)", () => {
    const { result } = renderHook(() => ({
      session: useServerSession(),
      transcode: useTranscodeAvailable(),
      omdb: useOmdbProxy(),
      build: useBuildProfile(),
      profiles: useServerProfiles(),
    }));
    expect(result.current.session).toBeNull();
    expect(result.current.transcode).toBe(false);
    expect(result.current.omdb).toBe(false);
    expect(result.current.build).toBe("public");
    expect(result.current.profiles).toEqual([]);
  });

  it("default setSession/setProfiles are safe no-ops", () => {
    const { result } = renderHook(() => ({
      setSession: useSetServerSession(),
      setProfiles: useSetServerProfiles(),
    }));
    // The createContext default provides no-op functions; calling them must not throw.
    expect(() => result.current.setSession(SESSION)).not.toThrow();
    expect(() => result.current.setProfiles([PROFILE])).not.toThrow();
  });
});
