import SwiftUI
import UniformTypeIdentifiers

struct LibraryView: View {
    var body: some View {
        LibraryCollectionView(listType: .favorites, title: "Library")
    }
}

struct WatchlistView: View {
    var body: some View {
        LibraryCollectionView(listType: .watchlist, title: "Watchlist")
    }
}

struct HistoryView: View {
    @Environment(AppState.self) private var appState

    @State private var items: [HistoryRow] = []
    @State private var isLoading = false
    @State private var statusMessage: String?
    @State private var selectedPreview: MediaPreview?

    var body: some View {
        Group {
            if isLoading {
                ProgressView("Loading history...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if items.isEmpty {
                emptyState(
                    icon: "clock",
                    title: "No watch history yet",
                    subtitle: "Start playback and your history will appear here."
                )
            } else {
                List(items) { item in
                    Button {
                        selectedPreview = item.media.toPreview()
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(item.media.title)
                                    .fontWeight(.semibold)
                                Text(item.history.progressString)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(item.history.lastWatched, style: .relative)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                }
                .listStyle(.inset)
            }
        }
        .navigationTitle("History")
        .task { await loadHistory() }
        .refreshable { await loadHistory() }
        .sheet(item: $selectedPreview) { preview in
            DetailView(mediaPreview: preview)
                .frame(minWidth: 700, minHeight: 500)
        }
        .overlay(alignment: .bottom) {
            if let statusMessage {
                Text(statusMessage)
                    .font(.caption)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.thinMaterial, in: Capsule())
                    .padding(.bottom, 8)
            }
        }
    }

    private func loadHistory() async {
        guard let db = appState.databaseManager else { return }
        isLoading = true
        defer { isLoading = false }

        do {
            let history = try await db.fetchAllWatchHistory(limit: 200)
            var rows: [HistoryRow] = []
            for item in history {
                guard let media = try await db.fetchMedia(id: item.mediaId) else { continue }
                rows.append(HistoryRow(id: item.id, history: item, media: media))
            }
            items = rows
            statusMessage = nil
        } catch {
            statusMessage = "Failed to load history: \(error.localizedDescription)"
        }
    }
}

private struct LibraryCollectionView: View {
    @Environment(AppState.self) private var appState

    let listType: UserLibraryEntry.ListType
    let title: String

    private let imdbSyncService = IMDbCSVSyncService()
    private let traktSyncService = TraktSyncService()

    @State private var items: [LibraryRow] = []
    @State private var isLoading = false
    @State private var statusMessage: String?
    @State private var selectedPreview: MediaPreview?
    @State private var isImportingIMDb = false
    @State private var isExportingIMDb = false
    @State private var exportDocument: CSVTextDocument?
    @State private var isSyncingTrakt = false

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            Divider()

            Group {
                if isLoading {
                    ProgressView("Loading \(title.lowercased())...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if items.isEmpty {
                    emptyState(
                        icon: listType == .watchlist ? "bookmark" : "books.vertical",
                        title: "No items in \(title.lowercased())",
                        subtitle: "Add titles from a detail page."
                    )
                } else {
                    List(items) { item in
                        HStack {
                            Button {
                                selectedPreview = item.media.toPreview()
                            } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(item.media.title)
                                        .fontWeight(.semibold)
                                    Text(item.media.yearString)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .buttonStyle(.plain)

                            Spacer()

                            Button("Remove") {
                                Task { await remove(item) }
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                    .listStyle(.inset)
                }
            }
        }
        .navigationTitle(title)
        .task { await loadItems() }
        .refreshable { await loadItems() }
        .fileImporter(
            isPresented: $isImportingIMDb,
            allowedContentTypes: [UTType.commaSeparatedText, UTType.plainText],
            allowsMultipleSelection: false
        ) { result in
            Task { await handleIMDbImport(result) }
        }
        .fileExporter(
            isPresented: $isExportingIMDb,
            document: exportDocument,
            contentType: .commaSeparatedText,
            defaultFilename: "debridstreamer-\(listType.rawValue)"
        ) { _ in }
        .sheet(item: $selectedPreview) { preview in
            DetailView(mediaPreview: preview)
                .frame(minWidth: 700, minHeight: 500)
        }
        .overlay(alignment: .bottom) {
            if let statusMessage {
                Text(statusMessage)
                    .font(.caption)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.thinMaterial, in: Capsule())
                    .padding(.bottom, 8)
            }
        }
    }

    private var toolbar: some View {
        HStack(spacing: 10) {
            Button("Import IMDb CSV") {
                isImportingIMDb = true
            }
            .buttonStyle(.bordered)

            Button("Export CSV") {
                prepareExport()
            }
            .buttonStyle(.bordered)

            if listType == .watchlist {
                Button("Pull Trakt") {
                    Task { await pullFromTrakt() }
                }
                .buttonStyle(.bordered)
                .disabled(isSyncingTrakt)

                Button("Push Trakt") {
                    Task { await pushToTrakt() }
                }
                .buttonStyle(.bordered)
                .disabled(isSyncingTrakt)
            }

            Spacer()
            Text("\(items.count) items")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(12)
    }

    private func loadItems() async {
        guard let db = appState.databaseManager else { return }
        isLoading = true
        defer { isLoading = false }

        do {
            let entries = try await db.fetchLibrary(listType: listType)
            var rows: [LibraryRow] = []
            for entry in entries {
                guard let media = try await db.fetchMedia(id: entry.mediaId) else { continue }
                rows.append(LibraryRow(id: entry.id, entry: entry, media: media))
            }
            items = rows
            statusMessage = nil
        } catch {
            statusMessage = "Failed to load \(title.lowercased()): \(error.localizedDescription)"
        }
    }

    private func remove(_ row: LibraryRow) async {
        guard let db = appState.databaseManager else { return }
        do {
            try await db.removeFromLibrary(id: row.entry.id)
            await loadItems()
            statusMessage = "Removed \(row.media.title)."
        } catch {
            statusMessage = "Remove failed: \(error.localizedDescription)"
        }
    }

    private func handleIMDbImport(_ result: Result<[URL], Error>) async {
        guard let db = appState.databaseManager else { return }
        do {
            let urls = try result.get()
            guard let url = urls.first else { return }
            let data = try Data(contentsOf: url)
            guard let text = String(data: data, encoding: .utf8) else {
                statusMessage = "Could not read CSV file."
                return
            }

            let importResult = try await imdbSyncService.importCSV(text, listType: listType, database: db)
            await loadItems()
            statusMessage = "IMDb import complete. Added \(importResult.added), skipped \(importResult.skippedDuplicates)."
        } catch {
            statusMessage = "IMDb import failed: \(error.localizedDescription)"
        }
    }

    private func prepareExport() {
        let csv = imdbSyncService.exportCSV(mediaItems: items.map(\.media))
        exportDocument = CSVTextDocument(text: csv)
        isExportingIMDb = true
    }

    private func pullFromTrakt() async {
        guard listType == .watchlist else { return }
        guard let db = appState.databaseManager, let settings = appState.settingsManager else { return }

        isSyncingTrakt = true
        defer { isSyncingTrakt = false }

        do {
            guard let clientID = try await settings.getValue(forKey: SettingsKeys.traktClientId),
                  let accessToken = try await settings.getValue(forKey: SettingsKeys.traktAccessToken),
                  !clientID.isEmpty, !accessToken.isEmpty else {
                statusMessage = "Set Trakt client ID and access token in Settings → AI & Sync."
                return
            }

            let watchlist = try await traktSyncService.fetchWatchlist(clientID: clientID, accessToken: accessToken)
            var added = 0
            for item in watchlist {
                let mediaID = item.imdbID
                if try await db.fetchMedia(id: mediaID) == nil {
                    try await db.saveMedia(MediaItem(
                        id: mediaID,
                        type: .movie,
                        title: item.title,
                        year: item.year,
                        lastFetched: Date()
                    ))
                }
                if try await db.isInLibrary(mediaId: mediaID, listType: .watchlist) == false {
                    try await db.addToLibrary(UserLibraryEntry(
                        id: "\(mediaID)-watchlist",
                        mediaId: mediaID,
                        listType: .watchlist,
                        addedAt: Date()
                    ))
                    added += 1
                }
            }

            await loadItems()
            statusMessage = "Pulled Trakt watchlist. Added \(added) new items."
        } catch {
            statusMessage = "Trakt pull failed: \(error.localizedDescription)"
        }
    }

    private func pushToTrakt() async {
        guard listType == .watchlist else { return }
        guard let settings = appState.settingsManager else { return }

        isSyncingTrakt = true
        defer { isSyncingTrakt = false }

        do {
            guard let clientID = try await settings.getValue(forKey: SettingsKeys.traktClientId),
                  let accessToken = try await settings.getValue(forKey: SettingsKeys.traktAccessToken),
                  !clientID.isEmpty, !accessToken.isEmpty else {
                statusMessage = "Set Trakt client ID and access token in Settings → AI & Sync."
                return
            }

            let imdbIDs = items.map(\.media.id).filter { $0.hasPrefix("tt") }
            try await traktSyncService.pushWatchlist(clientID: clientID, accessToken: accessToken, imdbIDs: imdbIDs)
            statusMessage = "Pushed \(imdbIDs.count) items to Trakt."
        } catch {
            statusMessage = "Trakt push failed: \(error.localizedDescription)"
        }
    }
}

private func emptyState(icon: String, title: String, subtitle: String) -> some View {
    VStack(spacing: 12) {
        Image(systemName: icon)
            .font(.system(size: 42))
            .foregroundStyle(.secondary)
        Text(title)
            .font(.title3)
            .fontWeight(.semibold)
        Text(subtitle)
            .font(.caption)
            .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
}

private struct LibraryRow: Identifiable {
    let id: String
    let entry: UserLibraryEntry
    let media: MediaItem
}

private struct HistoryRow: Identifiable {
    let id: String
    let history: WatchHistory
    let media: MediaItem
}

private extension MediaItem {
    func toPreview() -> MediaPreview {
        MediaPreview(
            id: id,
            type: type,
            title: title,
            year: year,
            posterPath: posterPath,
            imdbRating: imdbRating,
            tmdbId: tmdbId
        )
    }
}

private struct CSVTextDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.commaSeparatedText, .plainText] }
    var text: String

    init(text: String) {
        self.text = text
    }

    init(configuration: ReadConfiguration) throws {
        if let data = configuration.file.regularFileContents,
           let string = String(data: data, encoding: .utf8) {
            text = string
        } else {
            text = ""
        }
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(text.utf8))
    }
}
