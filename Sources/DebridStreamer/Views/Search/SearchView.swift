import SwiftUI

struct SearchView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = SearchViewModel()
    @State private var query = ""
    @State private var selectedType: MediaType? = nil
    @State private var selectedItem: MediaPreview?

    var body: some View {
        VStack(spacing: 0) {
            // Search bar
            HStack(spacing: 12) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Search movies and TV shows...", text: $query)
                    .textFieldStyle(.plain)
                    .font(.title3)
                    .onSubmit {
                        Task {
                            await viewModel.performSearch(
                                query: query,
                                type: selectedType,
                                provider: appState.metadataService
                            ) { message in
                                appState.errorMessage = message
                            }
                        }
                    }

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
                    Button("Cancel") {
                        viewModel.cancelSearch()
                    }
                    .buttonStyle(.bordered)
                }

                // Type filter
                Picker("Type", selection: $selectedType) {
                    Text("All").tag(nil as MediaType?)
                    Text("Movies").tag(MediaType.movie as MediaType?)
                    Text("TV Shows").tag(MediaType.series as MediaType?)
                }
                .pickerStyle(.segmented)
                .frame(width: 250)
            }
            .padding()
            .background(.bar)

            Divider()

            // Results
            if viewModel.isSearching {
                ProgressView("Searching...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if viewModel.results.isEmpty && !query.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 36))
                        .foregroundStyle(.secondary)
                    Text("No results found")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if viewModel.results.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "sparkle.magnifyingglass")
                        .font(.system(size: 36))
                        .foregroundStyle(.secondary)
                    Text("Search for movies and TV shows")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150, maximum: 180), spacing: 16)], spacing: 20) {
                        ForEach(viewModel.results) { item in
                            MediaCard(item: item)
                                .onTapGesture {
                                    selectedItem = item
                                }
                        }
                    }
                    .padding()
                }
            }
        }
        .navigationTitle("Search")
        .onChange(of: query) {
            viewModel.scheduleDebouncedSearch(
                query: query,
                type: selectedType,
                provider: appState.metadataService
            ) { message in
                appState.errorMessage = message
            }
        }
        .sheet(item: $selectedItem) { item in
            DetailView(mediaPreview: item)
                .frame(minWidth: 700, minHeight: 500)
        }
    }
}
