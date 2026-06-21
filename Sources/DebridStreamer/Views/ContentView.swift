import SwiftUI

struct ContentView: View {
    @Environment(AppState.self) private var appState
    @State private var hasInitialized = false
    @State private var needsSetup = false
    @State private var bootFinished = false

    var body: some View {
        ZStack {
            AppTheme.background.ignoresSafeArea()
            AppTheme.auroraGlow

            Group {
                if needsSetup {
                    SetupView()
                        .environment(appState)
                        .frame(minWidth: 600, minHeight: 500)
                        .onChange(of: appState.metadataService != nil) {
                            if appState.metadataService != nil {
                                needsSetup = false
                            }
                        }
                } else {
                    HStack(spacing: 0) {
                        NavRail()
                        detailView
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .overlay(alignment: .topTrailing) {
                                if showsGlobalSearch {
                                    GlobalSearchField()
                                        .padding(.top, AppTheme.Spacing.md)
                                        .padding(.trailing, AppTheme.Spacing.lg)
                                }
                            }
                    }
                    .frame(minWidth: 900, minHeight: 600)
                }
            }

            if !bootFinished {
                BootView { withAnimation(.easeOut(duration: 0.55)) { bootFinished = true } }
                    .transition(.opacity)
                    .zIndex(100)
            }
        }
        .task {
            guard !hasInitialized else { return }
            hasInitialized = true
            do {
                try await appState.initialize()
                // Check if TMDB key is configured
                if appState.metadataService == nil {
                    needsSetup = true
                }
            } catch {
                appState.errorMessage = error.localizedDescription
            }
        }
        .alert("Error", isPresented: .init(
            get: { appState.errorMessage != nil },
            set: { if !$0 { appState.errorMessage = nil } }
        )) {
            Button("OK") { appState.errorMessage = nil }
        } message: {
            Text(appState.errorMessage ?? "")
        }
    }

    /// The global quick-search field is shown on browse/library screens but not on
    /// Search itself (it has its own search bar) or Settings (no search context).
    private var showsGlobalSearch: Bool {
        switch appState.selectedSidebarItem {
        case .search, .settings: return false
        default: return true
        }
    }

    @ViewBuilder
    private var detailView: some View {
        switch appState.selectedSidebarItem {
        case .discover:
            DiscoverView()
        case .search:
            SearchView()
        case .library:
            LibraryView()
        case .watchlist:
            WatchlistView()
        case .history:
            HistoryView()
        case .assistant:
            AIAssistantView()
        case .settings:
            SettingsView()
        }
    }
}
