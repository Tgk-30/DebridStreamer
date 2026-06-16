import SwiftUI

struct DetailView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    let mediaPreview: MediaPreview

    @State private var mediaDetail: MediaItem?
    @State private var isLoading = true
    @State private var errorMessage: String?

    // Stream search state
    @State private var torrents: [TorrentResult] = []
    @State private var cacheResults: [String: (service: DebridServiceType, status: CacheStatus)] = [:]
    @State private var isSearchingStreams = false
    @State private var streamSearchDone = false
    @State private var streamError: String?
    @State private var streamSearchTask: Task<Void, Never>?

    // Season/episode selection for TV shows
    @State private var selectedSeason: Int = 1
    @State private var selectedEpisode: Int = 1
    @State private var seasons: [Season] = []

    // Player state
    @State private var resolvedStreams: [StreamInfo] = []
    @State private var isInWatchlist = false
    @State private var isInFavorites = false
    @State private var libraryActionStatus: String?
    @State private var availableFolders: [LibraryFolder] = []

    var body: some View {
        ZStack(alignment: .topTrailing) {
            AppTheme.background.ignoresSafeArea()
            AppTheme.auroraGlow
            ScrollView {
                if isLoading {
                    ProgressView("Loading details...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .padding(.top, 100)
                } else if let detail = mediaDetail {
                    detailContent(detail)
                } else if let error = errorMessage {
                    VStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 36))
                            .foregroundStyle(.orange)
                        Text(error)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 100)
                }
            }
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.primary)
                    .frame(width: 28, height: 28)
                    .background(.ultraThinMaterial, in: Circle())
                    .overlay(Circle().strokeBorder(AppTheme.glassBorder, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .padding(AppTheme.Spacing.md)
        }
        .task {
            await loadDetail()
        }
        .onDisappear {
            streamSearchTask?.cancel()
            streamSearchTask = nil
        }
    }

    @ViewBuilder
    private func detailContent(_ detail: MediaItem) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // Backdrop + overlay
            ZStack(alignment: .bottomLeading) {
                if let backdropURL = detail.backdropURL {
                    AsyncImage(url: backdropURL) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable().aspectRatio(contentMode: .fill)
                        default:
                            Rectangle().fill(.quaternary)
                        }
                    }
                    .frame(height: 300)
                    .clipped()
                    .overlay {
                        LinearGradient(
                            colors: [.clear, .black.opacity(0.8)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    }
                }

                // Title overlay
                VStack(alignment: .leading, spacing: 8) {
                    Text(detail.title)
                        .font(.largeTitle)
                        .fontWeight(.bold)
                        .foregroundStyle(.white)

                    HStack(spacing: AppTheme.Spacing.sm) {
                        if let year = detail.year {
                            Text(String(year)).foregroundStyle(.white.opacity(0.85))
                        }
                        if !detail.runtimeString.isEmpty {
                            metaDot
                            Text(detail.runtimeString).foregroundStyle(.white.opacity(0.85))
                        }
                        if let rating = detail.imdbRating, rating > 0 {
                            metaDot
                            HStack(spacing: AppTheme.Spacing.xs) {
                                Image(systemName: "star.fill")
                                    .foregroundStyle(AppTheme.warning)
                                Text(String(format: "%.1f", rating))
                                    .foregroundStyle(.white)
                            }
                        }
                        Text(detail.type.displayName)
                            .font(.caption.weight(.medium))
                            .padding(.horizontal, AppTheme.Spacing.sm)
                            .padding(.vertical, 2)
                            .background(.ultraThinMaterial)
                            .clipShape(Capsule())
                            .padding(.leading, AppTheme.Spacing.xs)
                    }
                    .font(.subheadline)
                }
                .padding()
            }

            // Content
            VStack(alignment: .leading, spacing: 16) {
                // Genres
                if !detail.genres.isEmpty {
                    HStack(spacing: 8) {
                        ForEach(detail.genres, id: \.self) { genre in
                            Text(genre)
                                .font(.caption.weight(.medium))
                                .padding(.horizontal, AppTheme.Spacing.md)
                                .padding(.vertical, AppTheme.Spacing.xs + 1)
                                .background(AppTheme.accent.opacity(0.18), in: Capsule())
                                .overlay(Capsule().strokeBorder(AppTheme.accent.opacity(0.35), lineWidth: 0.75))
                                .foregroundStyle(AppTheme.accent)
                        }
                    }
                }

                // Overview — constrain the measure for comfortable reading (L22).
                if let overview = detail.overview, !overview.isEmpty {
                    Text(overview)
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .lineSpacing(2)
                        .lineLimit(nil)
                        .frame(maxWidth: 580, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                }

                actionBar(detail)

                Divider()

                // Season/Episode picker for TV shows
                if detail.type == .series {
                    seasonEpisodePicker
                }

                // Stream search section
                streamSection(detail)
            }
            .padding()
        }
    }

    private var metaDot: some View {
        Text("•").foregroundStyle(.white.opacity(0.45))
    }

    @ViewBuilder
    private func actionBar(_ detail: MediaItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Button(isInWatchlist ? "Remove Watchlist" : "Add Watchlist") {
                    Task { await toggleLibrary(type: .watchlist, detail: detail) }
                }
                .buttonStyle(.glass)

                Button(isInFavorites ? "Remove Library" : "Add Library") {
                    Task { await toggleLibrary(type: .favorites, detail: detail) }
                }
                .buttonStyle(.glass)

                Button("Ask AI") {
                    let genres = detail.genres.joined(separator: ", ")
                    appState.assistantDraftPrompt = "Recommend \(detail.type == .movie ? "movies" : "series") similar to \(detail.title). Genres: \(genres)."
                    appState.selectedLibraryFolderId = availableFolders.first(where: { $0.listType == .favorites && !$0.isSystem })?.id
                    appState.selectedSidebarItem = .assistant
                    dismiss()
                }
                .buttonStyle(.glassProminent)

                if !availableFolders.isEmpty {
                    // Glass-styled to match the action pills (L4) instead of a stock Menu.
                    Menu {
                        let libraryFolders = availableFolders.filter { $0.listType == .favorites }
                        if !libraryFolders.isEmpty {
                            Section("Library") {
                                ForEach(libraryFolders) { folder in
                                    Button(folder.name) {
                                        Task { await addToFolder(folder, detail: detail) }
                                    }
                                }
                            }
                        }
                    } label: {
                        HStack(spacing: AppTheme.Spacing.xs) {
                            Image(systemName: "folder.badge.plus")
                            Text("Add To Folder")
                            Image(systemName: "chevron.down").font(.caption2)
                        }
                        .font(.callout.weight(.semibold))
                        .padding(.horizontal, AppTheme.Spacing.lg)
                        .padding(.vertical, AppTheme.Spacing.sm)
                    }
                    .menuStyle(.borderlessButton)
                    .menuIndicator(.hidden)
                    .fixedSize()
                    .background(.ultraThinMaterial, in: Capsule())
                    .overlay(Capsule().strokeBorder(AppTheme.glassBorder, lineWidth: 1))
                }
            }

            if let libraryActionStatus {
                Text(libraryActionStatus)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Season / Episode Picker

    @ViewBuilder
    private var seasonEpisodePicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Select Episode")
                .font(.headline)

            HStack(spacing: 16) {
                Picker("Season", selection: $selectedSeason) {
                    // Drive the picker from real TMDB season numbers (excluding
                    // season 0 "Specials"), not array indices — otherwise the tag
                    // doesn't match the seasonNumber used for episode/stream lookup.
                    let realSeasons = seasons.filter { $0.seasonNumber > 0 }
                    if realSeasons.isEmpty {
                        Text("Season \(selectedSeason)").tag(selectedSeason)
                    } else {
                        ForEach(realSeasons) { season in
                            Text(season.name).tag(season.seasonNumber)
                        }
                    }
                }
                .frame(width: 160)
                .onChange(of: selectedSeason) {
                    selectedEpisode = 1
                    clearStreamResults()
                }

                Picker("Episode", selection: $selectedEpisode) {
                    let episodeCount = seasons.first(where: { $0.seasonNumber == selectedSeason })?.episodeCount ?? 20
                    ForEach(1...max(1, episodeCount), id: \.self) { num in
                        Text("Episode \(num)").tag(num)
                    }
                }
                .frame(width: 160)
                .onChange(of: selectedEpisode) {
                    clearStreamResults()
                }
            }
        }
    }

    // MARK: - Stream Section

    @ViewBuilder
    private func streamSection(_ detail: MediaItem) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Streams")
                    .font(.title3)
                    .fontWeight(.semibold)

                Spacer()

                Button {
                    if isSearchingStreams {
                        streamSearchTask?.cancel()
                    } else {
                        streamSearchTask = Task {
                            await searchStreams(detail)
                        }
                    }
                } label: {
                    HStack(spacing: 6) {
                        if isSearchingStreams {
                            Image(systemName: "xmark.circle")
                        } else {
                            Image(systemName: "magnifyingglass")
                        }
                        Text(isSearchingStreams ? "Cancel" : (streamSearchDone ? "Refresh" : "Find Streams"))
                    }
                }
                .buttonStyle(.glassProminent)
            }

            if let error = streamError {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }

            if isSearchingStreams {
                VStack(spacing: 8) {
                    ProgressView()
                    Text("Searching indexers and checking debrid cache...")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 20)
            } else if streamSearchDone {
                StreamListView(
                    mediaItem: detail,
                    torrents: torrents,
                    cacheResults: cacheResults,
                    onPlay: { stream in
                        Task { @MainActor in
                            await playStream(stream)
                        }
                    }
                )
            } else {
                // Not yet searched
                VStack(spacing: 8) {
                    Image(systemName: "play.circle")
                        .font(.system(size: 32))
                        .foregroundStyle(.secondary)
                    Text("Click \"Find Streams\" to search for available streams")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    if appState.debridManager == nil {
                        Text("Configure a debrid service in Settings first.")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 20)
            }
        }
    }

    // MARK: - Actions

    private func loadDetail() async {
        guard let service = appState.metadataService else {
            errorMessage = "TMDB API key not configured"
            isLoading = false
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            if let tmdbId = mediaPreview.tmdbId {
                mediaDetail = try await service.getDetail(id: String(tmdbId), type: mediaPreview.type)
            } else {
                mediaDetail = try await service.getDetail(id: mediaPreview.id, type: mediaPreview.type)
            }

            if let detail = mediaDetail, let db = appState.databaseManager {
                try? await db.saveMedia(detail)
            }

            // Load seasons for TV shows
            if let detail = mediaDetail, detail.type == .series {
                await loadSeasons(detail, service: service)
            }

            if let detail = mediaDetail {
                await refreshLibraryFlags(for: detail)
                await loadAvailableFolders()
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadSeasons(_ detail: MediaItem, service: TMDBService) async {
        // Extract TMDB ID for season queries
        let tmdbIdInt: Int?
        if detail.id.hasPrefix("tmdb-"), let parsed = Int(detail.id.dropFirst(5)) {
            tmdbIdInt = parsed
        } else if let tId = detail.tmdbId {
            tmdbIdInt = tId
        } else {
            tmdbIdInt = nil
        }

        guard let tmdbId = tmdbIdInt else { return }

        do {
            let fetchedSeasons = try await service.getSeasons(tmdbId: tmdbId)
            if !fetchedSeasons.isEmpty {
                seasons = fetchedSeasons
                // Ensure the selection is a real season number (skip "Specials" 0),
                // since the default of 1 may not exist for every show.
                let realSeasons = fetchedSeasons.filter { $0.seasonNumber > 0 }
                if !realSeasons.contains(where: { $0.seasonNumber == selectedSeason }),
                   let first = realSeasons.first {
                    selectedSeason = first.seasonNumber
                }
            }
        } catch {
            // Non-fatal — just won't have accurate episode counts
        }
    }

    private func searchStreams(_ detail: MediaItem) async {
        guard let indexer = appState.indexerManager else {
            streamError = "Indexer not initialized"
            return
        }

        isSearchingStreams = true
        defer {
            isSearchingStreams = false
            streamSearchTask = nil
        }
        streamError = nil

        do {
            try Task.checkCancellation()
            // Step 1: Search indexers for torrents
            let imdbId = detail.id.hasPrefix("tt") ? detail.id : nil
            let season: Int? = detail.type == .series ? selectedSeason : nil
            let episode: Int? = detail.type == .series ? selectedEpisode : nil
            var results: [TorrentResult]

            if let imdbId = imdbId {
                results = await indexer.searchAll(
                    imdbId: imdbId,
                    type: detail.type,
                    season: season,
                    episode: episode
                )
            } else {
                results = [] // Will fall through to text search below
            }

            // If IMDB search found nothing, try text-based search as fallback
            if results.isEmpty {
                var query = detail.title
                if detail.type == .series {
                    if let s = season, let e = episode {
                        query += " S\(String(format: "%02d", s))E\(String(format: "%02d", e))"
                    }
                } else if let year = detail.year {
                    query += " \(year)"
                }
                try Task.checkCancellation()
                let textResults = await indexer.searchByQuery(query, type: detail.type)
                results = textResults
            }

            try Task.checkCancellation()
            torrents = results

            // Step 2: Check debrid cache for all hashes
            if let debrid = appState.debridManager, await debrid.hasServices {
                let hashes = results.map(\.infoHash)
                if !hashes.isEmpty {
                    try Task.checkCancellation()
                    let cache = try await debrid.checkCacheAll(hashes: hashes)
                    cacheResults = cache
                }
            }

            streamSearchDone = true

            // Show diagnostic info if no results
            if results.isEmpty {
                let errors = await indexer.lastSearchErrors
                if !errors.isEmpty {
                    let errorDetails = errors.map { "\($0.indexer): \($0.error)" }.joined(separator: "\n")
                    streamError = "No streams found. Indexer errors:\n\(errorDetails)"
                }
            }
        } catch is CancellationError {
            streamError = "Stream search canceled."
        } catch {
            streamError = "Search failed: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func playStream(_ stream: StreamInfo) async {
        guard let detail = mediaDetail else {
            streamError = "Unable to open player: media details unavailable."
            return
        }

        if !resolvedStreams.contains(where: { $0.streamURL == stream.streamURL }) {
            resolvedStreams.append(stream)
        }

        let request = PlayerSessionRequest(
            stream: stream,
            availableStreams: sortedResolvedStreams(),
            mediaTitle: detail.title,
            mediaId: detail.id,
            episodeId: detail.type == .series ? "\(detail.id)-s\(selectedSeason)e\(selectedEpisode)" : nil
        )
        appState.openPlayer(request)
        streamError = nil
    }

    private func clearStreamResults() {
        streamSearchTask?.cancel()
        torrents = []
        cacheResults = [:]
        resolvedStreams = []
        streamSearchDone = false
        streamError = nil
        isSearchingStreams = false
    }

    private func sortedResolvedStreams() -> [StreamInfo] {
        resolvedStreams.sorted {
            if $0.quality == $1.quality {
                return $0.sizeBytes > $1.sizeBytes
            }
            return $0.quality > $1.quality
        }
    }

    private func refreshLibraryFlags(for detail: MediaItem) async {
        guard let db = appState.databaseManager else { return }
        isInWatchlist = (try? await db.isInLibrary(mediaId: detail.id, listType: .watchlist)) ?? false
        isInFavorites = (try? await db.isInLibrary(mediaId: detail.id, listType: .favorites)) ?? false
    }

    private func loadAvailableFolders() async {
        guard let db = appState.databaseManager else { return }
        availableFolders = (try? await db.fetchAllLibraryFolders()) ?? []
    }

    private func toggleLibrary(type: UserLibraryEntry.ListType, detail: MediaItem) async {
        guard let db = appState.databaseManager else {
            libraryActionStatus = "Library database unavailable."
            return
        }

        do {
            let alreadyIn = try await db.isInLibrary(mediaId: detail.id, listType: type)
            if alreadyIn {
                try await db.removeFromLibrary(mediaId: detail.id, listType: type)
            } else {
                let folderId = try await db.fetchSystemLibraryFolderID(listType: type)
                let entry = UserLibraryEntry(
                    id: "\(detail.id)-\(folderId)",
                    mediaId: detail.id,
                    folderId: folderId,
                    listType: type,
                    addedAt: Date()
                )
                try await db.addToLibrary(entry)
            }

            await refreshLibraryFlags(for: detail)
            libraryActionStatus = alreadyIn ? "Removed from \(type.rawValue)." : "Added to \(type.rawValue)."
        } catch {
            libraryActionStatus = "Library update failed: \(error.localizedDescription)"
        }
    }

    private func addToFolder(_ folder: LibraryFolder, detail: MediaItem) async {
        guard let db = appState.databaseManager else {
            libraryActionStatus = "Library database unavailable."
            return
        }

        do {
            let exists = try await db.isInLibrary(mediaId: detail.id, folderId: folder.id)
            if exists {
                libraryActionStatus = "\"\(detail.title)\" is already in \"\(folder.name)\"."
                return
            }

            let entry = UserLibraryEntry(
                id: "\(detail.id)-\(folder.id)",
                mediaId: detail.id,
                folderId: folder.id,
                listType: folder.listType,
                addedAt: Date()
            )
            try await db.addToLibrary(entry)
            appState.selectedLibraryFolderId = folder.id
            await refreshLibraryFlags(for: detail)
            libraryActionStatus = "Added to \"\(folder.name)\"."
        } catch {
            libraryActionStatus = "Add to folder failed: \(error.localizedDescription)"
        }
    }
}
