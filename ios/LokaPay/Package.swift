// swift-tools-version: 6.0
// LokaPay: the payment logic for the LOKA iPhone app (protocol/PAYMENT-V1.md).
// Pure Swift on first-party frameworks only (CryptoKit, Security, LocalAuthentication),
// so `swift test` runs on any Mac and in CI without the app or a device.
import PackageDescription

let package = Package(
    name: "LokaPay",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "LokaPay", targets: ["LokaPay"]),
    ],
    targets: [
        .target(name: "LokaPay"),
        .testTarget(name: "LokaPayTests", dependencies: ["LokaPay"]),
    ],
    swiftLanguageModes: [.v5]
)
