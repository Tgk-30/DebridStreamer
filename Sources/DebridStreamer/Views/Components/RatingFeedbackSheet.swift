import SwiftUI

/// The shared "rate a watched title" sheet.
///
/// Presents the segmented Like / Dislike control, or a 1 to 10 / 1 to 100
/// slider, according to the active `FeedbackScaleMode`, and calls back on
/// Cancel / Save. Used from Discover's mark-watched flow and from the item
/// detail view's explicit Rate button so both entry points behave identically.
struct RatingFeedbackSheet: View {
    /// Display title for the sheet header (already includes any year suffix).
    let title: String
    let mode: FeedbackScaleMode
    /// The current rating value. The caller owns storage; the sheet applies the
    /// per-mode default when the binding is nil so the control always shows a
    /// sensible starting point.
    @Binding var value: Double?
    let onCancel: () -> Void
    let onSave: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
            Text("Rate Watched Title")
                .font(.title3.weight(.semibold))
            Text(title)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Group {
                switch mode {
                case .none:
                    EmptyView()
                case .likeDislike:
                    Picker("Feedback", selection: Binding(
                        get: { (value ?? 1) >= 0.5 ? "like" : "dislike" },
                        set: { newValue in value = newValue == "like" ? 1 : 0 }
                    )) {
                        Text("Like").tag("like")
                        Text("Dislike").tag("dislike")
                    }
                    .pickerStyle(.segmented)
                case .scale1to10:
                    VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
                        Text("Rating: \(Int((value ?? 8).rounded())) / 10")
                            .font(.caption)
                        Slider(
                            value: Binding(
                                get: { value ?? 8 },
                                set: { value = $0.rounded() }
                            ),
                            in: 1...10,
                            step: 1
                        )
                    }
                case .scale1to100:
                    VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
                        Text("Rating: \(Int((value ?? 80).rounded())) / 100")
                            .font(.caption)
                        Slider(
                            value: Binding(
                                get: { value ?? 80 },
                                set: { value = $0.rounded() }
                            ),
                            in: 1...100,
                            step: 1
                        )
                    }
                }
            }

            Spacer()
            HStack {
                Button("Cancel") { onCancel() }
                Spacer()
                Button("Save Feedback") { onSave() }
                    .buttonStyle(.glassProminent)
            }
        }
        .padding(AppTheme.Spacing.lg)
    }
}
