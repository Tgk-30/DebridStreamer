import SwiftUI

struct DiscoverView: View {
    @Environment(AppState.self) private var appState
    @State private var selectedItem: MediaPreview?
    @State private var showPersonalizationPrompt = false
    @State private var feedbackViewModel = DiscoverFeedbackViewModel()
    /// Drives the tasteful staggered appear of the rails. Toggled once per load.
    @State private var appeared = false

    private var store: DiscoverCatalogStore { appState.discoverStore }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.xl) {
                if appState.metadataService == nil {
                    PageHeader(title: "Discover", subtitle: "Trending picks, AI-curated for you", systemImage: SidebarItem.discover.icon)
                    noApiKeyView
                } else if isColdStart {
                    PageHeader(title: "Discover", subtitle: "Trending picks, AI-curated for you", systemImage: SidebarItem.discover.icon)
                    skeletonView
                } else {
                    content
                }
            }
            .padding()
        }
        .navigationTitle("Discover")
        .task {
            await appState.preloadDiscoverCatalog()
            await appState.preloadDiscoverAICuration()
            await evaluatePersonalizationPrompt()
            syncFeedbackVisibility()
            triggerAppear()
        }
        .onChange(of: appState.metadataService != nil) {
            guard appState.metadataService != nil else { return }
            Task {
                await appState.preloadDiscoverCatalog(forceRefresh: true)
                await appState.preloadDiscoverAICuration(forceRefresh: true)
                await evaluatePersonalizationPrompt()
            }
        }
        // A single re-sync keyed off the catalog revision + AI recommendations
        // replaces the six per-rail handlers; `syncFeedbackVisibility()` still
        // runs after every load so hidden-state stays correct.
        .onChange(of: store.catalogRevision) { _, _ in
            syncFeedbackVisibility()
            triggerAppear()
        }
        .onChange(of: appState.discoverAICurationStore.recommendations) { _, _ in
            syncFeedbackVisibility()
        }
        .alert("Personalize Discover?", isPresented: $showPersonalizationPrompt) {
            Button("Not Now", role: .cancel) {
                Task { await appState.markPersonalizationPromptShown() }
            }
            Button("Open Personalization") {
                Task { await appState.markPersonalizationPromptShown() }
                appState.openSettings(tab: .personalization)
            }
        } message: {
            Text("Share your current genres, vibe, and recency preferences to improve AI-curated recommendations.")
        }
        .sheet(item: $selectedItem) { item in
            DetailView(mediaPreview: item)
                .frame(minWidth: 880, idealWidth: 900, minHeight: 580)
        }
        .sheet(item: $feedbackViewModel.pendingFeedback) { pending in
            watchedFeedbackSheet(pending: pending)
                .frame(minWidth: 420, minHeight: 260)
        }
        .overlay(alignment: .bottom) {
            if let message = feedbackViewModel.statusMessage {
                Text(message)
                    .font(.caption)
                    .padding(.horizontal, AppTheme.Spacing.md)
                    .padding(.vertical, AppTheme.Spacing.sm)
                    .glassChip()
                    .padding(.bottom, AppTheme.Spacing.sm)
            }
        }
    }

    // MARK: - Cold-start detection

    /// True only when nothing has loaded yet — used to gate the skeleton so a
    /// refresh never flashes the screen empty (content stays put while reloading).
    private var isColdStart: Bool {
        !store.isLoaded
            && store.continueWatching.isEmpty
            && store.trendingMovies.isEmpty
            && store.trendingShows.isEmpty
            && store.popularMovies.isEmpty
            && store.topRatedMovies.isEmpty
    }

    // MARK: - Main content

    @ViewBuilder
    private var content: some View {
        if let hero = heroItem {
            HeroSpotlight(
                item: hero,
                onPlay: { selectedItem = hero },
                onDetails: { selectedItem = hero }
            )
            .railAppear(appeared: appeared, index: 0)
        } else {
            PageHeader(title: "Discover", subtitle: "Trending picks, AI-curated for you", systemImage: SidebarItem.discover.icon)
        }

        if store.isLoading {
            refreshingChip
        }

        aiCuratedSection
            .railAppear(appeared: appeared, index: 1)

        continueWatchingRail
            .railAppear(appeared: appeared, index: 2)

        catalogSection(title: "Trending Movies", items: store.trendingMovies, feedbackReason: "Trending Movies rail")
            .railAppear(appeared: appeared, index: 3)
        catalogSection(title: "Trending TV Shows", items: store.trendingShows, feedbackReason: "Trending TV Shows rail")
            .railAppear(appeared: appeared, index: 4)
        catalogSection(title: "Popular Movies", items: store.popularMovies, feedbackReason: "Popular Movies rail")
            .railAppear(appeared: appeared, index: 5)
        catalogSection(title: "Top Rated Movies", items: store.topRatedMovies, feedbackReason: "Top Rated Movies rail")
            .railAppear(appeared: appeared, index: 6)
        catalogSection(title: "Now Playing", items: store.nowPlayingMovies, feedbackReason: "Now Playing rail")
            .railAppear(appeared: appeared, index: 7)
        catalogSection(title: "Upcoming", items: store.upcomingMovies, feedbackReason: "Upcoming rail")
            .railAppear(appeared: appeared, index: 8)
        catalogSection(title: "Airing Today", items: store.airingTodayShows, feedbackReason: "Airing Today rail")
            .railAppear(appeared: appeared, index: 9)
        catalogSection(title: "On The Air", items: store.onTheAirShows, feedbackReason: "On The Air rail")
            .railAppear(appeared: appeared, index: 10)

        ForEach(Array(store.genreRails.enumerated()), id: \.element.id) { offset, rail in
            catalogSection(title: rail.name, items: rail.items, feedbackReason: "\(rail.name) genre rail")
                .railAppear(appeared: appeared, index: 11 + offset)
        }
    }

    private var refreshingChip: some View {
        HStack(spacing: AppTheme.Spacing.xs) {
            ProgressView().controlSize(.small)
            Text("Refreshing…")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, AppTheme.Spacing.md)
        .padding(.vertical, AppTheme.Spacing.xs)
        .glassChip()
    }

    // MARK: - Hero

    /// Featured item: first trending movie with a backdrop, else first trending
    /// show with one. Returns nil when no backdrop exists so the hero is hidden
    /// rather than rendering a broken box.
    private var heroItem: MediaPreview? {
        store.trendingMovies.first(where: { $0.backdropURL != nil })
            ?? store.trendingShows.first(where: { $0.backdropURL != nil })
    }

    // MARK: - Continue Watching (distinct landscape rail)

    @ViewBuilder
    private var continueWatchingRail: some View {
        let items = store.continueWatching.filter { $0.isInProgress }
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
                railHeader("Continue Watching")
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: AppTheme.Spacing.lg) {
                        ForEach(items) { item in
                            ContinueWatchingCard(item: item) {
                                selectedItem = item.preview
                            }
                        }
                    }
                    .padding(.horizontal, AppTheme.Spacing.xxs)
                    .padding(.trailing, AppTheme.Spacing.xl)
                    .padding(.vertical, AppTheme.Spacing.xs)
                }
                .mask(railFadeMask)
            }
        }
    }

    // MARK: - AI Curated

    @ViewBuilder
    private var aiCuratedSection: some View {
        let store = appState.discoverAICurationStore
        let visibleRecommendations = feedbackViewModel.visibleRecommendations(from: store.recommendations)
        if store.isLoading || !store.recommendations.isEmpty {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
                HStack(spacing: AppTheme.Spacing.sm) {
                    Image(systemName: "sparkles")
                        .font(.title3)
                        .foregroundStyle(AppTheme.accent)
                    Text("AI Curated For You")
                        .font(.title2)
                        .fontWeight(.bold)
                    if store.isLoading {
                        ProgressView()
                            .controlSize(.small)
                    }
                    Spacer()
                    Button {
                        Task { await appState.preloadDiscoverAICuration(forceRefresh: true) }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.glass)
                }

                if visibleRecommendations.isEmpty && store.isLoading {
                    Color.clear
                        .frame(height: 120)
                        .frame(maxWidth: .infinity)
                        .overlay {
                            Text("Generating personalized recommendations...")
                                .foregroundStyle(.secondary)
                        }
                        .glassPanel(radius: AppTheme.Radius.md, level: .ultraThin)
                } else if !visibleRecommendations.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: AppTheme.Spacing.md) {
                            ForEach(visibleRecommendations) { rec in
                                curatedRecommendationCard(rec)
                            }
                        }
                        .padding(.trailing, AppTheme.Spacing.xl)
                    }
                    // Match the catalog rails' L1 trailing-fade so the AI rail
                    // reads as scrollable (was previously missing here).
                    .mask(railFadeMask)
                } else {
                    Color.clear
                        .frame(height: 104)
                        .frame(maxWidth: .infinity)
                        .overlay {
                            Text("You reviewed all curated picks. Refresh for a new set.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .glassPanel(radius: AppTheme.Radius.md, level: .ultraThin)
                }
            }
        }
    }

    private func curatedRecommendationCard(_ recommendation: AIMovieRecommendation) -> some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
            CachedAsyncImage(url: recommendation.posterURL) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(2/3, contentMode: .fill)
                case .empty:
                    ZStack {
                        Rectangle().fill(.quaternary)
                        ProgressView()
                    }
                default:
                    ZStack {
                        LinearGradient(
                            colors: [AppTheme.accent.opacity(0.35), AppTheme.accentSecondary.opacity(0.25), AppTheme.accentTertiary.opacity(0.25)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                        Image(systemName: "film")
                            .font(.title2)
                            .foregroundStyle(.white.opacity(0.7))
                    }
                }
            }
            .frame(height: 210)
            .frame(maxWidth: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.md, style: .continuous))
            .overlay(alignment: .topTrailing) {
                feedbackControl(for: recommendation)
                    .padding(AppTheme.Spacing.sm)
            }

            VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
                Text(recommendation.title + (recommendation.year.map { " (\($0))" } ?? ""))
                    .font(.headline)
                    .lineLimit(2)
                Text(recommendation.reason)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }

            Button {
                Task { await openRecommendationDetail(recommendation) }
            } label: {
                Label("Details", systemImage: "info.circle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
        }
        .frame(width: 250, alignment: .topLeading)
        .padding(AppTheme.Spacing.md)
        .glassCard()
    }

    // MARK: - L12: single lighter feedback control

    /// One compact ellipsis Menu that reaches BOTH recommender signals:
    /// "Mark watched" runs the exact `beginWatchedFlow` → `submitWatched` path
    /// (so the rating sheet still appears for non-`.none` scale modes), and
    /// "Not interested" runs `markNotWatched`. The inline glyph reuses the
    /// existing `cardState(for:)` confirmation states. Replaces the old dual
    /// Watched / Not Watched button pair on every card.
    @ViewBuilder
    private func feedbackControl(for recommendation: AIMovieRecommendation) -> some View {
        let state = feedbackViewModel.cardState(for: recommendation)
        ZStack {
            switch state {
            case .saving:
                ProgressView()
                    .controlSize(.small)
                    .padding(6)
                    .background(.ultraThinMaterial, in: Circle())
            case .watched:
                glyphBadge("checkmark.circle.fill", tint: AppTheme.success)
            case .notWatched:
                glyphBadge("nosign", tint: AppTheme.warning)
            case .failed(let message):
                glyphBadge("exclamationmark.triangle.fill", tint: AppTheme.danger)
                    .help(message)
            case .idle:
                Menu {
                    Button {
                        Task { await markWatched(recommendation) }
                    } label: {
                        Label("Mark watched", systemImage: "checkmark.circle")
                    }
                    Button(role: .destructive) {
                        Task {
                            await feedbackViewModel.markNotWatched(
                                recommendation: recommendation,
                                service: appState.userFeedbackService
                            )
                        }
                    } label: {
                        Label("Not interested", systemImage: "hand.thumbsdown")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.white)
                        .frame(width: 26, height: 26)
                        .background(.ultraThinMaterial, in: Circle())
                        .overlay(Circle().strokeBorder(Color.white.opacity(0.18), lineWidth: 0.75))
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
            }
        }
        .animation(.easeInOut(duration: 0.18), value: state)
    }

    private func glyphBadge(_ systemName: String, tint: Color) -> some View {
        Image(systemName: systemName)
            .font(.caption.weight(.bold))
            .foregroundStyle(tint)
            .frame(width: 26, height: 26)
            .background(.ultraThinMaterial, in: Circle())
            .overlay(Circle().strokeBorder(Color.white.opacity(0.18), lineWidth: 0.75))
    }

    /// Shared "watched" path: open the rating sheet when the scale mode needs it,
    /// otherwise submit immediately — identical semantics to the prior button.
    private func markWatched(_ recommendation: AIMovieRecommendation) async {
        let mode = await feedbackViewModel.beginWatchedFlow(
            recommendation: recommendation,
            settings: appState.settingsManager
        )
        if mode == .none {
            await feedbackViewModel.submitWatched(
                recommendation: recommendation,
                mode: .none,
                value: nil,
                service: appState.userFeedbackService
            )
        }
    }

    private func watchedFeedbackSheet(pending: DiscoverFeedbackViewModel.PendingFeedback) -> some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
            Text("Rate Watched Title")
                .font(.title3.weight(.semibold))
            Text(pending.recommendation.title + (pending.recommendation.year.map { " (\($0))" } ?? ""))
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Group {
                switch pending.mode {
                case .none:
                    EmptyView()
                case .likeDislike:
                    Picker("Feedback", selection: Binding(
                        get: { (feedbackViewModel.pendingFeedback?.value ?? 1) >= 0.5 ? "like" : "dislike" },
                        set: { newValue in
                            feedbackViewModel.pendingFeedback?.value = newValue == "like" ? 1 : 0
                        }
                    )) {
                        Text("Like").tag("like")
                        Text("Dislike").tag("dislike")
                    }
                    .pickerStyle(.segmented)
                case .scale1to10:
                    VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
                        Text("Rating: \(Int((feedbackViewModel.pendingFeedback?.value ?? 8).rounded())) / 10")
                            .font(.caption)
                        Slider(
                            value: Binding(
                                get: { feedbackViewModel.pendingFeedback?.value ?? 8 },
                                set: { feedbackViewModel.pendingFeedback?.value = $0.rounded() }
                            ),
                            in: 1...10,
                            step: 1
                        )
                    }
                case .scale1to100:
                    VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
                        Text("Rating: \(Int((feedbackViewModel.pendingFeedback?.value ?? 80).rounded())) / 100")
                            .font(.caption)
                        Slider(
                            value: Binding(
                                get: { feedbackViewModel.pendingFeedback?.value ?? 80 },
                                set: { feedbackViewModel.pendingFeedback?.value = $0.rounded() }
                            ),
                            in: 1...100,
                            step: 1
                        )
                    }
                }
            }

            Spacer()
            HStack {
                Button("Cancel") {
                    feedbackViewModel.dismissPendingFeedback()
                }
                Spacer()
                Button("Save Feedback") {
                    guard let pending = feedbackViewModel.pendingFeedback else { return }
                    Task {
                        await feedbackViewModel.submitWatched(
                            recommendation: pending.recommendation,
                            mode: pending.mode,
                            value: pending.value,
                            service: appState.userFeedbackService
                        )
                    }
                }
                .buttonStyle(.glassProminent)
            }
        }
        .padding(AppTheme.Spacing.lg)
    }

    // MARK: - Poster catalog rails

    @ViewBuilder
    private func catalogSection(title: String, items: [MediaPreview], feedbackReason: String) -> some View {
        let visibleItems = feedbackViewModel.visibleMediaPreviews(from: items)
        if !visibleItems.isEmpty {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
                railHeader(title)

                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: AppTheme.Spacing.lg) {
                        ForEach(visibleItems) { item in
                            discoverCard(item: item, feedbackReason: feedbackReason)
                        }
                    }
                    .padding(.horizontal, AppTheme.Spacing.xxs)
                    .padding(.trailing, AppTheme.Spacing.xl)
                }
                // Fade the trailing edge so the rail reads as scrollable instead of
                // clipping a card dead at the window edge (L1).
                .mask(railFadeMask)
            }
        }
    }

    private func railHeader(_ title: String) -> some View {
        Text(title)
            .font(.title2)
            .fontWeight(.bold)
    }

    private var railFadeMask: LinearGradient {
        LinearGradient(
            stops: [
                .init(color: .black, location: 0),
                .init(color: .black, location: 0.95),
                .init(color: .clear, location: 1.0)
            ],
            startPoint: .leading, endPoint: .trailing
        )
    }

    private func discoverCard(item: MediaPreview, feedbackReason: String) -> some View {
        let recommendation = feedbackViewModel.recommendation(for: item, reason: feedbackReason)

        return MediaCard(item: item)
            .overlay(alignment: .topTrailing) {
                // L12: a single compact control on the poster's top-trailing corner
                // replaces the old dual button pair below the card.
                feedbackControl(for: recommendation)
                    .padding(AppTheme.Spacing.sm)
            }
            .onTapGesture {
                selectedItem = item
            }
    }

    // MARK: - Cold-start skeleton

    private var skeletonView: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.xl) {
            RoundedRectangle(cornerRadius: AppTheme.Radius.lg, style: .continuous)
                .fill(.ultraThinMaterial)
                .frame(height: 380)
                .overlay {
                    ProgressView("Loading Discover…")
                        .controlSize(.large)
                }
            ForEach(0..<3, id: \.self) { _ in
                VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
                    RoundedRectangle(cornerRadius: AppTheme.Radius.sm, style: .continuous)
                        .fill(.quaternary)
                        .frame(width: 160, height: 22)
                    HStack(spacing: AppTheme.Spacing.lg) {
                        ForEach(0..<6, id: \.self) { _ in
                            RoundedRectangle(cornerRadius: AppTheme.Radius.sm, style: .continuous)
                                .fill(.ultraThinMaterial)
                                .frame(width: 158, height: 237)
                        }
                    }
                }
            }
        }
        .redacted(reason: .placeholder)
        .padding(.top, AppTheme.Spacing.lg)
    }

    private var noApiKeyView: some View {
        VStack(spacing: AppTheme.Spacing.lg) {
            Image(systemName: "key.fill")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("TMDB API Key Required")
                .font(.title2)
                .fontWeight(.bold)
            Text("Go to Settings to enter your TMDB API key to browse content.")
                .foregroundStyle(.secondary)
            Button("Open Settings") {
                appState.selectedSidebarItem = .settings
            }
            .buttonStyle(.glassProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.top, 100)
    }

    // MARK: - Appear / personalization / detail plumbing

    private func triggerAppear() {
        guard !appeared else { return }
        withAnimation(.easeOut(duration: 0.4)) {
            appeared = true
        }
    }

    private func evaluatePersonalizationPrompt() async {
        let shouldShow = await appState.shouldShowPersonalizationPrompt()
        if shouldShow {
            showPersonalizationPrompt = true
        }
    }

    private func openRecommendationDetail(_ recommendation: AIMovieRecommendation) async {
        if let local = localPreview(for: recommendation) {
            selectedItem = local
            return
        }
        guard let metadataService = appState.metadataService else { return }
        guard let result = try? await metadataService.search(query: recommendation.title, type: nil, page: 1) else {
            return
        }
        if let matched = result.items.first(where: { item in
            guard let year = recommendation.year else { return true }
            return item.year == year
        }) ?? result.items.first {
            selectedItem = matched
        }
    }

    private func localPreview(for recommendation: AIMovieRecommendation) -> MediaPreview? {
        for item in allDiscoverPreviews {
            if item.title.compare(recommendation.title, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
                && (recommendation.year == nil || item.year == recommendation.year) {
                return item
            }
        }
        return nil
    }

    /// All previews currently surfaced across the page — used for hidden-state
    /// reconciliation and local Detail resolution.
    private var allDiscoverPreviews: [MediaPreview] {
        var items: [MediaPreview] = store.continueWatching.map(\.preview)
        items += store.trendingMovies
        items += store.trendingShows
        items += store.popularMovies
        items += store.topRatedMovies
        items += store.nowPlayingMovies
        items += store.upcomingMovies
        items += store.airingTodayShows
        items += store.onTheAirShows
        for rail in store.genreRails {
            items += rail.items
        }
        return items
    }

    private func syncFeedbackVisibility() {
        var validIDs = Set(appState.discoverAICurationStore.recommendations.map(\.id))
        for item in allDiscoverPreviews {
            validIDs.insert(feedbackViewModel.recommendationID(for: item))
        }
        feedbackViewModel.resetHiddenState(validIDs: validIDs)
    }
}

// MARK: - Staggered rail-appear modifier

private extension View {
    /// Tasteful staggered appear: fade + slight slide-up, delay growing with rail
    /// index (capped). Cheap and purely cosmetic — does not affect layout/scroll.
    func railAppear(appeared: Bool, index: Int) -> some View {
        let delay = min(0.04 + Double(index) * 0.06, 0.6)
        return self
            .opacity(appeared ? 1 : 0)
            .offset(y: appeared ? 0 : 12)
            .animation(.easeOut(duration: 0.4).delay(delay), value: appeared)
    }
}
