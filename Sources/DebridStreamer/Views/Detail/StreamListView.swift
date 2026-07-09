import SwiftUI

/// Displays a list of torrent results with cache status and stream resolution.
struct StreamListView: View {
    @Environment(AppState.self) private var appState
    let mediaItem: MediaItem
    let torrents: [TorrentResult]
    let cacheResults: [String: (service: DebridServiceType, status: CacheStatus)]
    /// True while the batch debrid availability check is still in flight - rows whose
    /// status hasn't arrived yet show an inline "checking" spinner instead of a badge.
    var isCheckingCache: Bool = false
    let onPlay: (StreamInfo) -> Void

    @State private var resolvingHash: String?
    @State private var resolveError: String?
    /// "Cached only" filter - when on, only torrents cached on the active debrid show.
    @State private var cachedOnly = false

    private var hasDebrid: Bool {
        appState.debridManager != nil
    }

    /// Number of results currently reported as cached/instant on a debrid.
    private var cachedCount: Int {
        torrents.reduce(into: 0) { count, torrent in
            if cacheResults[torrent.infoHash]?.status.isCached == true { count += 1 }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
            // Header
            HStack(spacing: AppTheme.Spacing.sm) {
                Text("Available Streams")
                    .font(.title3)
                    .fontWeight(.semibold)

                if isCheckingCache {
                    HStack(spacing: AppTheme.Spacing.xs) {
                        ProgressView().controlSize(.small)
                        Text("Checking cache…")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                // "Cached only" filter toggle - only meaningful with a debrid configured.
                if hasDebrid && !torrents.isEmpty {
                    cachedOnlyToggle
                }

                Text("\(displayCountString)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            // Debrid warning banner
            if !hasDebrid {
                debridWarningBanner
            }

            if torrents.isEmpty {
                noResultsView
            } else {
                let visible = visibleTorrents
                if visible.isEmpty {
                    noCachedResultsView
                } else {
                    ForEach(visible, id: \.infoHash) { torrent in
                        StreamRow(
                            torrent: torrent,
                            cacheInfo: cacheResults[torrent.infoHash],
                            isResolving: resolvingHash == torrent.infoHash,
                            isCheckingCache: isCheckingCache && cacheResults[torrent.infoHash] == nil,
                            hasDebrid: hasDebrid,
                            onTap: {
                                Task { @MainActor in
                                    await resolveTorrent(torrent)
                                }
                            }
                        )
                    }
                }
            }

            if let error = resolveError {
                HStack(spacing: AppTheme.Spacing.xs) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(AppTheme.warning)
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(AppTheme.danger)
                }
            }
        }
    }

    /// "Cached only" pill toggle. Shows the live cached count for quick context.
    private var cachedOnlyToggle: some View {
        Button {
            cachedOnly.toggle()
        } label: {
            HStack(spacing: AppTheme.Spacing.xs) {
                Image(systemName: cachedOnly ? "bolt.fill" : "bolt")
                    .font(.caption2)
                Text("Cached only")
                    .font(.caption.weight(.medium))
                if cachedCount > 0 {
                    Text("\(cachedCount)")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(cachedOnly ? .white : AppTheme.success)
                }
            }
            .foregroundStyle(cachedOnly ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
            .padding(.horizontal, AppTheme.Spacing.sm)
            .padding(.vertical, AppTheme.Spacing.xs)
            .background {
                Capsule().fill(cachedOnly ? AnyShapeStyle(AppTheme.success) : AnyShapeStyle(.thinMaterial))
            }
            .overlay(Capsule().strokeBorder(AppTheme.glassBorder, lineWidth: 0.75))
        }
        .buttonStyle(.plain)
        .help("Show only streams already cached on your debrid (instant playback)")
    }

    /// Count label that reflects the active filter.
    private var displayCountString: String {
        if cachedOnly {
            return "\(cachedCount) cached"
        }
        return "\(torrents.count) results"
    }

    private var debridWarningBanner: some View {
        HStack(spacing: AppTheme.Spacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.title3)
                .foregroundStyle(AppTheme.warning)
            VStack(alignment: .leading, spacing: AppTheme.Spacing.xxs) {
                Text("Debrid Service Required")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                Text("A debrid service (Real-Debrid, AllDebrid, etc.) is required to stream torrents. Configure one in Settings → Debrid Services.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(AppTheme.Spacing.md)
        .glassPanel(radius: AppTheme.Radius.sm, tint: AppTheme.warning)
    }

    private var noResultsView: some View {
        VStack(spacing: AppTheme.Spacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.title2)
                .foregroundStyle(.secondary)
            Text("No streams found")
                .foregroundStyle(.secondary)
            Text("Try a different title or check your indexer settings.")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, AppTheme.Spacing.xl)
    }

    /// Shown when "Cached only" is on but nothing is cached yet.
    private var noCachedResultsView: some View {
        VStack(spacing: AppTheme.Spacing.sm) {
            Image(systemName: isCheckingCache ? "bolt.badge.clock" : "bolt.slash")
                .font(.title2)
                .foregroundStyle(.secondary)
            Text(isCheckingCache ? "Checking which streams are cached…" : "No cached streams")
                .foregroundStyle(.secondary)
            if !isCheckingCache {
                Button("Show all \(torrents.count) results") {
                    cachedOnly = false
                }
                .buttonStyle(.glass)
                .font(.caption)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, AppTheme.Spacing.xl)
    }

    /// Torrents after applying the "Cached only" filter, then cached-first sorting.
    private var visibleTorrents: [TorrentResult] {
        let filtered = cachedOnly
            ? torrents.filter { cacheResults[$0.infoHash]?.status.isCached == true }
            : torrents
        return sorted(filtered)
    }

    /// Default sort: cached-first, then quality (4K > 1080 > 720…), then seeders.
    private func sorted(_ list: [TorrentResult]) -> [TorrentResult] {
        list.sorted { lhs, rhs in
            let lhsCached = cacheResults[lhs.infoHash]?.status.isCached ?? false
            let rhsCached = cacheResults[rhs.infoHash]?.status.isCached ?? false

            // Cached first
            if lhsCached != rhsCached { return lhsCached }
            // Then by quality descending
            if lhs.quality != rhs.quality { return lhs.quality > rhs.quality }
            // Then by seeders
            return lhs.seeders > rhs.seeders
        }
    }

    @MainActor
    private func resolveTorrent(_ torrent: TorrentResult) async {
        guard let debrid = appState.debridManager else {
            resolveError = "No debrid service configured. Add one in Settings → Debrid Services."
            return
        }

        guard await debrid.hasServices else {
            resolveError = "No active debrid services. Check your API tokens in Settings → Debrid Services."
            return
        }

        resolvingHash = torrent.infoHash
        resolveError = nil

        do {
            let preferredService = cacheResults[torrent.infoHash]?.service
            let stream = try await debrid.resolveStream(
                hash: torrent.infoHash,
                preferredService: preferredService
            )
            onPlay(stream)
        } catch let error as DebridError {
            switch error {
            case .invalidToken:
                resolveError = "Invalid API token. Check your debrid settings."
            case .expired:
                resolveError = "Your debrid premium has expired."
            case .rateLimited:
                resolveError = "Rate limited by debrid service. Wait a moment and try again."
            case .httpError(let code, _) where code == 503:
                resolveError = "Debrid service temporarily unavailable (503). Please try again in a moment."
            default:
                resolveError = "Resolve failed: \(error.localizedDescription)"
            }
        } catch {
            resolveError = "Resolve failed: \(error.localizedDescription)"
        }

        resolvingHash = nil
    }
}

/// A single stream row showing quality, size, cache status, and play action.
struct StreamRow: View {
    let torrent: TorrentResult
    let cacheInfo: (service: DebridServiceType, status: CacheStatus)?
    let isResolving: Bool
    /// The batch availability check is still running and this row has no status yet.
    var isCheckingCache: Bool = false
    let hasDebrid: Bool
    let onTap: () -> Void

    private var isCached: Bool {
        cacheInfo?.status.isCached ?? false
    }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: AppTheme.Spacing.md) {
                // Quality badge
                qualityBadge

                // Cached-on-debrid badge sits right next to the quality chip - the
                // category-defining "Instant vs. Will cache" signal.
                cacheBadge

                // Details
                VStack(alignment: .leading, spacing: AppTheme.Spacing.xxs) {
                    Text(torrent.title)
                        .font(.caption)
                        .lineLimit(1)
                        .truncationMode(.middle)

                    HStack(spacing: AppTheme.Spacing.sm) {
                        Text(torrent.qualityLabel)
                            .font(.caption2)
                            .foregroundStyle(.secondary)

                        Text(torrent.sizeString)
                            .font(.caption2)
                            .foregroundStyle(.secondary)

                        if torrent.seeders > 0 {
                            HStack(spacing: AppTheme.Spacing.xxs) {
                                Image(systemName: "arrow.up")
                                    .font(.system(size: 8))
                                Text("\(torrent.seeders)")
                                    .font(.caption2)
                            }
                            .foregroundStyle(AppTheme.seederColor(torrent.seeders))
                        }

                        Text(torrent.indexerName)
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }

                Spacer()

                // Play / resolving / no debrid indicator
                if isResolving {
                    ProgressView()
                        .controlSize(.small)
                } else if !hasDebrid {
                    Image(systemName: "lock.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Image(systemName: isCached ? "play.circle.fill" : "play.circle")
                        .font(.title3)
                        .foregroundStyle(isCached ? AppTheme.success : .secondary)
                }
            }
            .padding(.horizontal, AppTheme.Spacing.md)
            .padding(.vertical, AppTheme.Spacing.sm)
            .glassCard(radius: AppTheme.Radius.sm, tint: isCached ? AppTheme.success : nil)
        }
        .buttonStyle(.plain)
        .disabled(isResolving || !hasDebrid)
        .opacity(hasDebrid ? 1.0 : 0.6)
    }

    @ViewBuilder
    private var qualityBadge: some View {
        Text(torrent.quality.rawValue)
            .font(.caption.bold())
            .foregroundStyle(.white)
            .frame(width: 44, height: 24)
            .background(qualityColor)
            .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.xs, style: .continuous))
    }

    /// The cached-on-debrid pill:
    ///  - green "Instant · RD" when the active debrid already has it cached;
    ///  - subtle grey "Will cache" when it must download it first;
    ///  - inline spinner while the batch check is still running;
    ///  - nothing for `.unknown` (never blocks the row).
    @ViewBuilder
    private var cacheBadge: some View {
        if !hasDebrid {
            EmptyView()
        } else if isCached, let info = cacheInfo {
            HStack(spacing: AppTheme.Spacing.xxs) {
                Image(systemName: "bolt.fill")
                    .font(.system(size: 9, weight: .bold))
                Text("Instant")
                    .font(.caption2.weight(.semibold))
                Text(info.service.shortCode)
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1)
                    .background(Capsule().fill(.white.opacity(0.22)))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, AppTheme.Spacing.sm)
            .padding(.vertical, AppTheme.Spacing.xs)
            .background(Capsule().fill(AppTheme.success))
            .overlay(Capsule().strokeBorder(.white.opacity(0.18), lineWidth: 0.5))
            .help("Cached on \(info.service.displayName) - streams instantly")
        } else if isCheckingCache {
            HStack(spacing: AppTheme.Spacing.xxs) {
                ProgressView().controlSize(.mini)
            }
            .frame(width: 16)
        } else if case .notCached = cacheInfo?.status {
            HStack(spacing: AppTheme.Spacing.xxs) {
                Image(systemName: "arrow.down.circle")
                    .font(.system(size: 9))
                Text("Will cache")
                    .font(.caption2.weight(.medium))
            }
            .foregroundStyle(.secondary)
            .padding(.horizontal, AppTheme.Spacing.sm)
            .padding(.vertical, AppTheme.Spacing.xs)
            .background(Capsule().fill(.gray.opacity(0.18)))
            .overlay(Capsule().strokeBorder(AppTheme.glassBorder, lineWidth: 0.5))
            .help("Not yet cached - the debrid will download it first, then stream")
        } else {
            // .unknown or no result yet (check skipped) - neutral, no badge.
            EmptyView()
        }
    }

    private var qualityColor: Color {
        AppTheme.qualityColor(torrent.quality.rawValue)
    }
}
