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
    @State private var isCheckingCache = false
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

    // Watched indicator + rating flow (mirrors Discover's mark-watched path).
    @State private var watchedStatus: WatchedStatus = .unwatched
    @State private var pendingRating: PendingRating?

    // "Would I like this?" inline AI verdict.
    @State private var affinityVerdict: AIAffinityVerdict?
    @State private var isPredictingAffinity = false
    @State private var affinityError: String?
    @State private var showAffinityUnavailable = false

    // L23 - cast / related / technical details
    @State private var cast: [CastMember] = []
    @State private var related: [MediaPreview] = []
    // Tapping a "More Like This" poster opens that title in a nested detail sheet.
    @State private var relatedSelection: MediaPreview?
    // Tapping a cast headshot opens that person's Person/Cast page.
    @State private var selectedPerson: CastMember?

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
        .sheet(item: $relatedSelection) { item in
            DetailView(mediaPreview: item)
                .frame(minWidth: 880, idealWidth: 900, minHeight: 580)
        }
        .sheet(item: $selectedPerson) { member in
            PersonView(personId: member.id, initialName: member.name)
                .frame(minWidth: 820, idealWidth: 900, minHeight: 560)
        }
        .sheet(item: $pendingRating) { pending in
            RatingFeedbackSheet(
                title: ratingTitle,
                mode: pending.mode,
                value: Binding(
                    get: { pendingRating?.value },
                    set: { pendingRating?.value = $0 }
                ),
                onCancel: { pendingRating = nil },
                onSave: {
                    guard let pending = pendingRating else { return }
                    Task { await submitRating(mode: pending.mode, value: pending.value) }
                }
            )
            .frame(minWidth: 420, minHeight: 260)
        }
    }

    @ViewBuilder
    private func detailContent(_ detail: MediaItem) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // Backdrop + overlay
            ZStack(alignment: .bottomLeading) {
                if let backdropURL = detail.backdropURL {
                    CachedAsyncImage(url: backdropURL) { phase in
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
                        if let rt = detail.rtRating, rt > 0 {
                            metaDot
                            HStack(spacing: AppTheme.Spacing.xs) {
                                Image(systemName: rt >= 60 ? "fork.knife.circle.fill" : "fork.knife.circle")
                                    .foregroundStyle(rt >= 60 ? AppTheme.success : AppTheme.warning)
                                Text("\(rt)%")
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

                        if watchedStatus.isWatched {
                            HStack(spacing: AppTheme.Spacing.xxs) {
                                Image(systemName: "checkmark.circle.fill")
                                Text("Watched")
                            }
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, AppTheme.Spacing.sm)
                            .padding(.vertical, 2)
                            .background(AppTheme.success.opacity(0.9), in: Capsule())
                        }
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

                // Overview - constrain the measure for comfortable reading (L22).
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

                // L23 - fill the lower half: cast, related titles, technical details.
                if !cast.isEmpty {
                    Divider()
                    castSection
                }

                if !related.isEmpty {
                    Divider()
                    relatedSection
                }

                if let tech = technicalRows(detail), !tech.isEmpty {
                    Divider()
                    technicalSection(tech)
                }
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

                Button {
                    Task { await beginRating(detail) }
                } label: {
                    Label(watchedStatus.isWatched ? "Rate Again" : "Rate", systemImage: "star")
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

                Button {
                    if appState.aiAssistantHasProvider {
                        Task { await predictAffinity(detail) }
                    } else {
                        // Never a dead button: reveal the quiet unavailable hint.
                        showAffinityUnavailable = true
                        affinityVerdict = nil
                        affinityError = nil
                    }
                } label: {
                    if isPredictingAffinity {
                        HStack(spacing: AppTheme.Spacing.xs) {
                            ProgressView().controlSize(.small)
                            Text("Would I like this?")
                        }
                    } else {
                        Text("Would I like this?")
                    }
                }
                .buttonStyle(.glass)
                .disabled(isPredictingAffinity)

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

            affinitySection
        }
    }

    // MARK: - "Would I like this?" inline verdict

    /// Renders under the action bar: the gated unavailable hint, a provider error,
    /// or the verdict card. Nothing shows until the user taps the button.
    @ViewBuilder
    private var affinitySection: some View {
        if !appState.aiAssistantHasProvider, showAffinityUnavailable {
            affinityUnavailableHint
        } else if let affinityError {
            affinityErrorCard(affinityError)
        } else if let affinityVerdict {
            affinityResultCard(affinityVerdict)
        }
    }

    private var affinityUnavailableHint: some View {
        HStack(spacing: AppTheme.Spacing.sm) {
            Image(systemName: "key.fill")
                .foregroundStyle(.secondary)
            Text("Add an AI provider (OpenAI, Anthropic, or Ollama) to get a personal verdict.")
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Button("Open settings") {
                appState.openSettings(tab: .aiSync)
            }
            .buttonStyle(.glass)
            .controlSize(.small)
        }
        .padding(.horizontal, AppTheme.Spacing.md)
        .padding(.vertical, AppTheme.Spacing.sm)
        .frame(maxWidth: 580, alignment: .leading)
        .glassElevation(.rest, radius: AppTheme.Radius.md)
    }

    private func affinityErrorCard(_ message: String) -> some View {
        HStack(spacing: AppTheme.Spacing.sm) {
            Image(systemName: "exclamationmark.triangle")
                .foregroundStyle(AppTheme.warning)
            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Button {
                affinityError = nil
            } label: {
                Image(systemName: "xmark.circle")
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
        }
        .padding(AppTheme.Spacing.md)
        .frame(maxWidth: 580, alignment: .leading)
        .glassCard(radius: AppTheme.Radius.md)
    }

    private func affinityResultCard(_ verdict: AIAffinityVerdict) -> some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
            HStack(spacing: AppTheme.Spacing.sm) {
                Image(systemName: affinityIcon(verdict.verdict))
                    .font(.title3)
                    .foregroundStyle(affinityTint(verdict.verdict))
                Text(affinityHeadline(verdict.verdict))
                    .font(.headline)
                Text("\(verdict.confidencePercent)% confidence")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    affinityVerdict = nil
                } label: {
                    Image(systemName: "xmark.circle")
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
            Text(verdict.reasoning)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: 580, alignment: .leading)
        .padding(AppTheme.Spacing.md)
        .glassCard(radius: AppTheme.Radius.md, tint: affinityTint(verdict.verdict))
    }

    private func affinityIcon(_ verdict: AIAffinityVerdict.Verdict) -> String {
        switch verdict {
        case .yes: return "checkmark.circle.fill"
        case .maybe: return "questionmark.circle.fill"
        case .no: return "xmark.circle.fill"
        }
    }

    private func affinityTint(_ verdict: AIAffinityVerdict.Verdict) -> Color {
        switch verdict {
        case .yes: return AppTheme.success
        case .maybe: return AppTheme.warning
        case .no: return AppTheme.danger
        }
    }

    private func affinityHeadline(_ verdict: AIAffinityVerdict.Verdict) -> String {
        switch verdict {
        case .yes: return "Likely yes"
        case .maybe: return "Maybe"
        case .no: return "Probably not"
        }
    }

    private func predictAffinity(_ detail: MediaItem) async {
        guard let assistant = appState.aiAssistantManager else {
            affinityError = "AI is unavailable. Check Settings."
            return
        }
        showAffinityUnavailable = false
        affinityError = nil
        affinityVerdict = nil
        isPredictingAffinity = true
        defer { isPredictingAffinity = false }
        do {
            affinityVerdict = try await assistant.predictAffinity(for: detail)
        } catch {
            affinityError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
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
                    // season 0 "Specials"), not array indices - otherwise the tag
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
                    isCheckingCache: isCheckingCache,
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

    // MARK: - Cast / Related / Technical (L23)

    @ViewBuilder
    private var castSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Cast")
                .font(.title3)
                .fontWeight(.semibold)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: AppTheme.Spacing.md) {
                    ForEach(cast) { member in
                        Button {
                            selectedPerson = member
                        } label: {
                            CastChip(member: member)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.trailing, AppTheme.Spacing.xxl)
            }
            .mask(railTrailingFade)
        }
    }

    @ViewBuilder
    private var relatedSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("More like this")
                .font(.title3)
                .fontWeight(.semibold)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: AppTheme.Spacing.md) {
                    ForEach(related) { item in
                        Button {
                            relatedSelection = item
                        } label: {
                            MediaCard(item: item)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.trailing, AppTheme.Spacing.xxl)
            }
            .mask(railTrailingFade)
        }
    }

    @ViewBuilder
    private func technicalSection(_ rows: [(String, String)]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Details")
                .font(.title3)
                .fontWeight(.semibold)

            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 180, maximum: 280), spacing: AppTheme.Spacing.md, alignment: .leading)],
                alignment: .leading,
                spacing: AppTheme.Spacing.md
            ) {
                ForEach(rows, id: \.0) { label, value in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(label)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(value)
                            .font(.callout.weight(.medium))
                            .foregroundStyle(.primary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(AppTheme.Spacing.md)
                    .glassElevation(.rest, radius: AppTheme.Radius.sm)
                }
            }
        }
    }

    /// Build the key/value rows for the technical-details grid, omitting empties.
    private func technicalRows(_ detail: MediaItem) -> [(String, String)]? {
        var rows: [(String, String)] = []
        if let status = detail.status, !status.isEmpty {
            rows.append(("Status", status))
        }
        if !detail.runtimeString.isEmpty {
            rows.append(("Runtime", detail.runtimeString))
        }
        if !detail.genres.isEmpty {
            rows.append(("Genres", detail.genres.joined(separator: ", ")))
        }
        if let rating = detail.imdbRating, rating > 0 {
            rows.append(("IMDb rating", String(format: "%.1f / 10", rating)))
        }
        if let rt = detail.rtRating, rt > 0 {
            rows.append(("Rotten Tomatoes", "\(rt)%"))
        }
        return rows
    }

    /// L1 trailing fade so horizontal rails dissolve at the edge rather than hard-clip.
    private var railTrailingFade: some View {
        LinearGradient(
            stops: [
                .init(color: .black, location: 0),
                .init(color: .black, location: 0.92),
                .init(color: .clear, location: 1)
            ],
            startPoint: .leading,
            endPoint: .trailing
        )
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
                // L23 - cast + related, fetched in parallel and fault-tolerant.
                await loadCastAndRelated(detail, service: service)
                // B1 - IMDb/RT ratings via OMDB (only for real tt-ids).
                await loadOMDBRatings(detail)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Fetch the cast row and "more like this" row in parallel. Either failing
    /// just leaves its row empty - it never blocks the modal or surfaces an error.
    private func loadCastAndRelated(_ detail: MediaItem, service: TMDBService) async {
        guard let tmdbId = resolvedTMDBId(detail) else { return }
        async let castResult = try? service.getCast(tmdbId: tmdbId, type: detail.type)
        async let relatedResult = try? service.getRecommendations(tmdbId: tmdbId, type: detail.type)
        let (fetchedCast, fetchedRelated) = await (castResult, relatedResult)
        if let fetchedCast { cast = Array(fetchedCast.prefix(20)) }
        if let fetchedRelated { related = Array(fetchedRelated.prefix(20)) }
    }

    /// Enrich with IMDb/Rotten-Tomatoes ratings from OMDB. Guarded so we only
    /// call OMDB when the detail's id is a real IMDb id (`tt…`) - for tmdb-only
    /// titles there is no OMDB join key, so we skip silently. Also skips when no
    /// OMDB key is configured (`omdbService == nil`) or on any failure.
    private func loadOMDBRatings(_ detail: MediaItem) async {
        guard detail.id.hasPrefix("tt"), let omdb = appState.omdbService else { return }
        guard let ratings = try? await omdb.fetchRatings(imdbId: detail.id) else { return }
        guard let rtPercent = ratings.rtPercent else { return }
        guard var updated = mediaDetail else { return }
        updated.rtRating = rtPercent
        mediaDetail = updated
        // Persist into the existing rtRating column (no migration needed).
        if let db = appState.databaseManager {
            try? await db.saveMedia(updated)
        }
    }

    /// Resolve a numeric TMDB id from a MediaItem (`tmdbId`, `tmdb-{id}`, or numeric id).
    private func resolvedTMDBId(_ detail: MediaItem) -> Int? {
        if let tId = detail.tmdbId { return tId }
        if detail.id.hasPrefix("tmdb-"), let parsed = Int(detail.id.dropFirst(5)) { return parsed }
        if detail.id.allSatisfy(\.isNumber), let parsed = Int(detail.id) { return parsed }
        return nil
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
            // Non-fatal - just won't have accurate episode counts
        }
    }

    // @MainActor: this drives several @State properties (torrents, cacheResults,
    // streamSearchDone, isSearchingStreams, isCheckingCache, streamError) across
    // `await` suspension points. Pinning the method to the main actor guarantees
    // those mutations resume on the main thread (the heavy indexer/debrid work
    // still hops onto their own actors and back), avoiding SwiftUI's
    // "Publishing changes from background threads" warnings.
    @MainActor
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
            cacheResults = [:]

            // Render the stream list immediately; the batch cache check below runs
            // asynchronously and fills the per-row "Instant / Will cache" badges in
            // as it returns. The list is never blocked behind the availability check.
            streamSearchDone = true
            isSearchingStreams = false

            // Step 2: Batch debrid availability check for all hashes (one call).
            if let debrid = appState.debridManager, await debrid.hasServices {
                let hashes = results.map(\.infoHash)
                if !hashes.isEmpty {
                    try Task.checkCancellation()
                    isCheckingCache = true
                    defer { isCheckingCache = false }
                    let cache = try await debrid.checkCacheAll(hashes: hashes)
                    try Task.checkCancellation()
                    cacheResults = cache
                }
            }

            // Show diagnostic info if no results
            if results.isEmpty {
                let errors = await indexer.lastSearchErrors
                if !errors.isEmpty {
                    let errorDetails = errors.map { "\($0.indexer): \($0.error)" }.joined(separator: "\n")
                    streamError = "No streams found. Indexer errors:\n\(errorDetails)"
                }
            }
        } catch is CancellationError {
            // If the list is already on screen, a cancellation mid-availability-check
            // should not overwrite a valid result list with an error banner.
            if !streamSearchDone {
                streamError = "Stream search canceled."
            }
        } catch {
            if !streamSearchDone {
                streamError = "Search failed: \(error.localizedDescription)"
            }
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
        // Watched indicator: combine playback progress with the latest explicit
        // watched state the user set through the rating flow.
        let history = (try? await db.fetchWatchHistory(mediaId: detail.id)) ?? nil
        let watchedState = ((try? await db.fetchLatestWatchedState(mediaId: detail.id)) ?? nil)?.watchedState
        watchedStatus = WatchedStatus.derive(history: history, watchedState: watchedState)
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

    // MARK: - Rating flow (shared with Discover's mark-watched path)

    /// A pending rating awaiting the user's input in the shared sheet.
    struct PendingRating: Identifiable {
        let id = UUID()
        let mode: FeedbackScaleMode
        var value: Double?
    }

    /// Sheet header title for the current detail (with year suffix when known).
    private var ratingTitle: String {
        guard let detail = mediaDetail else { return mediaPreview.title }
        return detail.title + (detail.year.map { " (\($0))" } ?? "")
    }

    /// Open the rating sheet when the scale mode needs input, otherwise submit
    /// immediately, with identical semantics to Discover's "Mark watched".
    private func beginRating(_ detail: MediaItem) async {
        let mode = (try? await appState.settingsManager?.getFeedbackScaleMode()) ?? .likeDislike
        if mode == .none {
            await submitRating(mode: .none, value: nil)
        } else {
            pendingRating = PendingRating(mode: mode, value: defaultRatingValue(for: mode))
        }
    }

    private func submitRating(mode: FeedbackScaleMode, value: Double?) async {
        pendingRating = nil
        guard let detail = mediaDetail else { return }
        guard let service = appState.userFeedbackService else {
            libraryActionStatus = "Feedback service unavailable."
            return
        }

        let recommendation = AIMovieRecommendation(
            title: detail.title,
            year: detail.year,
            reason: "Rated from Detail",
            score: detail.imdbRating ?? 0,
            mediaId: detail.id,
            mediaType: detail.type,
            posterPath: detail.posterPath
        )
        let outcome = await service.recordRecommendationFeedback(
            recommendation: recommendation,
            watchedState: .watched,
            feedbackScaleMode: mode,
            feedbackValue: value,
            source: .manual
        )
        if outcome.addedToReleaseWait {
            libraryActionStatus = "Marked watched and added to Release Wait."
        } else if outcome.addedToWatchedFolder {
            libraryActionStatus = "Marked watched and added to Watched."
        } else {
            libraryActionStatus = "Marked watched."
        }
        // Reflect the new watched state on the chip.
        await refreshLibraryFlags(for: detail)
    }

    private func defaultRatingValue(for mode: FeedbackScaleMode) -> Double? {
        switch mode {
        case .none:
            return nil
        case .likeDislike:
            return 1
        case .scale1to10:
            return 8
        case .scale1to100:
            return 80
        }
    }
}

// MARK: - Tappable cast headshot

/// One cast headshot + name/character, with a subtle hover lift so it reads as
/// tappable (opens the Person/Cast page). Mirrors the MediaCard hover affordance.
private struct CastChip: View {
    let member: CastMember
    @State private var hovering = false

    var body: some View {
        VStack(spacing: AppTheme.Spacing.sm) {
            CachedAsyncImage(url: member.profileURL) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().aspectRatio(contentMode: .fill)
                default:
                    ZStack {
                        Rectangle().fill(.quaternary)
                        Image(systemName: "person.fill")
                            .font(.title)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .frame(width: 72, height: 72)
            .clipShape(Circle())
            .overlay(Circle().strokeBorder(hovering ? AppTheme.accent.opacity(0.7) : AppTheme.glassBorder, lineWidth: 1))

            VStack(spacing: 2) {
                Text(member.name)
                    .font(.caption.weight(.semibold))
                    .lineLimit(2, reservesSpace: true)
                    .multilineTextAlignment(.center)
                if !member.character.isEmpty {
                    Text(member.character)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(2, reservesSpace: true)
                        .multilineTextAlignment(.center)
                }
            }
            .frame(width: 84)
        }
        .contentShape(Rectangle())
        .scaleEffect(hovering ? 1.05 : 1)
        .animation(.spring(response: 0.3, dampingFraction: 0.72), value: hovering)
        .onHover { hovering = $0 }
    }
}
