import Testing
import Foundation
@testable import DebridStreamer

@Suite("DebridServiceProtocol Tests")
struct DebridServiceProtocolTests {
    @Test("DebridAccountInfo expiryString returns medium date")
    func accountInfoExpiryString() {
        let date = Date(timeIntervalSince1970: 1_700_000_000) // 2023-11-14T22:13:20Z
        let info = DebridAccountInfo(
            username: "user",
            email: "user@example.com",
            premiumExpiry: date,
            isPremium: true,
            points: 42
        )

        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        let expected = formatter.string(from: date)

        #expect(info.expiryString == expected)
    }

    @Test("DebridAccountInfo expiryString is nil when expiry is unknown")
    func accountInfoMissingExpiryString() {
        let info = DebridAccountInfo(
            username: "user",
            email: nil,
            premiumExpiry: nil,
            isPremium: false,
            points: nil
        )

        #expect(info.expiryString == nil)
    }
}
