// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "DebridStreamer",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "DebridStreamer", targets: ["DebridStreamer"])
    ],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift", from: "7.0.0"),
    ],
    targets: [
        .binaryTarget(
            name: "VLCKit",
            path: "Vendor/VLCKit.xcframework"
        ),
        .executableTarget(
            name: "DebridStreamer",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
                "VLCKit",
            ],
            path: "Sources/DebridStreamer",
            linkerSettings: [
                .unsafeFlags([
                    "-Xlinker", "-rpath",
                    "-Xlinker", "@loader_path/../../../Vendor/VLCKit.xcframework/macos-arm64_x86_64"
                ])
            ]
        ),
        .testTarget(
            name: "DebridStreamerTests",
            dependencies: [
                "DebridStreamer",
                "VLCKit",
                .product(name: "GRDB", package: "GRDB.swift"),
            ],
            path: "Tests/DebridStreamerTests",
            linkerSettings: [
                .unsafeFlags([
                    "-Xlinker", "-rpath",
                    "-Xlinker", "@loader_path/../../../../../../Vendor/VLCKit.xcframework/macos-arm64_x86_64"
                ])
            ]
        ),
    ]
)
