import SwiftUI
import AppKit

/// NSViewRepresentable wrapper around NSTextField for reliable text input on macOS.
/// SwiftUI TextField/SecureField can fail to accept keyboard input in SPM executables,
/// especially inside TabView. This wrapper uses native AppKit controls instead.
struct NativeTextField: NSViewRepresentable {
    var placeholder: String
    @Binding var text: String
    var isSecure: Bool = false
    var font: NSFont = .monospacedSystemFont(ofSize: 13, weight: .regular)
    var onSubmit: (() -> Void)?

    func makeNSView(context: Context) -> NSTextField {
        let field: NSTextField
        if isSecure {
            let secure = NSSecureTextField()
            field = secure
        } else {
            field = NSTextField()
        }

        field.placeholderString = placeholder
        field.font = font
        field.delegate = context.coordinator
        field.bezelStyle = .roundedBezel
        field.isBordered = true
        field.isBezeled = true
        field.isEditable = true
        field.isSelectable = true
        field.focusRingType = .default
        field.lineBreakMode = .byTruncatingTail
        field.cell?.isScrollable = true
        field.cell?.wraps = false
        field.cell?.sendsActionOnEndEditing = true
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
        field.stringValue = text

        // Ensure the field can become first responder for keyboard input
        DispatchQueue.main.async {
            if let window = field.window, window.firstResponder == window {
                window.makeFirstResponder(field)
            }
        }

        return field
    }

    func updateNSView(_ nsView: NSTextField, context: Context) {
        if nsView.stringValue != text {
            nsView.stringValue = text
        }
        // Keep delegate in sync (coordinator can be recreated)
        nsView.delegate = context.coordinator
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    class Coordinator: NSObject, NSTextFieldDelegate {
        var parent: NativeTextField

        init(_ parent: NativeTextField) {
            self.parent = parent
        }

        func controlTextDidChange(_ obj: Notification) {
            guard let textField = obj.object as? NSTextField else { return }
            parent.text = textField.stringValue
        }

        func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
            if commandSelector == #selector(NSResponder.insertNewline(_:)) {
                parent.onSubmit?()
                return true
            }
            return false
        }
    }
}

/// Convenience view that wraps NativeTextField with consistent styling matching our app.
struct NativeSecureField: View {
    var placeholder: String
    @Binding var text: String
    var onSubmit: (() -> Void)?

    var body: some View {
        NativeTextField(
            placeholder: placeholder,
            text: $text,
            isSecure: true,
            onSubmit: onSubmit
        )
        .frame(height: 28)
    }
}

/// Convenience view for regular (non-secure) text fields.
struct NativeInputField: View {
    var placeholder: String
    @Binding var text: String
    var onSubmit: (() -> Void)?

    var body: some View {
        NativeTextField(
            placeholder: placeholder,
            text: $text,
            isSecure: false,
            onSubmit: onSubmit
        )
        .frame(height: 28)
    }
}
