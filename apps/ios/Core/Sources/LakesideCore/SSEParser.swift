import Foundation

public struct SSEEvent: Equatable, Sendable {
    public let name: String
    public let data: String
    /// Public so a JSON answer (cached or short-circuited by the server) can
    /// flow through the same handler as a streamed one.
    public init(name: String, data: String) {
        self.name = name
        self.data = data
    }
}

/// Byte-oriented framing preserves blank lines and UTF-8 across network chunks.
public struct SSEParser {
    private var line: [UInt8] = []
    private var name = "message"
    private var data: [String] = []
    private var size = 0
    private var wasCR = false
    private var firstLine = true
    public init() {}

    public mutating func feed(_ byte: UInt8) throws -> SSEEvent? {
        if byte == 10 && wasCR { wasCR = false; return nil }
        wasCR = byte == 13
        if byte == 10 || byte == 13 { return try finishLine() }
        guard line.count < 8 * 1024 * 1024 else { throw URLError(.dataLengthExceedsMaximum) }
        line.append(byte); return nil
    }
    private mutating func finishLine() throws -> SSEEvent? {
        var text = String(decoding: line, as: UTF8.self); line.removeAll(keepingCapacity: true)
        if firstLine { firstLine = false; if text.first == "\u{FEFF}" { text.removeFirst() } }
        if text.isEmpty {
            defer { name = "message"; data = []; size = 0 }
            return data.isEmpty ? nil : SSEEvent(name: name.isEmpty ? "message" : name, data: data.joined(separator: "\n"))
        }
        if text.hasPrefix(":") { return nil }
        let pair = text.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
        var value = pair.count == 2 ? String(pair[1]) : ""
        if value.hasPrefix(" ") { value.removeFirst() }
        if pair[0] == "event" { name = value }
        if pair[0] == "data" {
            size += value.utf8.count + 1
            guard size <= 8 * 1024 * 1024 else { throw URLError(.dataLengthExceedsMaximum) }
            data.append(value)
        }
        return nil
    }
}
