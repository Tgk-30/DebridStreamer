import SwiftUI

/// AI mood/keyword discovery — the differentiator. The user types a free-text
/// vibe ("cozy fall mysteries", "mind-bending sci-fi from the 2010s"); the AI
/// assistant translates it into TMDB /discover params (genres, keywords, year
/// range, sort) which render as a result grid via the existing `discover()` path.
///
/// Gates gracefully: when no AI provider or TMDB key is configured the strip shows
/// a quiet hint instead of the prompt field.
struct MoodDiscoveryView: View {
    @Environment(AppState.self) private var appState

    @State private var vibe: String = ""
    @State private var plan: AIDiscoverPlan?
    @State private var results: [MediaPreview] = []
    @State private var isCurating = false
    @State private var errorMessage: String?
    @State private var selectedItem: MediaPreview?
    @FocusState private var fieldFocused: Bool

    /// A handful of starter chips so the feature is discoverable without typing.
    private let suggestions = [
        "Cozy fall mysteries",
        "Mind-bending sci-fi from the 2010s",
        "Feel-good road trips",
        "Slow-burn psychological thrillers"
    ]

    private let columns = [
        GridItem(.adaptive(minimum: 158, maximum: 180), spacing: AppTheme.Spacing.lg, alignment: .top)
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
            header

            if isAvailable {
                promptStrip
                if !suggestions.isEmpty && plan == nil && results.isEmpty {
                    suggestionChips
                }
            } else {
                unavailableHint
            }

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(AppTheme.warning)
            }

            if let plan {
                planSummary(plan)
            }

            if !results.isEmpty {
                resultGrid
            } else if isCurating {
                Color.clear
                    .frame(height: 120)
                    .frame(maxWidth: .infinity)
                    .overlay { ProgressView("Curating…").controlSize(.small) }
                    .glassPanel(radius: AppTheme.Radius.md, level: .ultraThin)
            }
        }
        .padding(AppTheme.Spacing.lg)
        .glassElevation(.raised, radius: AppTheme.Radius.lg, tint: AppTheme.accent)
        .sheet(item: $selectedItem) { item in
            DetailView(mediaPreview: item)
                .frame(minWidth: 880, idealWidth: 900, minHeight: 580)
        }
    }

    // MARK: - Availability gate

    /// Requires both a TMDB key (to run discover) and an AI provider (to translate).
    private var isAvailable: Bool {
        appState.metadataService != nil && appState.aiAssistantHasProvider
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: AppTheme.Spacing.sm) {
            Image(systemName: "wand.and.stars")
                .font(.title3)
                .foregroundStyle(AppTheme.accent)
            VStack(alignment: .leading, spacing: 1) {
                Text("Describe a vibe")
                    .font(.title3)
                    .fontWeight(.bold)
                Text("AI turns your mood into a curated lineup")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if plan != nil || !results.isEmpty {
                Button {
                    clear()
                } label: {
                    Label("Clear", systemImage: "xmark.circle")
                }
                .buttonStyle(.glass)
                .controlSize(.small)
            }
        }
    }

    // MARK: - Prompt strip

    private var promptStrip: some View {
        HStack(spacing: AppTheme.Spacing.sm) {
            Image(systemName: "sparkle.magnifyingglass")
                .foregroundStyle(.secondary)
            TextField("e.g. cozy fall mysteries", text: $vibe)
                .textFieldStyle(.plain)
                .focused($fieldFocused)
                .onSubmit { curate() }

            Button {
                curate()
            } label: {
                if isCurating {
                    ProgressView().controlSize(.small)
                } else {
                    Text("Curate")
                }
            }
            .buttonStyle(.glassProminent)
            .disabled(isCurating || vibe.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(.horizontal, AppTheme.Spacing.md)
        .padding(.vertical, AppTheme.Spacing.sm)
        .glassElevation(.rest, radius: AppTheme.Radius.md)
    }

    private var suggestionChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: AppTheme.Spacing.sm) {
                ForEach(suggestions, id: \.self) { suggestion in
                    Button {
                        vibe = suggestion
                        curate()
                    } label: {
                        Text(suggestion)
                            .font(.caption.weight(.medium))
                            .padding(.horizontal, AppTheme.Spacing.md)
                            .padding(.vertical, AppTheme.Spacing.xs + 1)
                    }
                    .buttonStyle(.plain)
                    .glassChip()
                }
            }
        }
    }

    private var unavailableHint: some View {
        HStack(spacing: AppTheme.Spacing.sm) {
            Image(systemName: "key.fill")
                .foregroundStyle(.secondary)
            Text(unavailableReason)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Button("Open settings") {
                appState.openSettings(tab: .aiSync)
            }
            .buttonStyle(.glass)
            .controlSize(.small)
        }
        .padding(.horizontal, AppTheme.Spacing.md)
        .padding(.vertical, AppTheme.Spacing.sm)
        .glassElevation(.rest, radius: AppTheme.Radius.md)
    }

    private var unavailableReason: String {
        if appState.metadataService == nil {
            return "Add a TMDB API key to enable AI mood discovery."
        }
        return "Add an AI provider (OpenAI, Anthropic, or Ollama) to describe a vibe."
    }

    // MARK: - Plan summary + results

    private func planSummary(_ plan: AIDiscoverPlan) -> some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
            Text(plan.summary)
                .font(.subheadline.weight(.medium))
            if !planChips(plan).isEmpty {
                HStack(spacing: AppTheme.Spacing.xs) {
                    ForEach(planChips(plan), id: \.self) { chip in
                        Text(chip)
                            .font(.caption2.weight(.medium))
                            .padding(.horizontal, AppTheme.Spacing.sm)
                            .padding(.vertical, 2)
                            .background(AppTheme.accent.opacity(0.16), in: Capsule())
                            .foregroundStyle(AppTheme.accent)
                    }
                }
            }
        }
    }

    /// Small human-readable chips describing how the vibe was interpreted.
    private func planChips(_ plan: AIDiscoverPlan) -> [String] {
        var chips: [String] = [plan.mediaType == .series ? "TV" : "Movies"]
        chips += plan.keywordNames
        if let lo = plan.yearGTE, let hi = plan.yearLTE {
            chips.append("\(lo)–\(hi)")
        } else if let lo = plan.yearGTE {
            chips.append("\(lo)+")
        }
        if let minRating = plan.minRating {
            chips.append(String(format: "%.0f+ rating", minRating))
        }
        return chips
    }

    private var resultGrid: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: AppTheme.Spacing.lg) {
            ForEach(results) { item in
                Button {
                    selectedItem = item
                } label: {
                    MediaCard(item: item)
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Actions

    private func curate() {
        let trimmed = vibe.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isCurating else { return }
        fieldFocused = false
        isCurating = true
        errorMessage = nil
        Task {
            await runCuration(trimmed)
            isCurating = false
        }
    }

    private func runCuration(_ vibe: String) async {
        guard let assistant = appState.aiAssistantManager,
              let service = appState.metadataService else {
            errorMessage = "AI mood discovery is unavailable. Check Settings."
            return
        }

        do {
            let plan = try await assistant.discoverFilters(from: vibe)
            self.plan = plan
            let response = try await service.discover(type: plan.mediaType, filters: plan.filters())
            results = response.items
            if results.isEmpty {
                errorMessage = "No titles matched that vibe. Try a broader description."
            }
        } catch {
            let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            errorMessage = message
            // Keep any previous plan/results cleared so a failure reads clean.
            plan = nil
            results = []
        }
    }

    private func clear() {
        vibe = ""
        plan = nil
        results = []
        errorMessage = nil
    }
}
