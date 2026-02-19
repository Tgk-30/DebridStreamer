import SwiftUI

struct SidebarView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var state = appState

        List(selection: $state.selectedSidebarItem) {
            Section("Browse") {
                Label(SidebarItem.discover.rawValue, systemImage: SidebarItem.discover.icon)
                    .tag(SidebarItem.discover)
                Label(SidebarItem.search.rawValue, systemImage: SidebarItem.search.icon)
                    .tag(SidebarItem.search)
            }

            Section("Library") {
                Label(SidebarItem.library.rawValue, systemImage: SidebarItem.library.icon)
                    .tag(SidebarItem.library)
                Label(SidebarItem.watchlist.rawValue, systemImage: SidebarItem.watchlist.icon)
                    .tag(SidebarItem.watchlist)
                Label(SidebarItem.history.rawValue, systemImage: SidebarItem.history.icon)
                    .tag(SidebarItem.history)
            }

            Section("Assistant") {
                Label(SidebarItem.assistant.rawValue, systemImage: SidebarItem.assistant.icon)
                    .tag(SidebarItem.assistant)
            }

            Section {
                Label(SidebarItem.settings.rawValue, systemImage: SidebarItem.settings.icon)
                    .tag(SidebarItem.settings)
            }
        }
        .listStyle(.sidebar)
        .navigationSplitViewColumnWidth(min: 180, ideal: 200, max: 250)
    }
}
