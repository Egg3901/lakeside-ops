import ActivityKit

struct KeirActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var status: String
        var count: Int
        var updatedAt: Double
        var stopped: Bool
    }
    var server: String
}
