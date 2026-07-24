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
- Conservative source recommendations with compatibility reasons, estimated
  bitrate, HDR and REMUX signals, progressive availability, and try-next
  recovery.
- Optional Server Mode adaptive HLS with seek offsets, subtitle sidecars,
  hardware encoder detection, and HDR tone mapping when FFmpeg supports it.
- Native audio-device selection, passthrough, HDR policy, aspect, zoom, pan,
  subtitle position, persistent delay, and codec or frame statistics.

## Comparison

| Product | Officially documented strengths | Main YAWF Stream gap |
|---|---|---|
| Plex | Profile-wide preferred audio and subtitle languages, deterministic track fallback, subtitle modes, manual per-item overrides, playback speed, automatic quality selection, hardware transcoding, and HDR-to-SDR tone mapping. | YAWF now covers default languages, ABR, hardware encoder selection, HDR policy, and direct or transcode status. Plex still has a more mature client capability matrix plus intro and credits detection. |
| Infuse | Preferred audio and subtitle languages, default playback speed, default-tag handling, volume boost, audio downmix options, AI upscaling, Dolby Vision policy, live seek previews, and intro or credits skipping. | YAWF now exposes HDR policy and output-device controls. It still lacks upscaling, volume boost, and intro or credits markers. |
| Stremio | Subtitle language and appearance defaults, configurable seek steps, pause-when-minimized, hardware-decoding control, cache sizing, and separate-player behavior. | YAWF lacks configurable seek steps, pause-when-minimized, and user-facing cache or hardware-decoder controls. |
| Jellyfin | Capability-driven direct play, remux, or transcode behavior across clients, broad server hardware acceleration, codec-specific client profiles, and HDR tone mapping. | YAWF now detects supported FFmpeg encoders and exposes ABR, client profiles, and tone mapping. It still lacks a full codec-specific device matrix and a dedicated remux decision. |
| Emby | Native-client quality presets, Direct Play versus Transcoding diagnostics, audio-device selection, exclusive audio, and surround-output guidance. | YAWF now shows the playback decision and native technical statistics, with audio-device and passthrough controls. Exclusive audio, downmix, and channel-layout guidance remain gaps. |
| IINA and mpv | Audio and subtitle selection, delays, chapters, crop, zoom, pan, hardware-decoder fallback, and detailed codec or frame statistics. | YAWF now covers aspect, zoom, pan, output selection, passthrough, and common frame statistics. Crop, deinterlacing, snapshots, and manual decoder selection remain gaps. |
| VLC | Aspect-ratio presets, crop, zoom, deinterlacing, snapshots, chapters, tracks, subtitle controls, and synchronization tools. | YAWF can hand off to VLC but does not expose all of those controls in its built-in player. |

## Prioritized gaps

### Closed in the v1.1 candidate

1. Deterministic, non-fatal default audio and subtitle language selection.
2. Renderer-synchronized track, mute, volume, and playback state.
3. Bounded lifecycle queues and media buffers, with coalesced native resize
   redraw decisions.
4. Recommended sources, try-next recovery, progressive results, and actionable
   provider failures.
5. Adaptive Server Mode HLS, seek offset, subtitle preservation, encoder
   detection, and conditional HDR tone mapping.

### P1: remaining high-value parity

1. Extend browser playback statistics with container, codec, HDR, and A/V sync
   details.
2. Add Skip Intro and Skip Credits markers and actions.
3. Add crop and deinterlacing controls with per-title memory.
4. Add a dedicated remux decision and a codec-specific client capability
   profile.

### P2: advanced playback

1. Add channel layout, downmix, volume boost, and exclusive audio where the
   operating system supports them.
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
