# Player Competitive Comparison

Assessment date: 2026-07-24

This comparison reviews YAWF Stream's checked-in web and native players against
current official product documentation. Features can differ by client platform,
subscription, server hardware, and source format.

## Where YAWF Stream is already strong

- A native libmpv player for broad codec and container compatibility, plus a
  browser video and HLS path and an external-player fallback.
- Per-title and per-episode resume data with remembered audio, subtitle, and
  playback-speed choices.
- Audio and subtitle track menus, chapters, subtitle and audio delay controls,
  subtitle sizing, quality selection, and playback speeds from 0.25x to 3x.
- Picture in Picture, AirPlay or Remote Playback where the browser supports it,
  and DLNA or UPnP casting in the desktop app.
- Hardware-decoding defaults with software fallback on supported desktop
  platforms.
- Optional Server Mode HLS transcoding and stream quality or size limits.

## Comparison

| Product | Officially documented strengths | Main YAWF Stream gap |
|---|---|---|
| Plex | Profile-wide preferred audio and subtitle languages, deterministic track fallback, subtitle modes, manual per-item overrides, playback speed, automatic quality selection, hardware transcoding, and HDR-to-SDR tone mapping. | YAWF's new default-language controls close the largest day-to-day gap. Plex still has a more mature quality, transcoding, HDR, and intro or credits pipeline. |
| Infuse | Preferred audio and subtitle languages, default playback speed, default-tag handling, volume boost, audio downmix options, AI upscaling, Dolby Vision policy, live seek previews, and intro or credits skipping. | YAWF lacks intro or credits markers, user-facing HDR policy, audio-output tuning, and upscaling controls. |
| Stremio | Subtitle language and appearance defaults, configurable seek steps, pause-when-minimized, hardware-decoding control, cache sizing, and separate-player behavior. | YAWF lacks configurable seek steps, pause-when-minimized, and user-facing cache or hardware-decoder controls. |
| Jellyfin | Capability-driven direct play, remux, or transcode behavior across clients, broad server hardware acceleration, codec-specific client profiles, and HDR tone mapping. | YAWF's Server Mode does not yet expose a comparable client-capability, hardware-transcode, and tone-mapping control plane. |
| Emby | Native-client quality presets, Direct Play versus Transcoding diagnostics, audio-device selection, exclusive audio, and surround-output guidance. | YAWF needs a full playback statistics panel and audio-device or passthrough controls. |
| IINA and mpv | Audio and subtitle selection, delays, chapters, crop, zoom, pan, hardware-decoder fallback, and detailed codec or frame statistics. | YAWF exposes the common controls but not crop, zoom, pan, decoder selection, or full frame statistics. |
| VLC | Aspect-ratio presets, crop, zoom, deinterlacing, snapshots, chapters, tracks, subtitle controls, and synchronization tools. | YAWF can hand off to VLC but does not expose all of those controls in its built-in player. |

## Prioritized gaps

### P0: playback trust

1. Keep the global audio-language fallback deterministic and non-fatal when
   metadata is missing or malformed.
2. Keep track, mute, volume, and playback state synchronized with the actual
   renderer rather than optimistic UI state.
3. Prevent player lifecycle races and bound media buffers so repeated playback
   sessions cannot orphan native players or grow memory without limit.
4. Keep native resizing responsive by coalescing expensive redraw work instead
   of rendering synchronously for every window-resize event.

### P1: high-value parity

1. Add a complete playback statistics panel with direct or transcoded status,
   container, codecs, HDR state, hardware-decoder state, dropped frames,
   bandwidth, buffer health, and A/V sync.
2. Add Skip Intro and Skip Credits markers and actions.
3. Add aspect-ratio, crop, zoom, and pan controls with per-title memory.
4. Add explicit HDR pass-through and HDR-to-SDR tone-mapping status and policy.
5. Add automatic quality adaptation for Server Mode while retaining a manual
   quality ceiling.

### P2: advanced playback

1. Add audio-device selection, channel layout, downmix, volume boost, and
   passthrough controls where the operating system supports them.
2. Add configurable seek-step lengths and pause-when-minimized behavior.
3. Add multiple ordered fallback languages rather than a single preference.
4. Explain which controls are available for native, browser, HLS, cast, and
   external-player playback before the user starts a stream.
5. Add advanced subtitle policies for forced and SDH tracks.

## Official sources

- [Plex audio and subtitle language settings](https://support.plex.tv/articles/204985278-account-audio-subtitle-language-settings/)
- [Plex playback speed controls](https://support.plex.tv/articles/video-playback-speed-controls/)
- [Plex HDR-to-SDR tone mapping](https://support.plex.tv/articles/hdr-to-sdr-tone-mapping/)
- [Plex hardware-accelerated streaming](https://support.plex.tv/articles/115002178853-using-hardware-accelerated-streaming/)
- [Infuse settings overview](https://support.firecore.com/hc/en-us/articles/360015608854-Settings-Overview)
- [Infuse subtitles and audio tracks](https://support.firecore.com/hc/en-us/articles/215090907-Subtitles-and-Audio-Tracks)
- [Stremio player and streaming options](https://stremio.zendesk.com/hc/en-us/articles/360017301779-Stremio-options-explained)
- [Jellyfin codec support](https://jellyfin.org/docs/general/clients/codec-support/)
- [Jellyfin transcoding](https://jellyfin.org/docs/general/post-install/transcoding/)
- [Emby Windows player FAQ](https://support.emby.media/support/articles/apps/windows/Emby-Windows-FAQ.html)
- [mpv manual](https://mpv.io/manual/master/)
- [VLC desktop video controls](https://docs.videolan.me/vlc-user/desktop/3.0/en/basic/video.html)
