import SwiftUI

struct AIAssistantView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = AIAssistantViewModel()

    var body: some View {
        HStack(spacing: 0) {
            composePane
            Divider()
            resultsPane
        }
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
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Adaptive Movie Assistant")
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                    Text("Context-aware recommendations using your library folders, watch recency, and explicit feedback.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary.opacity(0.9))
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    LinearGradient(
                        colors: [Color.accentColor.opacity(0.22), Color.indigo.opacity(0.10), Color.clear],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    in: RoundedRectangle(cornerRadius: 14)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(Color.white.opacity(0.10), lineWidth: 1)
                )

                usageSummaryPanel
                contextSnapshotPanel

                VStack(alignment: .leading, spacing: 10) {
                    Text("Prompt")
                        .font(.headline)
                    ZStack(alignment: .topLeading) {
                        if viewModel.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            Text("Ask for recommendations, tone matching, mood-based picks, or sequel-ready series.")
                                .foregroundStyle(.secondary)
                                .padding(.top, 8)
                                .padding(.leading, 6)
                        }
                        TextEditor(text: $viewModel.prompt)
                            .font(.body)
                            .frame(minHeight: 130)
                            .scrollContentBackground(.hidden)
                            .padding(4)
                    }
                    .padding(8)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Quick Prompts")
                        .font(.headline)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 8)], spacing: 8) {
                        ForEach(viewModel.quickPromptChips, id: \.self) { chip in
                            Button(chip) { viewModel.applyQuickPrompt(chip) }
                                .buttonStyle(.glass)
                                .font(.caption)
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 10) {
                    Toggle("Compare mode (multi-model + consensus merge)", isOn: $viewModel.compareMode)

                    HStack(alignment: .top, spacing: 8) {
                        Text("Providers")
                            .font(.subheadline.weight(.semibold))
                            .frame(width: 68, alignment: .leading)
                        HStack(spacing: 6) {
                            ForEach(AIProviderKind.allCases) { provider in
                                let selected = viewModel.selectedProviders.contains(provider)
                                Button {
                                    viewModel.toggleProvider(provider)
                                } label: {
                                    Text(provider.displayName)
                                        .font(.caption.weight(.semibold))
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 6)
                                        .background(selected ? Color.accentColor.opacity(0.22) : Color.secondary.opacity(0.12))
                                        .clipShape(Capsule())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding(12)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))

                HStack(spacing: 10) {
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
                        .foregroundStyle(status.contains("disabled") ? .orange : .secondary)
                }
            }
            .padding(14)
        }
        .frame(minWidth: 430, idealWidth: 470)
    }

    private var usageSummaryPanel: some View {
        let summary = viewModel.usageSummary
        return HStack(spacing: 10) {
            usageMetricTile(
                label: "Session Usage",
                value: String(format: "$%.4f", summary.sessionEstimatedCostUSD),
                detail: "\(summary.sessionTokens.formatted()) tokens"
            )
            usageMetricTile(
                label: "Lifetime Usage",
                value: String(format: "$%.4f", summary.lifetimeEstimatedCostUSD),
                detail: "\(summary.lifetimeTokens.formatted()) tokens"
            )
        }
    }

    private var contextSnapshotPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Context Snapshot")
                .font(.headline)
            HStack(spacing: 8) {
                Label(
                    viewModel.contextFolderId == nil ? "All folders" : "Folder scoped",
                    systemImage: "folder"
                )
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.secondary.opacity(0.12), in: Capsule())

                Label(
                    appState.selectedSidebarItem == .assistant ? "Assistant active" : "Background",
                    systemImage: "sparkles"
                )
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.accentColor.opacity(0.16), in: Capsule())
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }

    private func usageMetricTile(label: String, value: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title3.weight(.bold))
            Text(detail)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
    }

    @ViewBuilder
    private var resultsPane: some View {
        if let result = viewModel.compareResult {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    summaryBar(result: result)

                    if !result.usedContext.isEmpty {
                        contextPanel(result.usedContext)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Ranked Recommendations")
                            .font(.headline)
                        ForEach(result.mergedRecommendations) { recommendation in
                            recommendationCard(recommendation)
                        }
                    }

                    if viewModel.compareMode {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Per-Provider Breakdown")
                                .font(.headline)
                            ForEach(result.providerResponses, id: \.provider) { response in
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Text(response.provider.displayName)
                                            .fontWeight(.semibold)
                                        if let model = response.model, !model.isEmpty {
                                            Text(model)
                                                .font(.caption2.monospaced())
                                                .padding(.horizontal, 8)
                                                .padding(.vertical, 3)
                                                .background(Color.secondary.opacity(0.14), in: Capsule())
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
                                .padding(10)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
                            }
                        }
                    }
                }
                .padding(14)
            }
        } else {
            VStack(spacing: 14) {
                Image(systemName: "brain.head.profile")
                    .font(.system(size: 38))
                    .foregroundStyle(.secondary)
                Text("Ask for recommendations to unlock ranked picks, provider rationale, and context traces.")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 340)

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 10)], spacing: 10) {
                    ForEach(viewModel.quickPromptChips.prefix(4), id: \.self) { chip in
                        Button {
                            viewModel.applyQuickPrompt(chip)
                        } label: {
                            Text(chip)
                                .font(.caption)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 8)
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
        HStack(spacing: 10) {
            Label("\(result.mergedRecommendations.count) picks", systemImage: "list.number")
                .font(.caption.weight(.semibold))
            Label(result.usedFallback ? "Fallback" : "AI Live", systemImage: result.usedFallback ? "exclamationmark.triangle" : "bolt.fill")
                .font(.caption.weight(.semibold))
            if viewModel.compareMode {
                Label("\(result.providerResponses.count) providers", systemImage: "square.stack.3d.up")
                    .font(.caption.weight(.semibold))
            }
            Spacer()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
    }

    private func contextPanel(_ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Used Context")
                .font(.headline)
            ForEach(items.prefix(12), id: \.self) { value in
                Text("• \(value)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
    }

    private func recommendationCard(_ recommendation: AIMovieRecommendation) -> some View {
        HStack(alignment: .top, spacing: 10) {
            AsyncImage(url: recommendation.posterURL) { phase in
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
            .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 8) {
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
                            .fill(Color.accentColor.opacity(0.7))
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
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
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
