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
                draftedPrompt: appState.assistantDraftPrompt
            )
            appState.assistantDraftPrompt = ""
            viewModel.contextFolderId = appState.selectedLibraryFolderId
        }
    }

    private var composePane: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Personalized Movie Assistant")
                .font(.title2)
                .fontWeight(.bold)
            Text("Compare providers, use folder context, and inspect why each recommendation ranked highly.")
                .font(.caption)
                .foregroundStyle(.secondary)

            TextEditor(text: $viewModel.prompt)
                .font(.body)
                .frame(minHeight: 120, maxHeight: 170)
                .padding(8)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(viewModel.quickPromptChips, id: \.self) { chip in
                        Button(chip) { viewModel.applyQuickPrompt(chip) }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                    }
                }
            }

            Toggle("Compare Mode (multi-model + consensus merge)", isOn: $viewModel.compareMode)

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
                                .font(.caption)
                                .padding(.horizontal, 9)
                                .padding(.vertical, 5)
                                .background(selected ? Color.accentColor.opacity(0.22) : Color.secondary.opacity(0.12))
                                .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            HStack(spacing: 8) {
                Button {
                    Task { await viewModel.generateRecommendations(manager: appState.aiAssistantManager) }
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
                .buttonStyle(.borderedProminent)
                .disabled(viewModel.isGenerating || viewModel.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Button("Use Current Folder") {
                    viewModel.contextFolderId = appState.selectedLibraryFolderId
                }
                .buttonStyle(.bordered)

                Button("Clear") { viewModel.clear() }
                    .buttonStyle(.bordered)
            }

            if let status = viewModel.statusMessage {
                Text(status)
                    .font(.caption)
                    .foregroundStyle(status.contains("disabled") ? .orange : .secondary)
            }

            Spacer()
        }
        .padding(14)
        .frame(minWidth: 390, idealWidth: 420)
    }

    @ViewBuilder
    private var resultsPane: some View {
        if let result = viewModel.compareResult {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if !result.usedContext.isEmpty {
                        contextPanel(result.usedContext)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Ranked Recommendations")
                            .font(.headline)
                        ForEach(result.mergedRecommendations) { recommendation in
                            recommendationCard(recommendation)
                        }
                    }

                    if viewModel.compareMode {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Per-Provider Breakdown")
                                .font(.headline)
                            ForEach(result.providerResponses, id: \.provider) { response in
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(response.provider.displayName)
                                        .fontWeight(.semibold)
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
            VStack(spacing: 10) {
                Image(systemName: "brain.head.profile")
                    .font(.system(size: 34))
                    .foregroundStyle(.secondary)
                Text("Ask for recommendations to see ranked results and context usage.")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 280)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func contextPanel(_ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Used Context")
                .font(.headline)
            ForEach(items.prefix(10), id: \.self) { value in
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
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(recommendation.title + (recommendation.year.map { " (\($0))" } ?? ""))
                    .fontWeight(.semibold)
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
                        .fill(Color.accentColor.opacity(0.65))
                        .frame(width: width)
                }
            }
            .frame(height: 6)
            Text(recommendation.reason)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
    }
}
