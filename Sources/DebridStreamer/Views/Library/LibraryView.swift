import SwiftUI

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
        VStack(alignment: .leading, spacing: 0) {
            PageHeader(title: "History", subtitle: "Recently watched titles", systemImage: SidebarItem.history.icon)
                .padding(.horizontal, AppTheme.Spacing.lg)
                .padding(.top, AppTheme.Spacing.lg)
                .padding(.bottom, AppTheme.Spacing.sm)
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
                            VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
                                Text(item.media.title)
                                    .fontWeight(.semibold)
                                Text(item.history.progressString)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: AppTheme.Spacing.xxs) {
                                Text(item.history.lastWatched.formatted(date: .abbreviated, time: .shortened))
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                Text(item.history.lastWatched, style: .relative)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary.opacity(0.9))
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
                .listStyle(.inset)
                .scrollContentBackground(.hidden)
            }
            }
        }
        .navigationTitle("History")
        .task { await loadHistory() }
        .refreshable { await loadHistory() }
        .sheet(item: $selectedPreview) { preview in
            DetailView(mediaPreview: preview)
                .frame(minWidth: 880, idealWidth: 900, minHeight: 580)
        }
        .overlay(alignment: .bottom) {
            if let statusMessage {
                Text(statusMessage)
                    .font(.caption)
                    .padding(.horizontal, AppTheme.Spacing.md)
                    .padding(.vertical, AppTheme.Spacing.xs)
                    .glassChip()
                    .padding(.bottom, AppTheme.Spacing.sm)
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

    @State private var viewModel: LibraryViewModel
    @State private var selectedPreview: MediaPreview?
    @State private var showCreateFolder = false
    @State private var createFolderName = ""
    @State private var createParentId: String?
    @State private var showRenameFolder = false
    @State private var renameFolderName = ""
    @State private var renameFolderId: String?
    @State private var pendingDeleteFolder: LibraryFolder?

    init(listType: UserLibraryEntry.ListType, title: String) {
        self.listType = listType
        self.title = title
        _viewModel = State(initialValue: LibraryViewModel(listType: listType))
    }

    var body: some View {
        Group {
            if viewModel.supportsFolders {
                HStack(spacing: 0) {
                    folderSidebar
                    Divider()
                    contentPane
                }
            } else {
                contentPane
            }
        }
        .navigationTitle(title)
        .task { await loadData() }
        .refreshable { await loadData() }
        .onChange(of: viewModel.sortOption) {
            Task { await refreshData() }
        }
        .sheet(item: $selectedPreview) { preview in
            DetailView(mediaPreview: preview)
                .frame(minWidth: 880, idealWidth: 900, minHeight: 580)
        }
        .alert("New Folder", isPresented: $showCreateFolder) {
            TextField("Folder name", text: $createFolderName)
            Button("Cancel", role: .cancel) {}
            Button("Create") {
                Task {
                    guard let db = appState.databaseManager else { return }
                    await viewModel.createFolder(
                        name: createFolderName,
                        parentId: createParentId,
                        database: db
                    )
                    createFolderName = ""
                    createParentId = nil
                    if let selected = viewModel.selectedFolderId {
                        appState.selectedLibraryFolderId = selected
                    }
                }
            }
        } message: {
            Text("Create folders to organize imports and recommendations.")
        }
        .alert("Rename Folder", isPresented: $showRenameFolder) {
            TextField("Folder name", text: $renameFolderName)
            Button("Cancel", role: .cancel) {}
            Button("Rename") {
                Task {
                    guard let db = appState.databaseManager, let renameFolderId else { return }
                    await viewModel.renameFolder(id: renameFolderId, name: renameFolderName, database: db)
                }
            }
        }
        .alert(
            "Delete Folder?",
            isPresented: .init(
                get: { pendingDeleteFolder != nil },
                set: { if !$0 { pendingDeleteFolder = nil } }
            ),
            presenting: pendingDeleteFolder
        ) { folder in
            Button("Cancel", role: .cancel) {
                pendingDeleteFolder = nil
            }
            Button("Delete", role: .destructive) {
                Task {
                    guard let db = appState.databaseManager else { return }
                    await viewModel.deleteFolder(id: folder.id, database: db)
                    pendingDeleteFolder = nil
                    appState.selectedLibraryFolderId = viewModel.selectedFolderId
                }
            }
        } message: { folder in
            Text("Media inside \"\(folder.name)\" will be moved to the list root.")
        }
        .overlay(alignment: .bottom) {
            if let status = viewModel.statusMessage {
                Text(status)
                    .font(.caption)
                    .padding(.horizontal, AppTheme.Spacing.md)
                    .padding(.vertical, AppTheme.Spacing.xs)
                    .glassChip()
                    .padding(.bottom, AppTheme.Spacing.sm)
            }
        }
    }

    private var folderSidebar: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
            HStack {
                Text("Folders")
                    .font(.headline)
                Spacer()
                Button {
                    createParentId = viewModel.rootFolder?.id
                    createFolderName = ""
                    showCreateFolder = true
                } label: {
                    Image(systemName: "folder.badge.plus")
                }
                .buttonStyle(.plain)
                .help("Create Folder")
            }

            libraryHomeRow

            ScrollView {
                if viewModel.folderTree.isEmpty {
                    Text("No folders yet.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    OutlineGroup(viewModel.folderTree, children: \.displayChildren) { node in
                        folderRow(node.folder)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            Divider()

            Button {
                appState.openSettings(tab: .importsSync)
            } label: {
                Label("Imports & Sync", systemImage: "square.and.arrow.down.on.square")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.glass)

            Button {
                appState.openSettings(tab: .personalization)
            } label: {
                Label("Personalization", systemImage: "brain.head.profile")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.glass)
        }
        .padding(AppTheme.Spacing.md)
        .frame(width: 280)
        .glassPanel(level: .regular)
    }

    private var libraryHomeRow: some View {
        Button {
            Task {
                guard let db = appState.databaseManager, let root = viewModel.rootFolder else { return }
                await viewModel.selectFolder(root.id, database: db, metadataProvider: appState.metadataService)
                appState.selectedLibraryFolderId = root.id
            }
        } label: {
            HStack(spacing: AppTheme.Spacing.sm) {
                Image(systemName: "house")
                    .foregroundStyle(AppTheme.accent)
                Text("Library Home")
                    .lineLimit(1)
                Spacer()
            }
            .padding(.horizontal, AppTheme.Spacing.sm)
            .padding(.vertical, AppTheme.Spacing.xs)
            .background(AppTheme.accent.opacity(viewModel.isLibraryRootSelected() ? 0.20 : 0), in: RoundedRectangle(cornerRadius: AppTheme.Radius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func folderRow(_ folder: LibraryFolder) -> some View {
        let isSelected = viewModel.selectedFolderId == folder.id
        return Button {
            Task {
                guard let db = appState.databaseManager else { return }
                await viewModel.selectFolder(folder.id, database: db, metadataProvider: appState.metadataService)
                appState.selectedLibraryFolderId = folder.id
            }
        } label: {
            HStack(spacing: AppTheme.Spacing.sm) {
                Image(systemName: folderIcon(for: folder))
                    .foregroundStyle(folder.isSystem ? AnyShapeStyle(.secondary) : AnyShapeStyle(AppTheme.accent))
                Text(folder.name)
                    .lineLimit(1)
                Spacer()
                let badgeCount = viewModel.badgeCount(for: folder.id)
                if badgeCount > 0 {
                    Text("\(badgeCount)")
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, AppTheme.Spacing.sm)
                        .padding(.vertical, AppTheme.Spacing.xxs)
                        .glassChip()
                }
            }
            .padding(.horizontal, AppTheme.Spacing.sm)
            .padding(.vertical, AppTheme.Spacing.xs)
            .background(AppTheme.accent.opacity(isSelected ? 0.20 : 0), in: RoundedRectangle(cornerRadius: AppTheme.Radius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("New Subfolder") {
                createParentId = folder.id
                createFolderName = ""
                showCreateFolder = true
            }
            if !folder.isSystem {
                Button("Rename") {
                    renameFolderId = folder.id
                    renameFolderName = folder.name
                    showRenameFolder = true
                }
                Button("Delete", role: .destructive) {
                    pendingDeleteFolder = folder
                }
            }
        }
    }

    private func folderIcon(for folder: LibraryFolder) -> String {
        switch folder.folderKind {
        case .systemRoot:
            return "tray.full"
        case .watched:
            return "checkmark.circle"
        case .releaseWait:
            return "calendar.badge.clock"
        case .manual:
            return "folder"
        }
    }

    private var contentPane: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
            header

            if viewModel.isLoading {
                ProgressView("Loading \(title.lowercased())...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if viewModel.items.isEmpty {
                emptyState(
                    icon: "film.stack",
                    title: viewModel.supportsFolders ? "No items in this folder" : "No items in watchlist",
                    subtitle: viewModel.supportsFolders
                        ? "Open Settings → Imports & Sync to import IMDb CSV into a named folder."
                        : "Add titles from Detail pages to build your watchlist."
                )
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 210), spacing: AppTheme.Spacing.lg)], spacing: AppTheme.Spacing.lg) {
                        ForEach(viewModel.items) { item in
                            LibraryMediaCard(
                                item: item,
                                onOpen: { selectedPreview = item.media.toPreview() },
                                onRemove: {
                                    Task {
                                        guard let db = appState.databaseManager else { return }
                                        await viewModel.remove(item, database: db)
                                    }
                                }
                            )
                        }
                    }
                    .padding(.vertical, AppTheme.Spacing.sm)
                }
            }
        }
        .padding(AppTheme.Spacing.lg)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
                    Text(breadcrumbTitle)
                        .font(.headline)
                    Text("\(viewModel.items.count) titles")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Picker("Sort", selection: $viewModel.sortOption) {
                    ForEach(LibraryViewModel.SortOption.allCases) { option in
                        Text(option.displayName).tag(option)
                    }
                }
                .pickerStyle(.menu)
                .frame(width: 190)
            }

            HStack {
                Text(viewModel.supportsFolders
                     ? "Folder-first library: import CSVs into dedicated folders from Settings."
                     : "Watchlist is a single flat list for quick triage.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            }
            .padding(.horizontal, AppTheme.Spacing.md)
            .padding(.vertical, AppTheme.Spacing.md)
            .frame(maxWidth: .infinity)
            .glassPanel(radius: AppTheme.Radius.md, level: .thin)
        }
    }

    private var breadcrumbTitle: String {
        guard !viewModel.breadcrumbs.isEmpty else { return title }
        let rootID = viewModel.rootFolder?.id
        let labels = viewModel.breadcrumbs.map { folder in
            if folder.id == rootID, listType == .favorites {
                return "Library"
            }
            return folder.name
        }
        return labels.joined(separator: " / ")
    }

    private func loadData() async {
        guard let db = appState.databaseManager else { return }
        let preferred = viewModel.supportsFolders ? appState.selectedLibraryFolderId : nil
        await viewModel.load(
            database: db,
            preferredFolderId: preferred,
            metadataProvider: appState.metadataService
        )
        if viewModel.supportsFolders {
            appState.selectedLibraryFolderId = viewModel.selectedFolderId
        }
    }

    private func refreshData() async {
        guard let db = appState.databaseManager else { return }
        await viewModel.refresh(database: db, metadataProvider: appState.metadataService)
    }
}

private struct LibraryMediaCard: View {
    let item: LibraryViewModel.MediaCardItem
    let onOpen: () -> Void
    let onRemove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
            Button(action: onOpen) {
                CachedAsyncImage(url: item.media.posterURL) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(2/3, contentMode: .fill)
                    default:
                        posterPlaceholder
                    }
                }
                .frame(height: 260)
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.md, style: .continuous))
                .overlay(alignment: .topTrailing) {
                    Button(action: onRemove) {
                        Image(systemName: "trash")
                            .font(.caption.bold())
                            .foregroundStyle(.white)
                            .padding(AppTheme.Spacing.sm)
                            .background(.black.opacity(0.55), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .padding(AppTheme.Spacing.sm)
                }
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
                Text(item.media.title)
                    .font(.headline)
                    .lineLimit(2)
                HStack(spacing: AppTheme.Spacing.sm) {
                    if let year = item.media.year {
                        Text(String(year))
                    }
                    if let rating = item.media.imdbRating {
                        Label {
                            Text(String(format: "%.1f", rating))
                        } icon: {
                            Image(systemName: "star.fill")
                                .foregroundStyle(AppTheme.warning)
                        }
                        .labelStyle(.titleAndIcon)
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)

                if let history = item.history, history.hasResumePoint {
                    Text("Continue: \(history.progressString)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if let renewalStatus = item.entry.renewalStatus, !renewalStatus.isEmpty {
                    Text("Status: \(renewalStatus)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if let releaseDateHint = item.entry.releaseDateHint, !releaseDateHint.isEmpty {
                    Text("Expected: \(releaseDateHint)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(AppTheme.Spacing.md)
        .glassSurface()
    }

    private var posterPlaceholder: some View {
        ZStack {
            Rectangle()
                .fill(AppTheme.heroGradient)
            VStack(spacing: AppTheme.Spacing.sm) {
                Image(systemName: "film")
                    .font(.title2)
                    .foregroundStyle(.white.opacity(0.78))
                Text("No artwork")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.72))
            }
        }
    }
}

private func emptyState(icon: String, title: String, subtitle: String) -> some View {
    VStack(spacing: AppTheme.Spacing.md) {
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
