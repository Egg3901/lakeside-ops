import Foundation

/// An outside company that may receive an Ask server question, as listed by
/// `/api/me` `aiProviders`.
public struct AIRecipient: Hashable, Sendable {
    public let name: String
    public let detail: String
    public init(name: String, detail: String) {
        self.name = name
        self.detail = detail
    }
}

/// App Store guideline 5.1.2(i): name the outside AI services and record the
/// player's permission before a question reaches them. Permission is tied to
/// the exact list, so a provider added on the server asks again. The signature
/// format matches the in-game Ask surfaces.
public enum AIConsent {
    /// Used only when the Ask server predates the `aiProviders` field.
    public static let fallback: [AIRecipient] = [
        AIRecipient(name: "Meta", detail: "Muse Spark models. On Meta's contributor tier, Meta may use the question and answer to train its models"),
        AIRecipient(name: "Ollama", detail: "Ollama Cloud hosted models"),
        AIRecipient(name: "DeepSeek", detail: "DeepSeek models, operated from China"),
        AIRecipient(name: "Command Code", detail: "MiniMax models"),
        AIRecipient(name: "OpenRouter", detail: "relays to the vendor of the chosen model"),
        AIRecipient(name: "Google", detail: "Gemini models"),
    ]

    public static func recipients(from profile: JSONValue) -> [AIRecipient] {
        let listed = profile["aiProviders"].array.compactMap { item -> AIRecipient? in
            let name = item["name"].string.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty else { return nil }
            return AIRecipient(name: name, detail: item["detail"].string)
        }
        return listed.isEmpty ? fallback : listed
    }

    public static func signature(_ recipients: [AIRecipient]) -> String {
        recipients.map { "\($0.name)|\($0.detail)" }.sorted().joined(separator: "\n")
    }
}

/// Content-Type handling that accepts parameters and structured suffixes.
public enum MediaType {
    /// The lowercased `type/subtype` without parameters.
    public static func essence(_ contentType: String?) -> String {
        guard let contentType else { return "" }
        let head = contentType.split(separator: ";", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        return head.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
    public static func isJSON(_ contentType: String?) -> Bool {
        let value = essence(contentType)
        return value == "application/json" || (value.hasPrefix("application/") && value.hasSuffix("+json"))
    }
    public static func isHTML(_ contentType: String?) -> Bool {
        let value = essence(contentType)
        return value == "text/html" || value == "application/xhtml+xml"
    }
    public static func isEventStream(_ contentType: String?) -> Bool { essence(contentType) == "text/event-stream" }
}

/// What actually went wrong, so the app can say it truthfully.
public enum FailureKind: Equatable, Sendable {
    case signedOut
    case network
    case rateLimited
    case quotaExhausted
    case forbidden
    case notFound
    case server(Int)
    case unexpectedResponse
    case rejected(Int)

    public static func classify(status: Int, payload: JSONValue) -> FailureKind {
        switch status {
        case 401: return .signedOut
        case 403: return payload["signedOut"].bool ? .signedOut : .forbidden
        case 404: return .notFound
        case 429: return payload["quota"].bool ? .quotaExhausted : .rateLimited
        case 500...599: return .server(status)
        default: return .rejected(status)
        }
    }

    public var title: String {
        switch self {
        case .signedOut: return "Signed out"
        case .network: return "No connection"
        case .rateLimited: return "Too many requests"
        case .quotaExhausted: return "Daily limit reached"
        case .forbidden: return "Not available"
        case .notFound: return "Not found"
        case .server: return "Server problem"
        case .unexpectedResponse: return "Unexpected response"
        case .rejected: return "Request not accepted"
        }
    }

    /// The message used when the server did not supply one.
    public var defaultMessage: String {
        switch self {
        case .signedOut: return "Your session ended. Sign in again."
        case .network: return "Could not reach the server. Check your connection and try again."
        case .rateLimited: return "Too many requests in a short time. Wait a moment and try again."
        case .quotaExhausted: return "You have used today's allowance. It resets tomorrow."
        case .forbidden: return "Your account does not have access to this."
        case .notFound: return "This is not available on the server."
        case .server(let code): return "The server had a problem (HTTP \(code)). Try again shortly."
        case .unexpectedResponse: return "The server sent a response the app could not read. Try again shortly."
        case .rejected(let code): return "The server did not accept the request (HTTP \(code))."
        }
    }
}

/// Matches the server: questions are trimmed and measured in UTF-16 code
/// units, which is how JavaScript counts `String.length`.
public enum QuestionLimit {
    public static let minimum = 5
    public static let maximum = 500
    public static func count(_ text: String) -> Int {
        text.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count
    }
    public static func fits(_ text: String) -> Bool { (minimum...maximum).contains(count(text)) }
}

/// Client-generated ids. The server accepts `convId` as `[A-Za-z0-9_-]{6,40}`
/// and `clientReqId` as `[A-Za-z0-9_-]{8,64}`.
public enum ClientID {
    public static func make(length: Int = 18) -> String {
        String(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(max(8, min(length, 32))))
    }
    public static func isValidConversation(_ value: String) -> Bool { matches(value, 6...40) }
    public static func isValidRequest(_ value: String) -> Bool { matches(value, 8...64) }
    private static func matches(_ value: String, _ range: ClosedRange<Int>) -> Bool {
        range.contains(value.count) && value.unicodeScalars.allSatisfy {
            ($0.isASCII && CharacterSet.alphanumerics.contains($0)) || $0 == "_" || $0 == "-"
        }
    }
}

/// The server's reply to `POST /api/ask/stop`. Servers before Ask 3.0.0 only
/// know the `reqId` from the stream's `meta` event and answer `ok: false` for
/// an id they never saw, so the app must not claim the answer was discarded.
public enum StopResult: Equatable, Sendable {
    /// The server aborted the answer. Nothing is saved or charged.
    case confirmed
    /// The server will abort the answer when it arrives.
    case pending
    /// The server did not recognise the request. It may still finish.
    case unconfirmed

    public init(_ value: JSONValue) {
        guard value["ok"].bool else { self = .unconfirmed; return }
        self = value["pending"].bool ? .pending : .confirmed
    }
    public var discarded: Bool { self != .unconfirmed }
}

public struct ExportSource: Equatable, Sendable {
    public let label: String
    public let url: String
    public init(label: String, url: String) {
        self.label = label
        self.url = url
    }
}

/// A conversation turn as exported to Markdown.
public struct ExportTurn: Sendable {
    public let question: String
    public let answer: String
    public let model: String
    public let sources: [ExportSource]
    public init(question: String, answer: String, model: String = "", sources: [ExportSource] = []) {
        self.question = question
        self.answer = answer
        self.model = model
        self.sources = sources
    }
}

public enum ConversationExport {
    public static func markdown(title: String, turns: [ExportTurn], exported: Date = Date()) -> String {
        let heading = title.trimmingCharacters(in: .whitespacesAndNewlines)
        var lines = ["# \(heading.isEmpty ? "Lakeside Ask conversation" : heading)", ""]
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        lines.append("Exported from Lakeside Ask on \(formatter.string(from: exported)).")
        for turn in turns {
            lines.append("")
            lines.append("## \(turn.question.replacingOccurrences(of: "\n", with: " "))")
            lines.append("")
            lines.append(turn.answer.trimmingCharacters(in: .whitespacesAndNewlines))
            if !turn.model.isEmpty {
                lines.append("")
                lines.append("_Answered by \(turn.model)_")
            }
            if !turn.sources.isEmpty {
                lines.append("")
                lines.append("Sources:")
                for (index, source) in turn.sources.enumerated() {
                    let label = source.label.isEmpty ? "Source \(index + 1)" : source.label
                    lines.append(source.url.isEmpty ? "\(index + 1). \(label)" : "\(index + 1). [\(label)](\(source.url))")
                }
            }
        }
        return lines.joined(separator: "\n") + "\n"
    }

    /// A safe file name for the share sheet.
    public static func fileName(_ title: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: " -_"))
        let cleaned = String(title.unicodeScalars.map { allowed.contains($0) ? Character($0) : " " })
            .split(separator: " ").joined(separator: " ")
        let base = String(cleaned.prefix(60)).trimmingCharacters(in: .whitespaces)
        return (base.isEmpty ? "Lakeside Ask conversation" : base) + ".md"
    }
}

/// Epoch milliseconds or ISO 8601 text, as different Ask endpoints use.
public enum ServerDate {
    public static func parse(_ value: JSONValue) -> Date? {
        if case .number(let millis) = value, millis.isFinite, millis > 0 { return Date(timeIntervalSince1970: millis / 1000) }
        let text = value.string
        guard !text.isEmpty else { return nil }
        let precise = ISO8601DateFormatter()
        precise.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = precise.date(from: text) { return date }
        let plain = ISO8601DateFormatter()
        if let date = plain.date(from: text) { return date }
        if let millis = Double(text), millis > 0 { return Date(timeIntervalSince1970: millis / 1000) }
        return nil
    }
}

/// Follow-up pricing from `/api/nextcost`, phrased for the composer.
public struct NextCost: Equatable, Sendable {
    public let cost: Double?
    public let followup: Int
    public let followupsLeft: Int?
    public init(_ value: JSONValue) {
        cost = value["cost"].number.flatMap { $0.isFinite && $0 >= 0 ? $0 : nil }
        followup = Int(value["followup"].number ?? 0)
        followupsLeft = value["followupsLeft"].number.map { Int($0) }
    }
    public var costLabel: String? {
        guard let cost else { return nil }
        let amount = cost == cost.rounded() ? String(Int(cost)) : String(cost)
        return "\(amount) credit\(cost == 1 ? "" : "s")"
    }
    /// Empty for a new thread; otherwise the discounted follow-ups that remain.
    public var followupLabel: String? {
        guard followup > 0 else { return nil }
        guard let left = followupsLeft else { return "Follow-up \(followup)" }
        return left == 0 ? "Last discounted follow-up" : "Follow-up \(followup), \(left) more at this rate"
    }
}
