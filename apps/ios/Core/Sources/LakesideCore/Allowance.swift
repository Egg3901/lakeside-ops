import Foundation

/// A missing limit is unknown, not an unlimited or empty allowance.
public struct Allowance: Equatable, Sendable {
    public let limit: Double?
    public let remaining: Double?
    public init(limit: Double?, remaining: Double?) {
        let validLimit = limit.flatMap { $0.isFinite && $0 >= 0 ? $0 : nil }
        self.limit = validLimit
        self.remaining = remaining.flatMap { value in
            guard value.isFinite, value >= 0 else { return nil }
            return validLimit.map { min(value, $0) } ?? value
        }
    }
    public var fractionRemaining: Double? {
        guard let limit, let remaining else { return nil }
        return limit > 0 ? remaining / limit : 0
    }
    public var low: Bool { (fractionRemaining ?? 1) <= 0.2 && (limit ?? 0) > 0 }
}
