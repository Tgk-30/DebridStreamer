import SwiftUI

struct DiscoverView: View {
    @Environment(AppState.self) private var appState
    @State private var selectedItem: MediaPreview?
    @State private var showPersonalizationPrompt = false
    @State private var feedbackViewModel = DiscoverFeedbackViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.xl) {
                PageHeader(title: "Discover", subtitle: "Trending picks, AI-curated for you", systemImage: SidebarItem.discover.icon)

                if appState.discoverStore.isLoading {
                    ProgressView("Loading...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .padding(.top, 100)
                } else if appState.metadataService == nil {
                    noApiKeyView
                } else {
                    aiCuratedSection
                    catalogSection(
                        title: "Continue Watching",
                        items: appState.discoverStore.continueWatching,
                        feedbackReason: "Continue Watching rail"
                    )
                    catalogSection(
                        title: "Trending Movies",
                        items: appState.discoverStore.trendingMovies,
                        feedbackReason: "Trending Movies rail"
                    )
                    catalogSection(
                        title: "Trending TV Shows",
                        items: appState.discoverStore.trendingShows,
                        feedbackReason: "Trending TV Shows rail"
                    )
                    catalogSection(
                        title: "Popular Movies",
                        items: appState.discoverStore.popularMovies,
                        feedbackReason: "Popular Movies rail"
                    )
                    catalogSection(
                        title: "Top Rated Movies",
                        items: appState.discoverStore.topRatedMovies,
                        feedbackReason: "Top Rated Movies rail"
                    )
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
        }
        .onChange(of: appState.metadataService != nil) {
            guard appState.metadataService != nil else { return }
            Task {
                await appState.preloadDiscoverCatalog(forceRefresh: true)
                await appState.preloadDiscoverAICuration(forceRefresh: true)
                await evaluatePersonalizationPrompt()
            }
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
        .onChange(of: appState.discoverAICurationStore.recommendations) { _, recommendations in
            syncFeedbackVisibility()
        }
        .onChange(of: appState.discoverStore.continueWatching) { _, _ in syncFeedbackVisibility() }
        .onChange(of: appState.discoverStore.trendingMovies) { _, _ in syncFeedbackVisibility() }
        .onChange(of: appState.discoverStore.trendingShows) { _, _ in syncFeedbackVisibility() }
        .onChange(of: appState.discoverStore.popularMovies) { _, _ in syncFeedbackVisibility() }
        .onChange(of: appState.discoverStore.topRatedMovies) { _, _ in syncFeedbackVisibility() }
    }

    @ViewBuilder
    private var aiCuratedSection: some View {
        let store = appState.discoverAICurationStore
        let visibleRecommendations = feedbackViewModel.visibleRecommendations(from: store.recommendations)
        if store.isLoading || !store.recommendations.isEmpty {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
                HStack {
                    Text("AI Curated For You")
                        .font(.title2)
                        .fontWeight(.bold)
                    if store.isLoading {
                        ProgressView()
                            .controlSize(.small)
                    }
                    Spacer()
                    Button("Refresh") {
                        Task { await appState.preloadDiscoverAICuration(forceRefresh: true) }
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
                    }
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

            VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
                Text(recommendation.title + (recommendation.year.map { " (\($0))" } ?? ""))
                    .font(.headline)
                    .lineLimit(2)
                Text(recommendation.reason)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }

            actionRow(for: recommendation)
        }
        .frame(width: 250, alignment: .topLeading)
        .padding(AppTheme.Spacing.md)
        .glassCard()
    }

    @ViewBuilder
    private func actionRow(for recommendation: AIMovieRecommendation) -> some View {
        let state = feedbackViewModel.cardState(for: recommendation)
        HStack(spacing: AppTheme.Spacing.xs) {
            Button {
                Task {
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
            } label: {
                Text("Watched")
            }
            .buttonStyle(.glass)

            Button {
                Task {
                    await feedbackViewModel.markNotWatched(
                        recommendation: recommendation,
                        service: appState.userFeedbackService
                    )
                }
            } label: {
                Text("Not Watched")
            }
            .buttonStyle(.glass)

            Button("Details") {
                Task { await openRecommendationDetail(recommendation) }
            }
            .buttonStyle(.glassProminent)
        }
        .overlay(alignment: .topTrailing) {
            switch state {
            case .saving:
                ProgressView()
                    .controlSize(.small)
                    .padding(.top, -18)
            case .watched:
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(AppTheme.success)
                    .padding(.top, -18)
            case .notWatched:
                Image(systemName: "nosign")
                    .foregroundStyle(AppTheme.warning)
                    .padding(.top, -18)
            case .failed(let message):
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(AppTheme.danger)
                    .padding(.top, -18)
                    .help(message)
            case .idle:
                EmptyView()
            }
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

    @ViewBuilder
    private func catalogSection(title: String, items: [MediaPreview], feedbackReason: String) -> some View {
        let visibleItems = feedbackViewModel.visibleMediaPreviews(from: items)
        if !visibleItems.isEmpty {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
                Text(title)
                    .font(.title2)
                    .fontWeight(.bold)

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
                .mask(
                    LinearGradient(
                        stops: [
                            .init(color: .black, location: 0),
                            .init(color: .black, location: 0.95),
                            .init(color: .clear, location: 1.0)
                        ],
                        startPoint: .leading, endPoint: .trailing
                    )
                )
            }
        }
    }

    private func discoverCard(item: MediaPreview, feedbackReason: String) -> some View {
        let recommendation = feedbackViewModel.recommendation(for: item, reason: feedbackReason)
        let state = feedbackViewModel.cardState(for: recommendation)

        return VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
            MediaCard(item: item)
                .onTapGesture {
                    selectedItem = item
                }

            HStack(spacing: AppTheme.Spacing.xs) {
                Button {
                    Task {
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
                } label: {
                    Text("Watched")
                        .font(.caption2.weight(.semibold))
                }
                .buttonStyle(.glass)

                Button {
                    Task {
                        await feedbackViewModel.markNotWatched(
                            recommendation: recommendation,
                            service: appState.userFeedbackService
                        )
                    }
                } label: {
                    Text("Not Watched")
                        .font(.caption2.weight(.semibold))
                }
                .buttonStyle(.glass)
            }
            .overlay(alignment: .trailing) {
                switch state {
                case .saving:
                    ProgressView()
                        .controlSize(.small)
                case .watched:
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(AppTheme.success)
                case .notWatched:
                    Image(systemName: "nosign")
                        .foregroundStyle(AppTheme.warning)
                case .failed(let message):
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(AppTheme.danger)
                        .help(message)
                case .idle:
                    EmptyView()
                }
            }
        }
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
        let allItems = appState.discoverStore.continueWatching
            + appState.discoverStore.trendingMovies
            + appState.discoverStore.trendingShows
            + appState.discoverStore.popularMovies
            + appState.discoverStore.topRatedMovies

        return allItems.first { item in
            item.title.compare(recommendation.title, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
                && (recommendation.year == nil || item.year == recommendation.year)
        }
    }

    private func syncFeedbackVisibility() {
        var validIDs = Set(appState.discoverAICurationStore.recommendations.map(\.id))
        let allDiscoverItems = appState.discoverStore.continueWatching
            + appState.discoverStore.trendingMovies
            + appState.discoverStore.trendingShows
            + appState.discoverStore.popularMovies
            + appState.discoverStore.topRatedMovies
        for item in allDiscoverItems {
            validIDs.insert(feedbackViewModel.recommendationID(for: item))
        }
        feedbackViewModel.resetHiddenState(validIDs: validIDs)
    }
}
