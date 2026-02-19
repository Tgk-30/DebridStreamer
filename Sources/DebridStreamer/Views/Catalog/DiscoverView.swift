import SwiftUI

struct DiscoverView: View {
    @Environment(AppState.self) private var appState
    @State private var selectedItem: MediaPreview?
    @State private var showPersonalizationPrompt = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if appState.discoverStore.isLoading {
                    ProgressView("Loading...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .padding(.top, 100)
                } else if appState.metadataService == nil {
                    noApiKeyView
                } else {
                    aiCuratedSection
                    catalogSection(title: "Continue Watching", items: appState.discoverStore.continueWatching)
                    catalogSection(title: "Trending Movies", items: appState.discoverStore.trendingMovies)
                    catalogSection(title: "Trending TV Shows", items: appState.discoverStore.trendingShows)
                    catalogSection(title: "Popular Movies", items: appState.discoverStore.popularMovies)
                    catalogSection(title: "Top Rated Movies", items: appState.discoverStore.topRatedMovies)
                }
            }
            .padding()
        }
        .navigationTitle("Discover")
        .task {
            await appState.preloadDiscoverCatalog()
            await appState.preloadDiscoverAICuration()
            await evaluatePersonalizationPrompt()
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
                .frame(minWidth: 700, minHeight: 500)
        }
    }

    @ViewBuilder
    private var aiCuratedSection: some View {
        let store = appState.discoverAICurationStore
        if store.isLoading || !store.recommendations.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
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
                    .buttonStyle(.bordered)
                }

                if store.recommendations.isEmpty && store.isLoading {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.ultraThinMaterial)
                        .frame(height: 120)
                        .overlay {
                            Text("Generating personalized recommendations...")
                                .foregroundStyle(.secondary)
                        }
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            ForEach(store.recommendations) { rec in
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(rec.title + (rec.year.map { " (\($0))" } ?? ""))
                                        .font(.headline)
                                        .lineLimit(1)
                                    Text(rec.reason)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(3)
                                }
                                .frame(width: 260, height: 110, alignment: .topLeading)
                                .padding(12)
                                .glassSurface()
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func catalogSection(title: String, items: [MediaPreview]) -> some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text(title)
                    .font(.title2)
                    .fontWeight(.bold)

                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 16) {
                        ForEach(items) { item in
                            MediaCard(item: item)
                                .onTapGesture {
                                    selectedItem = item
                                }
                        }
                    }
                    .padding(.horizontal, 2)
                }
            }
        }
    }

    private var noApiKeyView: some View {
        VStack(spacing: 16) {
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
            .buttonStyle(.borderedProminent)
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
}
