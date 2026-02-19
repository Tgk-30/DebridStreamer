import SwiftUI

/// Displays a list of torrent results with cache status and stream resolution.
struct StreamListView: View {
    @Environment(AppState.self) private var appState
    let mediaItem: MediaItem
    let torrents: [TorrentResult]
    let cacheResults: [String: (service: DebridServiceType, status: CacheStatus)]
    let onPlay: (StreamInfo) -> Void

    @State private var resolvingHash: String?
    @State private var resolveError: String?

    private var hasDebrid: Bool {
        appState.debridManager != nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header
            HStack {
                Text("Available Streams")
                    .font(.title3)
                    .fontWeight(.semibold)
                Spacer()
                Text("\(torrents.count) results")
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
                // Cached streams first, then uncached
                let sorted = sortedTorrents
                ForEach(sorted, id: \.infoHash) { torrent in
                    StreamRow(
                        torrent: torrent,
                        cacheInfo: cacheResults[torrent.infoHash],
                        isResolving: resolvingHash == torrent.infoHash,
                        hasDebrid: hasDebrid,
                        onTap: {
                            Task { @MainActor in
                                await resolveTorrent(torrent)
                            }
                        }
                    )
                }
            }

            if let error = resolveError {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
        }
    }

    private var debridWarningBanner: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.title3)
                .foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 2) {
                Text("Debrid Service Required")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                Text("A debrid service (Real-Debrid, AllDebrid, etc.) is required to stream torrents. Configure one in Settings → Debrid Services.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.orange.opacity(0.1))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.orange.opacity(0.3), lineWidth: 1)
                )
        )
    }

    private var noResultsView: some View {
        VStack(spacing: 8) {
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
        .padding(.vertical, 20)
    }

    private var sortedTorrents: [TorrentResult] {
        torrents.sorted { lhs, rhs in
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
    let hasDebrid: Bool
    let onTap: () -> Void

    private var isCached: Bool {
        cacheInfo?.status.isCached ?? false
    }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                // Quality badge
                qualityBadge

                // Details
                VStack(alignment: .leading, spacing: 3) {
                    Text(torrent.title)
                        .font(.caption)
                        .lineLimit(1)
                        .truncationMode(.middle)

                    HStack(spacing: 8) {
                        Text(torrent.qualityLabel)
                            .font(.caption2)
                            .foregroundStyle(.secondary)

                        Text(torrent.sizeString)
                            .font(.caption2)
                            .foregroundStyle(.secondary)

                        if torrent.seeders > 0 {
                            HStack(spacing: 2) {
                                Image(systemName: "arrow.up")
                                    .font(.system(size: 8))
                                Text("\(torrent.seeders)")
                                    .font(.caption2)
                            }
                            .foregroundStyle(torrent.seeders > 50 ? .green : torrent.seeders > 10 ? .orange : .red)
                        }

                        Text(torrent.indexerName)
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }

                Spacer()

                // Cache / service indicator
                if isCached, let info = cacheInfo {
                    HStack(spacing: 4) {
                        Image(systemName: "bolt.fill")
                            .font(.caption2)
                        Text(info.service.displayName)
                            .font(.caption2)
                    }
                    .foregroundStyle(.green)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(.green.opacity(0.1))
                    .clipShape(Capsule())
                }

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
                        .foregroundStyle(isCached ? .green : .secondary)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(isCached ? Color.green.opacity(0.05) : Color.clear)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(isCached ? Color.green.opacity(0.2) : Color.secondary.opacity(0.15), lineWidth: 1)
                    )
            )
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
            .clipShape(RoundedRectangle(cornerRadius: 4))
    }

    private var qualityColor: Color {
        switch torrent.quality {
        case .uhd4k: return .purple
        case .hd1080p: return .blue
        case .hd720p: return .cyan
        case .sd480p: return .orange
        case .sdOther: return .gray
        case .unknown: return .gray
        }
    }
}
