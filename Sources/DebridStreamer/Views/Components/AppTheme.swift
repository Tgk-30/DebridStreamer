import SwiftUI

enum AppTheme {
    static let background = LinearGradient(
        colors: [
            Color(red: 0.07, green: 0.08, blue: 0.11),
            Color(red: 0.13, green: 0.14, blue: 0.19),
            Color(red: 0.09, green: 0.10, blue: 0.14)
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let glassBorder = Color.white.opacity(0.16)
}

struct GlassSurface: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(AppTheme.glassBorder, lineWidth: 1)
            )
    }
}

extension View {
    func glassSurface() -> some View {
        modifier(GlassSurface())
    }
}
