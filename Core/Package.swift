// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LakesideCore",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [.library(name: "LakesideCore", targets: ["LakesideCore"])],
    targets: [.target(name: "LakesideCore"), .testTarget(name: "LakesideCoreTests", dependencies: ["LakesideCore"])]
)
