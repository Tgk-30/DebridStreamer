import Foundation

enum LibraryFoldering {
    static let allFoldersLabel = "All Folders"
    static let unsortedLabel = "Unsorted"

    static func entryID(mediaId: String, listType: UserLibraryEntry.ListType) -> String {
        "\(mediaId)-\(listType.rawValue)"
    }

    static func normalizeStoredFolder(_ folder: String?) -> String? {
        guard let folder else { return nil }
        let canonical = folder.replacingOccurrences(of: "\\", with: "/")
        let segments = canonical
            .split(separator: "/")
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !segments.isEmpty else { return nil }
        return segments.joined(separator: "/")
    }

    static func displayName(for storedFolder: String?) -> String {
        normalizeStoredFolder(storedFolder) ?? unsortedLabel
    }

    static func matches(storedFolder: String?, selectionPath: String) -> Bool {
        guard let normalized = normalizeStoredFolder(storedFolder) else { return false }
        return normalized == selectionPath || normalized.hasPrefix(selectionPath + "/")
    }

    static func folderSegments(from storedFolder: String?) -> [String] {
        guard let normalized = normalizeStoredFolder(storedFolder) else { return [] }
        return normalized.split(separator: "/").map(String.init)
    }
}
