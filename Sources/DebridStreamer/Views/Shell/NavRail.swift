import SwiftUI

/// The V2 navigation rail: a slim glass icon+label rail replacing the heavy
/// system `List` sidebar. Primary destinations sit at the top, Settings is
/// pinned at the bottom, and selection is a soft accent-ring glass capsule
/// (never the loud system highlight). Search lives in the top-right global
/// field, not here - the "icons in different places" hybrid layout.
struct NavRail: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        VStack(spacing: AppTheme.Spacing.xs) {
            ForEach(SidebarItem.railPrimary) { item in
                NavRailButton(item: item, isSelected: appState.selectedSidebarItem == item) {
                    appState.selectedSidebarItem = item
                }
            }

            Spacer(minLength: AppTheme.Spacing.lg)

            // Thin divider then the pinned Settings gear.
            Rectangle()
                .fill(AppTheme.glassBorder)
                .frame(width: 28, height: 1)
                .padding(.bottom, AppTheme.Spacing.xs)

            NavRailButton(item: .settings, isSelected: appState.selectedSidebarItem == .settings) {
                appState.selectedSidebarItem = .settings
            }
        }
        // Clear the traffic-light zone at the top of the hidden-title-bar window.
        .padding(.top, 38)
        .padding(.bottom, AppTheme.Spacing.lg)
        .padding(.horizontal, AppTheme.Spacing.sm)
        .frame(width: 78)
        .frame(maxHeight: .infinity)
    }
}

/// A single rail entry: SF Symbol over a tiny label, with accent-ring selection.
private struct NavRailButton: View {
    let item: SidebarItem
    let isSelected: Bool
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: item.icon)
                    .font(.system(size: 18, weight: .medium))
                    .frame(height: 22)
                Text(item.shortLabel)
                    .font(.system(size: 9, weight: .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(foreground)
            .frame(maxWidth: .infinity)
            .padding(.vertical, AppTheme.Spacing.sm)
            .background {
                RoundedRectangle(cornerRadius: AppTheme.Radius.md, style: .continuous)
                    .fill(AppTheme.accent.opacity(isSelected ? 0.16 : (hovering ? 0.07 : 0)))
            }
            .overlay {
                RoundedRectangle(cornerRadius: AppTheme.Radius.md, style: .continuous)
                    .strokeBorder(AppTheme.accent.opacity(isSelected ? 0.55 : 0), lineWidth: 1)
            }
            .shadow(color: AppTheme.accent.opacity(isSelected ? 0.22 : 0), radius: 8, y: 2)
        }
        .buttonStyle(.plain)
        .help(item.rawValue)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.16), value: isSelected)
        .animation(.easeOut(duration: 0.16), value: hovering)
    }

    private var foreground: Color {
        if isSelected { return AppTheme.accent }
        return hovering ? .primary : .secondary
    }
}

/// Floating glass quick-search field anchored top-right. Routes the query to the
/// Search screen via `AppState.pendingSearchQuery`.
struct GlobalSearchField: View {
    @Environment(AppState.self) private var appState
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: AppTheme.Spacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.secondary)

            TextField("Search movies & shows", text: $text)
                .textFieldStyle(.plain)
                .font(.callout)
                .focused($focused)
                .frame(width: 184)
                .onSubmit(submit)

            if !text.isEmpty {
                Button {
                    text = ""
                    focused = true
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help("Clear")
            }
        }
        .padding(.horizontal, AppTheme.Spacing.md)
        .padding(.vertical, AppTheme.Spacing.sm)
        .glassElevation(.raised, radius: AppTheme.Radius.pill)
    }

    private func submit() {
        let q = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return }
        appState.pendingSearchQuery = q
        appState.selectedSidebarItem = .search
    }
}
