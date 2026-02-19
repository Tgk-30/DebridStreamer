import SwiftUI

struct SearchView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = SearchViewModel()
    @State private var query = ""
    @State private var selectedType: MediaType? = nil
    @State private var selectedScope: SearchViewModel.Scope = .all
    @State private var selectedItem: MediaPreview?
    @State private var moodText = ""
    @State private var folderContextLabel: String?

    var body: some View {
        HStack(spacing: 0) {
            mainPane
            Divider()
            aiAssistPane
                .frame(width: 300)
        }
        .navigationTitle("Search")
        .onChange(of: query) { scheduleSearch() }
        .onChange(of: selectedType) { scheduleSearch() }
        .onChange(of: selectedScope) { scheduleSearch() }
        .onChange(of: appState.selectedLibraryFolderId) {
            Task { await refreshFolderContextLabel() }
        }
        .task { await refreshFolderContextLabel() }
        .sheet(item: $selectedItem) { item in
            DetailView(mediaPreview: item)
                .frame(minWidth: 780, minHeight: 540)
        }
    }

    private var mainPane: some View {
        VStack(spacing: 0) {
            header
            Divider()

            Group {
                if viewModel.isSearching {
                    VStack(spacing: 16) {
                        ProgressView()
                            .controlSize(.large)
                        Text("Searching \(selectedScope.displayName.lowercased())...")
                            .font(.headline)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if viewModel.results.isEmpty && !query.isEmpty {
                    emptyState(
                        icon: "sparkle.magnifyingglass",
                        title: "No results found",
                        subtitle: "Try a broader query, a different scope, or use AI refine."
                    )
                } else if viewModel.results.isEmpty {
                    emptyState(
                        icon: "magnifyingglass.circle",
                        title: "Search for movies and series",
                        subtitle: "Use folder scope and AI actions for faster discovery."
                    )
                } else {
                    ScrollView {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 16)], spacing: 18) {
                            ForEach(viewModel.results) { item in
                                SearchResultCard(item: item) {
                                    selectedItem = item
                                }
                            }
                        }
                        .padding()
                    }
                }
            }
        }
    }

    private var header: some View {
        VStack(spacing: 12) {
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 16)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color(red: 0.18, green: 0.22, blue: 0.36),
                                Color(red: 0.10, green: 0.14, blue: 0.23),
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                VStack(alignment: .leading, spacing: 10) {
                    Text("Cinematic Search")
                        .font(.title2)
                        .fontWeight(.bold)
                    Text("Scope-aware results with AI refinement and one-tap context prompts.")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass")
                            .foregroundStyle(.secondary)
                        TextField("Search movies and TV shows...", text: $query)
                            .textFieldStyle(.plain)
                            .font(.title3)
                            .onSubmit { runSearch() }

                        if !query.isEmpty {
                            Button {
                                query = ""
                                viewModel.clearResults()
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundStyle(.secondary)
                            }
                            .buttonStyle(.plain)
                        }

                        if viewModel.isSearching {
                            Button("Cancel") { viewModel.cancelSearch() }
                                .buttonStyle(.bordered)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))

                    HStack(spacing: 10) {
                        Picker("Scope", selection: $selectedScope) {
                            ForEach(SearchViewModel.Scope.allCases) { scope in
                                Text(scope.displayName).tag(scope)
                            }
                        }
                        .pickerStyle(.segmented)

                        Picker("Type", selection: $selectedType) {
                            Text("All").tag(nil as MediaType?)
                            Text("Movies").tag(MediaType.movie as MediaType?)
                            Text("TV Shows").tag(MediaType.series as MediaType?)
                        }
                        .pickerStyle(.segmented)
                    }
                }
                .padding(14)
            }
            .frame(height: 220)
            .glassSurface()
            .padding(.horizontal, 12)
            .padding(.top, 10)

            if selectedScope == .folder && appState.selectedLibraryFolderId == nil {
                Text("Select a folder in Library or Watchlist first for folder-scoped search.")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
        .padding(.bottom, 12)
    }

    private var aiAssistPane: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("AI Assist")
                .font(.headline)
            Text("Use search context to generate recommendation prompts.")
                .font(.caption)
                .foregroundStyle(.secondary)

            Button {
                sendToAssistant(viewModel.buildRefinePrompt(query: query, scope: selectedScope))
            } label: {
                Label("Refine Query", systemImage: "wand.and.stars")
            }
            .buttonStyle(.borderedProminent)
            .disabled(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            HStack(spacing: 8) {
                TextField("Mood (e.g. tense noir)", text: $moodText)
                Button("Find by Mood") {
                    sendToAssistant(viewModel.buildMoodPrompt(mood: moodText, scope: selectedScope))
                }
                .buttonStyle(.bordered)
            }

            Button("Suggest Similar To Selected") {
                sendToAssistant(viewModel.buildSimilarPrompt(selected: selectedItem, scope: selectedScope))
            }
            .buttonStyle(.bordered)

            Button("From This Folder") {
                sendToAssistant(viewModel.buildFolderPrompt(folderName: folderContextLabel))
            }
            .buttonStyle(.bordered)

            Button("Why This Matches Profile") {
                sendToAssistant(viewModel.buildProfileMatchPrompt(query: query))
            }
            .buttonStyle(.bordered)
            .disabled(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            Divider()

            if let selectedItem {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Selected")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(selectedItem.title)
                        .font(.headline)
                    if let year = selectedItem.year {
                        Text(String(year))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
            }

            Spacer()
        }
        .padding(12)
        .background(.ultraThinMaterial.opacity(0.4))
    }

    private func runSearch() {
        viewModel.startSearch(
            query: query,
            type: selectedType,
            provider: appState.metadataService,
            scope: selectedScope,
            folderId: appState.selectedLibraryFolderId,
            database: appState.databaseManager
        ) { message in
            appState.errorMessage = message
        }
    }

    private func scheduleSearch() {
        viewModel.scheduleDebouncedSearch(
            query: query,
            type: selectedType,
            provider: appState.metadataService,
            scope: selectedScope,
            folderId: appState.selectedLibraryFolderId,
            database: appState.databaseManager
        ) { message in
            appState.errorMessage = message
        }
    }

    private func sendToAssistant(_ prompt: String) {
        appState.assistantDraftPrompt = prompt
        appState.selectedSidebarItem = .assistant
    }

    private func refreshFolderContextLabel() async {
        guard let folderID = appState.selectedLibraryFolderId,
              let db = appState.databaseManager,
              let folder = try? await db.fetchLibraryFolder(id: folderID)
        else {
            folderContextLabel = nil
            return
        }
        folderContextLabel = folder.name
    }
}

private struct SearchResultCard: View {
    let item: MediaPreview
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 8) {
                AsyncImage(url: item.posterURL) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(2/3, contentMode: .fill)
                    default:
                        Rectangle().fill(.quaternary)
                    }
                }
                .frame(height: 250)
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 12))

                Text(item.title)
                    .font(.headline)
                    .lineLimit(2)

                HStack(spacing: 8) {
                    if let year = item.year {
                        Text(String(year))
                    }
                    if !item.ratingString.isEmpty {
                        Label(item.ratingString, systemImage: "star.fill")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            .padding(10)
            .glassSurface()
        }
        .buttonStyle(.plain)
    }
}

private func emptyState(icon: String, title: String, subtitle: String) -> some View {
    VStack(spacing: 10) {
        Image(systemName: icon)
            .font(.system(size: 38))
            .foregroundStyle(.secondary)
        Text(title)
            .font(.title3)
            .fontWeight(.semibold)
        Text(subtitle)
            .font(.caption)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: 360)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
}
