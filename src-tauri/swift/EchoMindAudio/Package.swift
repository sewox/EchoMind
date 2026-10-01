// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "EchoMindAudio",
    platforms: [.macOS(.v11)],
    products: [
        .library(name: "EchoMindAudio", type: .static, targets: ["EchoMindAudio"]),
    ],
    targets: [
        .target(name: "EchoMindAudio", path: "Sources/EchoMindAudio"),
    ]
)
