import Foundation

public struct Diagram: Sendable {
    public struct Series: Sendable { public let kind: String; public let values: [Double] }
    public struct Edge: Sendable { public let from: String; public let to: String; public let label: String }
    public var title = "Visualization"
    public var axis = "Value"
    public var labels: [String] = []
    public var series: [Series] = []
    public var edges: [Edge] = []
    public var kind = "unsupported"
    public init(_ source: String) {
        let lines = source.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }
        guard let first = lines.first else { return }
        if first.hasPrefix("pie") {
            kind = "pie"
            if let r = first.range(of: "title ") { title = Self.unquote(String(first[r.upperBound...])) }
            var values: [Double] = []
            for line in lines.dropFirst() {
                if let match = Self.match(#"^\s*"([^"]+)"\s*:\s*([-+\d.eE]+)\s*$"#, line), let value = Double(match[2]), value.isFinite, value >= 0 {
                    labels.append(match[1]); values.append(value)
                }
            }
            series = [Series(kind: "pie", values: values)]
            if values.isEmpty || values.reduce(0, +) <= 0 { kind = "unsupported" }
        } else if first.hasPrefix("xychart") {
            kind = "xy"
            for line in lines.dropFirst() {
                if line.hasPrefix("title ") { title = Self.unquote(String(line.dropFirst(6))) }
                if let m = Self.match(#"x-axis\s*(?:"[^"]*"\s*)?(\[.*\])"#, line) { labels = Self.list(m[1]) }
                if let m = Self.match(#"y-axis\s*"([^"]*)""#, line) { axis = m[1] }
                if let m = Self.match(#"^(bar|line)\s*(\[.*\])"#, line) {
                    let raw = Self.list(m[2]); let values = raw.compactMap(Double.init)
                    if values.count == raw.count && values.allSatisfy(\.isFinite) { series.append(Series(kind: m[1], values: values)) }
                }
            }
            if labels.isEmpty, let count = series.first?.values.count { labels = (1...max(1, count)).map(String.init) }
            if !series.allSatisfy({ $0.values.count == labels.count }) { kind = "unsupported" }
        } else if first.hasPrefix("flowchart") || first.hasPrefix("graph") || first.hasPrefix("sequenceDiagram") || first.hasPrefix("stateDiagram") {
            kind = "flow"
            var names: [String: String] = [:]
            for line in lines {
                for m in Self.matches(#"([A-Za-z_][\w-]*)\s*[\[({]+\s*"?([^\]\)}]+?)"?\s*[\]\)}]+"#, line) {
                    names[m[1]] = Self.unquote(m[2]).replacingOccurrences(of: "<br/>", with: "\n").replacingOccurrences(of: "<br>", with: "\n")
                }
                if let m = Self.match(#"^participant\s+(\w+)\s+as\s+(.+)$"#, line) { names[m[1]] = m[2] }
            }
            for line in lines.dropFirst() {
                let clean = line.replacingOccurrences(of: #"([A-Za-z_][\w-]*)\s*[\[({]+[^\]\)}]*[\]\)}]+"#, with: "$1", options: .regularExpression)
                // Look ahead so a shared middle node in A --> B --> C is retained.
                for m in Self.matches(#"(?=\b([A-Za-z_][\w]*)(?:\s*)(?:-->>?|==>|-\.->|->>|-->)(?:\s*)(?:\|([^|]*)\|\s*)?([A-Za-z_][\w]*)(?:\s*:\s*([^;]*))?)"#, clean) {
                    edges.append(Edge(from: names[m[1]] ?? m[1], to: names[m[3]] ?? m[3], label: m[2].isEmpty ? m[4] : m[2]))
                }

            }
            if edges.isEmpty { kind = "unsupported" }
        }
    }
    private static func unquote(_ text: String) -> String {
        if let data = text.data(using: .utf8), let value = try? JSONDecoder().decode(String.self, from: data) { return value }
        return text.trimmingCharacters(in: CharacterSet(charactersIn: "\""))
    }
    private static func list(_ text: String) -> [String] {
        if let data = text.data(using: .utf8), let values = try? JSONSerialization.jsonObject(with: data) as? [Any] {
            return values.map { String(describing: $0) }
        }
        return text.trimmingCharacters(in: CharacterSet(charactersIn: "[]")).split(separator: ",").map { unquote($0.trimmingCharacters(in: .whitespaces)) }
    }
    private static func match(_ pattern: String, _ text: String) -> [String]? { matches(pattern, text).first }
    private static func matches(_ pattern: String, _ text: String) -> [[String]] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        return regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).map { match in
            (0..<match.numberOfRanges).map { index in Range(match.range(at: index), in: text).map { String(text[$0]) } ?? "" }
        }
    }
}
