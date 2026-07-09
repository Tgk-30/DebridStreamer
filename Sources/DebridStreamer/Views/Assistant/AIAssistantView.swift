import SwiftUI

struct AIAssistantView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = AIAssistantViewModel()

    private var hasResults: Bool {
        viewModel.compareResult != nil || viewModel.isGenerating
    }

    var body: some View {
        HStack(spacing: 0) {
            // Until there's a result, the composer takes the full width instead of
            // sitting next to a tall empty column (L8).
            composePane
                .frame(maxWidth: hasResults ? 560 : .infinity)
            if hasResults {
                Divider()
                resultsPane
            }
        }
        .animation(.easeInOut(duration: 0.25), value: hasResults)
        .navigationTitle("AI Assistant")
        .task {
            await viewModel.initialize(
                manager: appState.aiAssistantManager,
                settings: appState.settingsManager,
                draftedPrompt: appState.assistantDraftPrompt,
                sessionStart: appState.appLaunchDate
            )
            appState.assistantDraftPrompt = ""
            viewModel.contextFolderId = appState.selectedLibraryFolderId
        }
    }

    private var composePane: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.lg) {
                VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
                    Text("Adaptive Movie Assistant")
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                    Text("Context-aware recommendations using your library folders, watch recency, and explicit feedback.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary.opacity(0.9))
                }
                .padding(AppTheme.Spacing.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
                .glassPanel(tint: AppTheme.accent)

                usageSummaryPanel
                contextSnapshotPanel

                VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
                    Text("Prompt")
                        .font(.headline)
                    ZStack(alignment: .topLeading) {
                        if viewModel.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            Text("Ask for recommendations, tone matching, mood-based picks, or sequel-ready series.")
                                .foregroundStyle(.secondary)
                                .padding(.top, AppTheme.Spacing.sm)
                                .padding(.leading, AppTheme.Spacing.xs + 2)
                        }
                        TextEditor(text: $viewModel.prompt)
                            .font(.body)
                            .frame(minHeight: 130)
                            .scrollContentBackground(.hidden)
                            .padding(AppTheme.Spacing.xs)
                    }
                    .padding(AppTheme.Spacing.sm)
                    .glassPanel(radius: AppTheme.Radius.md, level: .thin)
                }

                VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
                    Text("Quick Prompts")
                        .font(.headline)
                    // Even-width chips in a fixed 2-column grid - fills each cell so
                    // widths are uniform instead of ragged text-sized capsules (L9).
                    LazyVGrid(
                        columns: [
                            GridItem(.flexible(), spacing: AppTheme.Spacing.sm),
                            GridItem(.flexible(), spacing: AppTheme.Spacing.sm)
                        ],
                        spacing: AppTheme.Spacing.sm
                    ) {
                        ForEach(viewModel.quickPromptChips, id: \.self) { chip in
                            Button { viewModel.applyQuickPrompt(chip) } label: {
                                Text(chip)
                                    .font(.caption)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.leading)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .buttonStyle(.glass)
                        }
                    }
                }

                VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
                    Toggle("Compare mode (multi-model + consensus merge)", isOn: $viewModel.compareMode)

                    HStack(alignment: .top, spacing: AppTheme.Spacing.sm) {
                        Text("Providers")
                            .font(.subheadline.weight(.semibold))
                            .frame(width: 68, alignment: .leading)
                        HStack(spacing: AppTheme.Spacing.xs + 2) {
                            ForEach(AIProviderKind.allCases) { provider in
                                let selected = viewModel.selectedProviders.contains(provider)
                                Button {
                                    viewModel.toggleProvider(provider)
                                } label: {
                                    Text(provider.displayName)
                                        .font(.caption.weight(.semibold))
                                        .padding(.horizontal, AppTheme.Spacing.sm + 2)
                                        .padding(.vertical, AppTheme.Spacing.xs + 2)
                                        .background(selected ? AppTheme.accent.opacity(0.22) : Color.clear)
                                        .clipShape(Capsule())
                                        .glassChip()
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding(AppTheme.Spacing.md)
                .glassPanel(radius: AppTheme.Radius.md, level: .ultraThin)

                HStack(spacing: AppTheme.Spacing.sm) {
                    Button {
                        Task {
                            await viewModel.generateRecommendations(
                                manager: appState.aiAssistantManager,
                                settings: appState.settingsManager
                            )
                        }
                    } label: {
                        HStack(spacing: 6) {
                            if viewModel.isGenerating {
                                ProgressView()
                                    .controlSize(.small)
                            } else {
                                Image(systemName: "wand.and.stars")
                            }
                            Text("Generate")
                        }
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(viewModel.isGenerating || viewModel.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    Button("Use Current Folder") {
                        viewModel.contextFolderId = appState.selectedLibraryFolderId
                    }
                    .buttonStyle(.glass)

                    Button("Clear") { viewModel.clear() }
                        .buttonStyle(.glass)
                }

                if let status = viewModel.statusMessage {
                    Text(status)
                        .font(.caption)
                        .foregroundStyle(status.contains("disabled") ? AppTheme.warning : Color.secondary)
                }
            }
            .padding(AppTheme.Spacing.lg)
        }
        .frame(minWidth: 430)
    }

    // One compact inline strip instead of two chunky cards for trivial values (L20).
    private var usageSummaryPanel: some View {
        let summary = viewModel.usageSummary
        return HStack(spacing: AppTheme.Spacing.md) {
            usageInline("Session", cost: summary.sessionEstimatedCostUSD, tokens: summary.sessionTokens)
            Divider().frame(height: 20)
            usageInline("Lifetime", cost: summary.lifetimeEstimatedCostUSD, tokens: summary.lifetimeTokens)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, AppTheme.Spacing.md)
        .padding(.vertical, AppTheme.Spacing.sm)
        .glassPanel(radius: AppTheme.Radius.md, level: .ultraThin)
    }

    private func usageInline(_ label: String, cost: Double, tokens: Int) -> some View {
        HStack(spacing: AppTheme.Spacing.sm) {
            Text(label).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Text(String(format: "$%.4f", cost)).font(.callout.weight(.semibold)).monospacedDigit()
            Text("\(tokens.formatted()) tok").font(.caption2).foregroundStyle(.secondary)
        }
    }

    private var contextSnapshotPanel: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
            Text("Context Snapshot")
                .font(.headline)
            HStack(spacing: AppTheme.Spacing.sm) {
                Label(
                    viewModel.contextFolderId == nil ? "All folders" : "Folder scoped",
                    systemImage: "folder"
                )
                .font(.caption.weight(.semibold))
                .padding(.horizontal, AppTheme.Spacing.sm + 2)
                .padding(.vertical, AppTheme.Spacing.xs + 2)
                .glassChip()

                Label(
                    appState.selectedSidebarItem == .assistant ? "Assistant active" : "Background",
                    systemImage: "sparkles"
                )
                .font(.caption.weight(.semibold))
                .padding(.horizontal, AppTheme.Spacing.sm + 2)
                .padding(.vertical, AppTheme.Spacing.xs + 2)
                .background(AppTheme.accent.opacity(0.16), in: Capsule())
                .glassChip()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(AppTheme.Spacing.md)
        .glassPanel(radius: AppTheme.Radius.md, level: .ultraThin)
    }

    private func usageMetricTile(label: String, value: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title3.weight(.bold))
            Text(detail)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(AppTheme.Spacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(radius: AppTheme.Radius.sm)
    }

    @ViewBuilder
    private var resultsPane: some View {
        if let result = viewModel.compareResult {
            ScrollView {
                VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
                    summaryBar(result: result)

                    if !result.usedContext.isEmpty {
                        contextPanel(result.usedContext)
                    }

                    VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
                        Text("Ranked Recommendations")
                            .font(.headline)
                        ForEach(result.mergedRecommendations) { recommendation in
                            recommendationCard(recommendation)
                        }
                    }

                    if viewModel.compareMode {
                        VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
                            Text("Per-Provider Breakdown")
                                .font(.headline)
                            ForEach(result.providerResponses, id: \.provider) { response in
                                VStack(alignment: .leading, spacing: AppTheme.Spacing.xs + 2) {
                                    HStack {
                                        Text(response.provider.displayName)
                                            .fontWeight(.semibold)
                                        if let model = response.model, !model.isEmpty {
                                            Text(model)
                                                .font(.caption2.monospaced())
                                                .padding(.horizontal, AppTheme.Spacing.sm)
                                                .padding(.vertical, AppTheme.Spacing.xxs + 1)
                                                .glassChip()
                                        }
                                        Spacer()
                                        if let usage = response.usage {
                                            Text(providerUsageCaption(usage))
                                                .font(.caption2.monospaced())
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    if response.recommendations.isEmpty {
                                        Text("No recommendations returned.")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    } else {
                                        ForEach(response.recommendations.prefix(5)) { recommendation in
                                            Text("• \(recommendation.title)")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }
                                .padding(AppTheme.Spacing.sm)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .glassCard(radius: AppTheme.Radius.sm)
                            }
                        }
                    }
                }
                .padding(AppTheme.Spacing.lg)
            }
        } else {
            VStack(spacing: AppTheme.Spacing.md) {
                Image(systemName: "brain.head.profile")
                    .font(.system(size: 38))
                    .foregroundStyle(.secondary)
                Text("Ask for recommendations to unlock ranked picks, provider rationale, and context traces.")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 340)

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: AppTheme.Spacing.sm)], spacing: AppTheme.Spacing.sm) {
                    ForEach(viewModel.quickPromptChips.prefix(4), id: \.self) { chip in
                        Button {
                            viewModel.applyQuickPrompt(chip)
                        } label: {
                            Text(chip)
                                .font(.caption)
                                .padding(.horizontal, AppTheme.Spacing.sm + 2)
                                .padding(.vertical, AppTheme.Spacing.sm)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(.glass)
                    }
                }
                .frame(maxWidth: 500)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func summaryBar(result: AICompareResult) -> some View {
        HStack(spacing: AppTheme.Spacing.sm) {
            Label("\(result.mergedRecommendations.count) picks", systemImage: "list.number")
                .font(.caption.weight(.semibold))
            Label(result.usedFallback ? "Fallback" : "AI Live", systemImage: result.usedFallback ? "exclamationmark.triangle" : "bolt.fill")
                .font(.caption.weight(.semibold))
                .foregroundStyle(result.usedFallback ? AppTheme.warning : AppTheme.success)
            if viewModel.compareMode {
                Label("\(result.providerResponses.count) providers", systemImage: "square.stack.3d.up")
                    .font(.caption.weight(.semibold))
            }
            Spacer()
        }
        .padding(.horizontal, AppTheme.Spacing.sm)
        .padding(.vertical, AppTheme.Spacing.sm)
        .glassPanel(radius: AppTheme.Radius.sm, level: .ultraThin)
    }

    private func contextPanel(_ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.xs + 2) {
            Text("Used Context")
                .font(.headline)
            ForEach(items.prefix(12), id: \.self) { value in
                Text("• \(value)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(AppTheme.Spacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassPanel(radius: AppTheme.Radius.sm, level: .thin)
    }

    private func recommendationCard(_ recommendation: AIMovieRecommendation) -> some View {
        HStack(alignment: .top, spacing: AppTheme.Spacing.sm) {
            CachedAsyncImage(url: recommendation.posterURL) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(2/3, contentMode: .fill)
                default:
                    ZStack {
                        Rectangle().fill(.quaternary)
                        Image(systemName: "film")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .frame(width: 88, height: 124)
            .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.sm, style: .continuous))

            VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
                HStack {
                    Text(recommendation.title + (recommendation.year.map { " (\($0))" } ?? ""))
                        .fontWeight(.semibold)
                        .lineLimit(2)
                    Spacer()
                    Text(String(format: "%.2f", recommendation.score))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                GeometryReader { geo in
                    let width = max(0, min(1, recommendation.score)) * geo.size.width
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(Color.secondary.opacity(0.16))
                        Capsule()
                            .fill(AppTheme.accent)
                            .frame(width: width)
                    }
                }
                .frame(height: 6)

                Text(recommendation.reason)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }
        }
        .padding(AppTheme.Spacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(radius: AppTheme.Radius.sm)
    }

    private func providerUsageCaption(_ usage: AIUsageMetrics) -> String {
        let tokens = usage.safeTotalTokens
        let tokenLabel = "\(tokens.formatted()) tok"
        if let cost = usage.estimatedCostUSD {
            return "\(tokenLabel) • $\(String(format: "%.4f", cost))"
        }
        return tokenLabel
    }
}
