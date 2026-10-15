import Foundation

/// Preserves evolving server fields while screens select the fields they present.
public enum JSONValue: Codable, Equatable, Sendable {
    case object([String: JSONValue]), array([JSONValue]), string(String), number(Double), bool(Bool), null

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let x = try? c.decode(Bool.self) { self = .bool(x) }
        else if let x = try? c.decode(Double.self) { self = .number(x) }
        else if let x = try? c.decode(String.self) { self = .string(x) }
        else if let x = try? c.decode([JSONValue].self) { self = .array(x) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .object(let x): try c.encode(x)
        case .array(let x): try c.encode(x)
        case .string(let x): try c.encode(x)
        case .number(let x): try c.encode(x)
        case .bool(let x): try c.encode(x)
        case .null: try c.encodeNil()
        }
    }
    public subscript(_ key: String) -> JSONValue { object[key] ?? .null }
    public var object: [String: JSONValue] { if case .object(let x) = self { return x }; return [:] }
    public var array: [JSONValue] { if case .array(let x) = self { return x }; return [] }
    public var string: String {
        switch self {
        case .string(let x): return x
        case .number(let x): return x.formatted(.number.grouping(.never))
        case .bool(let x): return x ? "Yes" : "No"
        default: return ""
        }
    }
    public var number: Double? { if case .number(let x) = self { return x }; return Double(string) }
    public var bool: Bool { self == .bool(true) }
    public var pretty: String {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return (try? String(decoding: encoder.encode(self), as: UTF8.self)) ?? ""
    }
    public func first(_ keys: String...) -> String { keys.map { self[$0].string }.first { !$0.isEmpty } ?? "" }
    public static func parse(_ text: String) throws -> JSONValue { try JSONDecoder().decode(Self.self, from: Data(text.utf8)) }
}

public enum Endpoint {
    public static func url(base: URL, path: String, query: [String: String] = [:]) throws -> URL {
        guard base.scheme == "https", base.host != nil, base.user == nil, base.password == nil,
              path.hasPrefix("/"), !path.hasPrefix("//"), !path.contains("\\"),
              var c = URLComponents(url: base, resolvingAgainstBaseURL: false) else { throw URLError(.badURL) }
        c.path = path; c.query = nil; c.fragment = nil
        if !query.isEmpty { c.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) } }
        guard let url = c.url else { throw URLError(.badURL) }; return url
    }
    public static func link(_ value: String, base: URL) -> URL? {
        guard !value.isEmpty, let url = URL(string: value, relativeTo: base)?.absoluteURL,
              url.scheme == "https", url.user == nil, url.password == nil else { return nil }
        return url
    }
}
