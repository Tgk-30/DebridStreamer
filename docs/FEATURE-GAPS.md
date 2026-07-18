# Feature-gap audit

> Historical planning snapshot from v0.9.3. It is retained for decision history
> and does not describe the current release. Use the latest verification log for
> current behavior.

Product audit of what DebridStreamer lacks and could do with, as of v0.9.3
(2026-07-17). Method: full code inventory of what exists today, live-web
research of the competitive landscape (Stremio + addon ecosystem, Plex and
Jellyfin, Infuse and VidHub, and the debrid-native tooling: Debrid Media
Manager, Riven, zurg, Overseerr, Trakt, TorBox), then a jobs-to-be-done pass
over four personas: the solo just-watch user, the server-mode household, the
power user, and the developer-operator.

The baseline is strong: discovery/search/browse/calendar, a deep stream data
layer (dual imdb+title search, cache checks across four debrid services,
pack-aware ranking), two players plus external hand-off, subtitles with AI
translation, downloads with optimized transcode, local multi-profile and
server mode with roles, privacy modes, an AI assistant lane, and a themable
appearance system. The gaps below are ranked against that baseline.

## 0. Already built, never wired (cheapest wins in the repo)

These exist as working, tested code and are one wiring pass away from being
features. Ordered by value:

1. Trakt sync. `services/sync/TraktSyncService.ts` implements the OAuth
   device flow and watchlist pull/push, with tests - and is imported by zero
   screens. `Watchlist.tsx:5` calls it "the documented follow-up". Portable
   watch data is the single most-cited power-user must-have in the research.
   (Scrobbling is NOT implemented - see 3.4.)
2. IMDb two-way sync. `IMDbCSVSyncService.ts` exists beyond the one-shot
   import that is wired today; the DB-backed orchestration is unwired.
3. Subtitle appearance controls. Font scale, text color, and caption
   background opacity are persisted settings applied to `::cue` - with no
   Settings UI to change them. Every competitor exposes this in-player.
4. Per-profile PIN. The server stores a sub-profile password hash that is
   write-only today; `server/src/app.ts` comments call it "reserved for a
   future PIN". Anyone at a device can currently switch into any profile.
   Plex Home PINs are the household expectation.
5. Embedded-key broker. The mechanism that ships a default key exists and is
   wired for OMDb only. Wiring TMDB through it would remove the biggest
   onboarding cliff (see 2.1).

## 1. Dealbreaker tier (adoption blockers for a persona)

1.1 Living-room story. No TV app, no casting (Chromecast/AirPlay), no remote
    control of desktop playback from a phone. For households the TV is the
    primary screen; Stremio/Plex/Jellyfin all have TV clients. This is the
    most predictable inbound request and the largest strategic gap. Cheapest
    credible path first: PWA-on-TV testing + a phone-as-remote for the
    desktop player; native tvOS/Android TV is a separate large bet.

1.2 Remote access for households. Server mode requires manual port
    forwarding/DNS/VPN (docs/remote-access.md). Non-technical family members
    away from home are blocked; every deployment becomes support burden.
    Plex Relay is the bar. A guided tunnel helper (Tailscale/cloudflared
    detection + walkthrough, or a first-party lightweight relay) closes it.

1.3 Player confidence. The native mpv player - the only path for MKV/HEVC/
    AV1, i.e. most debrid content - is still flagged EXPERIMENTAL and
    default-on only on macOS. Infuse's "it just plays" is the expectation
    for the app's core promise. Graduating it (Windows/Linux default-on,
    removing the flag after a burn-in) is more valuable than any new feature.

1.4 Trakt wiring (from 0.1). Without it, power users' watch data is trapped
    per profile/device outside server mode.

## 2. Friction tier (annoys weekly, drives support load)

2.1 Onboarding key cliff. A real catalog requires the user to self-source a
    TMDB key; until then the app shows fixtures. Wire the
